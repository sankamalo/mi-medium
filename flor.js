// Mando y mano de plastilina, y el menú en forma de flor de las gafas.
// El mando y la mano viven en el espacio de agarre (gripSpace) y usan las medidas reales del
// Touch Plus de Quest. Los dedos se mueven con los sensores de contacto del mando.
import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';

const INK = 0x141210;
const COLORS = {
  red: 0xe3242b, blue: 0x1b4fd8, yellow: 0xffd21f, green: 0x12a54a, paper: 0xfff8e3,
  white: 0xffffff, pink: 0xff7ab8, hand: 0xffc62e,
};
const DEG = Math.PI / 180;
const RIG_ORDER = 990; // mando y mano se pintan después de la flor, encima de ella
const Y = new THREE.Vector3(0, 1, 0);

const mats = new Map();
function clay(hex) {
  // Algo de luz propia: los primarios tienen que seguir siendo primarios en una habitación oscura.
  if (!mats.has(hex)) mats.set(hex, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.78, emissive: hex, emissiveIntensity: 0.22 }));
  return mats.get(hex);
}
function outlineMat(width, hex = INK) {
  return new THREE.ShaderMaterial({
    uniforms: { w: { value: width }, c: { value: new THREE.Color(hex) } },
    side: THREE.BackSide,
    vertexShader: 'uniform float w; void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normalize(normal) * w, 1.0); }',
    fragmentShader: 'uniform vec3 c; void main(){ gl_FragColor = vec4(c, 1.0); }',
  });
}
const OUTLINE = outlineMat(0.0017);
// Para piezas con aristas: empuja desde el centro para que el contorno no se abra en las esquinas.
const OUTLINE_HARD = new THREE.ShaderMaterial({
  uniforms: { w: { value: 0.0017 }, c: { value: new THREE.Color(INK) } },
  side: THREE.BackSide,
  vertexShader: OUTLINE.vertexShader.replace('normalize(normal)', 'normalize(position)'),
  fragmentShader: OUTLINE.fragmentShader,
});

// Una pieza: la malla de color y, si se pide, su contorno negro de cera.
function piece(geo, hex, outline = OUTLINE) {
  const m = new THREE.Mesh(geo, clay(hex));
  if (outline) m.add(new THREE.Mesh(geo, outline));
  return m;
}

// Bultitos de plastilina: nadie modela una bola perfecta.
function lumps(geo, amp = 0.00045, f = 330) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = amp * (Math.sin(x * f + y * f * 0.6) + Math.sin(y * f * 0.8 + z * f * 1.1) + Math.sin(z * f * 0.7 - x * f * 0.9)) / 3;
    p.setXYZ(i, x + n.getX(i) * d, y + n.getY(i) * d, z + n.getZ(i) * d);
  }
  return geo;
}
function ellipsoid(rx, ry, rz, w = 18, h = 14) {
  const g = new THREE.SphereGeometry(1, w, h);
  const p = g.attributes.position, n = g.attributes.normal;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(n, i);
    n.setXYZ(i, ...new THREE.Vector3(v.x / rx, v.y / ry, v.z / rz).normalize().toArray());
    p.setXYZ(i, v.x * rx, v.y * ry, v.z * rz);
  }
  return g;
}
// Cápsula desde el origen hacia +Y, de longitud total len.
function capsule(r, len, radial = 10) {
  return new THREE.CapsuleGeometry(r, Math.max(0.0001, len - 2 * r), 3, radial).translate(0, len / 2, 0);
}
function aimY(obj, dir) {
  obj.quaternion.setFromUnitVectors(Y, vT.copy(dir).normalize());
}
const vT = new THREE.Vector3(), vA = new THREE.Vector3(), vB = new THREE.Vector3();

// ---------- Mando y mano ----------
// Geometría del mando derecho en metros; el izquierdo es el mismo en espejo.
const FACE = new THREE.Vector3(0.006, 0.816, -0.578).normalize(); // normal de la cara con los botones
const SIDE = new THREE.Vector3(1, 0, 0);
const FWD = new THREE.Vector3().crossVectors(SIDE, FACE); // dentro de la cara, hacia el usuario
const P_A = new THREE.Vector3(-0.002, 0.008, -0.018);
const P_B = new THREE.Vector3(-0.013, 0.001, -0.028);
const P_STICK = new THREE.Vector3(0.009, -0.002, -0.032);
const P_REST = new THREE.Vector3(0.022, 0.011, -0.016);
const P_TRIGGER = new THREE.Vector3(-0.009, -0.028, -0.026);
const P_SQUEEZE = new THREE.Vector3(-0.009, 0.001, 0.016);
const STICK_TILT = 22 * DEG;

// Cada dedo: nudillo, inclinación, largos, y ángulos en el plano XY abierto → cerrado.
const FINGERS = [
  { id: 'index', at: [0.034, -0.021, -0.012], tilt: -12, r: 0.0088, len: [0.036, 0.023, 0.02],
    open: [-108, -118, -128], closed: [-170, -226, -268] },
  { id: 'middle', at: [0.035, -0.023, 0.009], tilt: 0, r: 0.0092, len: [0.04, 0.025, 0.021],
    open: [-112, -128, -145], closed: [-172, -232, -276] },
  { id: 'ring', at: [0.034, -0.022, 0.03], tilt: -4, r: 0.0086, len: [0.037, 0.024, 0.02],
    open: [-112, -130, -148], closed: [-172, -232, -278] },
  { id: 'pinky', at: [0.032, -0.019, 0.049], tilt: -9, r: 0.0074, len: [0.03, 0.019, 0.017],
    open: [-112, -134, -152], closed: [-172, -236, -282] },
];

