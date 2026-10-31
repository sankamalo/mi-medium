// Cámara externa (solo en el espejo del Mac): una webcam o el iPhone te graba desde fuera y la
// escultura se pinta encima, en su sitio, como si estuviera de verdad delante de ti.
//
// - Calibración: con las gafas puestas mueves las manos delante de la webcam. La cámara detecta
//   tus manos y las empareja con los mandos que mandan las gafas: con esos cientos de pares
//   (punto 3D de las gafas ↔ píxel de la webcam) se calcula dónde está la cámara, su lente y el retraso.
// - Retraso: la webcam suele ir por detrás de las gafas; las poses se retrasan para casar.
// - Grabación: el lienzo (vídeo + escultura) se graba y se va guardando en el Mac a trozos
//   (carpeta grabaciones/), así no se pierde nada si algo se cuelga.
import * as THREE from 'three';
import { t } from './i18n.js';
import { loadHands, detectHands } from './manos.js';

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ---------- Cámara estenopeica: proyección y ajuste (Levenberg-Marquardt) ----------
// Parámetros: [rx, ry, rz] giro (eje·ángulo, cámara → mundo), [cx, cy, cz] posición, lf = log(f/h),
// y opcionalmente dónde queda la palma respecto a cada mando (3 + 3, en coordenadas del mando).
// Como en three.js, la cámara mira hacia -Z; píxeles con y hacia abajo y el centro óptico en medio.
function rotMat(rx, ry, rz) {
  const a = Math.hypot(rx, ry, rz);
  if (a < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const x = rx / a, y = ry / a, z = rz / a, c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
}

// Lente de webcam normal: unos 45° en vertical, y nunca fuera de 25°–75° (con pocos datos buenos
// el ajuste se iría a un gran angular absurdo con los mandos al fondo).
const LF0 = Math.log(0.5 / Math.tan(THREE.MathUtils.degToRad(22.5)));
const LF_MIN = Math.log(0.5 / Math.tan(THREE.MathUtils.degToRad(37.5)));
const LF_MAX = Math.log(0.5 / Math.tan(THREE.MathUtils.degToRad(12.5)));

// Error en píxeles de una observación { x, y, z, m, k, u, v }. Devuelve en err[0], err[1].
const err = [0, 0];
function pixelError(p, R, f, o, w, h) {
  let X = o.x, Y = o.y, Z = o.z;
  if (p.length > 7) {
    const k = 7 + o.k * 3, M = o.m;
    X += M[0] * p[k] + M[1] * p[k + 1] + M[2] * p[k + 2];
    Y += M[3] * p[k] + M[4] * p[k + 1] + M[5] * p[k + 2];
    Z += M[6] * p[k] + M[7] * p[k + 1] + M[8] * p[k + 2];
  }
  const dx = X - p[3], dy = Y - p[4], dz = Z - p[5];
  // pc = Rᵀ (X - C)
  const x = R[0] * dx + R[3] * dy + R[6] * dz, y = R[1] * dx + R[4] * dy + R[7] * dz, z = R[2] * dx + R[5] * dy + R[8] * dz;
  if (z > -0.05) { err[0] = err[1] = 1e4; return; } // detrás de la cámara
  err[0] = w / 2 + (f * x) / -z - o.u;
  err[1] = h / 2 - (f * y) / -z - o.v;
}

// Residuos: píxeles con pérdida de Cauchy (los puntos malos casi no cuentan) + condiciones suaves:
// lente normal, cámara sin ladear y palma cerca del mando.
function residuals(p, obs, w, h, c, out) {
  const R = rotMat(p[0], p[1], p[2]), f = Math.exp(p[6]) * h, N = obs.length;
  for (let i = 0; i < N; i++) {
    pixelError(p, R, f, obs[i], w, h);
    const e = Math.hypot(err[0], err[1]), s = e > 1e-9 ? (c * Math.sqrt(Math.log1p((e / c) * (e / c)))) / e : 1;
    out[i * 2] = err[0] * s;
    out[i * 2 + 1] = err[1] * s;
  }
  const scale = (h / 1080) * Math.sqrt(N), lf = p[6];
  out[N * 2] = 20 * scale * (lf - LF0) + 1e4 * (Math.max(0, lf - LF_MAX) + Math.max(0, LF_MIN - lf));
  out[N * 2 + 1] = 30 * scale * R[3];
  for (let k = 7; k < p.length; k++) out[N * 2 + 2 + k - 7] = 20 * scale * p[k];
  return out;
}

const sq = (r) => r.reduce((a, v) => a + v * v, 0);

function solveLinear(A, b) { // Gauss con pivote
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-15) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const k = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let j = r + 1; j < n; j++) s -= M[r][j] * x[j];
    x[r] = s / M[r][r];
  }
  return x;
}

