// Cámara externa (solo en el espejo del Mac): una webcam o el iPhone te graba desde fuera y la
// escultura se pinta encima, en su sitio, como si estuviera de verdad delante de ti.
//
// - Calibración: con las gafas puestas pones el mando en varios sitios (suena un pitido en cada
//   foto). Luego, en el Mac, haces clic en la punta del mando en cada foto. Con esos pares
//   (punto 3D de las gafas ↔ píxel de la webcam) se calcula dónde está la cámara y su lente.
// - Retraso: la webcam suele ir por detrás de las gafas; las poses se retrasan para casar.
// - Grabación: el lienzo (vídeo + escultura) se graba y se va guardando en el Mac a trozos
//   (carpeta grabaciones/), así no se pierde nada si algo se cuelga.
import * as THREE from 'three';

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ---------- Cámara estenopeica: proyección y ajuste (Levenberg-Marquardt) ----------
// Parámetros: [rx, ry, rz] giro (eje·ángulo, cámara → mundo), [cx, cy, cz] posición, lf = log(f/h).
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

function residuals(p, pts, w, h, out) {
  const R = rotMat(p[0], p[1], p[2]), f = Math.exp(p[6]) * h;
  for (let i = 0; i < pts.length; i++) {
    const [X, Y, Z] = pts[i].p, dx = X - p[3], dy = Y - p[4], dz = Z - p[5];
    // pc = Rᵀ (X - C)
    const x = R[0] * dx + R[3] * dy + R[6] * dz, y = R[1] * dx + R[4] * dy + R[7] * dz, z = R[2] * dx + R[5] * dy + R[8] * dz;
    if (z > -0.05) { out[i * 2] = out[i * 2 + 1] = 1e4; continue; } // detrás de la cámara
    out[i * 2] = w / 2 + (f * x) / -z - pts[i].u;
    out[i * 2 + 1] = h / 2 - (f * y) / -z - pts[i].v;
  }
  return out;
}

const sq = (r) => r.reduce((a, v) => a + v * v, 0);