function buildController() {
  const g = new THREE.Group();
  const center = P_A.clone().add(P_B).add(P_STICK).multiplyScalar(1 / 3);
  const head = piece(lumps(ellipsoid(0.036, 0.034, 0.019)), COLORS.blue);
  head.position.copy(center).addScaledVector(FACE, -0.0165);
  head.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(SIDE, vA.copy(FWD).negate(), FACE));
  const handle = piece(lumps(new THREE.CapsuleGeometry(0.0185, 0.066, 4, 14)), COLORS.blue);
  handle.position.set(0.0105, 0.001, 0.027);
  handle.rotation.x = Math.PI / 2 + 0.06;
  const band = piece(new THREE.TorusGeometry(0.0195, 0.0032, 8, 18), COLORS.yellow);
  band.position.set(0.0105, 0.004, 0.058);
  band.rotation.x = 0.06;
  const trigger = piece(lumps(new THREE.CapsuleGeometry(0.0095, 0.012, 3, 10)), COLORS.red);
  trigger.position.copy(P_TRIGGER);
  trigger.rotation.set(0.5, 0, 0);
  const squeeze = piece(lumps(ellipsoid(0.006, 0.012, 0.015)), COLORS.yellow);
  squeeze.position.copy(P_SQUEEZE);
  const btn = (p, hex) => {
    const b = piece(ellipsoid(0.0064, 0.0064, 0.0034, 12, 8), hex);
    b.position.copy(p);
    b.quaternion.copy(head.quaternion);
    return b;
  };
  const a = btn(P_A, COLORS.yellow), b = btn(P_B, COLORS.green);
  const stick = new THREE.Group();
  stick.position.copy(P_STICK).addScaledVector(FACE, -0.013);
  stick.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(SIDE, FACE, FWD));
  const stick0 = stick.quaternion.clone();
  const shaft = piece(new THREE.CylinderGeometry(0.004, 0.0055, 0.015, 10).translate(0, 0.0075, 0), COLORS.white, null);
  const cap = piece(ellipsoid(0.0098, 0.004, 0.0098, 14, 10), COLORS.red);
  cap.position.y = 0.0155;
  stick.add(shaft, cap);
  g.add(head, handle, band, trigger, squeeze, a, b, stick);
  return { group: g, a, b, trigger, squeeze, stick, stick0, trigger0: P_TRIGGER.clone(), squeeze0: P_SQUEEZE.clone() };
}

// ---------- La mano: una sola pieza ----------
// Se modela una vez como campo de distancias (como las esculturas), con uniones suaves entre
// dedos y palma; luego se le ponen huesos y los dedos se doblan sin separarse nunca.
const smin = (a, b, k) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
function segDist(p, s) {
  const ax = p[0] - s.a[0], ay = p[1] - s.a[1], az = p[2] - s.a[2];
  const bx = s.b[0] - s.a[0], by = s.b[1] - s.a[1], bz = s.b[2] - s.a[2];
  const k = Math.max(0, Math.min(1, (ax * bx + ay * by + az * bz) / (bx * bx + by * by + bz * bz || 1)));
  return Math.hypot(ax - bx * k, ay - by * k, az - bz * k) - s.r;
}
function ellDist(p, c, r) {
  const x = (p[0] - c[0]) / r[0], y = (p[1] - c[1]) / r[1], z = (p[2] - c[2]) / r[2];
  return (Math.hypot(x, y, z) - 1) * Math.min(r[0], r[1], r[2]);
}

// Superficie de un campo de distancias: un vértice por celda que cruza, unidos en quads.
function surfaceNets(sdf, lo, hi, h) {
  const nx = Math.ceil((hi[0] - lo[0]) / h) + 1, ny = Math.ceil((hi[1] - lo[1]) / h) + 1, nz = Math.ceil((hi[2] - lo[2]) / h) + 1;
  const at = (i, j, k) => i + nx * (j + ny * k);
  const f = new Float32Array(nx * ny * nz), id = new Int32Array(nx * ny * nz).fill(-1);
  const p = [0, 0, 0];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    p[0] = lo[0] + i * h; p[1] = lo[1] + j * h; p[2] = lo[2] + k * h;
    f[at(i, j, k)] = sdf(p);
  }
  const EDGES = [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]];
  const pos = [], tris = [];
  const c = new Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    for (let b = 0; b < 8; b++) {
      c[b] = f[at(i + (b & 1), j + ((b >> 1) & 1), k + ((b >> 2) & 1))];
      if (c[b] < 0) mask |= 1 << b;
    }
    if (mask === 0 || mask === 255) continue;
    let x = 0, y = 0, z = 0, n = 0;
    for (const [u, v] of EDGES) {
      if (c[u] < 0 === c[v] < 0) continue;
      const t = c[u] / (c[u] - c[v]);
      x += (u & 1) + ((v & 1) - (u & 1)) * t;
      y += ((u >> 1) & 1) + (((v >> 1) & 1) - ((u >> 1) & 1)) * t;
      z += ((u >> 2) & 1) + (((v >> 2) & 1) - ((u >> 2) & 1)) * t;
      n++;
    }
    id[at(i, j, k)] = pos.length / 3;
    pos.push(lo[0] + (i + x / n) * h, lo[1] + (j + y / n) * h, lo[2] + (k + z / n) * h);
  }
  const quad = (a, b, c2, d) => {
    if (a < 0 || b < 0 || c2 < 0 || d < 0) return;
    tris.push(a, b, c2, a, c2, d);
  };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const v = f[at(i, j, k)] < 0;
    if (v !== (f[at(i + 1, j, k)] < 0)) quad(id[at(i, j - 1, k - 1)], id[at(i, j, k - 1)], id[at(i, j, k)], id[at(i, j - 1, k)]);
    if (v !== (f[at(i, j + 1, k)] < 0)) quad(id[at(i - 1, j, k - 1)], id[at(i, j, k - 1)], id[at(i, j, k)], id[at(i - 1, j, k)]);
    if (v !== (f[at(i, j, k + 1)] < 0)) quad(id[at(i - 1, j - 1, k)], id[at(i, j - 1, k)], id[at(i, j, k)], id[at(i - 1, j, k)]);
  }
  // Normales del propio campo (lisas) y triángulos mirando hacia fuera.
  const normals = new Float32Array(pos.length), e = h * 0.5;
  const g = (x, y, z) => { p[0] = x; p[1] = y; p[2] = z; return sdf(p); };
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    const a = g(x + e, y, z) - g(x - e, y, z), b = g(x, y + e, z) - g(x, y - e, z), d = g(x, y, z + e) - g(x, y, z - e);
    const l = Math.hypot(a, b, d) || 1;
    normals[i] = a / l; normals[i + 1] = b / l; normals[i + 2] = d / l;
  }
  for (let i = 0; i < tris.length; i += 3) {
    const A = tris[i] * 3, B = tris[i + 1] * 3, C = tris[i + 2] * 3;
    const ux = pos[B] - pos[A], uy = pos[B + 1] - pos[A + 1], uz = pos[B + 2] - pos[A + 2];
    const vx = pos[C] - pos[A], vy = pos[C + 1] - pos[A + 1], vz = pos[C + 2] - pos[A + 2];
    const dot = (uy * vz - uz * vy) * normals[A] + (uz * vx - ux * vz) * normals[A + 1] + (ux * vy - uy * vx) * normals[A + 2];
    if (dot < 0) { const q = tris[i + 1]; tris[i + 1] = tris[i + 2]; tris[i + 2] = q; }
  }
  return { positions: new Float32Array(pos), normals, indices: tris };
}

