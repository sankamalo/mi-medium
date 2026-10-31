// Mando y mano de plastilina, y el menú en forma de flor de las gafas.
// El mando y la mano viven en el espacio de agarre (gripSpace) y usan las medidas reales del
// Touch Plus de Quest. Los dedos se mueven con los sensores de contacto del mando.
import * as THREE from 'three';

const INK = 0x141210;
const COLORS = {
  red: 0xe3242b, blue: 0x1b4fd8, yellow: 0xffd21f, green: 0x12a54a, paper: 0xfff8e3,
  white: 0xffffff, pink: 0xff7ab8, hand: 0xffc62e,
};
const DEG = Math.PI / 180;
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
  { id: 'index', at: [0.034, -0.021, -0.012], tilt: 14, r: 0.0088, len: [0.036, 0.023, 0.02],
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

function buildFinger(def, handGeo) {
  const root = new THREE.Group();
  root.position.fromArray(def.at);
  root.rotation.y = def.tilt * DEG;
  const joints = [];
  let parent = root;
  def.len.forEach((len, i) => {
    const j = new THREE.Group();
    if (i > 0) j.position.y = def.len[i - 1];
    j.add(piece(handGeo(def.r * (1 - i * 0.07), len + def.r * 0.5), COLORS.hand));
    parent.add(j);
    joints.push(j);
    parent = j;
  });
  return { root, joints, def, curl: 0.6 };
}

export function createControllerRig(handedness) {
  const group = new THREE.Group();
  const inner = new THREE.Group();
  if (handedness === 'left') inner.scale.x = -1;
  group.add(inner);
  const ctl = buildController();
  inner.add(ctl.group);

  const hand = new THREE.Group();
  inner.add(hand);
  const geoCache = new Map();
  const handGeo = (r, len) => {
    const k = r.toFixed(5) + '/' + len.toFixed(5);
    if (!geoCache.has(k)) geoCache.set(k, lumps(capsule(r, len, 9), 0.00035));
    return geoCache.get(k);
  };
  const palm = piece(lumps(ellipsoid(0.0145, 0.04, 0.037)), COLORS.hand);
  palm.position.set(0.044, 0.014, 0.022);
  palm.rotation.x = 0.08;
  palm.rotation.z = -0.1;
  const wrist = piece(lumps(capsule(0.019, 0.042, 18)), COLORS.hand);
  wrist.position.set(0.046, 0.04, 0.03);
  wrist.rotation.z = -0.08;
  const heel = piece(lumps(ellipsoid(0.012, 0.018, 0.016)), COLORS.hand);
  heel.position.set(0.034, 0.03, -0.004);
  hand.add(palm, wrist, heel);
  const fingers = FINGERS.map((d) => {
    const f = buildFinger(d, handGeo);
    hand.add(f.root);
    return f;
  });

  // Pulgar: dos huesos que buscan su objetivo.
  const T0 = new THREE.Vector3(0.033, 0.029, -0.013);
  const L1 = 0.031, L2 = 0.03;
  const th1 = piece(handGeo(0.0102, L1 + 0.004), COLORS.hand);
  const th2 = piece(handGeo(0.0094, L2 + 0.002), COLORS.hand);
  hand.add(th1, th2);
  const thumb = new THREE.Vector3().copy(P_REST).addScaledVector(FACE, 0.014);
  const elbow = new THREE.Vector3(), goal = new THREE.Vector3(), capTop = new THREE.Vector3();
  const qTilt = new THREE.Quaternion(), e = new THREE.Euler();
  const smooth = { trigger: 0.3, squeeze: 0.3, stickX: 0, stickY: 0 };

  function poseFinger(f, c) {
    const a = f.def.open, b = f.def.closed;
    let prev = 0;
    f.joints.forEach((j, i) => {
      const ang = (a[i] + (b[i] - a[i]) * c) * DEG;
      if (i === 0) j.rotation.z = ang - Math.PI / 2;
      else j.rotation.z = ang - prev;
      prev = ang;
    });
  }

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
    poseFinger(fingers[0], smooth.trigger);
    for (let i = 1; i < 4; i++) poseFinger(fingers[i], smooth.squeeze);

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

    vA.copy(thumb).sub(T0);
    const d = Math.min(vA.length(), L1 + L2 - 0.0005);
    vA.normalize();
    const along = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, L1 * L1 - along * along));
    vB.copy(FACE).addScaledVector(SIDE, 0.5).addScaledVector(vA, -vT.copy(FACE).addScaledVector(SIDE, 0.5).dot(vA)).normalize();
    elbow.copy(T0).addScaledVector(vA, along).addScaledVector(vB, h);
    th1.position.copy(T0);
    aimY(th1, vT.copy(elbow).sub(T0));
    th2.position.copy(elbow);
    aimY(th2, vB.copy(T0).addScaledVector(vA, d).sub(elbow));
  }
  update(null);
  return { group, update };
}

// ---------- La flor ----------
const R0 = 0.034, LEN = 0.14, WID = 0.098;

