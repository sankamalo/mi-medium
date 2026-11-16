// Modo manos (gafas, sin mandos): cada mano hace de «mando virtual». Un dedo, una cosa:
//   DERECHA   pulgar + índice (o + anular) = dibujar / pulsar → buttons[0]
//             pulgar + corazón             = agarrar          → buttons[1]
//   IZQUIERDA pulgar + índice   = deshacer                    → buttons[5]
//             pulgar + corazón  = agarrar (las dos = zoom)    → buttons[1]
//             pulgar + anular   = la flor                     → this.pinch === 'ring'
//             pulgar + meñique  = el panel                    → this.pinch === 'pinky'
// Las gafas se quedan con «palma hacia la cara + pulgar e índice» (su menú): no se puede quitar
// desde una web. Por eso, con la palma hacia ti, ese pellizco no hace nada aquí (this.guard) y
// para dibujar en esa postura está pulgar + anular.
// main.js usa el «proxy» de cada mano igual que usaba el mando: su punta (TIP) cae en el
// punto del pellizco y gira con la muñeca.
import * as THREE from 'three';

const FINGERS = ['thumb', 'index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
const CHAINS = FINGERS.map((f) => f === 'thumb'
  ? ['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip']
  : ['wrist', f + '-metacarpal', f + '-phalanx-proximal', f + '-phalanx-intermediate', f + '-phalanx-distal', f + '-tip']);
// Distancia pulgar–dedo (m) para empezar y para soltar un pellizco.
const ON = { index: 0.02, middle: 0.022, ring: 0.022, pinky: 0.024 }, OFF = { index: 0.035, middle: 0.04, ring: 0.04, pinky: 0.042 };
const TIPS = { index: 'index-finger-tip', middle: 'middle-finger-tip', ring: 'ring-finger-tip', pinky: 'pinky-finger-tip' };
const UP = new THREE.Vector3(0, 1, 0);
const a = new THREE.Vector3(), b = new THREE.Vector3(), n = new THREE.Vector3(), q = new THREE.Quaternion();

const CLAY = new THREE.MeshStandardMaterial({ color: 0xe8b796, roughness: 0.85, metalness: 0 });
// Cada dedo, un color de la flor: así los gestos se explican por colores («junta verde y rojo»).
export const FINGER_COLORS = { thumb: 0x9ad8ae, 'index-finger': 0xf2958b, 'middle-finger': 0x93adf4, 'ring-finger': 0xffdf85, 'pinky-finger': 0xf7b3d2 };
const FINGER_MAT = {};
for (const f in FINGER_COLORS) FINGER_MAT[f] = new THREE.MeshStandardMaterial({ color: FINGER_COLORS[f], roughness: 0.78, emissive: FINGER_COLORS[f], emissiveIntensity: 0.3 });
const OFF_MAT = new THREE.MeshStandardMaterial({ color: 0x6d6876, roughness: 0.9 });
const fingerOf = (name) => FINGERS.find((f) => name.startsWith(f) && !name.endsWith('metacarpal'));
// El recorrido marca aquí los dedos que tocan en cada paso: { left: ['thumb', 'index-finger'], right: [...] }.
export const handGlow = { left: null, right: null };
const BALL = new THREE.SphereGeometry(1, 10, 8), STICK = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);

export class HandRig {
  constructor(hand, tipOffset) {
    this.hand = hand; // renderer.xr.getHand(i): sus articulaciones se actualizan solas
    this.tipOffset = tipOffset;
    this.proxy = new THREE.Object3D();
    this.proxy.userData.isHand = true;
    this.proxy.userData.rig = this;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.004, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    dot.position.copy(tipOffset);
    this.proxy.add(dot);
    this.gp = { buttons: Array.from({ length: 6 }, () => ({ value: 0, pressed: false })), axes: [0, 0, 0, 0] };
    this.pinch = null;
    this.tracked = false;
    this.palmPos = new THREE.Vector3();
    this.indexTip = new THREE.Vector3();
    this.guard = false;
    // Mano de plastilina: bolitas en las articulaciones y palitos entre ellas.
    this.visual = new THREE.Group();
    this.visual.visible = false;
    this.balls = new Map();
    this.sticks = [];
    for (const chain of CHAINS) {
      chain.forEach((name, i) => {
        if (!this.balls.has(name)) {
          const m = new THREE.Mesh(BALL, FINGER_MAT[fingerOf(name)] || CLAY);
          m.frustumCulled = false;
          this.balls.set(name, m);
          this.visual.add(m);
        }
        if (i > 0) {
          const s = new THREE.Mesh(STICK, FINGER_MAT[fingerOf(chain[i - 1])] || CLAY);
          s.frustumCulled = false;
          this.sticks.push([chain[i - 1], name, s]);
          this.visual.add(s);
        }
      });
    }
  }

  release() {
    this.pinch = null;
    for (const btn of this.gp.buttons) { btn.value = 0; btn.pressed = false; }
  }
  hide() {
    if (this.tracked) this.release();
    this.tracked = false;
    this.visual.visible = false;
    this.proxy.visible = false;
  }