// Silueta negra que se dobla con los huesos.
const OUTLINE_SKIN = new THREE.ShaderMaterial({
  uniforms: { w: { value: 0.0017 }, c: { value: new THREE.Color(INK) } },
  side: THREE.BackSide,
  vertexShader: `
    #include <common>
    #include <skinning_pars_vertex>
    uniform float w;
    void main() {
      #include <skinbase_vertex>
      #include <beginnormal_vertex>
      #include <skinnormal_vertex>
      #include <begin_vertex>
      #include <skinning_vertex>
      transformed += normalize(objectNormal) * w;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
    }`,
  fragmentShader: 'uniform vec3 c; void main(){ gl_FragColor = vec4(c, 1.0); }',
});

const PALM_C = [0.044, 0.014, 0.022], PALM_R = [0.0145, 0.04, 0.037];
const HEEL_C = [0.034, 0.03, -0.004], HEEL_R = [0.012, 0.018, 0.016];
const WRIST = { a: [0.046, 0.04, 0.03], b: [0.05, 0.08, 0.03], r: 0.019 };
const T0 = new THREE.Vector3(0.033, 0.029, -0.013);
const L1 = 0.031, L2 = 0.03;
const THUMB_REST = new THREE.Vector3(0.012, 0.03, -0.045); // pulgar levantado, al modelar
const FAN = [9, 3, -3, -9]; // al modelar, dedos abiertos en abanico para que no se peguen

function solveThumb(target, elbow) {
  vA.copy(target).sub(T0);
  const d = Math.min(vA.length(), L1 + L2 - 0.0005);
  vA.normalize();
  const along = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, L1 * L1 - along * along));
  vT.copy(FACE).addScaledVector(SIDE, 0.5);
  vB.copy(vT).addScaledVector(vA, -vT.dot(vA)).normalize();
  elbow.copy(T0).addScaledVector(vA, along).addScaledVector(vB, h);
  return d;
}

let handData = null;
// Malla compartida por las dos manos. Grupos: 0 palma, 1-4 dedos, 5 pulgar.
function buildHandGeometry(boneOf) {
  const groups = boneOf.groups; // [{ segs:[{a,b,r,bone}] }]
  const fingerD = (p, g) => {
    let d = 1;
    for (const s of g.segs) d = smin(d, segDist(p, s), 0.004);
    return d;
  };
  const palmD = (p) => smin(smin(ellDist(p, PALM_C, PALM_R), ellDist(p, HEEL_C, HEEL_R), 0.012), segDist(p, WRIST), 0.014);
  const sdf = (p) => {
    let f = 1;
    for (const g of groups) f = Math.min(f, fingerD(p, g));
    return smin(palmD(p), f, 0.009);
  };
  const m = 0.012;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const grow = (q, r) => { for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], q[i] - r - m); hi[i] = Math.max(hi[i], q[i] + r + m); } };
  groups.forEach((g) => g.segs.forEach((s) => { grow(s.a, s.r); grow(s.b, s.r); }));
  grow(WRIST.a, WRIST.r); grow(WRIST.b, WRIST.r);
  grow(PALM_C, Math.max(...PALM_R)); grow(HEEL_C, Math.max(...HEEL_R));
  const net = surfaceNets(sdf, lo, hi, 0.003);

  // Pesos: cada vértice sigue a los huesos de su dedo y, cerca de la base, a la palma.
  const n = net.positions.length / 3;
  const skinIndex = new Uint16Array(n * 4), skinWeight = new Float32Array(n * 4);
  const p = [0, 0, 0];
  const W = (d) => 1 / (Math.max(d, 0) + 0.002) ** 4;
  for (let v = 0; v < n; v++) {
    p[0] = net.positions[v * 3]; p[1] = net.positions[v * 3 + 1]; p[2] = net.positions[v * 3 + 2];
    let best = null, bd = Infinity;
    for (const g of groups) {
      const d = fingerD(p, g);
      if (d < bd) { bd = d; best = g; }
    }
    const list = best.segs.map((s) => [s.bone, W(segDist(p, s))]);
    list.push([0, W(palmD(p))]);
    list.sort((a, b) => b[1] - a[1]);
    const top = list.slice(0, 4);
    const sum = top.reduce((t, x) => t + x[1], 0);
    top.forEach((x, i) => { skinIndex[v * 4 + i] = x[0]; skinWeight[v * 4 + i] = x[1] / sum; });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(net.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(net.normals, 3));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  geo.setIndex(net.indices);
  return geo;
}