function petalGeometry(grow = 0, z = 0) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(-WID * 0.34, LEN * 0.28, -WID * 0.72, LEN * 1.0, 0, LEN);
  s.bezierCurveTo(WID * 0.72, LEN * 1.0, WID * 0.34, LEN * 0.28, 0, 0);
  return new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.0055, bevelSize: 0.0045 + grow, bevelSegments: 3, curveSegments: 14 }).translate(0, 0, z);
}

// Iconos de plastilina (centrados, unos 5 cm de ancho, mirando hacia +Z).
function blob(rx, ry, rz, hex, x, y, z = 0, outline = OUTLINE) {
  const m = piece(lumps(ellipsoid(rx, ry, rz, 12, 10)), hex, outline);
  m.position.set(x, y, z);
  return m;
}
const ICONS = {
  inflate() { // nube
    const g = new THREE.Group();
    g.add(blob(0.015, 0.014, 0.01, COLORS.white, -0.016, -0.004), blob(0.018, 0.017, 0.012, COLORS.white, 0.001, 0.006),
      blob(0.014, 0.013, 0.01, COLORS.white, 0.018, -0.003), blob(0.02, 0.011, 0.01, COLORS.white, 0.001, -0.009));
    return g;
  },
  move() { // puño empujando una pirámide
    const g = new THREE.Group();
    const pyr = piece(new THREE.ConeGeometry(0.019, 0.03, 4).rotateY(Math.PI / 4), COLORS.yellow, OUTLINE_HARD);
    pyr.position.set(-0.016, 0.001, 0);
    // Manopla: sin dedos sueltos, que con dedos pequeños parece un pie.
    const thumb = piece(capsule(0.0048, 0.017), COLORS.hand);
    thumb.position.set(0.012, 0.006, 0.002);
    thumb.rotation.z = 0.75;
    const cuff = piece(capsule(0.0078, 0.016), COLORS.white);
    cuff.position.set(0.021, -0.001, 0);
    cuff.rotation.z = -Math.PI / 2;
    g.add(pyr, cuff, blob(0.0135, 0.0105, 0.009, COLORS.hand, 0.009, -0.001), thumb);
    return g;
  },
  paint() { // bote de spray
    const g = new THREE.Group();
    const can = piece(new THREE.CylinderGeometry(0.0115, 0.0115, 0.032, 14), COLORS.white, OUTLINE_HARD);
    can.position.set(0.007, -0.01, 0);
    const top = blob(0.0115, 0.006, 0.0115, COLORS.white, 0.007, 0.006);
    const noz = piece(new THREE.CylinderGeometry(0.0045, 0.0045, 0.009, 10), COLORS.blue, OUTLINE_HARD);
    noz.position.set(0.007, 0.014, 0);
    g.add(can, top, noz);
    [[-0.008, 0.015, 0.0028], [-0.016, 0.022, 0.0034], [-0.018, 0.012, 0.0034], [-0.026, 0.026, 0.0028], [-0.028, 0.015, 0.0034], [-0.026, 0.005, 0.0028]]
      .forEach(([x, y, r]) => g.add(blob(r, r, r, COLORS.white, x, y, 0, null)));
    return g;
  },
  add() { // chorro de espuma
    const g = new THREE.Group();
    g.add(blob(0.022, 0.0088, 0.012, COLORS.white, 0, -0.018), blob(0.017, 0.008, 0.011, COLORS.white, 0.002, -0.007),
      blob(0.012, 0.0072, 0.01, COLORS.white, -0.001, 0.004), blob(0.0075, 0.007, 0.008, COLORS.white, 0.001, 0.014));
    const tip = piece(new THREE.ConeGeometry(0.0048, 0.012, 10), COLORS.white, OUTLINE_HARD);
    tip.position.set(0, 0.024, 0);
    g.add(tip);
    return g;
  },
  remove() { // goma con migas
    const g = new THREE.Group();
    const a = piece(new THREE.BoxGeometry(0.03, 0.021, 0.014), COLORS.pink, OUTLINE_HARD);
    a.position.set(-0.009, -0.002, 0);
    const b = piece(new THREE.BoxGeometry(0.02, 0.021, 0.014), COLORS.blue, OUTLINE_HARD);
    b.position.set(0.016, -0.002, 0);
    const pair = new THREE.Group();
    pair.add(a, b);
    pair.rotation.z = 0.32;
    g.add(pair);
    [[0.024, 0.019], [0.012, 0.024], [0.03, 0.009]].forEach(([x, y]) => g.add(blob(0.0026, 0.0026, 0.0026, COLORS.pink, x, y, 0, null)));
    return g;
  },
};

// De izquierda a derecha, como en el dibujo.
export const FLOWER = [
  { id: 'inflate', angle: -100, color: COLORS.blue },
  { id: 'move', angle: -50, color: COLORS.green },
  { id: 'paint', angle: 0, color: COLORS.red },
  { id: 'add', angle: 50, color: COLORS.yellow },
  { id: 'remove', angle: 100, color: COLORS.paper },
];
const STEP = 50;