function solve7(A, b) { // Gauss con pivote, 7×7
  const n = 7, M = A.map((row, i) => [...row, b[i]]);
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

function refine(p0, pts, w, h, iters = 60) {
  let p = p0.slice(), lam = 1e-3;
  const m = pts.length * 2, r = new Float64Array(m), r2 = new Float64Array(m);
  let err = sq(residuals(p, pts, w, h, r));
  for (let it = 0; it < iters; it++) {
    const J = [];
    for (let k = 0; k < 7; k++) {
      const q = p.slice(), e = 1e-5;
      q[k] += e;
      residuals(q, pts, w, h, r2);
      J.push(Array.from(r2, (v, i) => (v - r[i]) / e));
    }
    const A = J.map((a) => J.map((b) => a.reduce((s, v, i) => s + v * b[i], 0)));
    const g = J.map((a) => a.reduce((s, v, i) => s + v * r[i], 0));
    let improved = false;
    for (let tries = 0; tries < 8 && !improved; tries++) {
      const B = A.map((row, i) => row.map((v, j) => (i === j ? v * (1 + lam) + 1e-12 : v)));
      const d = solve7(B, g.map((v) => -v));
      if (!d) { lam *= 10; continue; }
      const q = p.map((v, i) => v + d[i]);
      const e2 = sq(residuals(q, pts, w, h, r2));
      if (e2 < err) { p = q; err = e2; r.set(r2); lam = Math.max(1e-7, lam / 5); improved = true; }
      else lam *= 10;
    }
    if (!improved) break;
  }
  return { p, rms: Math.sqrt(err / pts.length) };
}

// pts: [{ p: [x,y,z] (metros, mundo de las gafas), u, v (píxeles del vídeo) }]
export function calibrate(pts, w, h) {
  const G = [0, 0, 0];
  pts.forEach((s) => s.p.forEach((v, k) => (G[k] += v / pts.length)));
  const gv = new THREE.Vector3(...G), m = new THREE.Matrix4(), q = new THREE.Quaternion();
  let best = null;
  // Arranques desde muchas posiciones alrededor de los puntos, mirándolos.
  const N = 48;
  for (let i = 0; i < N; i++) {
    const y = 1 - (2 * (i + 0.5)) / N, rr = Math.sqrt(1 - y * y), a = i * 2.39996;
    for (const D of [0.8, 1.6, 3]) {
      const eye = new THREE.Vector3(Math.cos(a) * rr, y * 0.6, Math.sin(a) * rr).normalize().multiplyScalar(D).add(gv);
      m.lookAt(eye, gv, new THREE.Vector3(0, 1, 0));
      q.setFromRotationMatrix(m);
      const ang = 2 * Math.acos(Math.min(1, Math.abs(q.w))), sgn = q.w < 0 ? -1 : 1, sn = Math.sin(ang / 2) || 1;
      const p0 = [q.x * sgn / sn * ang, q.y * sgn / sn * ang, q.z * sgn / sn * ang, eye.x, eye.y, eye.z, Math.log(1.2)];
      const r = refine(p0, pts, w, h, 25);
      if (!best || r.rms < best.rms) best = r;
    }
  }
  best = refine(best.p, pts, w, h, 100);
  const [rx, ry, rz, cx, cy, cz, lf] = best.p;
  const ang = Math.hypot(rx, ry, rz);
  const quat = ang < 1e-12 ? new THREE.Quaternion() : new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(rx / ang, ry / ang, rz / ang), ang);
  const f = Math.exp(lf) * h;
  return {
    pos: [cx, cy, cz], quat: quat.toArray(), fov: THREE.MathUtils.radToDeg(2 * Math.atan(h / 2 / f)),
    w, h, rms: best.rms,
    reproj: pts.map((s) => { const r = residuals(best.p, [s], w, h, [0, 0]); return [s.u + r[0], s.v + r[1]]; }),
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
      toast('No puedo abrir la cámara: ' + e.message, 5000);
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

  // ¿Están quietos los mandos (últimos 500 ms)?
  const still = () => {
    const now = performance.now() - rig.delay, P = rig.poses.filter((s) => s.t > now - 500 && s.t <= now);
    if (P.length < 3) return false;
    for (let i = 0; i < 2; i++) {
      const pos = P.map((s) => s.m.hands[i]).filter(Boolean);
      if (!pos.length) continue;
      for (const q of pos) if (Math.hypot(q[0] - pos[0][0], q[1] - pos[0][1], q[2] - pos[0][2]) > 0.008) return false;
    }
    return true;
  };

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

  rig.calibrate = async (ui, shots = 8) => {
    if (!rig.active) return;
    const [w, h] = rig.size();
    const samples = [];
    ui.open();
    ui.say('Ponte las gafas y coge <b>un solo mando</b> (deja el otro quieto).<br>' +
      'En cada foto pon la punta del mando en un sitio <b>que se vea en la webcam</b> y quédate quieto.<br>' +
      'Cambia de sitio en cada una: cerca, lejos, arriba, abajo, a los lados.', 'Empezamos en 5 s…');
    beep(440, 0.2);
    for (let s = 5; s > 0 && !ui.cancelled; s--) { ui.big(s); await sleep(1000); }
    for (let i = 0; i < shots && !ui.cancelled; i++) {
      for (let s = 3; s > 0 && !ui.cancelled; s--) { ui.big(s); ui.sub(`Foto ${i + 1} de ${shots}: muévete a otro sitio`); beep(520); await sleep(900); }
      // Espera a que esté quieto (hasta 4 s).
      const t0 = performance.now();
      while (!still() && performance.now() - t0 < 4000 && !ui.cancelled) { ui.big('…'); ui.sub('Quieto…'); await sleep(100); }
      if (ui.cancelled) break;
      const pose = rig.delayed();
      if (!pose || !pose.hands.some(Boolean)) { ui.sub('No llegan los mandos de las gafas'); await sleep(1200); i--; if (performance.now() - t0 > 30000) break; continue; }
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(video, 0, 0, w, h);
      samples.push({ img: cv, hands: pose.hands.map((x) => (x ? x.slice(0, 3) : null)) });
      ui.big('📸');
      beep(880, 0.25);
      await sleep(600);
    }
    if (ui.cancelled || samples.length < 5) { ui.close(); if (!ui.cancelled) toast('Hacen falta al menos 5 fotos'); return; }
    // El mando que se ha movido (el otro está quieto en la mesa).
    let hand = 0, bestSpread = -1;
    for (let k = 0; k < 2; k++) {
      const P = samples.map((s) => s.hands[k]).filter(Boolean);
      if (P.length < samples.length) continue;
      const c = [0, 1, 2].map((j) => P.reduce((a, p) => a + p[j], 0) / P.length);
      const spread = P.reduce((a, p) => a + Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]), 0);
      if (spread > bestSpread) { bestSpread = spread; hand = k; }
    }
    // Clics en el Mac.
    beep(440, 0.3);
    const pts = [];
    for (let i = 0; i < samples.length && !ui.cancelled; i++) {
      const uv = await ui.pick(samples[i].img, `Foto ${i + 1} de ${samples.length}: haz clic en la <b>punta del mando</b> (el centro del aro). ` +
        'Si no se ve, pulsa "Saltar".');
      if (uv) pts.push({ p: samples[i].hands[hand], u: uv[0], v: uv[1], i });
    }
    if (ui.cancelled) { ui.close(); return; }
    if (pts.length < 5) { ui.close(); toast('Hacen falta al menos 5 clics'); return; }
    ui.say('Calculando…', '');
    await sleep(30);
    const c = calibrate(pts, w, h);
    const ok = c.rms < Math.max(12, h * 0.02);
    const msg = `Error medio: ${c.rms.toFixed(1)} px · lente ${c.fov.toFixed(1)}° · cámara a ${new THREE.Vector3(...c.pos).distanceTo(new THREE.Vector3(...pts[0].p)).toFixed(2)} m`;
    const accept = await ui.result(samples[pts[0].i].img, pts, c.reproj,
      (ok ? 'Calibrada ✔ ' : 'Algo no cuadra (¿algún clic fuera de sitio?). ') + msg);
    ui.close();
    if (!accept) return;
    rig.calib = { pos: c.pos, quat: c.quat, fov: c.fov, w, h, rms: c.rms, date: Date.now() };
    rig.save();
    rig.applyCamera();
    rig.showCtrls = true;
    toast('Cámara calibrada: los mandos virtuales deberían caer encima de los reales. Retoca con las flechas si hace falta', 6000);
    return true;
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
        toast('Grabación descargada: ' + rec.name, 5000);
      } else toast('Grabación guardada en ' + (rec.saved || 'grabaciones/' + rec.name), 6000);
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
  const cv = el.querySelector('canvas'), ctx2 = cv.getContext('2d');
  const bSkip = el.querySelector('[data-a=skip]'), bOk = el.querySelector('[data-a=ok]'), bRedo = el.querySelector('[data-a=redo]');
  const bCancel = el.querySelector('[data-a=cancel]');
  const ui = { cancelled: false };
  const fit = (img) => {
    const s = Math.min((innerWidth - 40) / img.width, (innerHeight - 200) / img.height);
    cv.width = img.width; cv.height = img.height;
    cv.style.width = img.width * s + 'px'; cv.style.height = img.height * s + 'px';
    ctx2.drawImage(img, 0, 0);
  };
  const show = (...xs) => [bSkip, bOk, bRedo].forEach((b) => (b.style.display = xs.includes(b) ? '' : 'none'));
  ui.open = () => { ui.cancelled = false; el.classList.add('on'); cv.style.display = 'none'; show(); };
  ui.close = () => el.classList.remove('on');
  ui.say = (html, s = '') => { msg.innerHTML = html; sub.textContent = s; big.textContent = ''; };
  ui.big = (t) => (big.textContent = t);
  ui.sub = (t) => (sub.textContent = t);
  bCancel.onclick = () => { ui.cancelled = true; ui.close(); };
  ui.pick = (img, html) => new Promise((resolve) => {
    ui.say(html);
    cv.style.display = '';
    fit(img);
    show(bSkip);
    const done = (v) => { cv.onclick = bSkip.onclick = null; resolve(v); };
    cv.onclick = (e) => {
      const r = cv.getBoundingClientRect();
      const u = ((e.clientX - r.left) / r.width) * cv.width, v = ((e.clientY - r.top) / r.height) * cv.height;
      ctx2.strokeStyle = '#ff3b6b'; ctx2.lineWidth = Math.max(2, cv.width / 400);
      ctx2.beginPath(); ctx2.arc(u, v, cv.width / 80, 0, 7); ctx2.stroke();
      setTimeout(() => done([u, v]), 250);
    };
    bSkip.onclick = () => done(null);
    if (ui.cancelled) done(null);
  });
  ui.result = (img, pts, reproj, text) => new Promise((resolve) => {
    ui.say(text + '<br><small>Rosa = tus clics · verde = donde cae el mando con la calibración.</small>');
    cv.style.display = '';
    fit(img);
    const r = cv.width / 90;
    pts.forEach((p, i) => {
      ctx2.lineWidth = Math.max(2, cv.width / 500);
      ctx2.strokeStyle = '#ff3b6b'; ctx2.beginPath(); ctx2.arc(p.u, p.v, r, 0, 7); ctx2.stroke();
      ctx2.strokeStyle = '#3bff8a'; ctx2.beginPath(); ctx2.arc(reproj[i][0], reproj[i][1], r * 0.5, 0, 7); ctx2.stroke();
    });
    show(bOk, bRedo);
    bOk.onclick = () => resolve(true);
    bRedo.onclick = () => resolve(false);
  });
  return ui;
}