function buildHand() {
  const root = new THREE.Bone();
  const bones = [root];
  const groups = [];
  const fingers = FINGERS.map((def, fi) => {
    const base = new THREE.Bone();
    base.position.fromArray(def.at);
    base.rotation.set(FAN[fi] * DEG, def.tilt * DEG, 0);
    root.add(base);
    const joints = [];
    let parent = base;
    def.len.forEach((len, i) => {
      const j = new THREE.Bone();
      if (i > 0) j.position.y = def.len[i - 1];
      parent.add(j);
      bones.push(j);
      joints.push(j);
      parent = j;
    });
    return { base, joints, def };
  });
  const th1 = new THREE.Bone(), th2 = new THREE.Bone();
  root.add(th1, th2);
  bones.push(th1, th2);
  return { root, bones, groups, fingers, th1, th2 };
}

function poseFinger(f, c) {
  const a = f.def.open, b = f.def.closed;
  let prev = 0;
  f.joints.forEach((j, i) => {
    const ang = (a[i] + (b[i] - a[i]) * c) * DEG;
    j.rotation.z = i === 0 ? ang - Math.PI / 2 : ang - prev;
    prev = ang;
  });
}
function poseThumb(h, target, elbow) {
  const d = solveThumb(target, elbow);
  h.th1.position.copy(T0);
  aimY(h.th1, vT.copy(elbow).sub(T0));
  h.th2.position.copy(elbow);
  aimY(h.th2, vB.copy(T0).addScaledVector(vA, d).sub(elbow));
}

export function createControllerRig(handedness) {
  const group = new THREE.Group();
  const inner = new THREE.Group();
  if (handedness === 'left') inner.scale.x = -1;
  group.add(inner);
  const ctl = buildController();
  inner.add(ctl.group);

  // Postura de modelado: dedos abiertos, pulgar levantado.
  const hand = buildHand();
  const elbow = new THREE.Vector3();
  hand.fingers.forEach((f) => poseFinger(f, 0));
  poseThumb(hand, THUMB_REST, elbow);
  hand.root.updateMatrixWorld(true);
  if (!handData) {
    const wp = (o) => o.getWorldPosition(new THREE.Vector3()).toArray();
    const groups = hand.fingers.map((f) => ({
      segs: f.joints.map((j, i) => ({
        a: wp(j),
        b: j.localToWorld(new THREE.Vector3(0, f.def.len[i], 0)).toArray(),
        r: f.def.r * (1 - i * 0.07),
        bone: hand.bones.indexOf(j),
      })),
    }));
    groups.push({ segs: [
      { a: T0.toArray(), b: elbow.toArray(), r: 0.0102, bone: hand.bones.indexOf(hand.th1) },
      { a: elbow.toArray(), b: hand.th2.localToWorld(new THREE.Vector3(0, L2, 0)).toArray(), r: 0.0094, bone: hand.bones.indexOf(hand.th2) },
    ] });
    handData = buildHandGeometry({ groups });
  }
  const skel = new THREE.Skeleton(hand.bones);
  const skin = new THREE.SkinnedMesh(handData, clay(COLORS.hand));
  const line = new THREE.SkinnedMesh(handData, OUTLINE_SKIN);
  skin.frustumCulled = line.frustumCulled = false;
  skin.add(hand.root);
  skin.updateMatrixWorld(true);
  skin.bind(skel);
  line.bind(skel, skin.bindMatrix);
  inner.add(skin, line);
  // Ya modelada: los dedos vuelven a su sitio sobre el mando.
  hand.fingers.forEach((f) => f.base.rotation.set(0, f.def.tilt * DEG, 0));

  group.traverse((o) => { if (o.isMesh) o.renderOrder = RIG_ORDER; });

  // El pulgar busca lo que el mando diga que toca.
  const thumb = new THREE.Vector3().copy(P_REST).addScaledVector(FACE, 0.014);
  const goal = new THREE.Vector3(), capTop = new THREE.Vector3();
  const qTilt = new THREE.Quaternion(), e = new THREE.Euler();
  const smooth = { trigger: 0.3, squeeze: 0.3, stickX: 0, stickY: 0 };

  function update(gp, dt = 1 / 72) {
    const k = 1 - Math.exp(-dt * 20);
    const b = gp?.buttons || [];
    const mirror = handedness === 'left' ? -1 : 1;
    const trigV = b[0]?.value || 0, trigT = !!b[0]?.touched || trigV > 0.01;
    const grip = b[1]?.value || 0;
    const ax = (gp?.axes?.[2] || 0) * mirror, ay = gp?.axes?.[3] || 0;
    smooth.trigger += ((trigT ? 0.56 + 0.44 * trigV : 0) - smooth.trigger) * k;
    smooth.squeeze += ((0.68 + 0.32 * grip) - smooth.squeeze) * k;
    smooth.stickX += (ax - smooth.stickX) * k;
    smooth.stickY += (ay - smooth.stickY) * k;
    poseFinger(hand.fingers[0], smooth.trigger);
    for (let i = 1; i < 4; i++) poseFinger(hand.fingers[i], smooth.squeeze);

    // Piezas del mando que se hunden o se inclinan.
    ctl.trigger.position.copy(ctl.trigger0);
    ctl.trigger.position.y += trigV * 0.006;
    ctl.squeeze.position.copy(ctl.squeeze0);
    ctl.squeeze.position.x += grip * 0.002;
    ctl.a.position.copy(P_A).addScaledVector(FACE, b[4]?.pressed ? -0.0018 : 0);
    ctl.b.position.copy(P_B).addScaledVector(FACE, b[5]?.pressed ? -0.0018 : 0);
    e.set(smooth.stickY * STICK_TILT, 0, -smooth.stickX * STICK_TILT);
    qTilt.setFromEuler(e);
    ctl.stick.quaternion.copy(ctl.stick0).multiply(qTilt);
    capTop.set(0, 0.0195 - (b[3]?.pressed ? 0.002 : 0), 0).applyQuaternion(ctl.stick.quaternion).add(ctl.stick.position);

    // ¿Dónde está el pulgar? Lo que el mando diga que toca; si no toca nada, levantado.
    if (b[3]?.touched || b[3]?.pressed) goal.copy(capTop).addScaledVector(FACE, 0.006);
    else if (b[4]?.touched || b[4]?.pressed) goal.copy(P_A).addScaledVector(FACE, 0.0095);
    else if (b[5]?.touched || b[5]?.pressed) goal.copy(P_B).addScaledVector(FACE, 0.0095);
    else if (b[6]?.touched) goal.copy(P_REST).addScaledVector(FACE, 0.006);
    else goal.copy(P_STICK).addScaledVector(SIDE, 0.012).addScaledVector(FWD, 0.012).addScaledVector(FACE, 0.024);
    thumb.lerp(goal, k);

    poseThumb(hand, thumb, elbow);
  }
  update(null);
  return { group, update };
}