  // c = el objeto del rayo de esa mano (renderer.xr.getController); src = su XRInputSource.
  // Devuelve false si la mano no se ve bien en este fotograma.
  update(c, src, head, dt, show) {
    const j = this.hand.joints;
    const wrist = j['wrist'], thumb = j['thumb-tip'], index = j['index-finger-tip'];
    const kI = j['index-finger-phalanx-proximal'], kP = j['pinky-finger-phalanx-proximal'];
    if (!wrist?.visible || !thumb?.visible || !index?.visible || !kI?.visible || !kP?.visible) {
      this.hide();
      return false;
    }
    this.tracked = true;
    this.proxy.visible = true;

    // Pellizcos: solo uno a la vez por mano (el dedo más cerca del pulgar gana) y con margen para soltar.
    const d = {};
    for (const k in TIPS) d[k] = j[TIPS[k]]?.visible ? thumb.position.distanceTo(j[TIPS[k]].position) : 1;
    if (this.pinch && d[this.pinch] > OFF[this.pinch]) this.pinch = null;
    if (!this.pinch) {
      let best = null;
      for (const k in TIPS) if (d[k] < ON[k] && (!best || d[k] < d[best])) best = k;
      this.pinch = best;
    }
    const B = this.gp.buttons, left = src.handedness === 'left';
    // ¿Palma hacia la cara? Ahí el pellizco de índice es de las gafas (abre su menú): aquí no cuenta.
    a.subVectors(kI.position, wrist.position);
    b.subVectors(kP.position, wrist.position);
    n.crossVectors(a, b).normalize();
    if (left) n.negate();
    this.palmPos.addVectors(kI.position, kP.position).multiplyScalar(0.5).lerp(wrist.position, 0.4);
    const facing = n.dot(a.subVectors(head, this.palmPos).normalize());
    this.guard = facing > (this.guard ? 0.45 : 0.6);
    this.blocked = this.guard && this.pinch === 'index';
    this.indexTip.copy(index.position);
    const set = (i, v) => { B[i].value = v; B[i].pressed = v > 0.5; };
    const draw = !left && !this.blocked && (this.pinch === 'index' || this.pinch === 'ring');
    const dd = this.pinch === 'ring' ? d.ring : d.index;
    set(0, draw ? THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(dd, 0.03, 0.01, 0.55, 1), 0.55, 1) : 0);
    set(1, this.pinch === 'middle' ? 1 : 0);
    set(5, left && this.pinch === 'index' && !this.blocked ? 1 : 0);

    // El proxy: gira con la muñeca y su punta está entre el pulgar y el índice.
    wrist.getWorldQuaternion(this.proxy.quaternion);
    const other = this.pinch === 'ring' && !left && j['ring-finger-tip']?.visible ? j['ring-finger-tip'] : index;
    a.addVectors(thumb.position, other.position).multiplyScalar(0.5);
    this.proxy.position.copy(a).sub(b.copy(this.tipOffset).applyQuaternion(this.proxy.quaternion));
    this.proxy.updateMatrixWorld(true);
    this.proxy.userData.src = { handedness: src.handedness, hand: src.hand, gamepad: this.gp };
    this.proxy.userData.aim = c.visible ? c : this.proxy; // para apuntar de lejos, el rayo de la mano

    // Dibujo de la mano. show: 'full' = mano entera de plastilina · 'tips' = un dedal de color que
    // cubre la punta de cada dedo (en realidad mixta ya ves tus manos de verdad) · false = nada.
    // Con la palma hacia ti, el pulgar y el índice se apagan: ese pellizco es de las gafas.
    this.visual.visible = !!show;
    if (show) {
      const glow = handGlow[src.handedness], beat = 1.45 + 0.35 * Math.sin(performance.now() / 150);
      for (const [name, m] of this.balls) {
        const jt = j[name], tip = name.endsWith('-tip');
        const fin = fingerOf(name), distal = name.endsWith('phalanx-distal');
        m.visible = !!jt?.visible && (show === 'full' || tip || distal);
        if (!m.visible) continue;
        m.position.copy(jt.position);
        let r = name === 'wrist' ? 0.016 : Math.min(jt.jointRadius || 0.008, 0.011);
        if (show === 'tips') r = Math.max(r, 0.0085) * 1.12; // dedal: tapa la yema de verdad
        if (tip && glow?.includes(fin)) r *= beat;
        m.scale.setScalar(r);
        if (fin) m.material = this.guard && (fin === 'thumb' || fin === 'index-finger') ? OFF_MAT : FINGER_MAT[fin];
      }
      for (const [from, to, s] of this.sticks) {
        const p0 = j[from], p1 = j[to];
        const last = to.endsWith('-tip');
        s.visible = (show === 'full' || last) && !!(p0?.visible && p1?.visible);
        if (!s.visible) continue;
        a.subVectors(p1.position, p0.position);
        const len = a.length();
        if (len < 1e-5) { s.visible = false; continue; }
        s.position.copy(p0.position).addScaledVector(a, 0.5);
        s.quaternion.copy(q.setFromUnitVectors(UP, a.divideScalar(len)));
        let r = Math.min(p1.jointRadius || 0.008, 0.011) * 0.92;
        if (show === 'tips') r = Math.max(r, 0.0085) * 1.12;
        s.scale.set(r, len, r);
        const fin = fingerOf(from);
        if (fin) s.material = this.guard && (fin === 'thumb' || fin === 'index-finger') ? OFF_MAT : FINGER_MAT[fin];
      }
    }
    return true;
  }
}