function refine(p0, obs, w, h, c, iters) {
  let p = p0.slice(), lam = 1e-3;
  const P = p.length, m = obs.length * 2 + 2 + (P - 7), r = new Float64Array(m), r2 = new Float64Array(m);
  let cost = sq(residuals(p, obs, w, h, c, r));
  for (let it = 0; it < iters; it++) {
    const J = [];
    for (let k = 0; k < P; k++) {
      const q = p.slice(), e = 1e-5;
      q[k] += e;
      residuals(q, obs, w, h, c, r2);
      J.push(Float64Array.from(r2, (v, i) => (v - r[i]) / e));
    }
    const dot = (a, b) => { let s = 0; for (let i = 0; i < m; i++) s += a[i] * b[i]; return s; };
    const A = [];
    for (let i = 0; i < P; i++) { A.push(new Array(P)); for (let j = 0; j <= i; j++) A[i][j] = A[j][i] = dot(J[i], J[j]); }
    const g = J.map((a) => dot(a, r));
    let improved = false;
    for (let tries = 0; tries < 8 && !improved; tries++) {
      const B = A.map((row, i) => row.map((v, j) => (i === j ? v * (1 + lam) + 1e-12 : v)));
      const d = solveLinear(B, g.map((v) => -v));
      if (!d) { lam *= 10; continue; }
      const q = p.map((v, i) => v + d[i]);
      const e2 = sq(residuals(q, obs, w, h, c, r2));
      if (e2 < cost) { p = q; cost = e2; r.set(r2); lam = Math.max(1e-7, lam / 5); improved = true; }
      else lam *= 10;
    }
    if (!improved) break;
  }
  return p;
}

const median = (a) => { const b = Float64Array.from(a).sort(); return b.length ? b[b.length >> 1] : Infinity; };
const every = (a, max) => (a.length <= max ? a : Array.from({ length: max }, (_, i) => a[Math.floor((i * a.length) / max)]));
function pixelErrors(p, obs, w, h) {
  const R = rotMat(p[0], p[1], p[2]), f = Math.exp(p[6]) * h;
  return obs.map((o) => { pixelError(p, R, f, o, w, h); return Math.hypot(err[0], err[1]); });
}
function quatMat(a) { // [_, _, _, x, y, z, w] → matriz por filas
  const [x, y, z, q] = [a[3], a[4], a[5], a[6]];
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * q), 2 * (x * z + y * q),
    2 * (x * y + z * q), 1 - 2 * (x * x + z * z), 2 * (y * z - x * q),
    2 * (x * z - y * q), 2 * (y * z + x * q), 1 - 2 * (x * x + y * y),
  ];
}