// ---------- La flor ----------
// Plana, de color liso. Se pinta por encima de la escultura y por debajo del mando y la mano.
const R0 = 0.034, LEN = 0.135, WID = 0.094;
const OUTER = R0 + LEN * 1.45;
const DEAD = 0.03;
const INK_W = 0.0032, HALO_W = 0.0062;

function petalPoints(len, wid, grow = 0) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(-wid * 0.34, len * 0.28, -wid * 0.72, len, 0, len);
  s.bezierCurveTo(wid * 0.72, len, wid * 0.34, len * 0.28, 0, 0);
  const pts = s.getPoints(16);
  pts.pop();
  if (!grow) return pts;
  // Contorno: cada punto hacia fuera por su normal. El sentido de giro decide cuál es "fuera".
  const sign = THREE.ShapeUtils.isClockWise(pts) ? 1 : -1;
  return pts.map((p, i) => {
    const a = pts[(i + pts.length - 1) % pts.length], b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    return new THREE.Vector2(p.x - (dy / l) * grow * sign, p.y + (dx / l) * grow * sign);
  });
}

// Formas planas juntas en una sola malla: se pintan en el orden en que se añaden.
class Flat {
  constructor() { this.pos = []; this.col = []; this.idx = []; }
  shape(shape, hex) {
    const g = new THREE.ShapeGeometry(shape, 10);
    const base = this.pos.length / 3, c = new THREE.Color(hex), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), 0);
      this.col.push(c.r, c.g, c.b);
    }
    for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i));
    g.dispose();
  }
  poly(pts, hex) { this.shape(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))), hex); }
  circle(x, y, rx, ry, hex) {
    const s = new THREE.Shape();
    s.absellipse(x, y, rx, ry, 0, Math.PI * 2);
    this.shape(s, hex);
  }
  // La rueda de color: anillos de vértices, cada uno con el color que le toca.
  wheel(radius, colorAt, rings = 14, segs = 72) {
    const base = this.pos.length / 3, c = new THREE.Color();
    for (let j = 0; j <= rings; j++) for (let i = 0; i < segs; i++) {
      const r = j / rings, a = (i / segs) * Math.PI * 2, u = Math.cos(a) * r, v = Math.sin(a) * r;
      c.set(colorAt(u, v));
      this.pos.push(u * radius, v * radius, 0);
      this.col.push(c.r, c.g, c.b);
    }
    for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) {
      const a = base + j * segs + i, b = base + j * segs + (i + 1) % segs, d = a + segs, e = b + segs;
      this.idx.push(a, b, e, a, e, d);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    return g;
  }
}

// Iconos: un SVG de relleno por cada pétalo, en app/iconos/. Para cambiar uno, se cambia el archivo.
const ICON_FILES = {
  inflate: 'inflate', move: 'move', paint: 'paint', add: 'add', remove: 'remove', flatten: 'flatten', grab: 'grab', sym: 'sym',
  pinch: 'pinch', crease: 'crease', 'sym:x': 'sym-x', 'sym:y': 'sym-y', 'sym:z': 'sym-z', 'sym:radial': 'sym-radial',
  'shape:sphere': 'shape-sphere', 'shape:cube': 'shape-cube', 'shape:pyramid': 'shape-pyramid',
  'tool:palillo': 'tool-palillo', 'tool:cuter': 'tool-cuter', 'tool:cuchara': 'tool-cuchara',
  'tool:dedo': 'tool-dedo', 'tool:rodillo': 'tool-rodillo', 'tool:espatula': 'tool-espatula',
  'tex:plain': 'tex-plain', 'tex:rough': 'tex-rough', 'tex:dots': 'tex-dots', 'tex:stripes': 'tex-stripes', 'tex:scales': 'tex-scales',
};
const ICON_SIZE = 0.058, SUB_ICON_SIZE = 0.036;
const INK_ON = new Set([COLORS.yellow, COLORS.paper, COLORS.pink]); // en estos pétalos, el icono va en negro