const backOut = (x) => {
  if (x <= 0) return 0.0001;
  if (x >= 1) return 1;
  const c = 1.9;
  return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2;
};

export class Flower {
  constructor(labelOf = (id) => id) {
    this.labelOf = labelOf;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.highlight = null;
    this.age = 0;
    this.zero = new THREE.Vector3();
    const geo = lumps(petalGeometry(), 0.0005, 120);
    const inkGeo = petalGeometry(0.0032, -0.0016), haloGeo = petalGeometry(0.0062, -0.0016);
    this.inkGeo = inkGeo;
    this.haloGeo = haloGeo;
    this.petals = FLOWER.map((f) => {
      const g = new THREE.Group();
      g.rotation.z = -f.angle * DEG;
      const body = new THREE.Group();
      body.position.y = R0;
      const face = new THREE.Mesh(geo, clay(f.color));
      const line = new THREE.Mesh(inkGeo, new THREE.MeshBasicMaterial({ color: INK }));
      const icon = ICONS[f.id]();
      icon.position.set(0, LEN * 0.63, 0.021);
      icon.scale.setScalar(1.1);
      // El icono siempre de pie, aunque el pétalo esté tumbado.
      const up = new THREE.Group();
      up.position.copy(icon.position);
      up.rotation.z = f.angle * DEG;
      icon.position.set(0, 0, 0);
      up.add(icon);
      body.add(face, line, up);
      g.add(body);
      this.group.add(g);
      return { ...f, root: g, body, line, grow: 1 };
    });
    // Nombre de lo que señalas.
    this.canvas = document.createElement('canvas');
    this.canvas.width = 640;
    this.canvas.height = 150;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.label = new THREE.Mesh(
      new THREE.PlaneGeometry(0.128, 0.03),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false }),
    );
    this.label.renderOrder = 1000;
    this.label.visible = false;
    this.group.add(this.label);
  }

  // position: centro de la flor. pointer: dónde está la punta al abrir; eliges moviéndola desde ahí.
  open(position, lookAt, active, pointer = position) {
    this.group.position.copy(position);
    this.group.lookAt(lookAt);
    this.group.updateMatrixWorld();
    this.zero.copy(pointer);
    this.group.worldToLocal(this.zero);
    this.group.visible = true;
    this.age = 0;
    this.setHighlight(null);
    for (const p of this.petals) {
      // La herramienta que llevas en la mano tiene el borde blanco.
      p.line.material.color.set(p.id === active ? COLORS.white : INK);
      p.line.geometry = p.id === active ? this.haloGeo : this.inkGeo;
    }
    this.update(0);
  }

  close() {
    this.group.visible = false;
    this.label.visible = false;
  }

  // (x, y) en dirección de pantalla (y hacia abajo). Devuelve el pétalo o null.
  itemAt(x, y) {
    const a = Math.atan2(x, -y) / DEG;
    let best = null, bd = STEP * 0.5 + 16; // los de los lados perdonan un poco más
    for (const p of this.petals) {
      const d = Math.abs(a - p.angle);
      if (d < bd) { bd = d; best = p.id; }
    }
    return best;
  }

  // Dónde cae un punto del mundo respecto a la flor: el pétalo, o null si estás en el centro o fuera.
  itemAtWorld(world) {
    const p = this.group.worldToLocal(vT.copy(world)).sub(this.zero);
    const d = Math.hypot(p.x, p.y);
    if (d < 0.03 || d > (R0 + LEN) * 1.25) return null;
    return this.itemAt(p.x, -p.y);
  }

  setHighlight(id) {
    if (id === this.highlight) return false;
    this.highlight = id;
    const p = this.petals.find((q) => q.id === id);
    this.label.visible = !!p;
    if (p) {
      const g = this.canvas.getContext('2d'), W = this.canvas.width, H = this.canvas.height;
      const text = this.labelOf(id);
      g.clearRect(0, 0, W, H);
      g.font = '900 88px system-ui, "Noto Sans Thai", sans-serif';
      const tw = Math.min(W - 24, g.measureText(text).width + 56);
      g.fillStyle = '#141210';
      g.fillRect((W - tw) / 2, 6, tw, H - 12);
      g.fillStyle = '#ffd21f';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, W / 2, H / 2 + 4, W - 60);
      this.tex.needsUpdate = true;
      const a = p.angle * DEG, r = R0 + LEN + 0.04;
      this.label.position.set(Math.sin(a) * r + (Math.abs(p.angle) > 60 ? Math.sign(p.angle) * 0.03 : 0), Math.cos(a) * r, 0.03);
    }
    return true;
  }

  update(dt) {
    this.age += dt;
    const k = 1 - Math.exp(-dt * 18);
    this.petals.forEach((p, i) => {
      const pop = backOut((this.age - i * 0.025) / 0.2);
      p.grow += ((p.id === this.highlight ? 1.17 : 1) - p.grow) * k;
      p.root.scale.setScalar(pop * p.grow);
      p.body.position.z = (p.grow - 1) * 0.07;
    });
  }
}