// samples: [{ t, u, v, label }] manos vistas en la webcam (hora, píxel, izquierda/derecha según la
// detección, que no es de fiar). poses: [{ t, m }] lo que han mandado las gafas.
export function solveCamera(samples, poses, w, h, delay0 = 120) {
  // Mando k en el instante de cada muestra, suponiendo un retraso d.
  const handsAt = (d) => {
    const out = [];
    let i = 0;
    for (const s of samples) {
      const T = s.t - d;
      if (T < poses[0].t || T > poses[poses.length - 1].t) continue;
      while (i > 0 && poses[i].t > T) i--;
      while (i < poses.length - 2 && poses[i + 1].t <= T) i++;
      const a = poses[i], b = poses[i + 1] || a, f = (T - a.t) / (b.t - a.t || 1);
      if (b.t - a.t > 300) continue; // hueco en las poses
      const H = a.m.hands.map((q, k) => {
        const v = mixTransform(q, b.m.hands[k], f);
        return v && { x: v[0], y: v[1], z: v[2], m: quatMat(v), k };
      });
      out.push({ s, H });
    }
    return out;
  };
  const obsOf = (e, k) => ({ ...e.H[k], u: e.s.u, v: e.s.v });
  // A cada mano vista le corresponde el mando que mejor cae encima con la cámara actual.
  const nearest = (p, list) => {
    const R = rotMat(p[0], p[1], p[2]), f = Math.exp(p[6]) * h, out = [];
    for (const e of list) {
      let best = null, bestE = Infinity;
      e.H.forEach((H, k) => {
        if (!H) return;
        const o = obsOf(e, k);
        pixelError(p, R, f, o, w, h);
        const d = Math.hypot(err[0], err[1]);
        if (d < bestE) { bestE = d; best = o; }
      });
      if (best) out.push({ o: best, e: bestE });
    }
    return out;
  };

  let delay = delay0;
  let list = handsAt(delay);
  if (list.length < 30) return null;

  // 1) Arranques desde muchas posiciones alrededor de los puntos, mirándolos. Se prueban las dos
  //    formas de emparejar izquierda/derecha.
  const gv = new THREE.Vector3(), m = new THREE.Matrix4(), q = new THREE.Quaternion();
  const c = 0.04 * h;
  let best = null, bestE = Infinity;
  for (const map of [{ Left: 0, Right: 1 }, { Left: 1, Right: 0 }]) {
    const obs = every(list.map((e) => (e.H[map[e.s.label] ?? 0] ? obsOf(e, map[e.s.label] ?? 0) : null)).filter(Boolean), 60);
    if (obs.length < 10) continue;
    gv.set(0, 0, 0);
    obs.forEach((o) => gv.add(new THREE.Vector3(o.x, o.y, o.z).divideScalar(obs.length)));
    const N = 48;
    for (let i = 0; i < N; i++) {
      const y = 1 - (2 * (i + 0.5)) / N, rr = Math.sqrt(1 - y * y), a = i * 2.39996;
      for (const D of [0.4, 0.8, 1.6, 3]) {
        const eye = new THREE.Vector3(Math.cos(a) * rr, y * 0.6, Math.sin(a) * rr).normalize().multiplyScalar(D).add(gv);
        m.lookAt(eye, gv, new THREE.Vector3(0, 1, 0));
        q.setFromRotationMatrix(m);
        const ang = 2 * Math.acos(Math.min(1, Math.abs(q.w))), sgn = q.w < 0 ? -1 : 1, sn = Math.sin(ang / 2) || 1;
        const p = refine([q.x * sgn / sn * ang, q.y * sgn / sn * ang, q.z * sgn / sn * ang, eye.x, eye.y, eye.z, LF0], obs, w, h, c, 15);
        const e = median(pixelErrors(p, obs, w, h));
        if (e < bestE) { bestE = e; best = p; }
      }
    }
  }
  if (!best) return null;

  // 2) Afinar con todos: reparto mano ↔ mando, fuera los que no cuadran, y otra vez.
  let p = [...best, 0, 0, 0, 0, 0, 0], kept = [];
  for (let round = 0; round < 5; round++) {
    const near = nearest(p, list);
    const limit = Math.max(0.035 * h, 2.5 * median(near.map((n) => n.e)));
    kept = near.filter((n) => n.e < limit).map((n) => n.o);
    if (kept.length < 10) return null;
    p = refine(p, every(kept, 300), w, h, 0.03 * h, 20);
    // 3) El retraso que mejor casa vídeo y gafas (a partir de que la cámara ya esté cerca).
    if (round === 1 || round === 3) {
      let bestD = delay, bestM = Infinity;
      for (let d = 0; d <= 400; d += 20) {
        const e = median(nearest(p, handsAt(d)).map((n) => n.e));
        if (e < bestM) { bestM = e; bestD = d; }
      }
      delay = bestD;
      list = handsAt(delay);
    }
  }

  const near = nearest(p, list), errors = near.map((n) => n.e);
  const [rx, ry, rz, cx, cy, cz, lf] = p;
  const ang = Math.hypot(rx, ry, rz);
  const quat = ang < 1e-12 ? new THREE.Quaternion() : new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(rx / ang, ry / ang, rz / ang), ang);
  const f = Math.exp(lf) * h, G = new THREE.Vector3();
  kept.forEach((o) => G.add(new THREE.Vector3(o.x, o.y, o.z).divideScalar(kept.length)));
  return {
    pos: [cx, cy, cz], quat: quat.toArray(), fov: THREE.MathUtils.radToDeg(2 * Math.atan(h / 2 / f)), w, h,
    error: median(errors), good: errors.filter((e) => e < 0.04 * h).length / errors.length, delay,
    distance: G.distanceTo(new THREE.Vector3(cx, cy, cz)),
    offsets: [p.slice(7, 10), p.slice(10, 13)],
  };
}