async function loadIcon(p, size) {
  const url = new URL(`./iconos/${ICON_FILES[p.id]}.svg`, import.meta.url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const flat = new Flat();
  const hex = INK_ON.has(p.color) ? INK : COLORS.white;
  for (const path of new SVGLoader().parse(await res.text()).paths) {
    if (path.userData?.style?.fill === 'none') continue;
    for (const shape of SVGLoader.createShapes(path)) flat.shape(shape, hex);
  }
  // Sea cual sea su tamaño original: centrado, derecho (en SVG la Y va hacia abajo) y a la medida.
  const geo = flat.geometry();
  geo.computeBoundingBox();
  const box = geo.boundingBox, w = box.max.x - box.min.x, h = box.max.y - box.min.y;
  const k = size / (Math.max(w, h) || 1);
  geo.translate(-(box.min.x + box.max.x) / 2, -(box.min.y + box.max.y) / 2, 0);
  geo.scale(k, -k, 1);
  p.icon.geometry.dispose();
  p.icon.geometry = geo;
}

// El reloj de la flor: arriba las de siempre, abajo las demás.
export const FLOWER = [
  { id: 'inflate', angle: -72, color: COLORS.blue },
  { id: 'move', angle: -36, color: COLORS.green },
  { id: 'paint', angle: 0, color: COLORS.red },
  { id: 'add', angle: 36, color: COLORS.yellow },
  { id: 'remove', angle: 72, color: COLORS.paper },
  { id: 'crease', angle: 108, color: COLORS.blue },
  { id: 'pinch', angle: 144, color: COLORS.green },
  { id: 'flatten', angle: 180, color: COLORS.red },
  { id: 'grab', angle: -144, color: COLORS.yellow },
  { id: 'sym', angle: -108, color: COLORS.pink },
];
// Si te quedas un momento sobre estos pétalos, de su parte gorda nace otra flor con sus opciones.
const fan = (ids, step) => ids.map((id, i) => ({ id, off: (i - (ids.length - 1) / 2) * step }));
const SUBS = {
  add: fan(['shape:sphere', 'shape:cube', 'shape:pyramid'], 58),
  sym: fan(['sym:x', 'sym:y', 'sym:z', 'sym:radial'], 54),
  paint: [{ id: 'color:wheel', off: 0, wheel: true }],
  remove: fan(['tool:palillo', 'tool:cuter', 'tool:cuchara'], 58),
  flatten: fan(['tool:dedo', 'tool:rodillo', 'tool:espatula'], 58),
  inflate: fan(['tex:plain', 'tex:rough', 'tex:dots', 'tex:stripes', 'tex:scales'], 46),
};
const FAT = 0.7; // dónde está la parte gorda del pétalo, a lo largo de él
const SUB_LEN = 0.108, SUB_WID = 0.07;
const SUB_HOLE = 0.04, SUB_REACH = SUB_LEN * 1.35; // dentro del agujero sigues sobre el pétalo padre
// La rueda de color es un pétalo más grande, con la rueda dentro.
const WHEEL_LEN = 0.18, WHEEL_WID = 0.165, WHEEL_AT = 0.115, WHEEL_R = 0.055, WHEEL_GRACE = 0.03;
// Centro blanco, color puro a media altura, oscuro hacia el borde.
const WHEEL_PURE = 0.74, WHEEL_DARK = 0.88;
function wheelColor(u, v) {
  const r = Math.min(1, Math.hypot(u, v));
  const h = ((Math.atan2(v, u) / (Math.PI * 2)) + 1) % 1;
  const sat = Math.min(1, r / WHEEL_PURE), val = r <= WHEEL_PURE ? 1 : 1 - ((r - WHEEL_PURE) / (1 - WHEEL_PURE)) * WHEEL_DARK;
  const f = (n) => { const k = (n + h * 6) % 6; return val * (1 - sat * Math.max(0, Math.min(k, 4 - k, 1))); };
  return '#' + [5, 3, 1].map((n) => Math.round(f(n) * 255).toString(16).padStart(2, '0')).join('');
}
// El punto de la rueda más parecido a un color.
function wheelSpot(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  const sat = max ? d / max : 0;
  const h = !d ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const rad = max < 0.99 && sat > 0.5 ? WHEEL_PURE + ((1 - max) / WHEEL_DARK) * (1 - WHEEL_PURE) : sat * WHEEL_PURE;
  return [Math.cos((h / 6) * Math.PI * 2) * rad, Math.sin((h / 6) * Math.PI * 2) * rad];
}
const DWELL = 0.42;
const wrap = (a) => ((a + 540) % 360) - 180;
// Muelle con rebote: lo que hace que se sienta vivo.
const STIFF = 520, DAMP = 24;
function spring(o, key, target, dt) {
  const v = key + 'V';
  o[v] += ((target - o[key]) * STIFF - o[v] * DAMP) * dt;
  o[key] += o[v] * dt;
}

const flatMat = () => new THREE.MeshBasicMaterial({ vertexColors: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
function makePetal(def, len, wid, order) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const lineMat = new THREE.MeshBasicMaterial({ color: INK, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const ink = new THREE.ShapeGeometry(new THREE.Shape(petalPoints(len, wid, INK_W)));
  const halo = new THREE.ShapeGeometry(new THREE.Shape(petalPoints(len, wid, HALO_W)));
  const line = new THREE.Mesh(ink, lineMat);
  const fill = new Flat();
  fill.shape(new THREE.Shape(petalPoints(len, wid)), def.color);
  const face = new THREE.Mesh(fill.geometry(), flatMat());
  const icon = new THREE.Mesh(new THREE.BufferGeometry(), flatMat());
  const holder = new THREE.Group();
  holder.position.y = def.off === undefined ? len * 0.64 : len * 0.7;
  holder.add(icon);
  body.add(line, face, holder);
  root.add(body);
  const p = { ...def, root, body, holder, line, face, icon, ink, halo, len, order,
    ang: def.angle ?? 0, angV: 0, size: 0, sizeV: 0, push: 0, pushV: 0 };
  setOrder(p, order);
  return p;
}
function setOrder(p, o) {
  p.line.renderOrder = o;
  p.face.renderOrder = o + 0.1;
  p.icon.renderOrder = o + 0.2;
  if (p.markerRing) { p.markerRing.renderOrder = o + 0.3; p.markerDot.renderOrder = o + 0.4; }
}

export class Flower {
  constructor(labelOf = (id) => id) {
    this.labelOf = labelOf;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.highlight = null;
    this.age = 0;
    this.since = 0;
    this.zero = new THREE.Vector3();
    this.sub = false;
    this.pAngle = 0;
    this.pStrength = 0;
    this.pStrengthV = 0;
    this.petals = FLOWER.map((f, i) => {
      const p = makePetal(f, LEN, WID, 900 + i * 2);
      p.body.position.y = R0;
      this.group.add(p.root);
      return p;
    });
    // Las opciones llevan el color de su pétalo y salen por debajo de él: se ve que nacen de ahí.
    this.subPetals = Object.entries(SUBS).flatMap(([parent, list]) => list.map((f) => ({ ...f, parent }))).map((f, i) => {
      const dad = this.petals.find((q) => q.id === f.parent);
      const p = f.wheel
        ? makePetal({ ...f, color: COLORS.paper }, WHEEL_LEN, WHEEL_WID, 920 + i * 0.5)
        : makePetal({ ...f, color: dad.color }, SUB_LEN, SUB_WID, 920 + i * 0.5);
      p.ang = dad.angle + f.off;
      p.root.visible = false;
      if (f.wheel) this.buildWheel(p);
      this.group.add(p.root);
      return p;
    });
    this.wheelHex = '#cfc6bb';
    this.petals.forEach((p) => loadIcon(p, ICON_SIZE).catch((e) => console.warn('Icono', p.id, e)));
    this.subPetals.filter((p) => !p.wheel).forEach((p) => loadIcon(p, SUB_ICON_SIZE).catch((e) => console.warn('Icono', p.id, e)));
    // Nombre de lo que señalas.
    this.canvas = document.createElement('canvas');
    this.canvas.width = 640;
    this.canvas.height = 150;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.label = new THREE.Mesh(
      new THREE.PlaneGeometry(0.128, 0.03),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }),
    );
    this.label.renderOrder = 1000;
    this.label.visible = false;
    this.group.add(this.label);
  }

  buildWheel(p) {
    const flat = new Flat();
    flat.circle(0, 0, WHEEL_R + 0.0028, WHEEL_R + 0.0028, INK);
    flat.wheel(WHEEL_R, wheelColor);
    p.icon.geometry = flat.geometry();
    p.holder.position.y = WHEEL_AT;
    const disc = (r, hex) => {
      const f = new Flat();
      f.circle(0, 0, r, r, hex);
      return new THREE.Mesh(f.geometry(), flatMat());
    };
    p.marker = new THREE.Group();
    p.markerRing = disc(0.0088, INK);
    p.markerDot = disc(0.0062, COLORS.white);
    p.marker.add(p.markerRing, p.markerDot);
    p.holder.add(p.marker);
    setOrder(p, p.order);
    this.wheelPetal = p;
  }

  // El color elegido en la rueda, con su marca encima.
  setWheel(hex, u, v) {
    this.wheelHex = hex;
    const m = this.wheelPetal;
    m.marker.position.set(u * WHEEL_R, v * WHEEL_R, 0);
    m.markerDot.material.color.set(hex);
  }

  // position: centro de la flor. pointer: dónde está la punta al abrir; eliges moviéndola desde ahí.
  // isActive(id): si esa herramienta u opción es la que llevas puesta (lleva el borde blanco).
  // color: el que llevas puesto, para marcarlo en la rueda.
  open(position, lookAt, isActive = () => false, pointer = position, color = this.wheelHex) {
    this.group.position.copy(position);
    this.group.lookAt(lookAt);
    this.group.updateMatrixWorld();
    this.zero.copy(pointer);
    this.group.worldToLocal(this.zero);
    this.group.visible = true;
    this.age = 0;
    this.sub = false;
    this.pStrength = this.pStrengthV = 0;
    this.setWheel(color, ...wheelSpot(color));
    this.setHighlight(null);
    for (const p of [...this.petals, ...this.subPetals]) {
      const on = isActive(p.id);
      p.line.material.color.set(on ? COLORS.white : INK);
      p.line.geometry = on ? p.halo : p.ink;
      p.ang = p.angle ?? p.ang;
      p.angV = p.size = p.sizeV = p.push = p.pushV = 0;
      p.root.visible = !p.off && p.off !== 0;
    }
    this.update(0);
  }

  close() {
    this.group.visible = false;
    this.label.visible = false;
  }

  // (x, y) desde el centro, con y hacia abajo. Devuelve true si ha cambiado lo señalado.
  hover(x, y) {
    const d = Math.hypot(x, y);
    const a = Math.atan2(x, -y) / DEG;
    this.pAngle = a;
    this.pStrength = Math.max(0, Math.min(1, (d - DEAD) / 0.035));
    let id = null;
    if (d >= DEAD) {
      id = this.sub ? this.hoverSub(x, -y) : null;
      if (id) this.pAngle = this.petals.find((p) => p.id === this.sub).angle; // los pétalos no se mueven mientras eliges
      else if (d <= OUTER) id = this.petals.reduce((b, p) => (Math.abs(wrap(a - p.angle)) < Math.abs(wrap(a - b.angle)) ? p : b)).id;
    }
    // El submenú se cierra en cuanto te vas a otro pétalo o sales de la flor.
    if (this.sub && id !== this.sub && !SUBS[this.sub].some((s) => s.id === id)) this.setSub(false);
    return this.setHighlight(id);
  }

  // ¿Qué opción de la flor abierta hay en (x, y), con y hacia arriba?
  hoverSub(x, y) {
    const c = this.subCenter();
    const list = SUBS[this.sub];
    if (list[0].wheel) {
      const dad = this.find(this.sub);
      const u = (x - c.x - Math.sin(dad.ang * DEG) * WHEEL_AT) / WHEEL_R, v = (y - c.y - Math.cos(dad.ang * DEG) * WHEEL_AT) / WHEEL_R;
      const r = Math.hypot(u, v);
      if (r * WHEEL_R > WHEEL_R + WHEEL_GRACE) return null;
      const k = Math.min(1, 1 / (r || 1));
      this.setWheel(wheelColor(u * k, v * k), u * k, v * k);
      return list[0].id;
    }
    const dx = x - c.x, dy = y - c.y, dist = Math.hypot(dx, dy);
    if (dist < SUB_HOLE || dist > SUB_REACH) return null;
    const rel = wrap(Math.atan2(dx, dy) / DEG - c.ang);
    if (Math.abs(rel) > Math.abs(list[0].off) + 28) return null;
    return list.reduce((b, s) => (Math.abs(rel - s.off) < Math.abs(rel - b.off) ? s : b)).id;
  }

  // La parte gorda del pétalo que tiene las opciones abiertas.
  subCenter() {
    const dad = this.find(this.sub);
    const r = R0 + LEN * FAT * dad.size, a = dad.ang * DEG;
    return { x: Math.sin(a) * r, y: Math.cos(a) * r, ang: dad.ang };
  }

  // El stick señala una dirección: como una mano que estuviera ya sobre el pétalo.
  hoverDir(ax, ay) {
    const l = Math.hypot(ax, ay) || 1;
    if (this.sub) {
      const c = this.subCenter();
      // Al abrirse las opciones sigues en el pétalo: hay que mover el stick para entrar en ellas.
      if (!this.stickArmed && Math.abs(wrap(Math.atan2(ax, -ay) / DEG - c.ang)) > 14) this.stickArmed = true;
      if (!this.stickArmed) return this.hover(c.x, -c.y);
      if (SUBS[this.sub][0].wheel) {
        const a = c.ang * DEG;
        return this.hover(c.x + Math.sin(a) * WHEEL_AT + ax * WHEEL_R, -(c.y + Math.cos(a) * WHEEL_AT) + ay * WHEEL_R);
      }
      return this.hover(c.x + (ax / l) * 0.075, -c.y + (ay / l) * 0.075);
    }
    const r = R0 + LEN * FAT;
    return this.hover((ax / l) * r, (ay / l) * r);
  }

  // Punto del mundo. relative: medido desde donde estaba la punta al abrir (la mano que abre);
  // si no, tal cual cae sobre la flor (la otra mano, por encima de los pétalos).
  hoverWorld(world, relative = true) {
    const p = this.group.worldToLocal(vT.copy(world));
    if (relative) p.sub(this.zero);
    return this.hover(p.x, -p.y);
  }

  // ¿Esta mano está por encima de los pétalos?
  isOver(world) {
    const p = this.group.worldToLocal(vT.copy(world));
    const d = Math.hypot(p.x, p.y);
    return Math.abs(p.z) < 0.13 && d > DEAD && d < (this.sub ? 0.34 : OUTER);
  }

  // on: el id del pétalo cuyas opciones se abren, o false para cerrarlas.
  setSub(on) {
    if (on === this.sub) return;
    this.sub = on;
    this.subAge = 0;
    this.stickArmed = false;
    for (const p of this.subPetals) {
      p.root.visible = p.parent === on;
      p.size = p.sizeV = 0;
    }
  }

  setHighlight(id) {
    if (id === this.highlight) return false;
    this.highlight = id;
    this.since = this.age;
    const p = this.find(id);
    this.label.visible = !!p;
    this.petals.forEach((q) => setOrder(q, q.id === id || q.id === this.sub ? 940 : q.order));
    this.subPetals.forEach((q) => setOrder(q, q.id === id ? 935 : q.order));
    if (p) {
      const g = this.canvas.getContext('2d'), W = this.canvas.width, H = this.canvas.height;
      const text = this.labelOf(id);
      g.clearRect(0, 0, W, H);
      g.font = '600 84px Kanit, "Noto Sans Thai", system-ui, sans-serif';
      const tw = Math.min(W - 24, g.measureText(text).width + 56);
      g.fillStyle = '#141210';
      g.fillRect((W - tw) / 2, 6, tw, H - 12);
      g.fillStyle = '#ffd21f';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, W / 2, H / 2 + 4, W - 60);
      this.tex.needsUpdate = true;
    }
    return true;
  }

  find(id) {
    return this.petals.find((q) => q.id === id) || this.subPetals.find((q) => q.id === id) || null;
  }

  update(dt) {
    const step = Math.min(dt, 1 / 40);
    this.age += dt;
    if (SUBS[this.highlight] && !this.sub && this.age - this.since > DWELL) this.setSub(this.highlight);
    this.subAge = (this.subAge || 0) + dt;
    const opening = Math.min(1, this.age / 0.16);
    const s = this.pStrength;
    for (const p of this.petals) {
      // Efecto Dock: los pétalos reaccionan a la distancia a la mano, no a un sí o no.
      const delta = wrap(p.angle - this.pAngle);
      const near = Math.exp(-((delta / 30) ** 2)) * s;
      const hot = p.id === this.highlight;
      // Con otra flor abierta, los demás pétalos se encogen para dejarle sitio.
      const room = this.sub && p.id !== this.sub ? 0.78 : 1;
      const sizeTarget = opening * room * (1 + 0.1 * near + (hot ? 0.12 : 0));
      // Los vecinos se apartan, y el señalado se inclina un poco hacia la mano.
      const away = 24 * (delta / 55) * Math.exp(-((delta / 55) ** 2));
      const angTarget = p.angle + (away - delta * 0.28 * near) * s;
      if (dt > 0) {
        spring(p, 'ang', angTarget, step);
        spring(p, 'size', sizeTarget, step);
      } else p.size = sizeTarget;
      p.root.rotation.z = -p.ang * DEG;
      p.body.scale.setScalar(Math.max(0.0001, p.size));
      p.holder.rotation.z = p.ang * DEG; // el icono siempre de pie
    }
    if (this.sub) {
      const c = this.subCenter();
      this.subPetals.filter((p) => p.parent === this.sub).forEach((p) => {
        const hot = p.id === this.highlight && !p.wheel;
        const sizeTarget = Math.min(1, this.subAge / 0.1) * (hot ? 1.14 : 1);
        spring(p, 'size', sizeTarget, step);
        spring(p, 'ang', c.ang + p.off, step);
        p.root.position.set(c.x, c.y, 0);
        p.root.rotation.z = -p.ang * DEG;
        p.body.scale.setScalar(Math.max(0.0001, p.size));
        p.holder.rotation.z = p.ang * DEG;
      });
    }
    const hot = this.find(this.highlight);
    this.label.visible = !!hot && hot.id !== this.sub; // no tapar las opciones
    if (hot) {
      const a = hot.ang * DEG;
      const r = (hot.off !== undefined ? 0 : R0) + hot.len * hot.size + 0.024;
      const side = Math.abs(Math.sin(a)) > 0.85 ? Math.sign(Math.sin(a)) * 0.03 : 0;
      this.label.position.set(hot.root.position.x + Math.sin(a) * r + side, hot.root.position.y + Math.cos(a) * r, 0);
    }
  }
}