// ---------- Poses con retraso ----------
function mixTransform(a, b, t) { // [x,y,z, qx,qy,qz,qw]
  if (!a || !b) return t < 0.5 ? a : b;
  const out = new Array(7), qa = new THREE.Quaternion(a[3], a[4], a[5], a[6]), qb = new THREE.Quaternion(b[3], b[4], b[5], b[6]);
  for (let k = 0; k < 3; k++) out[k] = a[k] + (b[k] - a[k]) * t;
  qa.slerp(qb, t);
  out[3] = qa.x; out[4] = qa.y; out[5] = qa.z; out[6] = qa.w;
  return out;
}
function mixPose(a, b, t) {
  const m = { ...(t < 0.5 ? a : b) };
  m.head = mixTransform(a.head, b.head, t);
  m.hands = a.hands.map((h, i) => mixTransform(h, b.hands[i], t));
  const ma = a.model, mb = b.model, mm = mixTransform(ma.slice(0, 7), mb.slice(0, 7), t);
  m.model = [...mm, ma[7] + (mb[7] - ma[7]) * t];
  return m;
}

// ---------- Rig de la webcam ----------
// ctx: { renderer, scene, camera, toast, api, onLayoutReset }
export function createWebcam(ctx) {
  const { renderer, scene, camera, toast } = ctx;
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  const rig = {
    active: false,
    stream: null,
    label: '',
    texture: null,
    calib: null,
    delay: store.get('plastilinaCamDelay', 120),
    showCtrls: false,
    poses: [],
  };

  rig.devices = async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      return all.filter((d) => d.kind === 'videoinput');
    } catch { return []; }
  };

  rig.start = async (deviceId) => {
    rig.stop();
    try {
      rig.stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
        audio: false,
      });
    } catch (e) {
      toast(t('No puedo abrir la cámara: {0}', e.message), 5000);
      return false;
    }
    const track = rig.stream.getVideoTracks()[0];
    rig.label = track.label || 'webcam';
    video.srcObject = rig.stream;
    await video.play().catch(() => {});
    if (!video.videoWidth) await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }));
    rig.texture = new THREE.VideoTexture(video);
    rig.texture.colorSpace = THREE.SRGBColorSpace;
    rig.active = true;
    rig.calib = store.get('plastilinaCam', {})[rig.label] || null;
    if (rig.calib && (rig.calib.w !== video.videoWidth || rig.calib.h !== video.videoHeight)) rig.calib = null;
    if (!rig.calib) toast('Cámara lista. Pulsa "Calibrar" para encajar la escultura con el vídeo', 5000);
    rig.layout();
    return true;
  };

  rig.stop = () => {
    if (rig.stream) rig.stream.getTracks().forEach((t) => t.stop());
    rig.stream = null;
    if (rig.texture) rig.texture.dispose();
    rig.texture = null;
    if (rig.active) {
      rig.active = false;
      const c = renderer.domElement;
      c.style.marginLeft = c.style.marginTop = '';
      ctx.onLayoutReset();
    }
  };

  rig.size = () => [video.videoWidth || 1280, video.videoHeight || 720];

  // El lienzo a la resolución del vídeo (es lo que se graba), encajado en la ventana.
  rig.layout = () => {
    if (!rig.active) return;
    const [w, h] = rig.size();
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    const s = Math.min(innerWidth / w, innerHeight / h), c = renderer.domElement;
    c.style.width = Math.round(w * s) + 'px';
    c.style.height = Math.round(h * s) + 'px';
    c.style.marginLeft = Math.round((innerWidth - w * s) / 2) + 'px';
    c.style.marginTop = Math.round((innerHeight - h * s) / 2) + 'px';
    camera.aspect = w / h;
    rig.applyCamera();
  };

  rig.applyCamera = () => {
    if (!rig.active) return;
    scene.background = rig.texture;
    const c = rig.calib || { pos: [0, 1.4, 1.6], quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.15, 0, 0)).toArray(), fov: 45 };
    camera.position.fromArray(c.pos);
    camera.quaternion.fromArray(c.quat);
    if (camera.fov !== c.fov) { camera.fov = c.fov; camera.updateProjectionMatrix(); }
  };

  rig.save = () => {
    const all = store.get('plastilinaCam', {});
    all[rig.label] = rig.calib;
    store.set('plastilinaCam', all);
  };

  // Retoque a mano: flechas giran, Mayús+flechas mueven, +/- cambian el zoom.
  rig.nudge = (e) => {
    if (!rig.active || !rig.calib) return false;
    const c = rig.calib, q = new THREE.Quaternion().fromArray(c.quat), p = new THREE.Vector3().fromArray(c.pos);
    const step = THREE.MathUtils.degToRad(0.15), mv = 0.005;
    const dir = { arrowleft: [0, 1], arrowright: [0, -1], arrowup: [1, 1], arrowdown: [1, -1] }[e.key.toLowerCase()];
    if (dir && e.shiftKey) {
      const v = dir[0] ? new THREE.Vector3(0, dir[1] * mv, 0) : new THREE.Vector3(-dir[1] * mv, 0, 0);
      p.add(v.applyQuaternion(q));
    } else if (dir) {
      const axis = dir[0] ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(axis, step * dir[1]));
    } else if (e.key === '+' || e.key === '=') c.fov = Math.max(10, c.fov - 0.3);
    else if (e.key === '-') c.fov = Math.min(120, c.fov + 0.3);
    else return false;
    c.pos = p.toArray();
    c.quat = q.toArray();
    rig.save();
    rig.applyCamera();
    return true;
  };

  rig.setDelay = (ms) => { rig.delay = ms; store.set('plastilinaCamDelay', ms); };

  // Poses: se guardan con su hora de llegada; en modo webcam se usa la de hace `delay` ms.
  rig.push = (m) => {
    const t = performance.now();
    rig.poses.push({ t, m });
    if (rig.history) rig.history.push({ t, m }); // calibrando: se guardan todas
    while (rig.poses.length > 2 && rig.poses[0].t < t - 2000) rig.poses.shift();
  };
  rig.poseAt = (t) => {
    const P = rig.poses;
    if (!P.length) return null;
    if (t <= P[0].t) return P[0].m;
    for (let i = P.length - 1; i >= 0; i--) {
      if (P[i].t <= t) {
        const a = P[i], b = P[i + 1];
        if (!b) return a.m;
        return mixPose(a.m, b.m, (t - a.t) / (b.t - a.t || 1));
      }
    }
    return P.at(-1).m;
  };
  rig.delayed = () => rig.poseAt(performance.now() - rig.delay);

  // ---------- Calibración ----------
  let audio = null;
  const beep = (freq = 660, dur = 0.12) => {
    try {
      audio = audio || new AudioContext();
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.25, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + dur);
      o.connect(g).connect(audio.destination);
      o.start();
      o.stop(audio.currentTime + dur);
    } catch {}
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Una mano detectada por fotograma cuenta; rig.detector solo existe para las pruebas.
  const nextFrame = () => new Promise((r) => {
    const timer = setTimeout(r, 200);
    video.requestVideoFrameCallback?.(() => { clearTimeout(timer); r(); });
  });

  // Mueves las manos, se recogen muestras hasta cubrir bastante espacio, y se calcula.
  rig.capture = async (ui, w, h) => {
    const notify = ctx.notify || (() => {});
    const detect = rig.detector || detectHands;
    const samples = [], cells = new Set();
    const T0 = performance.now(), NEED_CELLS = 45, NEED_SAMPLES = 400, MAX_MS = 60000;
    ui.say(t('Ponte las gafas (bien puestas, no en la frente) y coge los dos mandos.<br>' +
      'Mueve las manos <b>despacio y delante de la webcam</b>: arriba, abajo, cerca, lejos, a los lados.<br>' +
      'Los puntos verdes son tus manos detectadas.'), '');
    notify('Mueve las manos despacio delante de la webcam');
    beep(440, 0.2);
    let lastSeen = T0;
    while (!ui.cancelled) {
      await nextFrame();
      if (ui.cancelled) break;
      const now = performance.now();
      const seen = detect(video);
      ui.dots(seen);
      const last = rig.poses[rig.poses.length - 1];
      const flowing = last && now - last.t < 1500 && last.m.hands.some(Boolean);
      if (flowing) for (const s of seen) samples.push({ t: now, u: s.x * w, v: s.y * h, label: s.label });
      if (seen.length) lastSeen = now;
      if (flowing && seen.length) {
        const pose = rig.poseAt(now - rig.delay);
        pose?.hands.forEach((q, k) => { if (q) cells.add(k + ':' + q.slice(0, 3).map((v) => Math.floor(v / 0.06)).join()); });
      }
      const done = Math.min(1, Math.min(cells.size / NEED_CELLS, samples.length / NEED_SAMPLES));
      ui.big(`${Math.round(done * 100)}%`);
      ui.sub(!flowing ? t('No llegan los mandos de las gafas')
        : now - lastSeen > 1500 ? t('No veo tus manos: ponlas delante de la webcam y con más luz')
          : t('Sigue moviendo las manos'));
      if (done >= 1) break;
      if (now - T0 > MAX_MS) break;
    }
    ui.dots([]);
    return samples;
  };

  rig.calibrate = async (ui) => {
    if (!rig.active) return;
    const [w, h] = rig.size();
    const notify = ctx.notify || (() => {});
    const before = rig.calib, beforeCtrls = rig.showCtrls, beforeDelay = rig.delay;
    ui.open();
    ui.live(true);
    if (!rig.detector) {
      ui.say(t('Preparando la detección de manos…'), '');
      try { await loadHands(); } catch (e) {
        ui.close();
        toast(t('No se ha podido cargar la detección de manos: {0}', e.message), 6000);
        return;
      }
    }
    while (!ui.cancelled) {
      rig.history = [];
      const samples = await rig.capture(ui, w, h);
      const poses = rig.history;
      rig.history = null;
      if (ui.cancelled) break;
      ui.say(t('Calculando…'), '');
      ui.big('');
      await sleep(30);
      const c = samples.length >= 60 && poses.length >= 2 ? solveCamera(samples, poses, w, h, rig.delay) : null;
      beep(880, 0.25);
      notify('Listo: mira el Mac', null, true);
      const fine = c && c.error < 0.04 * h && c.good > 0.5;
      console.info('calibración', { muestras: samples.length, poses: poses.length, ...(c || {}) });
      if (fine) {
        rig.calib = { pos: c.pos, quat: c.quat, fov: c.fov, w, h, rms: c.error, date: Date.now() };
        rig.showCtrls = true;
        rig.delay = c.delay;
        rig.applyCamera();
      }
      const use = await ui.ask(fine
        ? t('Mira los mandos virtuales: ¿caen sobre los reales?') + `<br><small>${t('Error: {0} px · lente {1}° · cámara a {2} m · retraso {3} ms', c.error.toFixed(0), c.fov.toFixed(0), c.distance.toFixed(2), c.delay)}</small>`
        : t('No cuadra: hace falta más luz y mover más las manos delante de la cámara.'), fine);
      if (use) {
        rig.setDelay(c.delay);
        rig.save();
        ui.close();
        toast('Cámara calibrada. Retoca con las flechas si hace falta', 6000);
        return true;
      }
      rig.calib = before;
      rig.delay = beforeDelay;
      rig.applyCamera();
    }
    rig.history = null;
    rig.calib = before;
    rig.delay = beforeDelay;
    rig.showCtrls = beforeCtrls;
    rig.applyCamera();
    ui.close();
  };

  // ---------- Grabación ----------
  rig.rec = null;
  rig.record = async ({ mic }) => {
    if (rig.rec) return rig.stopRecord();
    const stream = renderer.domElement.captureStream(30);
    let micStream = null;
    if (mic) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStream.getAudioTracks().forEach((t) => stream.addTrack(t));
      } catch { toast('Sin micro: se graba sin sonido'); }
    }
    const types = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.640028', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
    const d = new Date(), z = (n) => String(n).padStart(2, '0');
    const name = `plastilina_${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}.${ext}`;
    const mr = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 16e6 });
    const rec = { mr, name, part: 0, chain: Promise.resolve(), local: [], failed: false, bytes: 0, t0: performance.now(), micStream };
    // Cada trozo se manda al Mac en orden; si el servidor no responde, se guarda en memoria.
    mr.ondataavailable = (e) => {
      if (!e.data.size) return;
      const blob = e.data, part = rec.part++;
      rec.bytes += blob.size;
      rec.local.push(blob);
      rec.chain = rec.chain.then(async () => {
        if (rec.failed) return;
        try {
          const r = await fetch(`${ctx.api}/api/rec?name=${encodeURIComponent(name)}&part=${part}`, { method: 'POST', body: blob });
          if (!r.ok) throw new Error(r.status);
          rec.saved = (await r.json()).path;
        } catch { rec.failed = true; }
      });
    };
    mr.start(2000);
    rig.rec = rec;
    return rec;
  };
  rig.stopRecord = () => new Promise((resolve) => {
    const rec = rig.rec;
    if (!rec) return resolve(null);
    rec.mr.onstop = async () => {
      await rec.chain;
      rec.mr.stream.getTracks().forEach((t) => t.kind === 'audio' && t.stop());
      if (rec.micStream) rec.micStream.getTracks().forEach((t) => t.stop());
      if (rec.failed) {
        // Sin servidor: se descarga entero (va a Descargas del Mac).
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(rec.local, { type: rec.mr.mimeType }));
        a.download = rec.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 60000);
        toast(t('Grabación descargada: {0}', rec.name), 5000);
      } else toast(t('Grabación guardada en {0}', rec.saved || 'grabaciones/' + rec.name), 6000);
      rig.rec = null;
      resolve(rec);
    };
    rec.mr.stop();
  });

  return rig;
}

// ---------- Ventana de calibración ----------
export function calibUI() {
  const el = document.getElementById('calib');
  const msg = el.querySelector('.msg'), big = el.querySelector('.big'), sub = el.querySelector('.sub');
  const bOk = el.querySelector('[data-a=ok]'), bRedo = el.querySelector('[data-a=redo]');
  const bCancel = el.querySelector('[data-a=cancel]');
  const ui = { cancelled: false };
  const show = (...xs) => [bOk, bRedo].forEach((b) => (b.style.display = xs.includes(b) ? '' : 'none'));
  const marks = [];
  ui.open = () => { ui.cancelled = false; el.classList.add('on'); show(); };
  ui.close = () => { ui.dots([]); el.classList.remove('on', 'live'); };
  ui.live = (v) => el.classList.toggle('live', v); // mientras se calibra se ve la webcam detrás
  ui.say = (html, s = '') => { msg.innerHTML = html; sub.textContent = s; big.textContent = ''; };
  ui.big = (v) => (big.textContent = v);
  ui.sub = (v) => (sub.textContent = v);
  // Puntos sobre las manos detectadas (x, y en fracción del vídeo).
  ui.dots = (seen) => {
    const r = document.querySelector('#app canvas')?.getBoundingClientRect();
    while (marks.length < seen.length) { const d = document.createElement('i'); el.appendChild(d); marks.push(d); }
    marks.forEach((d, i) => {
      d.style.display = i < seen.length && r ? 'block' : 'none';
      if (i < seen.length && r) { d.style.left = r.left + seen[i].x * r.width + 'px'; d.style.top = r.top + seen[i].y * r.height + 'px'; }
    });
  };
  let answer = null;
  bCancel.onclick = () => { ui.cancelled = true; if (answer) answer(false); else ui.close(); };
  // ¿Se usa esta calibración? (Repetir o Cancelar: no.)
  ui.ask = (html, canUse) => new Promise((resolve) => {
    ui.say(html);
    show(...(canUse ? [bOk, bRedo] : [bRedo]));
    answer = (v) => { answer = null; show(); resolve(v); };
    bOk.onclick = () => answer(true);
    bRedo.onclick = () => answer(false);
  });
  return ui;
}
