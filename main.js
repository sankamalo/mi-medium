import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { SDFGrid, BLADE } from './sdf.js';
import { meshRegion, mergeChunks, quadsToTris, quadsToLines, toOBJ, parseOBJ, srgbToLinear } from './mesher.js';
import { RadialMenu, LABELS, TOOL_COLORS, SHAPE_ICON } from './radial.js';
import { toFBX } from './fbx.js';
import { createControllerRig, Flower, surfaceNets, wheelColor, wheelSpot } from './flor.js';
import { CanvasPanel, CERA, kanit, mali } from './panel.js';
import { parseModel, refType, REF_TYPES } from './referencia.js';
import { STAMPS, addOwnStamp, removeOwnStamp, stampFromGrid, stampThumb } from './sellos.js';
import { Live, fetchBlob, pack, unpack, API, server, checkServer } from './live.js';
import { idbGet, idbSet, idbDel, idbKeys } from './store.js';
import { remeshSDF, bakeMesh, meshArea, subdivideQuads } from './remesh.js';
import { createWebcam, calibUI } from './camara.js';
import { t, getLang, setLang, translateDOM } from './i18n.js';
import { textMesh, textField, readLetter, splitLetters, TEXT_KEYS } from './texto.js';
import { newShape, copyShape, shapeMesh, shapeHandles, handlePos, shapeField, extrudeFace, faceDir } from './formas.js';
import { sfx, PENTATONIC } from './sonidos.js';
import { OPCIONES } from './anadir.js';
import { Receptor } from './llamada.js';
import { looksBlack, findSheet, flattenSheet } from './hoja.js';
import { Tutorial } from './tutorial.js';

const RES_STEPS = [64, 96, 128, 192, 256, 320, 384, 512];
const DEFAULT_RES = 320;
const CHUNK = 32;
const B_PAD = 8; // margen al comparar trozos de malla entre fotogramas
// Hasta dónde puede crecer el espacio de una capa, en muestras por lado (unos 6 m a resolución 320).
const MAX_SAMPLES = 1600;
// En el casco la memoria es mucho más justa que en el Mac: menos historial de deshacer.
const ON_QUEST = /OculusBrowser|Quest/i.test(navigator.userAgent);
const UNDO_BYTES = ON_QUEST ? 300e6 : 800e6;
const BRICK_BYTES = 512 * 4;
let uso = null, favRow = null; // lo que más usas: se carga con el panel (ver «Lo que más usas»)
const TOOL_KEYS = ['add', 'remove', 'smooth', 'flatten', 'inflate', 'paint', 'move', 'grab', 'pinch', 'crease'];
const LAYER_COLORS = ['#cfc6bb', '#8fb8de', '#e0a07a', '#9ccf8f', '#c9a0dc', '#e6d27a', '#7ac9c2', '#e08a9a'];
const PALETTE = [
  '#f2efe9', '#cfc6bb', '#8a8580', '#2b2b2e', '#e8b796', '#c47a5a', '#7a4a33', '#e04f4f',
  '#f28c38', '#f2c94c', '#9ccf5f', '#3f9b6b', '#5ab4e0', '#3d6fd1', '#8f6fd6', '#e07ab4',
];

const params = new URLSearchParams(location.search);
const SPECTATOR = params.has('ver');      // Mac: espejo para grabar
const FORCE_EMIT = params.has('emitir');  // pruebas: emitir sin estar en las gafas
sfx.muted = SPECTATOR;

const state = {
  tool: 'add', radius: 0.025, strength: 0.6, stab: 0, sens: false, sym: false, wire: false,
  invert: false, smoothHold: false, quads: 8000, shape: 'sphere', stamp: 'stamp:ojo',
  symY: false, symZ: false, radial: false, radialN: 5, edge: 'even', texBy: {}, texAll: false, texAllId: 'plain', line: false,
  look: { rough: 0.55, wax: 0, shine: 0 }, floor: !SPECTATOR,
  exportFmt: 'obj', exportT: 0, exportNow: 0, color: '#cfc6bb', bakeSize: 2048, lathe: false, latheSpeed: 0.5,
};

// Obras guardadas: lista [{ id, name, date, size }], la abierta (null = nunca guardada)
// y el estado de la escena la última vez que se guardó.
let obras = [], obraId = null, obraSig = '', obrasReady = false;

// Tamaño del pincel en escala logarítmica: el deslizador da mucho recorrido a los tamaños pequeños.
const R_MIN = 0.004, R_MAX = 0.15;
const radiusToT = (r) => Math.log(r / R_MIN) / Math.log(R_MAX / R_MIN);
const tToRadius = (t) => R_MIN * (R_MAX / R_MIN) ** Math.max(0, Math.min(1, t));
const clampRadius = (r) => Math.max(R_MIN, Math.min(R_MAX, r));

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgbToHex = (c) => '#' + c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');

// ---------- Escena ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: SPECTATOR });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const deskBg = new THREE.Color(0x1d2026);
scene.background = deskBg;
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 50);
camera.position.set(0.4, 0.3, 1.15);

const hemi = new THREE.HemisphereLight(0xffffff, 0x3a3d48, 1.4);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xffffff, 1.8);
key.position.set(1, 2, 1.5);
scene.add(key);
const rim = new THREE.DirectionalLight(0x9db4ff, 0.7);
rim.position.set(-1.5, -0.5, -1);
scene.add(rim);

const model = new THREE.Group();
scene.add(model);
const clay = withLook(new THREE.MeshStandardMaterial({
  roughness: 0.55, metalness: 0, vertexColors: true,
  polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
}));
const wireMat = new THREE.LineBasicMaterial({ color: 0x15171c, transparent: true, opacity: 0.5 });
// Sin caja que marque el centro: con la simetría puesta se ven sus planos y su eje.
const guideMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false });
const guidePlane = (u, v) => {
  const S = 0.32, p = (a, b) => [u[0] * a + v[0] * b, u[1] * a + v[1] * b, u[2] * a + v[2] * b];
  const pts = [p(-S, -S), p(S, -S), p(S, -S), p(S, S), p(S, S), p(-S, S), p(-S, S), p(-S, -S), p(-S, 0), p(S, 0), p(0, -S), p(0, S)];
  return new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3)), guideMat);
};
const symGuides = {
  sym: guidePlane([0, 1, 0], [0, 0, 1]),
  symY: guidePlane([1, 0, 0], [0, 0, 1]),
  symZ: guidePlane([1, 0, 0], [0, 1, 0]),
  radial: new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, -0.4, 0, 0, 0.4, 0], 3)), guideMat),
};
// Todo lo de la simetría cuelga de symFrame: moverlo o girarlo es mover el eje. La bola amarilla es
// por donde se agarra; se ve siempre, aunque quede dentro de la plastilina.
const symFrame = new THREE.Group();
model.add(symFrame);
// El torno: todas las capas cuelgan de spinner, que gira alrededor del eje Y de symFrame.
// La rejilla no se entera: al esculpir, el punto de la mano se pasa al sistema de la pieza que gira.
const spinner = new THREE.Group();
spinner.matrixAutoUpdate = false;
model.add(spinner);
const spin = { angle: 0, inv: new THREE.Matrix4() };
const toSpin = (p) => (spin.angle ? new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(spin.inv).toArray() : p);
const wheelMat = (hex) => new THREE.MeshBasicMaterial({ color: hex });
const latheWheel = new THREE.Group();
const latheDisc = new THREE.Group();
{
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.006, 56), wheelMat(0x141210));
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.965, 0.965, 0.007, 56), wheelMat(0xfff8e3));
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.008, 0.035), wheelMat(0x141210));
  const bar2 = bar.clone();
  bar2.rotation.y = Math.PI / 2;
  const mark = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.009, 0.14), wheelMat(0xe3242b));
  mark.position.x = 0.8;
  latheDisc.add(rim, top, bar, bar2, mark);
  const axis = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0016, 0.6, 8).translate(0, 0.3, 0), wheelMat(0xffd21f));
  latheWheel.add(latheDisc, axis);
  latheWheel.visible = false;
  symFrame.add(latheWheel);
}
Object.values(symGuides).forEach((g) => { g.visible = false; symFrame.add(g); });
const symBall = new THREE.Mesh(
  new THREE.SphereGeometry(1, 20, 14),
  new THREE.MeshBasicMaterial({ color: 0xffd21f, transparent: true, depthTest: false, depthWrite: false }),
);
symBall.renderOrder = 880;
const symStick = new THREE.LineSegments(
  new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 0], 3)),
  new THREE.LineBasicMaterial({ color: 0xffd21f, transparent: true, opacity: 0.7, depthTest: false, depthWrite: false }),
);
symStick.renderOrder = 880;
symBall.visible = symStick.visible = false;
symFrame.add(symBall, symStick);
// Mide lo mismo de verdad aunque el modelo esté grande o pequeño, para poder cogerla siempre.
function syncSymBall() {
  const k = 1 / model.scale.x, far = (renderer.xr.isPresenting ? 0.42 : 0.27) * k;
  symBall.visible = symStick.visible = symOn();
  symBall.position.y = far;
  symBall.scale.setScalar(0.022 * k);
  symStick.scale.y = far;
}
function setSymBallHot(on) {
  symBall.material.color.set(on ? 0xffffff : 0xffd21f);
}

// Suelo: una rejilla muy tenue a la altura del suelo real. No es parte de la obra ni se exporta.
const floorU = { uCell: { value: 0.1 }, uRadius: { value: 1.6 }, uStrong: { value: 1 } };
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(16, 16).rotateX(-Math.PI / 2),
  new THREE.ShaderMaterial({
    uniforms: floorU, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `
      varying vec2 vP; varying vec2 vC;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vP = w.xz; vC = position.xz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform float uCell, uRadius, uStrong;
      varying vec2 vP; varying vec2 vC;
      float lines(vec2 p) {
        vec2 fw = fwidth(p);
        vec2 g = abs(fract(p - 0.5) - 0.5) / fw;
        return (1.0 - min(min(g.x, g.y), 1.0)) * (1.0 - smoothstep(0.25, 0.8, max(fw.x, fw.y)));
      }
      void main() {
        float a = max(lines(vP / uCell) * 0.1, lines(vP / (uCell * 4.0)) * 0.22);
        a *= 1.0 - smoothstep(uRadius * 0.3, uRadius, length(vC));
        a *= uStrong;
        if (a < 0.003) discard;
        // En las gafas, más marcado y algo oscuro: se ve igual sobre un fondo claro (al sol, en el agua...).
        gl_FragColor = vec4(mix(vec3(1.0), vec3(0.12, 0.11, 0.1), step(1.5, uStrong) * 0.55), min(a, 0.85));
      }`,
  }),
);
floor.renderOrder = -1;
floor.frustumCulled = false;
scene.add(floor);
function placeFloor(inXR) {
  floorU.uCell.value = inXR ? 0.25 : 0.1;
  floorU.uRadius.value = inXR ? 4.5 : 1.6;
  floorU.uStrong.value = inXR ? 3 : 1;
  floor.position.set(0, inXR ? 0 : -0.35, 0);
}
placeFloor(false);

// Material de la plastilina. La refracción de verdad no cabe en las gafas: "translucidez" es un
// truco de cera (la luz parece entrar y salir por los bordes) y "brillo" un reflejo barato del cielo.
const LOOK_DEFAULT = { rough: 0.55, wax: 0, shine: 0 };
const lookU = { uWax: { value: 0 }, uShine: { value: 0 } };
function withLook(mat) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, lookU);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWax;\nuniform float uShine;')
      .replace('#include <opaque_fragment>', `
        vec3 lookV = normalize(vViewPosition);
        float lookF = pow(1.0 - saturate(dot(normal, lookV)), 3.0);
        outgoingLight += diffuseColor.rgb * uWax * (0.18 + 0.75 * lookF);
        vec3 lookR = inverseTransformDirection(reflect(-lookV, normal), viewMatrix);
        float lookS = smoothstep(0.35, 0.95, lookR.y) + 0.25 * smoothstep(0.2, 0.9, lookR.x);
        outgoingLight += vec3(lookS) * uShine * (0.25 + 0.6 * lookF) * (1.0 - roughnessFactor * 0.7);
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'plastilinaLook';
  return mat;
}
function setLook(look) {
  state.look = { ...look };
  clay.roughness = look.rough;
  lookU.uWax.value = look.wax;
  lookU.uShine.value = look.shine;
  layers.forEach((L) => { if (L.remesh?.baked) L.remesh.baked.material.roughness = look.rough; });
}
function changeLook(key, value) {
  setLook({ ...state.look, [key]: value });
  if (live.emitting) live.hub.send({ t: 'look', look: state.look });
  syncLookInputs();
}
function syncLookInputs() {
  document.querySelectorAll('#hud [data-look]').forEach((el) => (el.value = state.look[el.dataset.look]));
}

const cursor = new THREE.Mesh(
  new THREE.SphereGeometry(1, 24, 16),
  new THREE.MeshBasicMaterial({ color: TOOL_COLORS.add, wireframe: true, transparent: true, opacity: 0.35, depthWrite: false }),
);
cursor.visible = false;
model.add(cursor);
// Un cursor por cada copia de simetría (se colocan solos, ver syncCursorCopies).
const cursorCopies = Array.from({ length: 15 }, () => {
  const c = cursor.clone();
  c.material = cursor.material;
  c.matrixAutoUpdate = false;
  model.add(c);
  return c;
});
// Forma del cursor = huella del pincel (a escala r): esfera, cubo o pirámide.
const CURSOR_GEO = {
  blade: new THREE.BoxGeometry(BLADE.thin * 2, BLADE.tall * 2, BLADE.long * 2),
  sphere: cursor.geometry,
  cube: new THREE.BoxGeometry(1.5, 1.5, 1.5, 2, 2, 2),
  pyramid: new THREE.ConeGeometry(Math.SQRT2, 2, 4, 1).rotateY(Math.PI / 4).translate(0, 0.4, 0),
};
// El fantasma de un sello: su malla, hecha la primera vez que se usa.
function stampCursorGeo(id) {
  const st = STAMPS.get(id);
  if (!st) return CURSOR_GEO.sphere;
  if (st.geo) return st.geo;
  const out = { d: 0, c: null };
  const net = surfaceNets((p) => { st.eval(p[0], p[1], p[2], out); return out.d; }, [-1.3, -1.3, -1.3], [1.3, 1.3, 1.3], 0.09);
  st.geo = new THREE.BufferGeometry();
  st.geo.setAttribute('position', new THREE.BufferAttribute(net.positions, 3));
  st.geo.setIndex(net.indices);
  return st.geo;
}
function updateCursorShape() {
  const sh = shapeActive() ? state.shape : 'sphere';
  const geo = sh === 'stamp' ? stampCursorGeo(state.stamp) : CURSOR_GEO[sh];
  if (cursor.geometry !== geo) cursor.geometry = geo;
  if (sh === 'sphere') {
    cursor.quaternion.identity();
    return;
  }
  const e = brushRot(model);
  if (!e) return;
  rotM.set(e[0], e[3], e[6], 0, e[1], e[4], e[7], 0, e[2], e[5], e[8], 0, 0, 0, 0, 1);
  cursor.quaternion.setFromRotationMatrix(rotM);
}

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
// Clic derecho queda libre para el dial de herramientas; el botón central mueve la vista.
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: null };

// ---------- Capas ----------
// Cada capa tiene su propia rejilla de vóxeles, su resolución, su color base y su malla.
function buildMesh(positions, normals, colors, quads, mat) {
  const geo = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(positions, 3);
  geo.setAttribute('position', pos);
  // Color en 3 bytes por vértice (en vez de 12): con mucho detalle la memoria del casco se nota.
  geo.setAttribute('color', new THREE.BufferAttribute(colorsToBytes(colors), 3, true));
  geo.setIndex(new THREE.BufferAttribute(quadsToTris(quads), 1));
  if (normals) geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  else geo.computeVertexNormals();
  geo.userData.refs = 1;
  const r = { mesh: new THREE.Mesh(geo, mat), lines: null, quads, group: null };
  if (state.wire) wireOf(r);
  return r;
}
// La misma malla en otro fotograma: no ocupa más memoria.
function shareMesh(src) {
  src.mesh.geometry.userData.refs++;
  const r = { mesh: new THREE.Mesh(src.mesh.geometry, clay), lines: null, quads: src.quads, group: null, m: src.m };
  if (state.wire) wireOf(r);
  return r;
}
// Las líneas de la malla solo se crean cuando se activa "Malla".
function wireOf(r) {
  if (!r.lines) {
    const lgeo = new THREE.BufferGeometry();
    lgeo.setAttribute('position', r.mesh.geometry.getAttribute('position'));
    lgeo.setIndex(new THREE.BufferAttribute(quadsToLines(r.quads), 1));
    r.lines = new THREE.LineSegments(lgeo, wireMat);
    if (r.group) r.group.add(r.lines);
  }
  return r.lines;
}
function addMesh(group, r) {
  r.group = group;
  group.add(r.mesh);
  if (r.lines) group.add(r.lines);
}
function setMeshWire(r, v) {
  if (v) wireOf(r).visible = true;
  else if (r.lines) {
    r.group?.remove(r.lines);
    r.lines.geometry.dispose();
    r.lines = null;
  }
}
function disposeMesh(group, r) {
  group.remove(r.mesh);
  setMeshWire(r, false);
  if (--r.mesh.geometry.userData.refs <= 0) r.mesh.geometry.dispose();
}
// sRGB 0-1 -> lineal en bytes (three.js los normaliza).
const LIN8 = new Uint8Array(256).map((_, i) => {
  const c = i / 255;
  return Math.round(255 * (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
});
function colorsToBytes(c) {
  const out = new Uint8Array(c.length);
  for (let i = 0; i < c.length; i++) out[i] = LIN8[Math.max(0, Math.min(255, Math.round(c[i] * 255)))];
  return out;
}

const IDENTITY4 = new THREE.Matrix4();
const placeV = new THREE.Vector3();
// Punto del modelo al sistema de la rejilla de un fotograma, y al revés.
const toGrid = (f, p) => { if (!f.moved) return p; placeV.set(p[0], p[1], p[2]).applyMatrix4(f.inv); return [placeV.x, placeV.y, placeV.z]; };
const fromGrid = (f, p) => { placeV.set(p[0], p[1], p[2]).applyMatrix4(f.voxels.matrix); return [placeV.x, placeV.y, placeV.z]; };
let layerSeq = 0;
class Layer {
  constructor(n, shape, opts = {}) {
    this.id = opts.id ?? ++layerSeq;
    layerSeq = Math.max(layerSeq, this.id);
    this.name = opts.name ?? t('Capa {0}', this.id);
    this.color = opts.color ?? LAYER_COLORS[(this.id - 1) % LAYER_COLORS.length];
    this.group = new THREE.Group();
    spinner.add(this.group);
    // Fotogramas: cada uno con su rejilla y su malla; se pasa de uno a otro enseñando y ocultando.
    this.f = this.makeFrame(opts.grid ?? new SDFGrid(n, shape));
    this.f.voxels.visible = true;
    this.frames = [this.f];
    this.group.add(this.f.voxels);
    this.reGroup = new THREE.Group(); // la malla del remesh va donde esté la capa
    this.reGroup.matrixAutoUpdate = false;
    this.group.add(this.reGroup);
    this.remesh = null;
    this.version = 0;
    this.moves = 0;
    this.busy = false;
    if (opts.visible === false) this.group.visible = false;
    this.rebuildAll();
  }

  // La capa trabaja siempre sobre el fotograma que se ve.
  get grid() { return this.f.grid; }
  set grid(v) { this.f.grid = v; }
  get voxels() { return this.f.voxels; }
  get chunks() { return this.f.chunks; }
  set chunks(v) { this.f.chunks = v; }
  get dirty() { return this.f.dirty; }
  set dirty(v) { this.f.dirty = v; }
  get C() { return this.f.C; }
  set C(v) { this.f.C = v; }

  makeFrame(grid) {
    const voxels = new THREE.Group();
    voxels.visible = false;
    voxels.matrixAutoUpdate = false;
    return { grid, voxels, chunks: [], dirty: new Set(), C: 0, inv: new THREE.Matrix4(), s: 1, moved: false };
  }
  // Dónde está un fotograma. Mover, girar o escalar solo cambia esta matriz: la rejilla y su malla no
  // se tocan, así que no se pierde detalle aunque muevas la pieza mil veces.
  setPlace(f, m) {
    f.voxels.matrix.copy(m);
    f.voxels.matrixWorldNeedsUpdate = true;
    f.inv.copy(m).invert();
    f.s = Math.cbrt(m.determinant());
    f.moved = !m.equals(IDENTITY4);
    if (f === this.f) this.placeRemesh();
  }
  placeRemesh() {
    this.reGroup.matrix.copy(this.f.voxels.matrix);
    this.reGroup.matrixWorldNeedsUpdate = true;
  }
  // Fotograma con la rejilla dada; su malla se hace poco a poco.
  frameFromGrid(grid) {
    const f = this.makeFrame(grid);
    this.rebuildFrame(f);
    return f;
  }
  // Copia instantánea: comparte rejilla y malla con el original hasta que se esculpe encima.
  copyFrame(src) {
    const f = this.makeFrame(src.grid.share());
    this.setPlace(f, src.voxels.matrix);
    f.C = src.C;
    f.chunks = src.chunks.map((r) => {
      if (!r) return null;
      const c = shareMesh(r);
      addMesh(f.voxels, c);
      return c;
    });
    f.dirty = new Set(src.dirty);
    return f;
  }
  insertFrame(f, at) {
    this.frames.splice(at, 0, f);
    this.group.add(f.voxels);
  }
  removeFrame(f) {
    const i = this.frames.indexOf(f);
    this.frames.splice(i, 1);
    this.group.remove(f.voxels);
    f.voxels.visible = false;
    if (this.f === f) {
      this.f = this.frames[Math.min(i, this.frames.length - 1)];
      this.f.voxels.visible = true;
    }
  }
  disposeFrame(f) {
    f.chunks.forEach((ch) => ch && disposeMesh(f.voxels, ch));
    f.chunks = [];
  }
  show(i) {
    const f = this.frames[i];
    if (f === this.f) return;
    this.f.voxels.visible = false;
    f.voxels.visible = true;
    this.f = f;
    this.placeRemesh();
  }
  // Se queda con una copia de los fotogramas de otra capa (sin gastar memoria nueva).
  adoptFrames(src) {
    this.disposeFrame(this.f);
    this.group.remove(this.f.voxels);
    this.frames = src.frames.map((f) => this.copyFrame(f));
    this.frames.forEach((f) => this.group.add(f.voxels));
    this.f = this.frames[src.frames.indexOf(src.f)];
    this.f.voxels.visible = true;
  }
  // Memoria aproximada de los fotogramas: lo compartido cuenta una vez.
  frameBytes() {
    const seen = new Set();
    for (const f of this.frames) {
      for (const b of f.grid.bricks) if (b) seen.add(b);
      for (const c of f.grid.colors) if (c) seen.add(c);
    }
    return seen.size * 2048;
  }

  get visible() { return this.group.visible; }
  set visible(v) { this.group.visible = v; }
  get base() { return hexToRgb(this.color); }

  setBase(hex) {
    this.color = hex;
    this.frames.forEach((f) => this.rebuildFrame(f));
    this.changed();
  }

  rebuildFrame(f) {
    f.chunks.forEach((ch) => ch && disposeMesh(f.voxels, ch));
    f.C = Math.ceil((f.grid.n - 1) / CHUNK);
    f.chunks = new Array(f.C ** 3).fill(null);
    f.dirty.clear();
    for (let i = 0; i < f.chunks.length; i++) f.dirty.add(i);
  }

  rebuildAll() {
    this.rebuildFrame(this.f);
    this.changed();
  }

  // Hace sitio para un tramo del pincel: si se acerca al borde, el espacio crece y nadie lo nota.
  fit(a, b, r) {
    const g = this.grid, pad = r * 2 + g.band * 2, g1 = g.o + (g.n - 1) * g.h;
    let need = 0;
    for (let i = 0; i < 3; i++) need = Math.max(need, g.o - (Math.min(a[i], b[i]) - pad), Math.max(a[i], b[i]) + pad - g1);
    if (need <= 0) return;
    // Múltiplo de CHUNK (y de 8): los trozos de malla ya hechos siguen valiendo, solo cambian de sitio.
    let S = Math.ceil(Math.max(need / g.h, g.n * 0.25) / CHUNK) * CHUNK;
    if (g.n + 2 * S > MAX_SAMPLES) S = Math.floor((MAX_SAMPLES - g.n) / 2 / CHUNK) * CHUNK;
    if (S <= 0) {
      if (!this.fullWarned) toast('Has llegado al final del espacio de esta capa');
      this.fullWarned = true;
      return;
    }
    const remap = g.grow(S);
    rebaseUndo(this, remap);
    const k = S / CHUNK, oldC = this.C, oldChunks = this.chunks, oldDirty = this.dirty;
    this.C = Math.ceil((g.n - 1) / CHUNK);
    const C = this.C, shift = (i) => (i % oldC) + k + C * ((Math.floor(i / oldC) % oldC) + k + C * (Math.floor(i / (oldC * oldC)) + k));
    this.chunks = new Array(C ** 3).fill(null);
    oldChunks.forEach((ch, i) => { if (ch) this.chunks[shift(i)] = ch; });
    this.dirty = new Set();
    for (const i of oldDirty) this.dirty.add(shift(i));
  }

  markDirty(lo, hi) {
    const C = this.C;
    const range = (a) => {
      const r = [];
      for (let i = 0; i < C; i++) {
        const c = i * CHUNK;
        if (lo[a] <= c + CHUNK && hi[a] >= c - 1) r.push(i);
      }
      return r;
    };
    const rx = range(0), ry = range(1), rz = range(2);
    for (const z of rz) for (const y of ry) for (const x of rx) this.dirty.add(x + C * (y + C * z));
    this.changed();
  }

  changed() {
    this.version++;
    if (this.remesh) this.clearRemesh();
  }

  // Re-malla los chunks pendientes; con presupuesto de tiempo para no congelar la pantalla.
  flush(budgetMs = Infinity, f = this.f) {
    const t0 = performance.now();
    const C = f.C, base = this.base;
    const prev = this.frames[this.frames.indexOf(f) - 1];
    for (const ci of f.dirty) {
      f.dirty.delete(ci);
      const cx = ci % C, cy = Math.floor(ci / C) % C, cz = Math.floor(ci / (C * C));
      if (f.chunks[ci]) disposeMesh(f.voxels, f.chunks[ci]);
      f.chunks[ci] = null;
      // Si el fotograma anterior es igual en este trozo, se aprovecha su malla.
      const twin = prev && prev.C === C && !prev.dirty.has(ci) && f.grid.sameRegion(prev.grid, cx * CHUNK - B_PAD, cy * CHUNK - B_PAD, cz * CHUNK - B_PAD,
        (cx + 1) * CHUNK + B_PAD, (cy + 1) * CHUNK + B_PAD, (cz + 1) * CHUNK + B_PAD);
      if (twin) {
        if (prev.chunks[ci]) {
          f.chunks[ci] = shareMesh(prev.chunks[ci]);
          addMesh(f.voxels, f.chunks[ci]);
        }
      } else {
        const m = meshRegion(f.grid, cx * CHUNK, cy * CHUNK, cz * CHUNK, CHUNK, base);
        if (m) {
          const r = buildMesh(m.positions, m.normals, m.colors, m.quads, clay);
          r.m = m;
          addMesh(f.voxels, r);
          f.chunks[ci] = r;
        }
      }
      if (performance.now() - t0 > budgetMs) break;
    }
  }
  // Los fotogramas que no se ven se mallan cuando sobra tiempo. Devuelve si ha hecho algo.
  flushHidden(budgetMs) {
    const f = this.frames.find((x) => x !== this.f && x.dirty.size);
    if (!f) return false;
    this.flush(budgetMs, f);
    return true;
  }

  merged() {
    this.flush();
    return mergeChunks(this.chunks.filter(Boolean).map((c) => c.m));
  }

  // Malla de Blender: el color se recupera de la rejilla en cada vértice.
  setRemesh(parsed) {
    this.clearRemesh();
    if (!parsed.colors) {
      const p = parsed.positions, base = this.base;
      const cols = new Float32Array(p.length);
      for (let i = 0; i < p.length; i += 3) {
        const c = this.grid.sampleColor(p[i], p[i + 1], p[i + 2]) || base;
        cols[i] = c[0] / 255; cols[i + 1] = c[1] / 255; cols[i + 2] = c[2] / 255;
      }
      parsed.colors = cols;
    }
    this.remesh = buildMesh(parsed.positions, parsed.normals || null, parsed.colors, parsed.quads, clay);
    if (!parsed.normals) parsed.normals = this.remesh.mesh.geometry.getAttribute('normal').array;
    this.remesh.data = parsed;
    addMesh(this.reGroup, this.remesh);
    this.placeRemesh();
    this.voxels.visible = false;
  }

  // Malla horneada: la malla nueva con UVs y las texturas (normales + color) del detalle.
  applyBake(bake) {
    const r = this.remesh;
    if (!r) return;
    this.clearBake();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(bake.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(bake.normals, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(bake.uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(bake.index, 1));
    const tex = (data, srgb) => {
      const t = new THREE.DataTexture(data, bake.size, bake.size, THREE.RGBAFormat);
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.anisotropy = 4;
      t.needsUpdate = true;
      return t;
    };
    // Normal map en convención OpenGL/glTF (Y = arriba en la imagen): three.js sin tangentes
    // necesita la Y invertida, igual que hace su cargador de glTF.
    const mat = withLook(new THREE.MeshStandardMaterial({
      map: tex(bake.colorMap, true), normalMap: tex(bake.normalMap, false),
      normalScale: new THREE.Vector2(1, -1), roughness: state.look.rough, metalness: 0,
    }));
    r.baked = new THREE.Mesh(geo, mat);
    r.bake = bake;
    r.mesh.visible = false;
    this.reGroup.add(r.baked);
  }

  clearBake() {
    const r = this.remesh;
    if (!r?.baked) return;
    this.reGroup.remove(r.baked);
    r.baked.geometry.dispose();
    r.baked.material.map.dispose();
    r.baked.material.normalMap.dispose();
    r.baked.material.dispose();
    r.baked = null;
    r.bake = null;
    r.mesh.visible = true;
  }

  clearRemesh() {
    if (!this.remesh) return;
    this.clearBake();
    disposeMesh(this.reGroup, this.remesh);
    this.remesh = null;
    this.voxels.visible = true;
  }

  setWire(v) {
    this.frames.forEach((f) => f.chunks.forEach((ch) => ch && setMeshWire(ch, v)));
    if (this.remesh) setMeshWire(this.remesh, v);
  }

  dispose() {
    this.frames.forEach((f) => this.disposeFrame(f));
    this.clearRemesh();
    spinner.remove(this.group);
  }
}

let layers = [new Layer(DEFAULT_RES, 'sphere')];
let active = layers[0];
const layerById = (id) => layers.find((L) => L.id === id);

function setActive(L) {
  active = L;
  state.brushRes = L.grid.res;
  showLayerRow(L);
  if (!L.visible) L.visible = true;
  paintOnion();
  updateHud();
}

function newLayer() {
  const L = new Layer(active.grid.res, 'empty');
  layers.push(L);
  setActive(L);
  live.structure();
  sfx.play('pop');
  toast(t('{0} creada (vacía): añade barro con "Añadir"', L.name));
}

function nextLayer() {
  setActive(layers[(layers.indexOf(active) + 1) % layers.length]);
  live.structure();
  toast(t('Capa activa: {0}', active.name));
}

function deleteLayer(L, ask = true) {
  if (merge) return mergeBusy();
  if (layers.length === 1) return toast('No puedes borrar la única capa');
  if (ask && !confirm(t('¿Borrar {0}? No se puede deshacer.', L.name))) return;
  for (const s of [undoStack, redoStack]) {
    for (let i = s.length - 1; i >= 0; i--) if (s[i]?.layer === L) forgetEntry(s.splice(i, 1)[0]);
  }
  mergePick.delete(L);
  const idx = layers.indexOf(L);
  L.dispose();
  layers.splice(idx, 1);
  setActive(layers[Math.max(0, idx - 1)]);
  live.structure();
  sfx.play('poof');
}

// Con varias capas elegidas (los círculos de color), «Borrar» se las lleva todas de una vez.
const deleteTargets = () => (mergePick.size > 1 ? layers.filter((L) => mergePick.has(L)) : [active]);
function deleteLayers(list, ask = true) {
  if (list.length < 2) return deleteLayer(list[0], ask);
  if (merge) return mergeBusy();
  if (list.length >= layers.length) return toast('Deja al menos una capa sin elegir');
  if (ask && !confirm(t('¿Borrar estas {0} capas? No se puede deshacer.', list.length))) return;
  for (const L of list) deleteLayer(L, false);
  toast(t('{0} capas borradas', list.length));
  updateHud();
  drawPanel();
}

// Unir capas: se eligen tocando su círculo de color. Queda la de más resolución, para no perder detalle,
// y las demás se guardan por si se deshace.
const mergePick = new Set();
function pickForMerge(L) {
  if (mergePick.has(L)) mergePick.delete(L);
  else mergePick.add(L);
  updateHud();
  drawPanel();
}
// Hasta aquí una unión se hace sin preguntar; por encima, pesaría demasiado o tardaría mucho.
const MERGE_QUADS = ON_QUEST ? 500e3 : 2.5e6, MERGE_WORK = ON_QUEST ? 20e3 : 150e3;
const fmtQuads = (q) => (q >= 1e6 ? (q / 1e6).toLocaleString(getLang(), { maximumFractionDigits: 1 }) + ' M' : Math.round(q / 1000) + ' k');
// Cuentas de antes de unir: dónde cae cada capa y cuánto saldría a cada resolución (más vóxeles por lado,
// más polígonos: crecen con el cuadrado). Es un cálculo por lo alto: no descuenta lo que se solape.
function mergePlan(list) {
  const T = list.reduce((a, L) => (L.grid.res > a.grid.res || (L.grid.res === a.grid.res && L === active) ? L : a));
  const v = new THREE.Vector3(), rest = list.filter((L) => L !== T);
  const pieces = rest.map((L) => {
    const toT = new THREE.Matrix4().multiplyMatrices(T.f.inv, L.f.voxels.matrix), box = L.grid.occupied();
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    if (box) for (let c = 0; c < 8; c++) {
      v.set(c & 1 ? box.hi[0] : box.lo[0], c & 2 ? box.hi[1] : box.lo[1], c & 4 ? box.hi[2] : box.lo[2]).applyMatrix4(toT);
      v.toArray().forEach((x, a) => { lo[a] = Math.min(lo[a], x); hi[a] = Math.max(hi[a], x); });
    }
    return { L, lo, hi, empty: !box, map: new THREE.Matrix4().multiplyMatrices(L.f.inv, T.f.voxels.matrix).elements, scale: L.f.s / T.f.s };
  });
  const own = T.grid.occupied();
  let reach = own ? Math.max(...own.lo.map(Math.abs), ...own.hi.map(Math.abs)) : 0;
  for (const p of pieces) if (!p.empty) reach = Math.max(reach, ...p.lo.map(Math.abs), ...p.hi.map(Math.abs));
  const counts = list.map((L) => ({ L, quads: L.chunks.reduce((a, c) => a + (c ? c.quads.length / 4 : 0), 0), bricks: L.grid.bricks.reduce((a, b) => a + (b ? 1 : 0), 0) }));
  const at = (res) => {
    let quads = 0, work = 0;
    for (const { L, quads: q, bricks } of counts) {
      const k = (L.grid.h * L.f.s * (res - 1)) / T.f.s;
      quads += q * k * k;
      if (L !== T || res !== T.grid.res) work += bricks * k * k;
    }
    const fits = 2 * reach * (res - 1) + 64 <= MAX_SAMPLES;
    return { res, quads, work, fits, light: fits && quads <= MERGE_QUADS && work <= MERGE_WORK };
  };
  const full = at(T.grid.res);
  const lower = RES_STEPS.filter((r) => r < T.grid.res).map(at).filter((o) => o.fits).reverse();
  let choices = [full];
  if (!full.light && lower.length) {
    const best = lower.findIndex((o) => o.light), i = best < 0 ? lower.length - 1 : best;
    choices = [lower[i], lower[i + 1], full.fits ? full : null].filter(Boolean);
  }
  return { list, T, rest, pieces, full, choices, at };
}
function mergeLayers() {
  if (merge) return mergeBusy();
  const list = layers.filter((L) => mergePick.has(L));
  if (list.length < 2) return toast('Toca el círculo de color de dos capas o más');
  if (list.some((L) => L.frames.length > 1)) return toast('Las capas con fotogramas no se pueden unir');
  if (list.some((L) => L.busy)) return toast('Espera a que acabe el remesh');
  const locked = list.find((L) => L.remesh);
  if (locked) return remeshLocked(locked);
  if (sculpting || xr.stroking) return;
  const plan = mergePlan(list);
  if (plan.choices.length === 1) return startMerge(plan.choices[0].res);
  showMergeAsk({ ...plan, title: 'Unir capas', text: mergeAskText(plan), note: 'Reducir quita detalle fino. Se puede deshacer.', label: (o, i) => mergeChoice(plan, o, i), go: (o) => startMerge(o.res) });
}
function showMergeAsk(plan) {
  mergeAsk = plan;
  if (renderer.xr.isPresenting) {
    panelPage = 'unir';
    drawPanel();
  } else {
    const box = $('mergeAskBtns');
    $('mergeAskText').textContent = plan.text;
    box.replaceChildren(...plan.choices.map((o, i) => {
      const b = document.createElement('button');
      b.textContent = plan.label(o, i);
      b.classList.toggle('primary', !i);
      b.onclick = () => plan.go(o);
      return b;
    }));
    $('mergeAsk').hidden = false;
  }
  sfx.play('dial', { semi: -5 });
}
let mergeAsk = null;
const mergeAskText = (plan) => t('Esto quedaría muy pesado: unos {0} polígonos. ¿Reducirlo antes de unir?', fmtQuads(plan.full.quads));
function mergeChoice(plan, o, i) {
  if (o.res === plan.T.grid.res) return t('Sin reducir: {0}³ · unos {1} polígonos', o.res, fmtQuads(o.quads));
  return t(i ? '{0}³ · unos {1} polígonos' : '{0}³ · unos {1} polígonos · recomendado', o.res, fmtQuads(o.quads));
}
function closeMergeAsk() {
  mergeAsk = null;
  $('mergeAsk').hidden = true;
  if (panelPage === 'unir') {
    panelPage = 'main';
    drawPanel();
  }
}

// La unión va a trocitos entre imagen e imagen: la vista sigue a la cabeza todo el rato. Hasta el final
// no se cambia nada de la obra, y las capas de antes siguen a la vista hasta que la nueva está hecha.
let merge = null;
const mergeBusy = () => toast('Espera a que acabe la barra');
function startMerge(res) {
  const list = layers.filter((L) => mergePick.has(L));
  closeMergeAsk();
  if (list.length < 2) return;
  mergePick.clear();
  runMerge(list, res, 'Uniendo capas', (T) => t('Capas unidas en {0}, a {1}³', T.name, T.grid.res));
}
function runMerge(list, res, title, done, extra) {
  closeMergeAsk();
  if (list.some((L) => L.busy || (L.remesh && !extra))) return;
  const plan = mergePlan(list);
  list.forEach((L) => { L.busy = true; });
  merge = { ...plan, res, title, done, p: 0, pct: -1, stamp: list.map((L) => [L, L.version, L.moves]), touched: [], job: null, grid: null };
  Object.assign(merge, extra);
  merge.job = extra?.makeJob ? extra.makeJob(merge) : mergeJob(merge);
  mergeBarShow(true);
  updateHud();
  drawPanel();
}
function* mergeJob(m) {
  const { T, pieces, res, touched } = m;
  const k2 = (L) => ((L.grid.h * L.f.s * (res - 1)) / T.f.s) ** 2;
  const count = (L) => L.grid.bricks.reduce((a, b) => a + (b ? 1 : 0), 0) * k2(L);
  const shrink = res !== T.grid.res;
  const weights = pieces.map((x) => (x.empty ? 0 : count(x.L)));
  const own = shrink ? count(T) : 0, total = own + weights.reduce((a, b) => a + b, 0) || 1;
  let done = 0;
  // Reducir empieza en una rejilla aparte; si no, en una copia que comparte con la de ahora lo que no cambie.
  if (shrink) {
    m.grid = new SDFGrid(2, 'empty');
    m.grid.setState(T.grid.state());
    for (const p of m.grid.resampleSteps(res)) { m.p = (p * own) / total; yield; }
    done = own;
    for (const x of pieces) if (!x.empty) m.grid.growTo(x.lo, x.hi, MAX_SAMPLES);
  } else {
    for (const x of pieces) if (!x.empty) T.fit(x.lo, x.hi, 0);
    m.grid = T.grid.share();
  }
  for (let i = 0; i < pieces.length; i++) {
    const x = pieces[i];
    if (x.empty) continue;
    for (const p of m.grid.absorbSteps(x.L.grid, x.map, x.scale, x.L.base, x.lo, x.hi, touched)) { m.p = (done + p * weights[i]) / total; yield; }
    done += weights[i];
  }
}
// Una vez por imagen: un trocito de cálculo, o esperar a que se haga la malla nueva.
function mergeFrame(dt) {
  const m = merge;
  if (!m) return;
  const inXR = renderer.xr.isPresenting;
  if (m.job) {
    if (m.stamp.some(([L, v, n]) => !layers.includes(L) || L.version !== v || L.moves !== n)) return cancelMerge();
    const end = performance.now() + (inXR ? 8 : 14);
    while (performance.now() < end) {
      if (m.job.next().done) {
        commitMerge(m);
        break;
      }
    }
  } else if (!m.T.dirty.size) return finishMerge(m);
  const shown = m.job ? m.p * 0.85 : 0.85 + 0.15 * (1 - m.T.dirty.size / m.meshes);
  mergeBarPaint(shown, dt);
}
function cancelMerge() {
  merge.list.forEach((L) => { L.busy = false; });
  merge = null;
  mergeBarShow(false);
  updateHud();
  drawPanel();
  toast('Ha cambiado la capa: cancelado');
}
// Ya está calculado: la capa pasa a tener la forma nueva y se rehace solo la malla que cambia.
function commitMerge(m) {
  const { T, grid, touched } = m;
  m.job = null;
  m.shrunk = grid.h !== T.grid.h || m.textBack;
  m.full = T.grid.state();
  m.oldBytes = m.shrunk ? T.grid.bytes() : touched.length * BRICK_BYTES * 2;
  T.grid.setState(grid.state());
  if (m.shrunk) {
    // El texto en quads sigue a la vista hasta que el vóxel está hecho.
    if (T.remesh) {
      m.oldRemesh = T.remesh;
      T.remesh = null;
      T.voxels.visible = true;
    }
    m.oldMeshes = T.chunks.filter(Boolean);
    T.chunks = [];
    T.rebuildAll();
  } else {
    const C = T.C, nb = T.grid.nb;
    for (const bi of touched) {
      const v = [bi % nb, Math.floor(bi / nb) % nb, Math.floor(bi / (nb * nb))];
      const from = v.map((x) => Math.max(0, Math.ceil(x / 4) - 1)), to = v.map((x) => Math.min(C - 1, (x + 1) >> 2));
      for (let z = from[2]; z <= to[2]; z++) for (let y = from[1]; y <= to[1]; y++) for (let x = from[0]; x <= to[0]; x++) T.dirty.add(x + C * (y + C * z));
    }
    T.changed();
  }
  m.meshes = T.dirty.size || 1;
  setActive(T);
}
function finishMerge(m) {
  const { T, rest, list } = m;
  merge = null;
  m.oldMeshes?.forEach((ch) => disposeMesh(T.f.voxels, ch));
  if (m.oldRemesh) disposeMesh(T.reGroup, m.oldRemesh);
  noteEdit();
  const removed = rest.map((L) => ({ L, at: layers.indexOf(L) }));
  undoStack.push({ layer: T, grid: T.grid, merge: removed, present: true, full: m.full, textBack: m.textBack, bytes: m.oldBytes + rest.reduce((a, L) => a + L.grid.bytes(), 0) });
  clearRedo();
  trimUndo();
  for (const L of rest) {
    layers.splice(layers.indexOf(L), 1);
    spinner.remove(L.group);
  }
  list.forEach((L) => { L.busy = false; });
  mergeBarShow(false);
  setActive(T);
  live.structure();
  drawPanel();
  sfx.play('thock');
  toast(m.done(T));
}

function setLayerBase(L, hex) {
  if ((L.text || L.shape) && L.remesh) {
    L.color = hex;
    rebuildParam(L);
    updateHud();
    live.structure();
    return;
  }
  if (remeshLocked(L)) return;
  L.setBase(hex);
  updateHud();
  live.structure();
}

// ---------- Deshacer ----------
// Los trazos guardan solo los bloques que tocan; los cambios de resolución guardan la rejilla entera.
const undoStack = [], redoStack = [];
// Lo pesado de fondo (autoguardar) espera a que dejes de trabajar un momento.
let lastEdit = 0;
const noteEdit = () => { lastEdit = performance.now(); };
const entryBytes = (e) => (e.rec ? e.rec.size * BRICK_BYTES * 2 : e.bytes);

function pushStroke(L) {
  noteEdit();
  const rec = new Map();
  undoStack.push({ layer: L, grid: L.grid, rec });
  clearRedo();
  trimUndo();
  return rec;
}
function pushFull(L) {
  noteEdit();
  undoStack.push({ layer: L, grid: L.grid, full: L.grid.state(), bytes: L.grid.bytes() });
  clearRedo();
  trimUndo();
}
// El espacio ha crecido: los trazos guardados apuntan a bloques con otro número. Se traducen hasta
// llegar a un cambio de rejilla entera, porque por debajo de él la rejilla vuelve a ser la de antes.
function rebaseUndo(L, remap) {
  for (let i = undoStack.length - 1; i >= 0; i--) {
    const e = undoStack[i];
    if (e.layer !== L || e.grid !== L.grid) continue;
    if (e.full) break;
    const items = [...e.rec];
    e.rec.clear();
    for (const [bi, v] of items) e.rec.set(remap(bi), v);
  }
  // Rehacer se vacía al empezar un trazo; lo que quede de otra rejilla ya no se puede aplicar.
  for (let i = redoStack.length - 1; i >= 0; i--) if (redoStack[i].layer === L && redoStack[i].grid === L.grid && redoStack[i].rec) redoStack.splice(i, 1);
}
function trimUndo() {
  let total = undoStack.reduce((a, e) => a + entryBytes(e), 0);
  while (total > UNDO_BYTES && undoStack.length > 1) {
    const e = undoStack.shift();
    total -= entryBytes(e);
    forgetEntry(e);
  }
}
// Un fotograma borrado se guarda por si se deshace; cuando ya no se puede, se libera su malla.
function forgetEntry(e) {
  if (e.frameOp && !e.present) e.layer.disposeFrame(e.f);
  // Una unión que ya no se puede deshacer: sus capas de antes se van del todo.
  if (e.merge && e.present) for (const { L } of e.merge) {
    for (const s of [undoStack, redoStack]) for (let i = s.length - 1; i >= 0; i--) if (s[i]?.layer === L) forgetEntry(s.splice(i, 1)[0]);
    L.dispose();
  }
}
function clearRedo() {
  redoStack.forEach(forgetEntry);
  redoStack.length = 0;
}
function swapEntry(e) {
  const L = e.layer;
  noteEdit();
  if (e.shapeEdit) {
    const cur = shapeSnap(L.shape);
    Object.assign(L.shape, shapeSnap(e.shapeEdit));
    buildShape(L);
    live.structure();
    return { ...e, shapeEdit: cur };
  }
  if (e.place) {
    if (!L.frames.includes(e.f)) return e;
    if (e.f !== L.f) goToFrame(L, e.f);
    const cur = e.f.voxels.matrix.clone();
    L.setPlace(e.f, e.place);
    L.moves++;
    live.move(L, e.f);
    return { ...e, place: cur };
  }
  if (e.merge) {
    const cur = L.grid.state();
    L.grid.setState(e.full);
    L.rebuildAll();
    if (e.textBack && e.present) rebuildParam(L);
    if (e.present) {
      for (const { L: o, at } of e.merge) {
        layers.splice(at, 0, o);
        spinner.add(o.group);
      }
    } else {
      for (const { L: o } of e.merge) {
        layers.splice(layers.indexOf(o), 1);
        spinner.remove(o.group);
      }
    }
    mergePick.clear();
    live.structure();
    return { ...e, full: cur, present: !e.present };
  }
  if (e.frameOp) {
    if (e.present) L.removeFrame(e.f);
    else L.insertFrame(e.f, e.at);
    L.version++;
    goToFrame(L, e.present ? L.f : e.f);
    live.structure();
    return { ...e, present: !e.present };
  }
  // Se deshace en el fotograma donde se hizo: te lleva hasta él.
  if (e.grid !== L.grid) {
    const f = L.frames.find((x) => x.grid === e.grid);
    if (!f) return e;
    goToFrame(L, f);
  }
  if (e.rec) {
    const { inv, lo, hi } = L.grid.restoreBricks(e.rec);
    if (e.rec.size) L.markDirty(lo, hi);
    live.patch(L, e.rec.keys());
    return { layer: L, grid: L.grid, rec: inv };
  }
  const cur = { layer: L, grid: L.grid, full: L.grid.state(), bytes: L.grid.bytes() };
  L.grid.setState(e.full);
  L.rebuildAll();
  live.structure();
  return cur;
}
// ---------- Fondo del entorno ----------
// Un color plano, o la luz de un lugar real (HDRI de Poly Haven, CC0): se ve difuminado de fondo e
// ilumina el modelo. Es una preferencia tuya: vale para todas las obras.
const BG_COLORS = [['dark', 'Oscuro', '#15171c'], ['gray', 'Gris', '#6a6e74'], ['cream', 'Crema', '#e9e0cc'], ['night', 'Azul noche', '#16233f']];
const BG_HDRI = [['studio', 'Estudio', 'studio_small_09'], ['sunset', 'Atardecer', 'venice_sunset'], ['sky', 'Cielo', 'kloofendal_48d_partly_cloudy_puresky'], ['forest', 'Bosque', 'forest_slope']];
const bg = { id: 'dark', rot: 0, show: 0.6, ar: false, arSession: false };
try { Object.assign(bg, JSON.parse(localStorage.getItem('plastilinaFondo') || '{}'), { ar: false }); } catch {}
const hdriMaps = new Map();
let pmrem = null;
// En realidad mixta un color de fondo normal no tapa la sala: lo hace esta cúpula.
const bgDome = new THREE.Mesh(new THREE.SphereGeometry(20, 24, 12), new THREE.MeshBasicMaterial({ side: THREE.BackSide, depthTest: false, depthWrite: false, toneMapped: false }));
bgDome.renderOrder = -1000;
bgDome.visible = false;
scene.add(bgDome);
async function hdriMap(id) {
  if (hdriMaps.has(id)) return hdriMaps.get(id);
  const file = BG_HDRI.find((h) => h[0] === id)[2];
  const { RGBELoader } = await import('three/addons/loaders/RGBELoader.js');
  const tex = await new RGBELoader().loadAsync(new URL(`./vendor/hdri/${file}_1k.hdr`, import.meta.url).href);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  // El cálculo no debe verse afectado por la vista de las gafas.
  const wasXR = renderer.xr.enabled;
  renderer.xr.enabled = false;
  pmrem ??= new THREE.PMREMGenerator(renderer);
  const map = pmrem.fromEquirectangular(tex).texture;
  renderer.xr.enabled = wasXR;
  tex.dispose();
  hdriMaps.set(id, map);
  return map;
}
function applyBg() {
  const map = hdriMaps.get(bg.id), color = BG_COLORS.find((c) => c[0] === bg.id);
  // Con HDRI la luz viene de la imagen; las lámparas de siempre se quedan en un apoyo.
  scene.environment = map || null;
  hemi.intensity = map ? 0.3 : 1.4;
  key.intensity = map ? 0.5 : 1.8;
  rim.intensity = map ? 0.1 : 0.7;
  if (map) {
    scene.environmentRotation.y = scene.backgroundRotation.y = bg.rot * Math.PI * 2;
    scene.backgroundBlurriness = 0.75;
    scene.backgroundIntensity = bg.show;
  }
  if (SPECTATOR) return; // el espejo elige su propio fondo (croma, blanco...)
  const hex = color?.[2] || BG_COLORS[0][2], domed = bg.arSession && !bg.ar && !map;
  bgDome.visible = domed;
  bgDome.material.color.set(hex);
  scene.background = bg.ar || domed ? null : map || new THREE.Color(hex);
}
// Elegir un fondo lo enseña también en realidad mixta; «Ver la sala» vuelve a la cámara de las gafas.
async function setBg(id) {
  if (id === 'room') {
    bg.ar = bg.arSession;
    return bgChanged();
  }
  try {
    if (BG_HDRI.some((h) => h[0] === id)) await hdriMap(id);
  } catch (e) {
    console.warn('Fondo', e);
    return toast('No he podido cargar el fondo', 4000);
  }
  bg.id = id;
  bg.ar = false;
  bgChanged();
}
function bgChanged() {
  applyBg();
  try { localStorage.setItem('plastilinaFondo', JSON.stringify({ id: bg.id, rot: bg.rot, show: bg.show })); } catch {}
  if (live.emitting) live.hub.send({ t: 'bg', id: bg.id, rot: bg.rot, show: bg.show });
  bgUi();
  if (panel3d.visible) drawPanel();
}
function bgUi() {
  $('bgRow').replaceChildren(...[...BG_COLORS, ...BG_HDRI].map(([id, name]) => {
    const b = document.createElement('button');
    b.textContent = t(name);
    b.classList.toggle('on', bg.id === id && !bg.ar);
    b.onclick = () => setBg(id);
    return b;
  }));
  $('bgRot').value = bg.rot;
  $('bgShow').value = bg.show;
}

// ---------- Animación ----------
// Fotograma a fotograma, como el stop motion: no hay interpolación. Un solo reloj para toda la obra;
// cada capa repite su propio bucle, así que una capa de 4 y otra de 7 se van desfasando.
const anim = { frame: 0, playing: false, fps: 8, acc: 0, onion: true, mb: 0 };
const wrap = (a, n) => ((a % n) + n) % n;
const frameIndex = (L = active) => L.frames.indexOf(L.f);
// Fuera de la página de animación y sin fotogramas, los botones siguen siendo los de siempre.
const animating = () => panelPage === 'anim' || active.frames.length > 1;

const onionMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, opacity, transparent: true, depthWrite: false, toneMapped: false,
  polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 8 }); // detrás: la superficie igual no se tiñe
const ONION_PREV = [onionMat(0xe8452c, 0.34), onionMat(0xe8452c, 0.15)];
const ONION_NEXT = [onionMat(0x2f7fe6, 0.34), onionMat(0x2f7fe6, 0.15)];
let onionFrames = [];

// Antes en rojo, después en azul. Lo que no cambia respecto al fotograma actual no se dibuja.
function tintFrame(f, mat, cur) {
  f.voxels.visible = !!mat;
  f.chunks.forEach((r, ci) => {
    if (!r) return;
    r.mesh.material = mat || clay;
    r.mesh.visible = !mat || !cur || cur.C !== f.C || cur.chunks[ci]?.mesh.geometry !== r.mesh.geometry || !cur.voxels.matrix.equals(f.voxels.matrix);
    if (r.lines) r.lines.visible = !mat;
  });
}
function paintOnion() {
  for (const f of onionFrames) {
    tintFrame(f, null);
    f.voxels.visible = f === f.owner.f;
  }
  onionFrames = [];
  const L = active, n = L.frames.length;
  if (SPECTATOR || !anim.onion || anim.playing || n < 2 || !L.visible) return;
  const i = frameIndex(L);
  const put = (j, mat) => {
    const f = L.frames[wrap(j, n)];
    if (f === L.f || onionFrames.includes(f)) return;
    f.owner = L;
    tintFrame(f, mat, L.f);
    onionFrames.push(f);
  };
  put(i - 1, ONION_PREV[0]); put(i + 1, ONION_NEXT[0]);
  put(i - 2, ONION_PREV[1]); put(i + 2, ONION_NEXT[1]);
}
function showFrames() {
  for (const L of layers) L.show(wrap(anim.frame, L.frames.length));
  paintOnion();
}
function frameToast() {
  toast(t('Fotograma {0} de {1}', frameIndex() + 1, active.frames.length), 1200);
}
function afterFrames() {
  anim.mb = Math.round(layers.reduce((a, L) => a + (L.frames.length > 1 ? L.frameBytes() : 0), 0) / 1e6);
  if (anim.mb > 800 && !anim.warned) {
    anim.warned = true;
    toast('La animación ya pesa mucho: guarda la obra a menudo', 6000);
  }
  updateHud();
}
function goToFrame(L, f) {
  anim.frame = L.frames.indexOf(f);
  showFrames();
  live.anim();
  afterFrames();
}
function setPlaying(v) {
  if (v && !layers.some((L) => L.frames.length > 1)) return toast('Añade más fotogramas para poder reproducir');
  anim.playing = v;
  anim.acc = 0;
  sfx.play(v ? 'popUp' : 'popDown');
  if (!v) anim.frame = frameIndex();
  showFrames();
  live.anim();
  updateHud();
}
function stepFrame(d, canAdd = false) {
  if (sculpting || xr.stroking) return;
  if (anim.playing) setPlaying(false);
  const n = active.frames.length, i = frameIndex();
  if (canAdd && d > 0 && i === n - 1) return addFrame(true);
  anim.frame = wrap(i + d, n);
  sfx.play('dial', { semi: d > 0 ? 3 : -2 });
  showFrames();
  live.anim();
  frameToast();
  afterFrames();
}
function addFrame(copy) {
  if (sculpting || xr.stroking) return;
  if (anim.playing) setPlaying(false);
  if (remeshLocked()) return;
  const L = active, from = frameIndex(L), at = from + 1;
  const f = copy ? L.copyFrame(L.f) : L.frameFromGrid(L.grid.blank());
  L.insertFrame(f, at);
  undoStack.push({ layer: L, frameOp: true, f, at, present: true, bytes: 0 });
  clearRedo();
  L.version++;
  anim.frame = at;
  live.frameOp(L, copy ? 'copy' : 'blank', from, at);
  showFrames();
  live.anim();
  frameToast();
  afterFrames();
}
function deleteFrame() {
  if (sculpting || xr.stroking) return;
  const L = active;
  if (L.frames.length < 2) return toast('No puedes borrar el único fotograma');
  if (anim.playing) setPlaying(false);
  const f = L.f, at = frameIndex(L);
  L.removeFrame(f);
  undoStack.push({ layer: L, frameOp: true, f, at, present: false, bytes: 0 });
  clearRedo();
  L.version++;
  anim.frame = frameIndex(L);
  live.frameOp(L, 'del', at, at);
  showFrames();
  live.anim();
  frameToast();
  afterFrames();
}
function updateAnim(dt) {
  if (!anim.playing) return;
  anim.acc += dt * anim.fps;
  if (anim.acc < 1) return;
  const k = Math.floor(anim.acc);
  anim.acc -= k;
  anim.frame += k;
  showFrames();
}

function undo() {
  if (merge) return mergeBusy();
  if (!undoStack.length) return toast('Nada que deshacer');
  if (!undoStack.at(-1).shapeEdit && remeshLocked(undoStack.at(-1).layer)) return;
  const e = undoStack.pop();
  if (e.rec && e.layer === text.L && text.strokes.length) text.undone.push(text.strokes.pop());
  redoStack.push(swapEntry(e));
  setActive(e.layer);
  sfx.play('popDown');
  tut?.emit('undo');
  toast('Deshacer', 900);
}
function redo() {
  if (merge) return mergeBusy();
  if (!redoStack.length) return toast('Nada que rehacer');
  if (!redoStack.at(-1).textBack && !redoStack.at(-1).shapeEdit && remeshLocked(redoStack.at(-1).layer)) return;
  const e = redoStack.pop();
  if (e.rec && e.layer === text.L && text.undone.length) text.strokes.push(text.undone.pop());
  undoStack.push(swapEntry(e));
  setActive(e.layer);
  sfx.play('popUp');
  tut?.emit('redo');
  toast('Rehacer', 900);
}

// ---------- Herramientas ----------
// Mantener Shift suaviza sin cambiar de herramienta.
const activeTool = () => (state.smoothHold ? 'smooth' : state.tool);
let strokeRec = null;
let strokePrev = null;
let strokeFx = null; // cómo va sonando la pincelada
let strokeRadius = null, strokeInk = null; // grosor y presión suavizada del trazo con sensibilidad
let tut = null;

// Una capa con remesh se queda tal cual: para volver a esculpirla hay que convertirla a propósito.
function remeshLocked(L = active) {
  if (!L.remesh) return false;
  toast(t('{0} tiene remesh: pulsa «A vóxel» para esculpirla', L.name));
  sfx.play('dial', { semi: -5 });
  return true;
}
function toVoxel(L = active) {
  if (!L.remesh) return;
  if (L.text) return textToVoxel(L);
  if (L.shape) return shapeToVoxel(L);
  L.clearRemesh();
  L.version++;
  noteEdit();
  updateHud();
  drawPanel();
  live.structure();
  toast(t('{0}: otra vez en vóxel', L.name));
}
function beginStroke() {
  if (anim.playing) setPlaying(false);
  strokeFx = null;
  strokeRadius = null;
  strokeInk = null;
  if (merge) return mergeBusy();
  if (text.writing && activeTool() === 'add' && !state.invert) {
    if (!text.L || !layers.includes(text.L)) newTextDraft();
    if (active !== text.L) setActive(text.L);
    text.cur = [];
    text.strokes.push(text.cur);
    text.undone.length = 0;
    if (panel3d.visible) drawPanel();
  } else {
    text.cur = null;
    layerForStroke();
  }
  if (remeshLocked()) return;
  latheDepth = null;
  strokeRec = pushStroke(active);
  strokePrev = null;
  strokeFx = { tool: activeTool(), t0: performance.now(), prev: null, speed: 0, touched: false };
  lazy = null;
  lineStroke = null;
  meltPath = null;
}

// Estabilizador ("cuerda"): el pincel va detrás de la mano/ratón a una distancia fija y solo
// avanza cuando la cuerda se tensa → trazos rectos y sin temblor. 0 = desactivado.
let lazy = null;
const ropeGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
const rope = new THREE.Line(ropeGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthTest: false }));
rope.renderOrder = 998;
rope.frustumCulled = false;
rope.visible = false;
model.add(rope);
function stabilize(p) {
  const L = state.stab * 0.12;
  if (!L || !lazy) {
    lazy = [p[0], p[1], p[2]];
    rope.visible = false;
    return p;
  }
  const dx = p[0] - lazy[0], dy = p[1] - lazy[1], dz = p[2] - lazy[2];
  const d = Math.hypot(dx, dy, dz);
  if (d > L) {
    const f = (d - L) / d;
    lazy = [lazy[0] + dx * f, lazy[1] + dy * f, lazy[2] + dz * f];
  }
  const a = ropeGeo.attributes.position.array;
  a.set(lazy, 0);
  a.set([p[0], p[1], p[2]], 3);
  ropeGeo.attributes.position.needsUpdate = true;
  rope.visible = true;
  return [lazy[0], lazy[1], lazy[2], p[3]];
}

// Una pincelada = el tramo desde el punto anterior hasta el actual (trazo continuo).
const stampOpts = (o) => (o?.shape === 'stamp' ? { ...o, stampEval: STAMPS.get(o.stamp)?.eval } : o);
function brushCall(L, tool, a, b, r, s, inv, dt, paint, opts) {
  // Si la capa está movida, el pincel se traduce a su sistema: la rejilla sigue donde siempre.
  const f = L.f;
  if (f.moved) {
    a = toGrid(f, a);
    b = toGrid(f, b);
    r /= f.s;
    if (opts?.rot || opts?.frame) {
      opts = { ...opts };
      delete opts.frame;
      delete opts.shift;
      if (opts.rot) {
        const e = rot3.setFromMatrix4(f.inv).multiplyScalar(f.s).elements;
        opts.rot = mul3(Array.from(e), opts.rot);
      }
    }
  }
  L.fit(a, b, r);
  const res = L.grid.applyBrush(tool, a, b, r, s, inv, dt, L === active ? strokeRec : null, paint, stampOpts(opts));
  if (res) L.markDirty(res.lo, res.hi);
  // Los sellos tuyos no están en el Mac: le llega la escena entera.
  if (opts?.shape === 'stamp' && STAMPS.get(opts.stamp)?.own) live.structure();
  else live.brush(L, tool, a, b, r, s, inv, dt, paint, opts);
}

// Orientación del pincel de forma (cubo, pirámide) en coordenadas del modelo:
// en el Mac mira a la cámara; en las gafas sigue al mando derecho.
let brushObj = null;
const rotM = new THREE.Matrix4(), rot3 = new THREE.Matrix3();
function brushRot(frame = spinner) {
  if (!brushObj) return null;
  model.updateMatrixWorld();
  brushObj.updateMatrixWorld();
  rotM.copy(frame.matrixWorld).invert().multiply(brushObj.matrixWorld);
  rot3.setFromMatrix4(rotM);
  const e = rot3.elements;
  for (let c = 0; c < 3; c++) {
    const l = Math.hypot(e[3 * c], e[3 * c + 1], e[3 * c + 2]) || 1;
    e[3 * c] /= l; e[3 * c + 1] /= l; e[3 * c + 2] /= l;
  }
  return Array.from(e, (v) => Math.round(v * 1e4) / 1e4);
}
// Cada herramienta su forma: un sello de Añadir no se cuela en Quitar. Las de modelar llevan la suya.
const shapeBy = { add: 'sphere', remove: 'sphere' };
Object.defineProperty(state, 'shape', {
  get: () => (clayTool === 'tool:cuter' ? 'blade' : clayTool ? 'sphere' : shapeBy[state.tool === 'remove' ? 'remove' : 'add']),
  set: (v) => { shapeBy[state.tool === 'remove' ? 'remove' : 'add'] = v; },
});
const shapeActive = () => (activeTool() === 'add' || activeTool() === 'remove') && state.shape !== 'sphere';

// ---------- Simetría ----------
// Cada copia es una matriz 3x3 (por columnas): espejos en X, Y, Z y giros alrededor del eje vertical.
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const mul3 = (a, b) => {
  const o = [];
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) {
    o.push(a[r] * b[3 * c] + a[3 + r] * b[3 * c + 1] + a[6 + r] * b[3 * c + 2]);
  }
  return o;
};
const xf3 = (m, p) => [m[0] * p[0] + m[3] * p[1] + m[6] * p[2], m[1] * p[0] + m[4] * p[1] + m[7] * p[2], m[2] * p[0] + m[5] * p[1] + m[8] * p[2]];
let symCopies = [];
const symM4 = [];
function rebuildSym() {
  let list = [I3];
  const mirror = (on, m) => { if (on) list = list.flatMap((x) => [x, mul3(m, x)]); };
  if (state.radial) {
    list = Array.from({ length: state.radialN }, (_, i) => {
      const a = (i * 2 * Math.PI) / state.radialN, c = Math.cos(a), s = Math.sin(a);
      return [c, 0, -s, 0, 1, 0, s, 0, c];
    });
  }
  mirror(state.sym, [-1, 0, 0, 0, 1, 0, 0, 0, 1]);
  mirror(state.symY, [1, 0, 0, 0, -1, 0, 0, 0, 1]);
  mirror(state.symZ, [1, 0, 0, 0, 1, 0, 0, 0, -1]);
  // La simetría se hace alrededor de symFrame: se lleva el punto a su sistema, se copia y se devuelve.
  const e = new THREE.Matrix4().makeRotationFromQuaternion(symFrame.quaternion).elements;
  const F = [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]];
  const Ft = [F[0], F[3], F[6], F[1], F[4], F[7], F[2], F[5], F[8]];
  const c = symFrame.position.toArray();
  symCopies = list.slice(1).map((s) => {
    const m = mul3(mul3(F, s), Ft), q = xf3(m, c);
    return { m, t: [c[0] - q[0], c[1] - q[1], c[2] - q[2]] };
  });
  for (const k in symGuides) symGuides[k].visible = state[k];
  symCopies.forEach(({ m, t: v }, i) => {
    symM4[i] = (symM4[i] || new THREE.Matrix4()).set(m[0], m[3], m[6], v[0], m[1], m[4], m[7], v[1], m[2], m[5], m[8], v[2], 0, 0, 0, 1);
  });
  if (symOn() && !symHinted) {
    symHinted = true;
    toast(renderer.xr.isPresenting ? 'Coge la bola amarilla con el gatillo para colocar la simetría' : 'Arrastra la bola amarilla para colocar la simetría (Shift = girar)', 5000);
  }
}
let symHinted = false;
const copyPoint = (c, p) => {
  const q = xf3(c.m, p);
  return [q[0] + c.t[0], q[1] + c.t[1], q[2] + c.t[2]];
};

// Cerca de vertical u horizontal, el eje se queda recto: a mano es casi imposible clavarlo.
const SNAP_COS = Math.cos((4 * Math.PI) / 180);
const snapV = new THREE.Vector3(), snapT = new THREE.Vector3(), snapQ = new THREE.Quaternion();
function snapSymFrame() {
  let snapped = false;
  for (let a = 0; a < 3; a++) {
    snapV.set(+(a === 0), +(a === 1), +(a === 2)).applyQuaternion(symFrame.quaternion);
    const best = [0, 1, 2].reduce((b, i) => (Math.abs(snapV.getComponent(i)) > Math.abs(snapV.getComponent(b)) ? i : b), 0);
    if (Math.abs(snapV.getComponent(best)) < SNAP_COS) continue;
    snapT.set(0, 0, 0).setComponent(best, Math.sign(snapV.getComponent(best)));
    symFrame.quaternion.premultiply(snapQ.setFromUnitVectors(snapV, snapT)).normalize();
    snapped = true;
  }
  if (symFrame.position.length() < 0.012) { symFrame.position.set(0, 0, 0); snapped = true; }
  return snapped;
}
const symOn = () => state.sym || state.symY || state.symZ || state.radial || state.lathe;

// Llama a fn con el tramo original y con el de cada copia. Las que caen encima de otra (sobre el
// plano del espejo o en el eje) se saltan: si no, ese punto recibiría el pincel dos veces.
function forCopies(a, b, fn) {
  fn(a, b, null);
  if (!symCopies.length) return;
  const seen = [b], lim = active.grid.h * 0.5;
  for (const c of symCopies) {
    const qb = copyPoint(c, b);
    if (seen.some((q) => Math.hypot(q[0] - qb[0], q[1] - qb[1], q[2] - qb[2]) < lim)) continue;
    seen.push(qb);
    fn(copyPoint(c, a), qb, c);
  }
}
function syncCursorCopies() {
  cursor.updateMatrix();
  cursorCopies.forEach((c, i) => {
    c.visible = cursor.visible && i < symCopies.length;
    if (!c.visible) return;
    c.geometry = cursor.geometry;
    c.matrix.multiplyMatrices(symM4[i], cursor.matrix);
    c.matrixWorldNeedsUpdate = true;
  });
}

// Herramientas de modelar: un pincel normal con su tamaño y su borde ya puestos.
// Al volver a una herramienta normal, el tamaño y el borde vuelven a como estaban.
const CLAY_TOOLS = {
  'tool:palillo': { tool: 'remove', radius: 0.008, edge: 'even' },
  'tool:cuter': { tool: 'remove', radius: 0.03, edge: 'hard', stab: 0.6 }, // con el pulso firme: cortes rectos y limpios
  'tool:cuchara': { tool: 'remove', radius: 0.045, edge: 'soft' },
  'tool:dedo': { tool: 'smooth', radius: 0.03, edge: 'even' },
  'tool:rodillo': { tool: 'flatten', radius: 0.07, edge: 'even' },
  'tool:espatula': { tool: 'flatten', radius: 0.03, edge: 'hard' },
};
let clayTool = null, clayBefore = null;
function leaveClayTool() {
  if (clayBefore) Object.assign(state, clayBefore);
  clayTool = clayBefore = null;
}

// Lo que se puede elegir del pincel, para pintar qué botón está encendido en cualquier sitio.
function optionOn(id) {
  const [k, v] = id.split(':');
  if (id === 'floor') return state.floor;
  if (k === 'tool') return clayTool === id;
  if (k === 'edge') return state.edge === v;
  if (id === 'tex:all') return state.texAll;
  if (k === 'tex') return texOf(state.tool) === v;
  if (id === 'stroke:sens') return state.sens;
  if (k === 'stroke') return state.line === (v === 'line');
  if (k === 'radial') return state.radial && state.radialN === +v;
  if (id === 'sym') return symOn();
  if (id === 'sym:x') return state.sym;
  if (id === 'sym:y') return state.symY;
  if (id === 'sym:z') return state.symZ;
  if (id === 'sym:radial') return state.radial;
  if (id === 'sym:lathe') return state.lathe;
  if (id === 'shape:more') return state.shape === 'stamp';
  if (k === 'stamp') return state.shape === 'stamp' && state.stamp === id;
  if (k === 'shape') return state.shape === v;
  return state.tool === id;
}

// Opciones de la pincelada (null si no hay ninguna: el mensaje al espejo sigue siendo pequeño).
// Cada herramienta guarda su textura: Inflar con rayas no le pone rayas a Añadir, salvo con «Textura en todas».
const texOf = (tool) => (state.texAll ? state.texAllId : state.texBy[tool] || 'plain');
function brushOpts(tool, rot, c) {
  const o = {};
  if (rot) { o.shape = state.shape; o.rot = c ? mul3(c.m, rot) : rot; if (state.shape === 'stamp') o.stamp = state.stamp; }
  if (state.edge !== 'even') o.edge = state.edge;
  if (texOf(tool) !== 'plain' && TEXTURED.has(tool)) {
    o.texture = texOf(tool);
    if (c) { o.frame = c.m; o.shift = c.t; }
  }
  return Object.keys(o).length ? o : null;
}
const TEXTURED = new Set(['add', 'remove', 'inflate', 'paint']);

// Trazo recto: al apretar se fija el principio, una línea te enseña el camino y al soltar se aplica.
let lineStroke = null;
function trackLine(p, pressure, tool) {
  if (!lineStroke) lineStroke = { from: [p[0], p[1], p[2]], pressure, tool };
  lineStroke.to = [p[0], p[1], p[2]];
  lineStroke.pressure = Math.max(lineStroke.pressure, pressure);
  const arr = ropeGeo.attributes.position.array;
  arr.set(lineStroke.from, 0);
  arr.set(lineStroke.to, 3);
  ropeGeo.attributes.position.needsUpdate = true;
  rope.visible = true;
}
function endStroke() {
  if (strokeFx) {
    if (strokeFx.touched) sfx.play('release');
    sfx.strokeEnd();
    tut?.emit('stroke', { tool: strokeFx.tool, touched: strokeFx.touched, time: (performance.now() - strokeFx.t0) / 1000 });
    strokeFx = null;
  }
  if (state.lathe) placeWheel();
  commitLine();
  meltStroke();
}
// Borde suave en añadir/quitar: al soltar, unas pasadas de alisado por donde ha ido el trazo funden
// lo nuevo con lo que había. Va al final porque cada pincelada volvería a dejar el corte marcado.
let meltPath = null;
function meltStroke() {
  const path = meltPath;
  meltPath = null;
  if (!path) return;
  let len = 0;
  for (let i = 1; i < path.length; i++) len += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2]);
  const gap = Math.max(state.radius * 0.5, len / 150);
  const stamps = [path[0]];
  let left = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    for (let t = gap - left; t < l; t += gap) stamps.push([a[0] + ((b[0] - a[0]) * t) / l, a[1] + ((b[1] - a[1]) * t) / l, a[2] + ((b[2] - a[2]) * t) / l]);
    left = (left + l) % gap;
  }
  stamps.push(path[path.length - 1]);
  for (let pass = 0; pass < 3; pass++) {
    stamps.forEach((p) => forCopies(p, p, (qa, qb) => brushCall(active, 'smooth', qa, qb, state.radius * 1.4, 1, false, 1 / 60, null, { edge: 'hard' })));
  }
}
function commitLine() {
  if (!lineStroke) return;
  const { from, to, pressure, tool } = lineStroke;
  lineStroke = null;
  rope.visible = false;
  // Añadir y quitar son de golpe: un solo tramo. Los demás se van acumulando, así que se recorre
  // la línea a paso fijo (sin pasarse de 400 pasos para no congelar las gafas al soltar).
  const instant = tool === 'add' || tool === 'remove';
  const len = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  const steps = instant ? 1 : Math.max(1, Math.min(400, Math.ceil(len / (state.radius * 0.2))));
  let a = from;
  for (let i = 1; i <= steps; i++) {
    const f = i / steps, b = [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f, from[2] + (to[2] - from[2]) * f];
    brushStep(tool, a, b, 1 / 60, pressure);
    a = b;
  }
}

// Un tramo del pincel, en el original y en todas sus copias de simetría.
// Con la sensibilidad, Añadir engorda según aprietas el gatillo, como un pincel de verdad.
// La presión llega de 0,3 (gatillo apenas tocado) a 1 (a fondo); el ratón siempre va a fondo.
const INK_THIN = 0.12;
function brushRadius(tool, pressure) {
  if (tool !== 'add' || !state.sens || (shapeActive() && state.shape === 'stamp')) return state.radius;
  const k = THREE.MathUtils.clamp((pressure - 0.3) / 0.7, 0, 1);
  return state.radius * (INK_THIN + (1 - INK_THIN) * k ** 1.3);
}
function brushStep(tool, a, p, dt, pressure) {
  const s = state.strength * pressure;
  const paint = { rgb: hexToRgb(state.color), base: active.base };
  const usePaint = tool === 'paint' || tool === 'add' ? paint : null;
  const rot = (tool === 'add' || tool === 'remove') && state.shape !== 'sphere' ? brushRot() : null;
  if (state.edge === 'soft' && (tool === 'add' || tool === 'remove') && !(rot && state.shape === 'stamp')) (meltPath ||= [[a[0], a[1], a[2]]]).push([p[0], p[1], p[2]]);
  const r1 = brushRadius(tool, pressure), r0 = strokeRadius ?? r1;
  strokeRadius = r1;
  // Si el grosor cambia de golpe se reparte por el tramo: la línea crece suave, sin escalones.
  const n = Math.min(12, Math.ceil(Math.abs(r1 - r0) / (0.15 * Math.min(r0, r1))) || 1);
  for (let i = 1; i <= n; i++) {
    const u0 = (i - 1) / n, u1 = i / n, r = r0 + (r1 - r0) * u1;
    const q0 = [a[0] + (p[0] - a[0]) * u0, a[1] + (p[1] - a[1]) * u0, a[2] + (p[2] - a[2]) * u0];
    const q1 = [a[0] + (p[0] - a[0]) * u1, a[1] + (p[1] - a[1]) * u1, a[2] + (p[2] - a[2]) * u1];
    forCopies(q0, q1, (qa, qb, c) => {
      brushCall(active, tool, qa, qb, r, s, state.invert, dt, usePaint, brushOpts(tool, rot, c));
    });
  }
}

// El barro suena solo cuando lo tocas de verdad; un pincel grande suena más grave que uno fino.
function strokeFeel(p, tool, dt, pressure) {
  const s = strokeFx;
  if (!s) return;
  if (s.prev && dt > 0) s.speed += (Math.hypot(p[0] - s.prev[0], p[1] - s.prev[1], p[2] - s.prev[2]) / dt - s.speed) * Math.min(1, dt * 12);
  s.prev = p;
  const q = toGrid(active.f, p);
  const touching = tool === 'add' || active.grid.sample(q[0], q[1], q[2]) * active.f.s < state.radius * 1.15;
  const semi = THREE.MathUtils.clamp(-7 * Math.log2(state.radius / 0.025), -7, 7);
  if (touching && !s.touched) {
    s.touched = true;
    if (tool === 'paint') sfx.play('rattle', { vol: 0.8 });
    else if (tool !== 'smooth') sfx.play('press', { semi, vol: 0.6 + 0.4 * pressure });
  }
  // Un sello se pone de un golpe: no tiene sonido seguido.
  if (!(tool === 'add' && shapeActive() && state.shape === 'stamp')) sfx.stroke(tool, s.speed / 0.6, pressure, dt, touching, semi);
}

function applyAt(p, dt, pressure = 1) {
  if (active.remesh || merge) return;
  p = toSpin(p);
  text.cur?.push(p);
  const tool = activeTool();
  strokeFeel(p, tool, dt, pressure);
  if (tool === 'add' && state.sens) pressure = strokeInk = strokeInk === null ? pressure : strokeInk + (pressure - strokeInk) * Math.min(1, dt * 25);
  const a = strokePrev || p;
  // Si el punto apenas se ha movido, los pinceles "de golpe" (añadir/quitar) no repiten.
  const moved = Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]);
  // Un sello se pone de un golpe: mientras no sueltes, no se repite.
  if (shapeActive() && state.shape === 'stamp') {
    if (!strokePrev) brushStep(tool, p, p, 1 / 60, pressure);
    strokePrev = [p[0], p[1], p[2]];
    return;
  }
  if (state.line && tool !== 'grab' && !state.lathe) return trackLine(p, pressure, lineStroke?.tool || tool);
  // Con la mano quieta, apretar más sí engorda.
  const grows = tool === 'add' && strokeRadius !== null && brushRadius(tool, pressure) > strokeRadius * 1.04;
  if (strokePrev && !grows && moved < brushRadius(tool, pressure) * 0.05 && (tool === 'add' || tool === 'remove')) return;
  if (tool === 'grab') {
    // Arrastrar: lleva el barro con la mano en pasos pequeños (elástico, sin romperse).
    if (!strokePrev) { strokePrev = [p[0], p[1], p[2]]; return; }
    if (moved < active.grid.h * 0.05) return;
    const steps = Math.ceil(moved / (state.radius * 0.2));
    for (let i = 1; i <= steps; i++) {
      const q0 = strokePrev, q1 = [a[0] + (p[0] - a[0]) * (i / steps), a[1] + (p[1] - a[1]) * (i / steps), a[2] + (p[2] - a[2]) * (i / steps)];
      forCopies(q0, q1, (qa, qb) => brushCall(active, 'grab', qa, qb, state.radius, 1, false, dt, null, brushOpts('grab')));
      strokePrev = q1;
    }
    return;
  }
  strokePrev = [p[0], p[1], p[2]];
  brushStep(tool, a, p, dt, pressure);
}

// − Res y + Res rehacen el objeto de la capa activa a otra resolución, conservando la forma y el color.
// Va con la misma barra que unir capas y se puede deshacer.
function changeRes(dir) {
  if (merge) return mergeBusy();
  if (sculpting || xr.stroking) return;
  const L = active, n = L.grid.res;
  if (remeshLocked(L)) return;
  if (L.busy) return toast('Espera a que acabe el remesh');
  if (L.frames.length > 1) return toast('Las capas con fotogramas no cambian de resolución');
  const steps = dir > 0 ? RES_STEPS.filter((r) => r > n) : RES_STEPS.filter((r) => r < n).reverse();
  if (!steps.length) return toast(dir > 0 ? 'Resolución máxima' : 'Resolución mínima');
  const res = steps[0], o = mergePlan([L]).at(res);
  const go = () => runMerge([L], res, 'Cambiando resolución', () => t('{0}: ahora a {1}³', L.name, res));
  if (!o.fits) return toast('Resolución máxima');
  if (dir < 0 || o.light) return go();
  showMergeAsk({ T: L, choices: [o], title: 'Resolución', text: t('A {0}³ quedaría muy pesado: unos {1} polígonos.', res, fmtQuads(o.quads)),
    note: 'Se puede deshacer.', label: () => t('Subir a {0}³', res), go });
}
// El selector de resolución del pincel no cambia lo que ya está hecho: es la del próximo trazo de Añadir.
// Si no es la de la capa activa, el trazo sigue en una capa de esa resolución, o en una nueva si no hay.
const brushRes = () => state.brushRes ?? active.grid.res;
function setRes(n) {
  state.brushRes = n;
  updateHud();
  drawPanel();
  if (n !== active.grid.res) toast(t('El próximo trazo de Añadir irá a {0}³, en otra capa', n));
}
function layerForStroke() {
  const n = brushRes();
  if (active.grid.res === n || activeTool() !== 'add' || state.invert) return;
  const same = [...layers].reverse().find((L) => L.grid.res === n && L.visible && !L.remesh && !L.busy && L.frames.length === 1);
  if (same) return setActive(same);
  const L = new Layer(n, 'empty');
  layers.push(L);
  setActive(L);
  live.structure();
  toast(t('{0}: capa nueva a {1}³', L.name, n));
}

function resetLayer(shape) {
  if (remeshLocked()) return;
  pushFull(active);
  const g = active.grid;
  g.setResolution(g.res);
  if (shape === 'sphere') g.reset();
  active.rebuildAll();
  live.structure();
}

function choose(id) {
  noteUse(id);
  // La simetría y el torno se excluyen: el torno ya da la vuelta entera.
  if (/^(sym$|sym:[xyz]$|sym:radial$|radial:)/.test(id) || id === 'move') state.lathe = false;
  switch (id) {
    case 'add': case 'remove': case 'smooth': case 'flatten': case 'inflate': case 'paint': case 'move': case 'grab': case 'pinch': case 'crease':
      leaveClayTool();
      state.tool = id;
      break;
    case 'tool:palillo': case 'tool:cuter': case 'tool:cuchara': case 'tool:dedo': case 'tool:rodillo': case 'tool:espatula':
      leaveClayTool();
      clayBefore = { radius: state.radius, edge: state.edge, stab: state.stab };
      clayTool = id;
      Object.assign(state, CLAY_TOOLS[id]);
      toast(t(LABELS[id]), 1200);
      break;
    case 'shape:sphere': case 'shape:cube': case 'shape:pyramid':
      state.shape = id.slice(6);
      if (state.tool !== 'remove') state.tool = 'add';
      toast(t('Pincel: {0}', t(LABELS[id])), 1200);
      break;
    default:
      if (STAMPS.has(id)) {
        state.shape = 'stamp';
        state.stamp = id;
        if (state.tool !== 'remove') state.tool = 'add';
        toast(t('Pincel: {0}', label(id)), 1200);
      }
      break;
    case 'shape:more': panelPage = 'sellos'; if (panel3d.visible) drawPanel(); $('stampBox').hidden = !$('stampBox').hidden; break;
    case 'stamp:save': saveStamp(); break;
    case 'stamp:delete': deleteLastStamp(); break;
    case 'text': openText(); break;
    case 'resUp': changeRes(1); break;
    case 'resDown': changeRes(-1); break;
    case 'sym': {
      // El pétalo entero: si hay alguna, las apaga todas; si no, la de siempre (X).
      const on = !symOn();
      state.symY = state.symZ = state.radial = false;
      state.sym = on;
      toast(on ? 'Simetría ON' : 'Simetría OFF');
      rebuildSym();
      break;
    }
    // Radial con espejos X o Z saldrían demasiadas copias: son excluyentes. Radial + Y sí se puede.
    case 'sym:x': state.sym = !state.sym; if (state.sym) state.radial = false; rebuildSym(); break;
    case 'sym:y': state.symY = !state.symY; rebuildSym(); break;
    case 'sym:z': state.symZ = !state.symZ; if (state.symZ) state.radial = false; rebuildSym(); break;
    case 'sym:radial':
      state.radial = !state.radial;
      if (state.radial) state.sym = state.symZ = false;
      rebuildSym();
      break;
    case 'radial:3': case 'radial:4': case 'radial:5': case 'radial:6': case 'radial:8':
      state.radialN = +id.slice(7);
      state.radial = true;
      state.sym = state.symZ = false;
      rebuildSym();
      break;
    case 'stroke:sens':
      state.sens = !state.sens;
      toast(state.sens ? 'Presión: Añadir engorda según aprietas el gatillo' : 'Sin presión: Añadir siempre del mismo grosor');
      break;
    case 'sym:lathe':
      state.lathe = !state.lathe;
      if (state.lathe) {
        state.sym = state.symY = state.symZ = state.radial = false;
        placeWheel();
      }
      rebuildSym();
      break;
    case 'import': $('fileRef').click(); break;
    case 'sym:reset':
      symFrame.position.set(0, 0, 0);
      symFrame.quaternion.identity();
      rebuildSym();
      break;
    case 'floor': state.floor = !state.floor; break;
    case 'edge:soft': case 'edge:even': case 'edge:hard': state.edge = id.slice(5); break;
    case 'tex:plain': case 'tex:rough': case 'tex:dots': case 'tex:stripes': case 'tex:scales':
      if (!TEXTURED.has(state.tool)) choose('inflate');
      state.texBy[state.tool] = state.texAllId = id.slice(4);
      break;
    case 'tex:all':
      state.texAllId = state.texBy[state.tool] || 'plain';
      state.texAll = !state.texAll;
      break;
    case 'stroke:free': state.line = false; break;
    case 'stroke:line': state.line = true; break;
    case 'wire':
      state.wire = !state.wire;
      layers.forEach((L) => L.setWire(state.wire));
      break;
    case 'undo': undo(); break;
    case 'remesh': remeshLayer(active); break;
    case 'voxel': toVoxel(); break;
    case 'export': exportModel(); break;
    case 'save': saveObra(); break;
    case 'share': shareModel(); break;
    case 'layerNew': newLayer(); break;
    case 'layerNext': nextLayer(); break;
  }
  updateHud();
}

// ---------- Torno ----------
// El disco se coloca bajo la pieza y un poco más ancho que ella.
function placeWheel() {
  symFrame.updateMatrix();
  const inv = new THREE.Matrix4().copy(symFrame.matrix).invert(), v = new THREE.Vector3();
  const { bricks, fill, nb, h, o } = active.grid;
  let low = Infinity, wide = 0;
  for (let bz = 0; bz < nb; bz++) for (let by = 0; by < nb; by++) for (let bx = 0; bx < nb; bx++) {
    const bi = bx + nb * (by + nb * bz), bk = bricks[bi];
    if (!(fill[bi] < 0) && !(bk && bk.some((d) => d < 0))) continue;
    v.set(o + (bx * 8 + 4) * h, o + (by * 8 + 4) * h, o + (bz * 8 + 4) * h).applyMatrix4(active.f.voxels.matrix).applyMatrix4(inv);
    low = Math.min(low, v.y - 4 * h);
    wide = Math.max(wide, Math.hypot(v.x, v.z) + 6 * h);
  }
  if (low === Infinity) { low = -0.1; wide = 0.1; }
  latheWheel.position.y = low - 0.012;
  latheDisc.scale.set(Math.max(0.09, wide * 1.15), 1, Math.max(0.09, wide * 1.15));
}
const spinA = new THREE.Matrix4(), spinB = new THREE.Matrix4();
function updateLathe(dt) {
  const held = xr.symGrab || symDrag;
  if (held && state.lathe) placeWheel();
  if (state.lathe && !held) spin.angle = (spin.angle + state.latheSpeed * 2 * Math.PI * dt) % (2 * Math.PI) || 1e-6;
  else if (spin.angle) {
    // Al parar, vuelve despacio a como estaba: la rejilla nunca ha girado.
    const a = spin.angle > Math.PI ? spin.angle - 2 * Math.PI : spin.angle;
    const b = a * Math.exp(-dt * 7);
    spin.angle = Math.abs(b) < 0.002 ? 0 : (b + 2 * Math.PI) % (2 * Math.PI);
  }
  latheWheel.visible = state.lathe;
  latheDisc.rotation.y = spin.angle;
  symFrame.updateMatrix();
  spinA.makeRotationY(spin.angle).premultiply(symFrame.matrix);
  spinB.copy(symFrame.matrix).invert();
  spinner.matrix.multiplyMatrices(spinA, spinB);
  spin.inv.copy(spinner.matrix).invert();
  spinner.matrixWorldNeedsUpdate = true;
}

// ---------- Referencia ----------
// Un modelo de fuera para mirarlo mientras trabajas. Cuelga del modelo, pero no gira con el torno,
// no se esculpe y no se exporta. El archivo se queda guardado aquí; lo que haya en la carpeta
// referencias del Mac también se puede traer.
const refMat = new THREE.MeshStandardMaterial({ color: 0x8fb0e0, roughness: 0.7, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
const refRoot = new THREE.Group();
refRoot.visible = false;
model.add(refRoot);
const refBall = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0x1b4fd8 }));
refBall.scale.setScalar(0.02);
refRoot.add(refBall);
const REF_FIT = 0.35; // lo que mide lo más largo del modelo, con el tamaño a 1
const ref = { name: null, obj: null, list: [], mac: [], size: 1, opacity: 0.4, height: 0 };
const refSizeToT = (s) => (Math.log2(s) + 3) / 6;
const tToRefSize = (v) => 2 ** (v * 6 - 3);
function layoutRef() {
  if (!ref.obj) return;
  ref.obj.scale.setScalar(ref.size * ref.fit);
  refBall.position.y = (ref.height * ref.size * ref.fit) / 2 + 0.03;
}
const saveRefState = () => idbSet('refActiva', ref.name ? { name: ref.name, size: ref.size, opacity: ref.opacity, shown: refRoot.visible, pos: refRoot.position.toArray(), q: refRoot.quaternion.toArray() } : null).catch(() => {});
function clearRef() {
  if (ref.obj) {
    ref.obj.traverse((o) => o.geometry?.dispose());
    if (ref.image) {
      ref.image.map.dispose();
      ref.image.dispose();
      ref.image = null;
    }
    refRoot.remove(ref.obj);
  }
  ref.obj = ref.name = null;
  refRoot.visible = false;
}
async function refBytes(name) {
  const here = await idbGet('ref:' + name).catch(() => null);
  if (here) return here;
  const r = await fetch(API + '/api/ref?name=' + encodeURIComponent(name));
  if (!r.ok) throw new Error('mac');
  const buf = await r.arrayBuffer();
  await addRefToList(name, buf);
  return buf;
}
async function addRefToList(name, buf) {
  await idbSet('ref:' + name, buf);
  if (!ref.list.includes(name)) ref.list.push(name);
  await idbSet('refs', ref.list);
}
async function showRef(name, saved) {
  try {
    const buf = await refBytes(name);
    const obj = await parseModel(name, buf);
    clearRef();
    let tris = 0;
    const image = obj.userData.image || null;
    obj.traverse((o) => { if (o.isMesh) { if (!image) o.material = refMat; tris += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; } });
    if (tris > 600000) toast(t('Este modelo es muy pesado: puede ir lento en las gafas'), 5000);
    const box = new THREE.Box3().setFromObject(obj), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    const big = Math.max(sz.x, sz.y, sz.z) || 1;
    ref.fit = REF_FIT / big;
    ref.height = sz.y;
    obj.children.forEach((m) => m.geometry.translate(-c.x, -c.y, -c.z));
    ref.obj = obj;
    ref.name = name;
    ref.size = saved?.size ?? 1;
    ref.opacity = saved?.opacity ?? (image ? 0 : 0.4);
    ref.image = image;
    (image || refMat).opacity = 1 - ref.opacity;
    refRoot.add(obj);
    refRoot.position.fromArray(saved?.pos ?? [0, 0, 0]);
    refRoot.quaternion.fromArray(saved?.q ?? [0, 0, 0, 1]);
    refRoot.visible = saved?.shown ?? true;
    layoutRef();
    saveRefState();
  } catch (e) {
    console.warn('Referencia', name, e);
    toast(t('No he podido abrir {0}', name), 5000);
  }
  refUi();
}
async function importRef(file) {
  if (!REF_TYPES.includes(refType(file.name))) return toast(t('Solo FBX, OBJ, GLB o imágenes'), 4000);
  const name = file.name.replace(/[^\w .-]/g, '_');
  const buf = await file.arrayBuffer();
  // Antes de guardarlo: si no se puede abrir, no entra en la lista.
  try { await parseModel(name, buf); } catch (e) {
    console.warn('Referencia', name, e);
    return toast(t('No he podido abrir {0}', name), 5000);
  }
  await addRefToList(name, buf);
  if (server.ok) fetch(API + '/api/ref?name=' + encodeURIComponent(name), { method: 'POST', body: buf }).catch(() => {});
  await showRef(name);
}
async function dropRef(name) {
  if (ref.name === name) { clearRef(); saveRefState(); }
  ref.list = ref.list.filter((n) => n !== name);
  await idbDel('ref:' + name).catch(() => {});
  await idbSet('refs', ref.list).catch(() => {});
  refUi();
}
async function refreshMacRefs() {
  if (!server.ok) { ref.mac = []; return; }
  try { ref.mac = await (await fetch(API + '/api/refs')).json(); } catch { ref.mac = []; }
  refUi();
}
const refNames = () => [...new Set([...ref.list, ...ref.mac])];
function refUi() {
  const names = refNames();
  $('refBox').hidden = !names.length && !ref.name;
  $('refList').replaceChildren(...names.map((n) => {
    const b = document.createElement('button');
    b.textContent = n;
    b.style.textTransform = 'none';
    b.classList.toggle('on', n === ref.name);
    b.onclick = () => showRef(n);
    return b;
  }));
  $('refHide').textContent = t(refRoot.visible ? 'Ocultar' : 'Mostrar');
  $('refSize').value = refSizeToT(ref.size);
  $('refOpacity').value = ref.opacity;
  if (panel3d.visible) drawPanel();
}
// Sacar foto: la cámara del dispositivo, con una cuenta atrás de 3 s para encuadrar. La foto queda
// en la lista de referencias, delante de ti. Si el navegador no da la cámara, se dice claro.
let photoBusy = false;
// Lo que ve la cámara en este momento, o null si llega en negro: pasa con la cámara de las gafas.
async function photoFrame(video, track) {
  const c = document.createElement('canvas');
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext('2d').drawImage(video, 0, 0);
  if (!looksBlack(c)) return c;
  if (!window.ImageCapture || track?.readyState !== 'live') return null;
  try {
    const bmp = await new ImageCapture(track).grabFrame();
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close();
    return looksBlack(c) ? null : c;
  } catch { return null; }
}
const PHOTO_WAIT = 5;
async function takeRefPhoto() {
  if (photoBusy) return;
  if (!navigator.mediaDevices?.getUserMedia) return toast('Este navegador no deja usar la cámara', 6000);
  photoBusy = true;
  let stream = null, view = null, tex = null, over = null, timer = 0;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
    const video = Object.assign(document.createElement('video'), { srcObject: stream, muted: true, playsInline: true });
    await video.play();
    const track = stream.getVideoTracks()[0];
    for (let i = 0; i < 40 && !video.videoWidth; i++) await new Promise((r) => setTimeout(r, 100));
    // Lo que ve la cámara, flotando delante de ti: la pantalla no molesta a la cámara, se ve la hoja a través de ella.
    const aspect = (video.videoHeight || 3) / (video.videoWidth || 4), W = 0.36, H = W * aspect;
    tex = new THREE.VideoTexture(video);
    tex.colorSpace = THREE.SRGBColorSpace;
    view = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    const cam = () => (renderer.xr.isPresenting ? renderer.xr.getCamera() : camera);
    const head0 = cam().getWorldPosition(new THREE.Vector3()), dir0 = cam().getWorldDirection(new THREE.Vector3());
    view.position.copy(head0).addScaledVector(dir0, 0.6);
    view.lookAt(head0);
    // Encima, el marco de la hoja y la cuenta atrás.
    const oc = document.createElement('canvas');
    oc.width = 640;
    oc.height = Math.round(640 * aspect);
    const og = oc.getContext('2d');
    over = new THREE.CanvasTexture(oc);
    over.colorSpace = THREE.SRGBColorSpace;
    const overMesh = new THREE.Mesh(view.geometry, new THREE.MeshBasicMaterial({ map: over, transparent: true, toneMapped: false, depthWrite: false }));
    overMesh.position.z = 0.002;
    view.add(overMesh);
    scene.add(view);
    let sheet = null, sheetAt = 0, count = PHOTO_WAIT, dark = false;
    const paint = () => {
      og.clearRect(0, 0, oc.width, oc.height);
      const k = oc.width / (video.videoWidth || 1);
      if (sheet) {
        og.strokeStyle = '#FFD21F';
        og.lineWidth = 8;
        og.beginPath();
        sheet.forEach((p, i) => (i ? og.lineTo(p[0] * k, p[1] * k) : og.moveTo(p[0] * k, p[1] * k)));
        og.closePath();
        og.stroke();
      }
      og.textAlign = 'center';
      og.textBaseline = 'middle';
      og.fillStyle = '#141210';
      og.fillRect(oc.width / 2 - 60, 12, 120, 96);
      og.fillStyle = '#FFD21F';
      og.font = kanit(72);
      og.fillText(String(count), oc.width / 2, 62);
      const say = dark ? t('La cámara no da imagen') : sheet ? t('Hoja encontrada') : t('Pon la hoja delante, sobre fondo oscuro');
      og.font = mali(28);
      const tw = og.measureText(say).width + 28;
      og.fillStyle = '#141210';
      og.fillRect((oc.width - tw) / 2, oc.height - 58, tw, 46);
      og.fillStyle = '#FFF8E3';
      og.fillText(say, oc.width / 2, oc.height - 35);
      over.needsUpdate = true;
    };
    const look = async () => {
      if (!video.videoWidth) return;
      const f = await photoFrame(video, track);
      dark = !f;
      const found = f && findSheet(f);
      if (found) { sheet = found; sheetAt = performance.now(); }
      else if (performance.now() - sheetAt > 900) sheet = null;
      paint();
    };
    paint();
    timer = setInterval(look, 350);
    for (; count > 0; count--) {
      paint();
      sfx.play('tick', { semi: count === 1 ? 7 : 0 });
      await new Promise((r) => setTimeout(r, 1000));
    }
    clearInterval(timer);
    timer = 0;
    // Si la foto llega en negro se insiste un poco antes de rendirse.
    let frame = null;
    for (let i = 0; i < 12 && !frame; i++) {
      frame = await photoFrame(video, track);
      if (!frame) await new Promise((r) => setTimeout(r, 250));
    }
    if (!frame) {
      toast(renderer.xr.isPresenting ? 'La cámara da negro dentro de VR: sal de VR y saca la foto desde ahí' : 'La cámara da negro: revisa el permiso de la cámara', 8000);
      throw null;
    }
    const corners = findSheet(frame) || (performance.now() - sheetAt < 1200 ? sheet : null);
    const out = corners ? flattenSheet(frame, corners) : frame;
    sfx.play('thock');
    const blob = await new Promise((r) => out.toBlob(r, 'image/jpeg', 0.9));
    const buf = await blob.arrayBuffer();
    const name = 'foto-' + new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-') + '.jpg';
    await addRefToList(name, buf);
    if (server.ok) fetch(API + '/api/ref?name=' + encodeURIComponent(name), { method: 'POST', body: buf }).catch(() => {});
    // Delante de ti, de cara a ti.
    const head = cam().getWorldPosition(new THREE.Vector3()), dir = cam().getWorldDirection(new THREE.Vector3());
    const at = head.clone().addScaledVector(dir, 0.5);
    const face = new THREE.Object3D();
    face.position.copy(at);
    face.lookAt(head);
    model.updateMatrixWorld();
    const q = model.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(face.quaternion);
    await showRef(name, { pos: model.worldToLocal(at).toArray(), q: q.toArray(), size: 1, opacity: 0, shown: true });
    ctrlBuzz();
    toast(corners ? 'Foto lista: coge la bola azul para colocarla' : 'No vi la hoja, va la foto entera. Coge la bola azul para colocarla', 5000);
  } catch (e) {
    if (e) {
      console.warn('Cámara', e);
      toast('No puedo usar la cámara aquí: sal de VR, pulsa Sacar foto y acepta el permiso', 7000);
    }
  }
  clearInterval(timer);
  stream?.getTracks().forEach((tr) => tr.stop());
  if (view) {
    scene.remove(view);
    view.geometry.dispose();
    view.material.dispose();
    view.children[0].material.dispose();
  }
  tex?.dispose();
  over?.dispose();
  photoBusy = false;
}
const ctrlBuzz = () => ctrls.forEach((c) => c.userData.src?.gamepad?.hapticActuators?.[0]?.pulse?.(0.7, 60));

function setRefShown(on) { refRoot.visible = on && !!ref.obj; saveRefState(); refUi(); }
function setRefSize(s) { ref.size = s; layoutRef(); saveRefState(); }
function setRefOpacity(v) { ref.opacity = v; (ref.image || refMat).opacity = 1 - v; saveRefState(); }
async function loadRefs() {
  try {
    ref.list = (await idbGet('refs')) || [];
    const saved = await idbGet('refActiva');
    if (saved?.name) await showRef(saved.name, saved);
  } catch {}
  refUi();
  refreshMacRefs();
}

// ---------- Sellos ----------
// Los de la app y los tuyos, guardados en las gafas. Sus dibujitos se hacen de uno en uno.
const MAX_OWN_STAMPS = 9;
let ownStamps = []; // { id, name, n, d, c }
const stampThumbs = new Map();
const stampRows = () => [{ id: 'stamp:save' }, ...STAMPS.values()];
function plusThumb() {
  const c = document.createElement('canvas');
  c.width = c.height = 72;
  const g = c.getContext('2d');
  g.fillStyle = CERA.ink;
  g.beginPath(); g.arc(36, 36, 32, 0, Math.PI * 2); g.fill();
  g.fillStyle = CERA.yellow;
  g.fillRect(31, 15, 10, 42); g.fillRect(15, 31, 42, 10);
  return c;
}
function stampsChanged() {
  flower.setStamps(stampRows().map((s) => ({ id: s.id, canvas: stampThumbs.get(s.id) })));
  drawStampBox();
  if (panel3d.visible) drawPanel();
}
function drawStampBox() {
  const box = $('stampBox');
  box.replaceChildren(...stampRows().map((s) => {
    const b = document.createElement('button');
    b.className = 'stamp';
    b.title = label(s.id);
    b.dataset.opt = s.id;
    const pic = stampThumbs.get(s.id);
    if (pic) { const c = document.createElement('canvas'); c.width = c.height = pic.width; c.getContext('2d').drawImage(pic, 0, 0); b.append(c); }
    b.onclick = () => choose(s.id);
    return b;
  }));
  updateHud();
}
let thumbTimer = null;
function renderThumbs() {
  clearTimeout(thumbTimer);
  const todo = [...STAMPS.values()].find((s) => !stampThumbs.has(s.id));
  if (!todo) return stampsChanged();
  stampThumbs.set(todo.id, stampThumb(todo));
  thumbTimer = setTimeout(renderThumbs, 30);
}
function saveStamp() {
  const n = (ownStamps.at(-1)?.num || 0) + 1;
  const saved = stampFromGrid(active.grid, 'stamp:mio' + n, t('Mi sello {0}', n));
  if (!saved) return toast(t('Esta capa está vacía'));
  saved.num = n;
  if (ownStamps.length >= MAX_OWN_STAMPS) dropStamp(ownStamps[0]);
  ownStamps.push(saved);
  addOwnStamp(saved);
  state.shape = 'stamp';
  state.stamp = saved.id;
  if (state.tool !== 'remove') state.tool = 'add';
  idbSet('sellos', ownStamps).catch(() => {});
  toast(t('Sello guardado'));
  renderThumbs();
}
function dropStamp(s) {
  ownStamps = ownStamps.filter((q) => q !== s);
  removeOwnStamp(s.id);
  stampThumbs.delete(s.id);
  if (state.stamp === s.id) { state.stamp = 'stamp:ojo'; if (state.shape === 'stamp') state.shape = 'sphere'; }
}
function deleteLastStamp() {
  const s = ownStamps.at(-1);
  if (!s) return;
  dropStamp(s);
  idbSet('sellos', ownStamps).catch(() => {});
  stampsChanged();
}
async function loadStamps() {
  try { ownStamps = (await idbGet('sellos')) || []; } catch { ownStamps = []; }
  ownStamps.forEach(addOwnStamp);
  stampThumbs.set('stamp:save', plusThumb());
  renderThumbs();
}

function setColor(hex) {
  state.color = hex;
  updateHud();
}

// ---------- Remesh en el casco: malla nueva de quads + horneado del detalle ----------
// La malla nueva sale de la propia rejilla (sin Blender) y el detalle de alta resolución se
// hornea en un mapa de normales y otro de color. Va por tramos: la escena no se congela.
let remeshOkUntil = 0;
// Segundos de remesh por cada 100.000 polígonos de la capa: lo medido la última vez en este aparato.
function remeshRate() {
  let r = 0;
  try { r = +localStorage.getItem('plastilinaRemeshRate'); } catch {}
  return r > 0 ? r : ON_QUEST ? 8 : 2;
}
// Avisar solo al llegar a un límite, una vez por escalón: nada de avisos mientras todo va bien.
const LOAD_STEPS = ON_QUEST ? [[1.2e6, 700], [2e6, 1100]] : [[5e6, 2500], [8e6, 4000]];
let loadStep = 0;
setInterval(() => {
  if (merge || sculpting || SPECTATOR) return;
  const { quads, mb } = sceneLoad();
  const step = LOAD_STEPS.filter(([q, m]) => quads > q || mb > m).length;
  if (step > loadStep) toast(step === 1 ? 'Vas llegando al límite de las gafas: une capas, oculta las que no uses o baja la resolución (− Res)' : 'Casi al límite: guarda la obra ahora y aligera antes de seguir', 8000);
  loadStep = step;
}, 5000);
async function remeshLayer(L) {
  if (L.frames.length > 1) return toast('Las capas con fotogramas no se pueden hacer remesh');
  if (L.busy) return toast('Ya está haciendo remesh…');
  // Una capa grande tarda: se dice cuánto (aprendido de la última vez) y hace falta pulsar otra vez.
  const big = L.chunks.reduce((a, ch) => a + (ch ? ch.quads.length / 4 : 0), 0), secs = Math.round((big / 1e5) * remeshRate());
  if (secs >= 8 && performance.now() > remeshOkUntil) {
    remeshOkUntil = performance.now() + 8000;
    return toast(t('Esta capa es grande: el remesh tardará unos {0} s. Pulsa Remesh otra vez para hacerlo.', secs), 8000);
  }
  remeshOkUntil = 0;
  const hi = L.merged();
  if (!hi.quads.length) return toast('La capa está vacía');
  L.busy = true;
  const ver = L.version;
  updateHud();
  const t0 = performance.now();
  const stale = () => L.version !== ver || !layers.includes(L);
  const prog = (stage, f) => toast(`${L.name} · ${t(stage)}… ${Math.round(f * 100)}%`, 3000);
  try {
    const low = await remeshSDF(L.grid, meshArea(hi.positions, hi.quads), state.quads, prog);
    if (stale()) throw new Error('stale');
    await bakeRemesh(L, low, ver);
    if (big > 2e4) try { localStorage.setItem('plastilinaRemeshRate', String((performance.now() - t0) / 1000 / (big / 1e5))); } catch {}
    toast(t('{0}: {1} quads + detalle horneado ({2}px) en {3} s', L.name, (low.quads.length / 4).toLocaleString(), state.bakeSize, ((performance.now() - t0) / 1000).toFixed(1)), 5000);
  } catch (e) {
    if (e.message === 'stale') toast('Has esculpido durante el remesh: vuelve a lanzarlo');
    else { console.error(e); toast(t('Remesh falló: {0}', e.message)); }
  }
  L.busy = false;
  updateHud();
}

// Pone la malla nueva en la capa y hornea el detalle (también al recuperar una obra).
async function bakeRemesh(L, low, ver = L.version, size = state.bakeSize) {
  const prog = (stage, f) => toast(`${L.name} · ${t(stage)}… ${Math.round(f * 100)}%`, 3000);
  const bake = await bakeMesh(L.grid, low, L.base, size, prog);
  if (L.version !== ver || !layers.includes(L)) throw new Error('stale');
  if (L.remesh?.data.positions !== low.positions) L.setRemesh({ positions: low.positions, normals: low.normals, quads: low.quads });
  L.applyBake(bake);
  updateHud();
  drawPanel();
  live.structure();
}

// ---------- Remesh con QuadriFlow en Blender (en el Mac) ----------
async function remeshBlender(L) {
  if (L.busy) return toast('Ya está haciendo remesh…');
  const mesh = L.merged();
  if (!mesh.quads.length) return toast('La capa está vacía');
  if (!(await checkServer())) return toast('El remesh usa Blender en el Mac: conéctate a su Wi-Fi');
  L.busy = true;
  const ver = L.version;
  toast(t('Remesh de {0}: Blender trabajando…', L.name), 60000);
  updateHud();
  try {
    const r = await fetch(API + '/api/remesh?faces=' + state.quads, {
      method: 'POST', body: toOBJ([{ name: 'capa', mesh: { ...mesh, colors: null } }]),
    });
    if (!r.ok) throw new Error(await r.text());
    const parsed = parseOBJ(await r.text());
    if (L.version !== ver) toast('Has esculpido durante el remesh: vuelve a lanzarlo');
    else if (!layers.includes(L)) toast('La capa se borró');
    else {
      L.setRemesh(parsed);
      live.structure();
      toast(t('{0}: {1} quads uniformes (esculpir lo descarta)', L.name, parsed.quads.length / 4));
    }
  } catch (e) {
    console.error(e);
    toast(t('Remesh falló: {0}', e.message || t('sin conexión con el servidor')));
  }
  L.busy = false;
  updateHud();
}

const $ = (id) => document.getElementById(id);

// ---------- Exportar a Blender ----------

// Quads al exportar: a la izquierda del todo, tal cual está; si no, se rehace la malla con esa cantidad.
const EXPORT_FORMATS = ['obj', 'fbx', 'glb'];
const exportTarget = () => (state.exportT < 0.02 ? 0 : Number((1000 * 200 ** ((state.exportT - 0.02) / 0.98)).toPrecision(2)));
const exportQuadsText = () => (exportTarget() ? exportTarget().toLocaleString() : t('Sin cambiar'));
function exportUi() {
  $('fmtRow').replaceChildren(...EXPORT_FORMATS.map((f) => {
    const b = document.createElement('button');
    b.textContent = f.toUpperCase();
    b.classList.toggle('on', state.exportFmt === f);
    b.onclick = () => { state.exportFmt = f; exportUi(); };
    return b;
  }));
  $('exportQuads').value = state.exportT;
  $('exportQuadsVal').textContent = exportQuadsText();
}
function exportBase() {
  state.exportNow = exportObjects().reduce((a, o) => a + o.mesh.quads.length / 4, 0);
}
// Las capas con la cantidad de quads pedida, sin tocar lo que hay en la obra: se reparte según el tamaño.
async function exportMeshes() {
  const target = exportTarget();
  if (!target) return exportObjects();
  const list = layers.filter((L) => L.visible).map((L) => ({ L, mesh: L.merged() })).filter((x) => x.mesh.quads.length);
  list.forEach((x) => { x.area = meshArea(x.mesh.positions, x.mesh.quads); });
  const total = list.reduce((a, x) => a + x.area * x.L.f.s ** 2, 0) || 1, out = [];
  for (const { L, area, mesh } of list) {
    const prog = (stage, f) => toast(`${L.name} · ${t(stage)}… ${Math.round(f * 100)}%`, 3000);
    const want = Math.max(100, Math.round((target * area * L.f.s ** 2) / total)), have = mesh.quads.length / 4;
    // Bajar: malla nueva. Subir por encima de la rejilla: partir cada quad en cuatro las veces que haga falta.
    let low;
    if (want > have * 1.5) {
      low = { positions: mesh.positions, quads: mesh.quads };
      for (let q = have; q * 2 < want; q *= 4) low = subdivideQuads(L.grid, low.positions, low.quads);
      if (!low.normals) low.normals = mesh.normals;
    } else low = await remeshSDF(L.grid, area, want, prog, want > (area / (2 * L.grid.h) ** 2) * 0.9 ? 'fine' : 'flow');
    const p = low.positions, colors = new Float32Array(p.length), base = L.base;
    for (let i = 0; i < p.length; i += 3) {
      const c = L.grid.sampleColor(p[i], p[i + 1], p[i + 2]) || base;
      colors[i] = c[0] / 255; colors[i + 1] = c[1] / 255; colors[i + 2] = c[2] / 255;
    }
    out.push({ name: L.name.replace(/[^\w-]+/g, '_'), mesh: placedMesh(L, { positions: p, normals: low.normals, quads: low.quads, colors }), bake: null });
  }
  return out;
}

// La malla de una capa, donde se ve la capa: la que guarda sigue en el sistema de su rejilla.
function placedMesh(L, mesh) {
  const f = L.f;
  if (!f.moved) return mesh;
  const m = f.voxels.matrix, n = new THREE.Matrix3().setFromMatrix4(m).multiplyScalar(1 / f.s), v = new THREE.Vector3();
  const positions = new Float32Array(mesh.positions.length);
  for (let i = 0; i < positions.length; i += 3) v.fromArray(mesh.positions, i).applyMatrix4(m).toArray(positions, i);
  let normals = mesh.normals;
  if (normals) {
    normals = new Float32Array(normals.length);
    for (let i = 0; i < normals.length; i += 3) v.fromArray(mesh.normals, i).applyMatrix3(n).toArray(normals, i);
  }
  return { ...mesh, positions, normals };
}
function exportObjects() {
  return layers
    .filter((L) => L.visible)
    .map((L) => ({
      name: L.name.replace(/[^\w-]+/g, '_'),
      mesh: placedMesh(L, L.remesh ? L.remesh.data : L.merged()),
      bake: L.remesh?.bake ? placedMesh(L, L.remesh.bake) : null,
    }))
    .filter((o) => o.mesh.quads.length);
}

// GLB: una pieza por capa. Las capas horneadas llevan UVs, mapa de color y mapa de normales;
// el resto, color por vértice.
async function buildGLB(objects) {
  const root = new THREE.Group();
  root.name = 'LaPlastilina';
  const textures = [];
  for (const o of objects) {
    const geo = new THREE.BufferGeometry();
    let mat;
    if (o.bake) {
      const b = o.bake;
      geo.setAttribute('position', new THREE.BufferAttribute(b.positions, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(b.normals, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(b.uvs, 2));
      geo.setIndex(new THREE.BufferAttribute(b.index, 1));
      const tex = (data, srgb) => {
        const t = new THREE.DataTexture(data, b.size, b.size, THREE.RGBAFormat);
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.needsUpdate = true;
        textures.push(t);
        return t;
      };
      mat = new THREE.MeshStandardMaterial({ map: tex(b.colorMap, true), normalMap: tex(b.normalMap, false), roughness: state.look.rough });
    } else {
      geo.setAttribute('position', new THREE.BufferAttribute(o.mesh.positions, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(o.mesh.normals, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(srgbToLinear(o.mesh.colors), 3));
      geo.setIndex(new THREE.BufferAttribute(quadsToTris(o.mesh.quads), 1));
      mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: state.look.rough });
    }
    const m = new THREE.Mesh(geo, mat);
    m.name = o.name;
    root.add(m);
  }
  const glb = await new GLTFExporter().parseAsync(root, { binary: true });
  root.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  textures.forEach((t) => t.dispose());
  return glb;
}

function exportName() {
  const d = new Date();
  const pad = (v) => String(v).padStart(2, '0');
  return `plastilina_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

let exporting = false;
async function exportModel() {
  if (exporting) return;
  // La app instalada desde GitHub sin el Mac a mano: compartir el archivo. Entrando por el
  // enlace del Mac queda en cola aunque se haya cortado la Wi-Fi.
  const online = await checkServer();
  if (!online && !MAC_APP) return shareModel();
  exporting = true;
  toast('Exportando…');
  try {
    const objects = exportObjects();
    if (!objects.length) throw new Error('nada visible');
    const glb = await buildGLB(objects);
    const obj = await new Blob([toOBJ(objects)]).arrayBuffer();
    // Guardado y exportado van juntos a la carpeta de la obra.
    await saveObra(false, true);
    const o = obras.find((x) => x.id === obraId);
    const stamp = exportName();
    await idbSet(`envio:${stamp}:obj`, { id: o.id, stamp, kind: 'obj', data: obj });
    await idbSet(`envio:${stamp}:glb`, { id: o.id, stamp, kind: 'glb', data: glb });
    const sent = await syncToMac();
    const total = objects.reduce((a, x) => a + x.mesh.quads.length / 4, 0);
    toast(sent ? t('En el Mac, en obras/{0}: {1} capa(s) · {2} quads', o.name, objects.length, total)
      : t('Guardado en las gafas: irá al Mac cuando se conecte'));
  } catch (e) {
    console.error(e);
    exporting = false;
    if (e.message === 'nada visible') return toast('No hay nada visible que exportar');
    return shareModel();
  }
  exporting = false;
}

// ---------- Compartir (WhatsApp, correo…) ----------
// Sin horneado: un OBJ (quads + color, una pieza por capa). Si alguna capa está horneada: un GLB
// (lleva dentro las texturas). El navegador solo deja compartir ciertos tipos de archivo: si no
// acepta el bueno, se prueba con otro tipo o como .txt (Blender lo abre igual).
let shareFiles = null;
async function shareModel() {
  let objects;
  try {
    toast('Rehaciendo la malla…', 2000);
    objects = await exportMeshes();
  } catch (e) {
    console.error(e);
    return toast(t('Remesh falló: {0}', e.message));
  }
  if (!objects.length) return toast('No hay nada visible que exportar');
  // El menú de compartir no se puede abrir dentro de la vista inmersiva: se sale primero.
  if (renderer.xr.isPresenting) await renderer.xr.getSession().end();
  const base = exportName();
  const baked = objects.some((o) => o.bake);
  let files;
  if (state.exportFmt === 'fbx') {
    const fbx = toFBX(objects);
    files = [
      new File([fbx], base + '.fbx', { type: 'application/octet-stream' }),
      new File([fbx], base + '.fbx', { type: 'model/fbx' }),
    ];
  } else if (baked || state.exportFmt === 'glb') {
    const glb = await buildGLB(objects);
    files = [
      new File([glb], base + '.glb', { type: 'model/gltf-binary' }),
      new File([glb], base + '.glb', { type: 'application/octet-stream' }),
    ];
  } else {
    const text = toOBJ(objects);
    files = [
      new File([text], base + '.obj', { type: 'model/obj' }),
      new File([text], base + '.obj.txt', { type: 'text/plain' }),
    ];
  }
  const ok = files.find((f) => navigator.canShare?.({ files: [f] }));
  shareFiles = { share: ok || null, download: files[0] };
  const total = objects.reduce((a, o) => a + o.mesh.quads.length / 4, 0);
  $('shareInfo').textContent = t('{0} · {1} capa(s) · {2} quads', (ok || files[0]).name, objects.length, total.toLocaleString()) +
    (baked ? t(' · con texturas') : '') + ` · ${(files[0].size / 1048576).toFixed(1)} MB` +
    (ok ? '' : t('. Este navegador no deja compartir este archivo: descárgalo y adjúntalo desde WhatsApp.'));
  $('shareGo').style.display = ok ? '' : 'none';
  $('share').classList.add('show');
}
$('shareGo').onclick = async () => {
  try {
    await navigator.share({ files: [shareFiles.share], title: 'La Plastilina' });
    $('share').classList.remove('show');
  } catch (e) {
    if (e.name !== 'AbortError') toast(t('No se pudo compartir: {0}', e.message));
  }
};
$('shareDl').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(shareFiles.download);
  a.download = shareFiles.download.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Descargado en la carpeta Descargas');
};
$('shareClose').onclick = () => $('share').classList.remove('show');

// ---------- HUD escritorio ----------
const sizeIn = $('size'), strIn = $('strength'), quadsIn = $('quads'), colorIn = $('color');
sizeIn.value = radiusToT(state.radius);
strIn.value = state.strength;
quadsIn.value = state.quads;
sizeIn.oninput = () => { state.radius = tToRadius(+sizeIn.value); updateHud(); };
$('stab').oninput = (e) => { state.stab = +e.target.value; updateHud(); };
strIn.oninput = () => { state.strength = +strIn.value; updateHud(); };
quadsIn.oninput = () => { state.quads = +quadsIn.value; updateHud(); };
colorIn.oninput = () => setColor(colorIn.value);
$('btnPaint').onclick = () => choose('paint');
$('btnImport').onclick = () => choose('import');
$('fileRef').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importRef(f); };
$('refHide').onclick = () => setRefShown(!refRoot.visible);
$('refSize').oninput = (e) => setRefSize(tToRefSize(+e.target.value));
$('refOpacity').oninput = (e) => setRefOpacity(+e.target.value);
$('latheSpeed').oninput = (e) => { state.latheSpeed = +e.target.value; };
$('btnBase').onclick = () => setLayerBase(active, state.color);
$('btnUndo').onclick = undo;
$('btnExport').onclick = exportModel;
$('btnShare').onclick = shareModel;
$('btnSym').onclick = () => choose('sym');
$('btnWire').onclick = () => choose('wire');
document.querySelectorAll('#bakeSizes [data-bake]').forEach((b) => (b.onclick = () => { state.bakeSize = +b.dataset.bake; updateHud(); }));
document.querySelectorAll('#shapes [data-shape]').forEach((b) => (b.onclick = () => choose('shape:' + b.dataset.shape)));
document.querySelectorAll('#hud [data-opt]').forEach((b) => (b.onclick = () => choose(b.dataset.opt)));
document.querySelectorAll('#hud [data-look]').forEach((el) => (el.oninput = () => changeLook(el.dataset.look, +el.value)));
syncLookInputs();
$('btnSave').onclick = () => saveObra();
$('btnSaveAs').onclick = () => saveObra(true);
$('btnNew').onclick = newObra;
$('btnRemesh').onclick = () => remeshLayer(active);
$('btnVoxel').onclick = () => toVoxel();
$('textWrite').onclick = () => { panelTab[0] = 'text'; startWriting(); updateHud(); };
$('textMake').onclick = () => convertWriting();
$('textMode').onclick = () => (active.remesh ? toVoxel() : textToQuads(active));
$('shapeBox').onclick = () => makeShape('box');
$('shapePyramid').onclick = () => makeShape('pyramid');
$('shapeWedge').onclick = () => makeShape('wedge');
$('shapeMode').onclick = () => (active.remesh ? toVoxel() : textToQuads(active));
$('shapeReset').onclick = () => resetShape(active);
$('shapeExtrude').onclick = () => setExtrude(!shapeUI.extrude);
$('textInput').onkeydown = (e) => e.stopPropagation();
$('textInput').oninput = (e) => {
  const str = [...e.target.value.toUpperCase()].map((c) => (TEXT_KEYS.includes(c) ? c : ' ')).join('');
  if (!active.text) {
    if (str.trim()) makeTypedText(str);
  } else if (active.remesh || !active.text.str) {
    active.text.str = str;
    buildText(active);
  }
  updateHud();
};
for (const n of RES_STEPS) {
  const b = document.createElement('button');
  b.textContent = n;
  b.dataset.res = n;
  b.onclick = () => setRes(n);
  $('resRow').appendChild(b);
}
$('bgRot').oninput = (e) => { bg.rot = +e.target.value; bgChanged(); };
$('bgShow').oninput = (e) => { bg.show = +e.target.value; bgChanged(); };
$('btnPhoto').onclick = () => takeRefPhoto();
$('exportQuads').oninput = (e) => { state.exportT = +e.target.value; exportUi(); };
$('btnFramePrev').onclick = () => stepFrame(-1);
$('btnFrameNext').onclick = () => stepFrame(1);
$('btnFramePlay').onclick = () => setPlaying(!anim.playing);
$('btnFrameCopy').onclick = () => addFrame(true);
$('btnFrameBlank').onclick = () => addFrame(false);
$('btnFrameDel').onclick = () => deleteFrame();
$('btnOnion').onclick = () => { anim.onion = !anim.onion; paintOnion(); updateHud(); };
$('frameFps').oninput = (e) => { anim.fps = +e.target.value; $('frameFpsVal').textContent = anim.fps; live.anim(); };
$('btnRemeshMac').onclick = () => remeshBlender(active);
$('layerAdd').onclick = newLayer;
$('layerDel').onclick = () => deleteLayers(deleteTargets());
$('layerSphere').onclick = () => resetLayer('sphere');
$('layerMerge').onclick = () => mergeLayers();
$('mergeAskNo').onclick = () => closeMergeAsk();
$('layerClear').onclick = () => resetLayer('empty');
$('btnMenu').onclick = (e) => {
  const b = e.currentTarget.getBoundingClientRect();
  openMenu(b.right + 200, b.top + 160, 'click');
};
const swatchBox = $('swatches');
for (const hex of PALETTE) {
  const s = document.createElement('button');
  s.className = 'swatch';
  s.style.background = hex;
  s.dataset.hex = hex;
  s.title = hex;
  s.onclick = () => setColor(hex);
  swatchBox.append(s);
}

const label = (id) => (STAMPS.get(id)?.own ? STAMPS.get(id).name : t(LABELS[id] || STAMPS.get(id)?.name || id));
// Carga de la escena: quads en pantalla y memoria de las rejillas (para ver cuánto aguanta el casco).
let loadCache = null, loadSig = '';
function sceneLoad() {
  // Solo se recalcula si algo cambió (recorrer 512³ en bloques no es gratis).
  const sig = layers.map((L) => `${L.id}:${L.version}:${L.visible}:${L.remesh ? L.remesh.quads.length : 0}:${L.dirty.size}`).join('|');
  if (loadCache && sig === loadSig) return loadCache;
  loadSig = sig;
  let quads = 0, bytes = 0;
  for (const L of layers) {
    bytes += L.grid.bytes();
    if (!L.visible) continue;
    if (L.remesh) quads += L.remesh.quads.length / 4;
    else for (const ch of L.chunks) if (ch) quads += ch.quads.length / 4;
  }
  return (loadCache = { quads, mb: bytes / 1048576 });
}
function infoText() {
  const { quads, mb } = sceneLoad();
  const k = quads >= 1e6 ? (quads / 1e6).toFixed(1) + 'M' : Math.round(quads / 1000) + 'k';
  return `${active.name} · ${active.grid.res}³ · ${k} quads · ${mb.toFixed(0)} MB${symOn() ? t(' · simetría') : ''}${state.wire ? t(' · malla') : ''}`;
}

function renderLayers() {
  const list = $('layerList');
  list.innerHTML = '';
  for (const L of layers) {
    const row = document.createElement('div');
    row.className = 'layer' + (L === active ? ' active' : '');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = L.color;
    dot.classList.toggle('pick', mergePick.has(L));
    dot.title = t('Elegir para unir');
    dot.onclick = (e) => {
      e.stopPropagation();
      pickForMerge(L);
    };
    const name = document.createElement('span');
    name.className = 'lname';
    name.textContent = L.name + (L.remesh ? ' ⊞' : '') + (L.busy ? ' …' : '') + (L.frames.length > 1 ? ` · ${frameIndex(L) + 1}/${L.frames.length}` : '');
    name.title = t('Doble clic para renombrar');
    const res = document.createElement('span');
    res.className = 'lres';
    res.textContent = `${L.grid.res}³`;
    const eye = document.createElement('button');
    eye.className = 'eye';
    eye.textContent = L.visible ? '👁' : '–';
    eye.title = t('Mostrar / ocultar');
    eye.onclick = (e) => {
      e.stopPropagation();
      L.visible = !L.visible;
      updateHud();
      live.structure();
    };
    row.onclick = () => setActive(L);
    name.ondblclick = () => {
      const v = prompt(t('Nombre de la capa'), L.name);
      if (v) { L.name = v.trim().slice(0, 30); updateHud(); live.structure(); }
    };
    row.append(dot, name, res, eye);
    list.append(row);
  }
  $('layerMerge').disabled = mergePick.size < 2;
  $('layerDel').textContent = mergePick.size > 1 ? t('Borrar {0}', mergePick.size) : t('Borrar');
  $('layerMerge').textContent = mergePick.size > 1 ? t('Unir {0}', mergePick.size) : t('Unir');
  $('frameInfo').textContent = t('Fotograma {0} de {1}', frameIndex() + 1, active.frames.length);
  $('btnFramePlay').textContent = t(anim.playing ? 'Pausa' : 'Play');
  $('btnFramePlay').classList.toggle('on', anim.playing);
  $('btnOnion').classList.toggle('on', anim.onion);
  $('frameFps').value = anim.fps;
  $('frameFpsVal').textContent = anim.fps;
}

let hudMsg = '', hudMsgUntil = 0;
function updateHud() {
  if (favRow) paintFavRow();
  const el = $('tool');
  const tool = activeTool();
  el.textContent = label(tool) + (state.invert ? ' ' + t('(invertido)') : '');
  $('info').textContent = infoText();
  sizeIn.value = radiusToT(state.radius);
  $('stab').value = state.stab;
  $('stabVal').textContent = state.stab ? Math.round(state.stab * 100) + '%' : t('no');
  strIn.value = state.strength;
  quadsIn.value = state.quads;
  colorIn.value = state.color;
  $('btnPaint').classList.toggle('on', state.tool === 'paint');
  $('btnSym').classList.toggle('on', symOn());
  document.querySelectorAll('#hud [data-opt]').forEach((b) => b.classList.toggle('on', optionOn(b.dataset.opt)));
  $('latheSpeed').value = state.latheSpeed;
  $('latheBox').hidden = !state.lathe;
  $('btnVoxel').hidden = !active.remesh;
  if (document.activeElement !== $('textInput')) $('textInput').value = active.text?.str || '';
  $('textMode').hidden = !active.text;
  $('textMode').textContent = t(active.remesh ? 'A vóxel' : 'A quads');
  $('textWrite').classList.toggle('on', text.writing);
  if (text.writing || active.text) $('foldText').open = true;
  $('shapeMode').hidden = !active.shape;
  $('shapeMode').textContent = t(active.remesh ? 'A vóxel' : 'A forma');
  $('shapeReset').hidden = !active.shape || !active.remesh;
  $('shapeExtrude').hidden = !active.shape || !active.remesh;
  $('shapeExtrude').classList.toggle('on', shapeUI.extrude);
  document.querySelectorAll('#resRow [data-res]').forEach((b) => b.classList.toggle('on', +b.dataset.res === brushRes()));
  $('btnWire').classList.toggle('on', state.wire);
  document.querySelectorAll('#bakeSizes [data-bake]').forEach((b) => b.classList.toggle('on', +b.dataset.bake === state.bakeSize));
  document.querySelectorAll('#shapes [data-shape]').forEach((b) => b.classList.toggle('on', b.dataset.shape === state.shape));
  $('quadsVal').textContent = state.quads.toLocaleString();
  for (const s of swatchBox.children) s.classList.toggle('on', s.dataset.hex === state.color);
  const paintLike = tool === 'paint' || tool === 'add';
  cursor.material.color.set(state.invert ? '#ffffff' : paintLike ? state.color : TOOL_COLORS[tool]);
  renderLayers();
  if (obrasReady) renderObras();
  if (radialOpen) radial.draw(state, infoText());
  drawHud3D();
  if (panel3d.visible) drawPanel();
}

let toastTimer = 0;
function toast(raw, ms = 2600) {
  const msg = t(raw); // los avisos fijos se traducen aquí
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  hudMsg = msg;
  hudMsgUntil = performance.now() + Math.min(ms, 8000);
  drawHud3D();
}

// ---------- Menú radial ----------
const radial = new RadialMenu(768);
radial.canvas.id = 'radial';
document.body.appendChild(radial.canvas);
let radialOpen = false, radialMode = null;
let radialDrag = -1; // arco deslizador que se está arrastrando
radial.sliders = [
  { id: 'size', label: 'Tamaño', color: '#e8ecf3', get: () => radiusToT(state.radius),
    set: (t) => (state.radius = tToRadius(t)), text: () => String(Math.round(state.radius * 1000) / 10) },
  { id: 'stab', label: 'Estabilizar', color: '#f2c94c', get: () => state.stab,
    set: (t) => (state.stab = Math.round(t * 20) / 20), text: () => (state.stab ? Math.round(state.stab * 100) + '%' : t('no')) },
];
// Vista previa del tamaño del pincel mientras ajustas el arco de Tamaño: encima del dial, con la
// forma del pincel y el tamaño que tendrá en pantalla (en las gafas, a tamaño real; ver xrFrame).
const preview = document.createElement('canvas');
preview.id = 'brushPreview';
preview.width = preview.height = 320;
document.body.appendChild(preview);
const PREVIEW_PX = 160;
function brushScreenRadius() {
  // A la profundidad del último sitio donde estuvo el cursor (al principio, el centro del modelo).
  const ref = cursor.getWorldPosition(vA);
  const depth = Math.max(0.05, ref.sub(camera.position).dot(camera.getWorldDirection(vB)));
  const px = (state.radius * model.scale.x) / (depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * (innerHeight / 2);
  return px;
}
function drawPreview() {
  const show = radialOpen && radial.highlight === 'slider:size' && !renderer.xr.isPresenting;
  preview.style.display = show ? 'block' : 'none';
  if (!show) return;
  const top = menuCenter.y - MENU_PX / 2 - PREVIEW_PX - 4;
  preview.style.left = menuCenter.x - PREVIEW_PX / 2 + 'px';
  preview.style.top = (top >= 0 ? top : menuCenter.y + MENU_PX / 2 + 4) + 'px';
  const g = preview.getContext('2d'), S = preview.width, c = S / 2;
  g.clearRect(0, 0, S, S);
  const real = brushScreenRadius() * (S / PREVIEW_PX);
  const R = Math.min(real, c - 6);
  g.strokeStyle = '#' + cursor.material.color.getHexString();
  g.fillStyle = 'rgba(14,15,19,0.55)';
  g.lineWidth = 3;
  const sh = shapeActive() ? state.shape : 'sphere';
  g.beginPath();
  if (sh === 'cube') g.rect(c - R * 0.75, c - R * 0.75, R * 1.5, R * 1.5);
  else if (sh === 'blade') g.rect(c - R * 0.1, c - R * 0.9, R * 0.2, R * 1.8);
  else if (sh === 'pyramid') { g.moveTo(c, c - R * 1.1); g.lineTo(c + R, c + R * 0.75); g.lineTo(c - R, c + R * 0.75); g.closePath(); }
  else g.arc(c, c, R, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  // Líneas de "malla" como el cursor.
  g.lineWidth = 1.5;
  g.globalAlpha = 0.6;
  g.beginPath();
  if (sh === 'sphere') {
    g.ellipse(c, c, R, R * 0.35, 0, 0, Math.PI * 2);
    g.moveTo(c + R * 0.35, c);
    g.ellipse(c, c, R * 0.35, R, 0, 0, Math.PI * 2);
  } else if (sh === 'cube') {
    g.moveTo(c, c - R * 0.75); g.lineTo(c, c + R * 0.75);
    g.moveTo(c - R * 0.75, c); g.lineTo(c + R * 0.75, c);
  } else {
    g.moveTo(c, c - R * 1.1); g.lineTo(c, c + R * 0.75);
  }
  g.stroke();
  g.globalAlpha = 1;
  g.fillStyle = '#e8ecf3';
  g.font = '600 26px system-ui, "Noto Sans Thai", sans-serif';
  g.textAlign = 'center';
  g.fillText(t(real > c - 6 ? 'más grande ↗' : 'tamaño real'), c, S - 14);
}

// Mueve el arco i al ángulo de (x, y) (píxeles del canvas desde el centro).
function dragSlider(i, x, y) {
  radial.sliders[i].set(radial.sliderValue(x, y));
  updateHud();
  drawPreview();
}
const menuCenter = { x: 0, y: 0 };
const MENU_PX = 420;

function openMenu(x, y, mode) {
  menuCenter.x = Math.max(MENU_PX / 2, Math.min(innerWidth - MENU_PX / 2, x));
  menuCenter.y = Math.max(MENU_PX / 2, Math.min(innerHeight - MENU_PX / 2, y));
  const el = radial.canvas;
  el.style.width = el.style.height = MENU_PX + 'px';
  el.style.left = menuCenter.x - MENU_PX / 2 + 'px';
  el.style.top = menuCenter.y - MENU_PX / 2 + 'px';
  el.style.display = 'block';
  radialOpen = true;
  radialMode = mode;
  radialDrag = -1;
  radial.reset();
  radial.draw(state, infoText());
}
function closeMenu(pick) {
  if (!radialOpen) return;
  const h = radial.highlight;
  if (pick && h) sfx.play('thock');
  radial.canvas.style.display = 'none';
  radialOpen = false;
  radialDrag = -1;
  drawPreview();
  if (pick && h) choose(h);
}
// buttons: botones del ratón pulsados (para arrastrar los arcos de Tamaño / Estabilizar).
function hoverMenu(x, y, buttons = 0) {
  const dx = x - menuCenter.x, dy = y - menuCenter.y;
  const k = radial.size / MENU_PX;
  if (!buttons) radialDrag = -1;
  const si = radialDrag >= 0 ? radialDrag : radial.sliderAt(dx * k, dy * k);
  if (si >= 0) {
    radial.setHighlight('slider:' + radial.sliders[si].id);
    if (buttons) {
      radialDrag = si;
      dragSlider(si, dx * k, dy * k);
    } else radial.draw(state, infoText());
    drawPreview();
    return;
  }
  const h = radial.inside(dx * k, dy * k) ? radial.itemAt(dx, dy) : null;
  if (radial.setHighlight(h)) radial.draw(state, infoText());
  drawPreview();
}
radial.canvas.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  hoverMenu(e.clientX, e.clientY, e.buttons || 1);
  if (radial.highlight?.startsWith('slider:')) return; // arrastrando un arco: el menú sigue abierto
  closeMenu(true);
});

// ---------- Ratón ----------
// ---------- Mover una capa (sin tocar las demás ni el entorno) ----------
const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3();
function dragMoveDesktop() {
  raycaster.setFromCamera(mouse.ndc, camera);
  model.updateMatrixWorld();
  invM.copy(model.matrixWorld).invert();
  const o = raycaster.ray.origin.clone().applyMatrix4(invM);
  const d = raycaster.ray.direction.clone().transformDirection(invM);
  const m = new THREE.Matrix4();
  if (moveOp.mode === 'move') {
    // Punto del rayo sobre el plano (mirando a cámara) que pasa por donde agarraste.
    const den = d.dot(moveOp.n);
    if (Math.abs(den) < 1e-6) return;
    const t = tmpV.copy(moveOp.p0).sub(o).dot(moveOp.n) / den;
    m.makeTranslation(o.addScaledVector(d, t).sub(moveOp.p0));
  } else {
    // Girar alrededor del punto agarrado: horizontal = eje vertical de la cámara, vertical = eje horizontal.
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).transformDirection(invM);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).transformDirection(invM);
    const k = 0.01;
    tmpQ.setFromAxisAngle(up, (mouse.x - moveOp.x0) * k)
      .multiply(new THREE.Quaternion().setFromAxisAngle(right, (mouse.y - moveOp.y0) * k));
    m.makeTranslation(moveOp.p0)
      .multiply(new THREE.Matrix4().makeRotationFromQuaternion(tmpQ))
      .multiply(new THREE.Matrix4().makeTranslation(tmpV.copy(moveOp.p0).negate()));
  }
  setMoveMatrix(m);
}

// Mientras arrastras solo se mueve su grupo 3D; al soltar, eso pasa a ser el sitio del fotograma.
const moveOp = { L: null, mode: 'move', p0: new THREE.Vector3(), n: new THREE.Vector3(), x0: 0, y0: 0, start: new THREE.Matrix4(), scale: 1, toastT: 0 };

function beginMove(L) {
  sfx.play('grab');
  moveOp.L = L;
  moveOp.scale = 1;
  if (L !== active) setActive(L);
  resetGroup(L);
}
function resetGroup(L) {
  L.group.position.set(0, 0, 0);
  L.group.quaternion.identity();
  L.group.scale.set(1, 1, 1);
}

// m = movimiento de la mano/ratón; la escala se aplica antes, alrededor del punto agarrado (p0).
function setMoveMatrix(m) {
  const s = moveOp.scale, p = moveOp.p0;
  m.multiply(new THREE.Matrix4().makeTranslation(p.x * (1 - s), p.y * (1 - s), p.z * (1 - s)).scale(tmpV.set(s, s, s)));
  m.decompose(moveOp.L.group.position, moveOp.L.group.quaternion, moveOp.L.group.scale);
}

// Stick ↑/↓ (o la rueda en el Mac) mientras agarras: más grande / más pequeña.
function scaleMove(f) {
  moveOp.scale = THREE.MathUtils.clamp(moveOp.scale * f, 0.1, 10);
  const now = performance.now();
  if (now - moveOp.toastT > 120) {
    moveOp.toastT = now;
    toast(`${moveOp.L.name}: ${Math.round(moveOp.scale * 100)}%`, 900);
  }
}

function endMove() {
  const L = moveOp.L;
  moveOp.L = null;
  if (!L) return;
  sfx.play('drop');
  L.group.updateMatrix();
  const s = L.group.scale.x;
  const moved = L.group.position.length() > 1e-4 || 1 - Math.abs(L.group.quaternion.w) > 1e-6 || Math.abs(s - 1) > 1e-3;
  if (moved && layers.includes(L)) {
    const f = L.f;
    noteEdit();
    undoStack.push({ layer: L, f, place: f.voxels.matrix.clone(), bytes: 0 });
    clearRedo();
    L.setPlace(f, new THREE.Matrix4().multiplyMatrices(L.group.matrix, f.voxels.matrix));
    L.moves++;
    live.move(L, f);
    paintOnion();
  }
  resetGroup(L);
}

// Agarrando una capa: deja una copia exacta donde está ahora y sigues con la original en la mano.
function duplicateHeld() {
  const L = moveOp.L;
  if (!L) return;
  const N = new Layer(2, 'empty', { name: t('{0} copia', L.name), color: L.color, grid: L.grid.share() });
  N.adoptFrames(L);
  L.group.updateMatrix();
  N.setPlace(N.f, new THREE.Matrix4().multiplyMatrices(L.group.matrix, L.f.voxels.matrix));
  // Una capa con remesh se copia con su malla limpia y su horneado, no con los vóxeles de debajo.
  if (L.text) {
    N.text = { ...L.text };
    if (L.remesh) buildText(N);
  } else if (L.shape) {
    N.shape = copyShape(L.shape);
    if (L.remesh) buildShape(N);
  } else if (L.remesh) {
    const { positions, normals, quads, colors } = L.remesh.data;
    N.setRemesh({ positions, normals, quads, colors });
    if (L.remesh.bake) N.applyBake(L.remesh.bake);
  }
  layers.push(N);
  sfx.play('dup');
  toast(t('{0} creada', N.name), 1500);
  updateHud();
  live.structure();
}

const mouse = { x: 0, y: 0, ndc: new THREE.Vector2(), inside: false };
const raycaster = new THREE.Raycaster();
const invM = new THREE.Matrix4();
let sculpting = false;
const lastRay = { o: [0, 0, 0], d: [0, 0, -1] };
let strokeDepth = 0;

// Impacto más cercano entre las capas visibles. Si no hay nada (capa vacía) y vas a añadir,
// usa el plano que pasa por el centro del modelo.
function pickLocal(allowAir) {
  raycaster.setFromCamera(mouse.ndc, camera);
  model.updateMatrixWorld();
  invM.copy(model.matrixWorld).invert();
  const o = raycaster.ray.origin.clone().applyMatrix4(invM).toArray();
  const d = raycaster.ray.direction.clone().transformDirection(invM).toArray();
  lastRay.o = o;
  lastRay.d = d;
  // Con el torno en marcha, la pieza está girada: el rayo se pasa a su sistema y el punto se devuelve.
  const so = toSpin(o), sd = spin.angle ? new THREE.Vector3(d[0], d[1], d[2]).transformDirection(spin.inv).toArray() : d;
  let best = null, bestLayer = null;
  // Durante un trazo de Añadir/Quitar, la capa activa se lee tal como estaba al empezar.
  const frozen = sculpting && (activeTool() === 'add' || activeTool() === 'remove');
  for (const L of layers) {
    if (!L.visible) continue;
    if (paramLive(L)) {
      const hit = paramRay(L, so);
      if (hit && (!best || hit[3] < best[3])) { best = hit; bestLayer = L; }
      continue;
    }
    if (frozen && L === active) L.grid.view = strokeRec;
    const f = L.f;
    const hit = f.moved
      ? L.grid.raymarch(toGrid(f, so), new THREE.Vector3(sd[0], sd[1], sd[2]).transformDirection(f.inv).toArray())
      : L.grid.raymarch(so, sd);
    L.grid.view = null;
    if (hit && f.moved) {
      const q = fromGrid(f, hit);
      hit[0] = q[0]; hit[1] = q[1]; hit[2] = q[2]; hit[3] *= f.s;
    }
    if (hit && (!best || hit[3] < best[3])) { best = hit; bestLayer = L; }
  }
  if (best && spin.angle) {
    const v = new THREE.Vector3(best[0], best[1], best[2]).applyMatrix4(spinner.matrix);
    best[0] = v.x; best[1] = v.y; best[2] = v.z;
  }
  if (!best && allowAir) {
    const t = -(o[0] * d[0] + o[1] * d[1] + o[2] * d[2]);
    const p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
    if (t > 0) best = [...p, t];
  }
  if (best) best.layer = bestLayer;
  return best;
}
// Añadir/Quitar siguen la superficie original del trazo (si no, el barro "trepa" hacia la cámara
// o el corte excava sin fin). Fuera del modelo, mantienen la última profundidad.
function strokePoint(hit) {
  const tool = activeTool();
  // Con el torno, lo que pasa girando bajo el ratón no debe mover la mano: se queda a la misma profundidad.
  if (state.lathe) {
    const { o, d } = lastRay;
    if (!strokePrev || latheDepth === null) latheDepth = hit ? hit[3] : latheDepth;
    if (latheDepth !== null) return [o[0] + d[0] * latheDepth, o[1] + d[1] * latheDepth, o[2] + d[2] * latheDepth, latheDepth];
  }
  if (tool === 'grab') {
    // Arrastrar: el punto agarrado sigue al ratón a la misma profundidad.
    const { o, d } = lastRay;
    return [o[0] + d[0] * strokeDepth, o[1] + d[1] * strokeDepth, o[2] + d[2] * strokeDepth, strokeDepth];
  }
  if (tool !== 'add' && tool !== 'remove') return hit;
  if (hit) strokeDepth = hit[3] + (tool === 'add' ? state.radius * 0.3 : 0);
  const { o, d } = lastRay;
  return [o[0] + d[0] * strokeDepth, o[1] + d[1] * strokeDepth, o[2] + d[2] * strokeDepth, strokeDepth];
}

// Cuentagotas (Alt + clic): coge el color del punto.
function pickColor(hit) {
  const L = hit.layer || active;
  const q = toGrid(L.f, toSpin(hit));
  const c = L.grid.sampleColor(q[0], q[1], q[2]);
  setColor(c ? rgbToHex(c) : L.color);
  toast(t('Color cogido: {0}', state.color), 1200);
}

function setModifiers(e) {
  if (e.ctrlKey === state.invert && e.shiftKey === state.smoothHold) return;
  state.invert = e.ctrlKey;
  state.smoothHold = e.shiftKey;
  updateHud();
}

function setMouse(e) {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  mouse.ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
}

if (!SPECTATOR) {
  // Fase de captura en el contenedor: decidimos antes que OrbitControls si el clic esculpe o gira.
  $('app').addEventListener('pointerdown', (e) => {
    if (radialOpen) { closeMenu(false); e.stopPropagation(); return; }
    if (renderer.xr.isPresenting) return;
    setMouse(e);
    // En Mac, Ctrl+clic llega como clic derecho: aquí significa "esculpir invertido".
    const ctrlClick = e.button === 2 && e.ctrlKey;
    if (e.button === 2 && !ctrlClick) {
      e.stopPropagation();
      openMenu(e.clientX, e.clientY, 'hold');
      return;
    }
    if (e.button !== 0 && !ctrlClick) return;
    setModifiers(e);
    if (e.altKey) {
      const hit = pickLocal(false);
      if (hit) { pickColor(hit); e.stopPropagation(); }
      return;
    }
    if (state.tool !== 'move' && shapeMouseDown()) {
      e.stopPropagation();
      return;
    }
    if (symBallUnderMouse(e)) {
      symDrag = { x: e.clientX, y: e.clientY, pos: symFrame.position.clone(), q: symFrame.quaternion.clone(), rotate: e.shiftKey };
      controls.enabled = false;
      e.stopPropagation();
      return;
    }
    if (state.tool === 'move') {
      if (moveOp.mode === 'wheel' && moveOp.L) { clearTimeout(wheelMoveTimer); endMove(); }
      const hit = pickLocal(false);
      if (hit && hit.layer) {
        // Arrastrar = mover en el plano de la pantalla · Shift + arrastrar = girar.
        beginMove(hit.layer);
        moveOp.mode = e.shiftKey ? 'rotate' : 'move';
        moveOp.p0.set(hit[0], hit[1], hit[2]);
        moveOp.n.set(...lastRay.d).normalize();
        moveOp.x0 = e.clientX;
        moveOp.y0 = e.clientY;
        controls.enabled = false;
        e.stopPropagation();
      }
      return;
    }
    const hit = pickLocal(state.tool === 'add' && !state.invert && !state.smoothHold);
    if (hit) {
      strokeDepth = hit[3] + (activeTool() === 'grab' ? 0 : state.radius * 0.3);
      sculpting = true;
      controls.enabled = false;
      beginStroke();
      e.stopPropagation();
    }
  }, true);
}
// La bola de la simetría con el ratón: arrastrar la mueve, con Shift la gira.
let symDrag = null;
const ballV = new THREE.Vector3();
function symBallUnderMouse(e) {
  if (!symOn()) return false;
  symBall.getWorldPosition(ballV).project(camera);
  const px = ((ballV.x + 1) / 2) * innerWidth, py = ((1 - ballV.y) / 2) * innerHeight;
  return ballV.z < 1 && Math.hypot(e.clientX - px, e.clientY - py) < 16;
}
function dragSym(e) {
  const dx = e.clientX - symDrag.x, dy = e.clientY - symDrag.y;
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  symFrame.position.copy(symDrag.pos);
  symFrame.quaternion.copy(symDrag.q);
  if (symDrag.rotate) {
    symFrame.quaternion.premultiply(tmpQ.setFromAxisAngle(up, dx * 0.008));
    symFrame.quaternion.premultiply(tmpQ.setFromAxisAngle(right, dy * 0.008));
  } else {
    const perPx = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.distanceTo(symFrame.getWorldPosition(ballV))) / innerHeight;
    symFrame.position.addScaledVector(right, dx * perPx).addScaledVector(up, -dy * perPx);
  }
  snapSymFrame();
  rebuildSym();
}
addEventListener('pointermove', (e) => {
  setMouse(e);
  if (symDrag) dragSym(e);
  shapeMouseMove();
  if (!renderer.xr.isPresenting && !SPECTATOR) setModifiers(e);
  mouse.inside = e.target === renderer.domElement;
  if (radialOpen && radialMode === 'hold') hoverMenu(e.clientX, e.clientY, e.buttons);
  if (radialOpen && radialMode === 'click' && (e.target === radial.canvas || radialDrag >= 0)) hoverMenu(e.clientX, e.clientY, e.buttons);
});
addEventListener('contextmenu', (e) => e.preventDefault());
// Rueda con Mover: escala la capa que tienes cogida, o la que está bajo el ratón (sin clic).
// En ese segundo caso se fija sola cuando dejas de girar la rueda (un solo paso de deshacer).
let wheelMoveTimer = 0;
if (!SPECTATOR) {
  $('app').addEventListener('wheel', (e) => {
    if (renderer.xr.isPresenting || state.tool !== 'move') return;
    if (!moveOp.L) {
      setMouse(e);
      const hit = pickLocal(false);
      if (!hit || !hit.layer) return; // fuera de las capas: la rueda sigue siendo zoom
      beginMove(hit.layer);
      moveOp.p0.set(hit[0], hit[1], hit[2]);
      moveOp.mode = 'wheel';
    }
    e.preventDefault();
    e.stopPropagation();
    scaleMove(Math.exp(-e.deltaY * 0.0015));
    if (moveOp.mode === 'wheel') {
      setMoveMatrix(new THREE.Matrix4());
      clearTimeout(wheelMoveTimer);
      wheelMoveTimer = setTimeout(() => moveOp.mode === 'wheel' && endMove(), 450);
    }
  }, { capture: true, passive: false });
}
addEventListener('pointerup', (e) => {
  radialDrag = -1;
  if (shapeUI.drag && !renderer.xr.isPresenting) {
    endShapeDrag();
    shapeUI.plane = null;
    controls.enabled = true;
  }
  if (symDrag) {
    symDrag = null;
    controls.enabled = true;
  }
  // Dial con clic derecho: suelta sobre una herramienta para elegirla.
  // Si lo sueltas sin moverte, se queda abierto para elegir con un clic.
  if (e.button === 2 && radialOpen && radialMode === 'hold') {
    if (radial.highlight) closeMenu(true);
    else radialMode = 'click';
  }
  if (sculpting) {
    sculpting = false;
    endStroke();
    controls.enabled = true;
  }
  if (moveOp.L && moveOp.mode !== 'wheel' && !renderer.xr.isPresenting) {
    endMove();
    controls.enabled = true;
  }
});

addEventListener('keydown', (e) => {
  if (SPECTATOR) return spectatorKey(e);
  if (e.target.tagName === 'INPUT' && e.key !== ' ') return;
  if (e.key === 'Shift' || e.key === 'Control') setModifiers(e);
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (e.code === 'Space') {
    e.preventDefault();
    if (!radialOpen) openMenu(mouse.x || innerWidth / 2, mouse.y || innerHeight / 2, 'hold');
  } else if ((e.metaKey || e.ctrlKey) && k === 's') {
    e.preventDefault();
    saveObra(e.shiftKey);
  } else if ((e.metaKey || e.ctrlKey) && k === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
  } else if (e.key === '[') { state.radius = clampRadius(state.radius / 1.15); updateHud(); }
  else if (e.key === ']') { state.radius = clampRadius(state.radius * 1.15); updateHud(); }
  else if (k >= '1' && k <= '9') choose(TOOL_KEYS[+k - 1]);
  else if (k === '0') choose('crease');
  else if (k === 'l') choose(state.line ? 'stroke:free' : 'stroke:line');
  else if (k === 'b') choose('shape:' + ({ sphere: 'cube', cube: 'pyramid', pyramid: 'sphere' }[state.shape] || 'sphere'));
  else if (e.key === ',') stepFrame(-1);
  else if (e.key === '.') stepFrame(1, true);
  else if (k === 'o') setPlaying(!anim.playing);
  else if (k === 'g') choose('move');
  else if (k === 'p') choose('paint');
  else if (k === 'w') choose('wire');
  else if (k === 'x') choose('sym');
  else if (k === 'e') choose('export');
  else if (k === 'r') choose('remesh');
  else if (k === 'n') choose('layerNew');
  else if (k === 'tab') { e.preventDefault(); choose('layerNext'); }
  else if (k === 'escape') closeMenu(false);
});
addEventListener('keyup', (e) => {
  if (SPECTATOR) return;
  if (e.key === 'Shift' || e.key === 'Control') setModifiers(e);
  if (e.code === 'Space' && radialMode === 'hold') closeMenu(true);
});

function fitWindow() {
  const c = renderer.domElement;
  c.style.marginLeft = c.style.marginTop = '';
  if (SPECTATOR && spec.vertical) {
    webcam.fit(1080, 1920);
    camera.aspect = 9 / 16;
    camera.updateProjectionMatrix();
    return;
  }
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', () => {
  if (webcam?.active) webcam.layout();
  else fitWindow();
});

// ---------- Gafas (WebXR) ----------
const btnAR = $('btnAR'), btnVR = $('btnVR');
if (navigator.xr) {
  navigator.xr.isSessionSupported('immersive-ar').then((ok) => (btnAR.disabled = !ok));
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => (btnVR.disabled = !ok));
}
btnAR.onclick = () => startXR('immersive-ar');
btnVR.onclick = () => startXR('immersive-vr');

async function startXR(mode) {
  try {
    const session = await navigator.xr.requestSession(mode, { optionalFeatures: ['local-floor'] });
    renderer.xr.setReferenceSpaceType('local-floor');
    await renderer.xr.setSession(session);
    // 72 imágenes por segundo: da más tiempo a cada una (14 ms en vez de 11) y va más estable que a 90.
    try { if (session.supportedFrameRates?.includes(72)) await session.updateTargetFrameRate(72); } catch {}
    bg.ar = bg.arSession = mode === 'immersive-ar';
    applyBg();
    model.position.set(0, 1.1, -0.6);
    model.quaternion.identity();
    model.scale.setScalar(WS.scale);
    placeFloor(true);
    xr.follow = true; // el espacio te sigue con la vista hasta que empiezas a esculpir
    xr.followSnap = true;
    hud3d.visible = true;
    live.structure();
    session.addEventListener('end', () => {
      bg.ar = bg.arSession = false;
      applyBg();
      model.position.set(0, 0, 0);
      model.quaternion.identity();
      model.scale.setScalar(1);
      placeFloor(false);
      flower.close();
      hud3d.visible = false;
      panel3d.visible = false;
      ray.visible = false;
      cursor.visible = false;
      syncCursorCopies();
    });
  } catch (e) {
    console.error(e);
    toast(t('No se pudo entrar en las gafas: {0}', e.message));
  }
}

// Mandos: cuerpo simple + punta del pincel.
function controllerModel() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.016, 0.09, 12).rotateX(Math.PI / 2).translate(0, 0, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x30343d, roughness: 0.4 }),
  );
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.005, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  tip.position.set(0, 0, -0.055);
  g.add(body, tip);
  return g;
}
const ctrls = [0, 1].map((i) => {
  const c = renderer.xr.getController(i);
  c.addEventListener('connected', (e) => (c.userData.src = e.data));
  c.addEventListener('disconnected', () => (c.userData.src = null));
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.005, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  tip.position.set(0, 0, -0.055);
  c.add(tip);
  scene.add(c);
  return c;
});
const TIP = new THREE.Vector3(0, 0, -0.055);

// Mando y mano de plastilina, en el espacio de agarre (ahí está el mando de verdad).
const rigs = { left: createControllerRig('left'), right: createControllerRig('right') };
[0, 1].forEach((i) => {
  const grip = renderer.xr.getControllerGrip(i);
  grip.addEventListener('connected', (e) => {
    const rig = rigs[e.data.handedness];
    if (rig) grip.add(rig.group);
  });
  grip.addEventListener('disconnected', () => grip.clear());
  scene.add(grip);
});

// Rayo del mando derecho (para el panel)
const ray = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -0.055), new THREE.Vector3(0, 0, -1)]),
  new THREE.LineBasicMaterial({ color: 0x7fb6ff, transparent: true, opacity: 0.8 }),
);
ray.visible = false;

// Menú de las gafas: la flor.
const flower = new Flower((id) => label(id));
scene.add(flower.group);
loadStamps();
loadRefs();

// HUD en el mando izquierdo
const hudCanvas = document.createElement('canvas');
hudCanvas.width = 512;
hudCanvas.height = 200;
const hudTex = new THREE.CanvasTexture(hudCanvas);
hudTex.colorSpace = THREE.SRGBColorSpace;
const hud3d = new THREE.Mesh(
  new THREE.PlaneGeometry(0.13, 0.0508),
  new THREE.MeshBasicMaterial({ map: hudTex, transparent: true }),
);
hud3d.position.set(0, 0.045, 0.01);
hud3d.rotation.x = -0.7;
hud3d.visible = false;

function drawHud3D() {
  const g = hudCanvas.getContext('2d');
  g.clearRect(0, 0, 512, 200);
  g.fillStyle = 'rgba(14,15,19,0.85)';
  g.beginPath();
  g.roundRect(0, 0, 512, 200, 28);
  g.fill();
  const tool = activeTool();
  g.fillStyle = state.invert ? '#fff' : TOOL_COLORS[tool];
  g.font = '700 52px system-ui, "Noto Sans Thai", sans-serif';
  g.fillText(label(tool) + (state.invert ? ' ⇄' : ''), 26, 66);
  g.fillStyle = state.color;
  g.beginPath();
  g.arc(470, 46, 24, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#cfd6e2';
  g.font = '500 30px system-ui, "Noto Sans Thai", sans-serif';
  g.fillText(t('{0} · fuerza {1}%', infoText(), Math.round(state.strength * 100)), 26, 118);
  if (performance.now() < hudMsgUntil) {
    g.fillStyle = '#7fb6ff';
    g.fillText(hudMsg, 26, 168);
  }
  hudTex.needsUpdate = true;
}

// ---------- Texto en 3D ----------
// Escribes con el pincel en una capa de boceto; al convertir se lee letra a letra y sale una capa nueva
// con el texto en quads. La capa guarda lo escrito, así que el vóxel siempre parte de esos quads.
const text = { writing: false, L: null, strokes: [], undone: [], cur: null, job: null, sel: -1, alts: [] };
const TEXT_RES = 192, TEXT_DEPTH = 0.35;
function newTextDraft() {
  const L = new Layer(96, 'empty', { name: t('Boceto de texto') });
  layers.push(L);
  text.L = L;
  text.strokes = [];
  text.undone = [];
  setActive(L);
  live.structure();
}
function openText() {
  panelTab[0] = 'text';
  panelPage = 'main';
  closeMergeAsk();
  if (renderer.xr.isPresenting) panel3d.visible = true;
  if (!active.text) startWriting();
  else drawPanel();
  updateHud();
}
function startWriting() {
  text.writing = true;
  text.sel = -1;
  text.alts = [];
  state.line = false;
  choose('add');
  drawPanel();
  toast('Escribe en mayúsculas, con las letras separadas');
}
function clearDraft() {
  if (text.L && layers.includes(text.L)) deleteLayer(text.L, false);
  text.L = null;
  text.strokes = [];
  text.undone = [];
  text.cur = null;
}
// El plano en el que has escrito: mira hacia ti y con el arriba del mundo.
function writingPlane(all) {
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  const c = new THREE.Vector3();
  for (const p of all) c.add(new THREE.Vector3(p[0], p[1], p[2]));
  c.divideScalar(all.length);
  const head = spinner.worldToLocal(cam.getWorldPosition(new THREE.Vector3()));
  const n = head.sub(c).normalize();
  const worldUp = new THREE.Vector3(0, 1, 0).applyQuaternion(spinner.getWorldQuaternion(new THREE.Quaternion()).invert());
  if (Math.abs(n.dot(worldUp)) > 0.95) n.set(0, 0, 1);
  const right = new THREE.Vector3().crossVectors(worldUp, n).normalize(), up = new THREE.Vector3().crossVectors(n, right);
  return { c, n, right, up };
}
// Leer va a trozos, con la barra, aunque suele ir rápido.
function convertWriting() {
  if (merge || text.job) return mergeBusy();
  const strokes = text.strokes.filter((s) => s.length);
  if (!strokes.length) return toast('Escribe algo primero');
  const plane = writingPlane(strokes.flat());
  const flat = strokes.map((s) => s.map((p) => {
    const v = new THREE.Vector3(p[0] - plane.c.x, p[1] - plane.c.y, p[2] - plane.c.z);
    return [v.dot(plane.right), v.dot(plane.up)];
  }));
  text.writing = false;
  barTitle = 'Leyendo tus letras';
  text.job = { gen: readJob(splitLetters(flat), plane), t0: performance.now(), p: 0 };
  mergeBarShow(true);
}
function* readJob(groups, plane) {
  const H = Math.max(...groups.map((g) => g.yh - g.yl), 1e-3);
  const heights = groups.map((g) => g.yh - g.yl).filter((h) => h > H * 0.5).sort((a, b) => a - b);
  const height = heights[heights.length >> 1] || H;
  const mid = (Math.max(...groups.map((g) => g.yh)) + Math.min(...groups.map((g) => g.yl))) / 2;
  let str = '';
  const alts = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i], h = g.yh - g.yl, w = g.hi - g.lo;
    if (i && g.lo - groups[i - 1].hi > height * 0.8) {
      str += ' ';
      alts.push([]);
    }
    const small = h < height * 0.3 && w < height * 0.6;
    const read = small ? ((g.yh + g.yl) / 2 > mid - height * 0.15 ? ['-', '.'] : ['.', ',', '-']) : readLetter(g.strokes);
    str += read[0];
    alts.push(read);
    text.job.p = (i + 1) / groups.length;
    yield;
  }
  const x0 = Math.min(...groups.map((g) => g.lo)), x1 = Math.max(...groups.map((g) => g.hi));
  const at = plane.c.clone().addScaledVector(plane.right, (x0 + x1) / 2).addScaledVector(plane.up, mid);
  text.result = { str, alts, height, at, plane };
}
function textFrame(dt) {
  const j = text.job;
  if (!j) return;
  const end = performance.now() + 8;
  while (j.gen && performance.now() < end) if (j.gen.next().done) j.gen = null;
  // Un momento como mínimo: que se vea que ha pasado algo.
  const shown = Math.min(j.p, (performance.now() - j.t0) / 700);
  mergeBarPaint(shown, dt);
  if (j.gen || performance.now() - j.t0 < 700) return;
  text.job = null;
  mergeBarShow(false);
  const r = text.result;
  clearDraft();
  makeTextLayer(r.str, r.height, r.at, r.plane);
  text.alts = r.alts;
  text.sel = r.alts.findIndex((a) => a.length);
  sfx.play('thock');
  toast(t('He leído: {0}. Toca una letra para corregirla', r.str), 5000);
}
function makeTextLayer(str, height, at, plane) {
  const L = new Layer(TEXT_RES, 'empty', { name: t('Texto') });
  L.text = { str, height, depth: height * TEXT_DEPTH };
  const m = new THREE.Matrix4().makeBasis(plane.right, plane.up, plane.n);
  m.setPosition(at);
  L.setPlace(L.f, m);
  layers.push(L);
  buildText(L);
  setActive(L);
  noteEdit();
  live.structure();
  drawPanel();
  return L;
}
// Texto delante de ti, para el que se escribe con el teclado.
function makeTypedText(str) {
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  const eye = cam.getWorldPosition(new THREE.Vector3()), dir = cam.getWorldDirection(new THREE.Vector3());
  const c = spinner.worldToLocal(eye.addScaledVector(dir, renderer.xr.isPresenting ? 0.6 : 1));
  clearDraft();
  text.writing = false;
  const plane = writingPlane([[c.x, c.y, c.z]]);
  return makeTextLayer(str, 0.12, c, plane);
}
function buildText(L) {
  const { str, height, depth } = L.text;
  const mesh = textMesh(str, height, depth), base = L.base;
  L.version++;
  if (!mesh.quads.length) {
    L.clearRemesh();
    return;
  }
  const colors = new Float32Array(mesh.positions.length);
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = base[0] / 255; colors[i + 1] = base[1] / 255; colors[i + 2] = base[2] / 255;
  }
  L.setRemesh({ positions: mesh.positions, normals: mesh.normals, quads: mesh.quads, colors });
  if (state.wire) L.setWire(true);
}
function typeKey(k) {
  const L = active;
  if (!L.text) {
    if (k === '⌫' || k === ' ') return;
    makeTypedText(k);
    return;
  }
  if (!L.remesh && L.text.str) return toast('Está en vóxel: pulsa «A quads» para cambiar las letras');
  const chars = [...L.text.str], at = text.sel;
  if (k === '⌫') {
    const i = at >= 0 && at < chars.length ? at : chars.length - 1;
    if (i < 0) return;
    chars.splice(i, 1);
    text.alts.splice(i, 1);
    text.sel = Math.min(i, chars.length - 1);
  } else if (at >= 0 && at < chars.length) {
    chars[at] = k;
    text.alts[at] = [];
    text.sel = at + 1 < chars.length ? at + 1 : -1;
  } else {
    chars.push(k);
    text.alts.push([]);
  }
  L.text.str = chars.join('');
  buildText(L);
  sfx.play('plip');
  updateHud();
  drawPanel();
}
function setTextShape(L) {
  if (L.remesh) buildText(L);
}
// De los quads al vóxel: rejilla nueva con la barra y deshacer, como todo lo pesado.
function textToVoxel(L) {
  if (merge || text.job) return mergeBusy();
  if (L.frames.length > 1 || L.busy) return;
  const res = Math.max(L.grid.res, TEXT_RES);
  const { str, height, depth } = L.text;
  runMerge([L], res, 'Pasando a vóxel', () => t('{0}: otra vez en vóxel', L.name), { textBack: true, makeJob: (m) => fieldVoxelJob(m, textField(str, height, depth), res) });
}
function shapeToVoxel(L) {
  if (merge || text.job) return mergeBusy();
  if (L.frames.length > 1 || L.busy) return;
  endShapeDrag();
  const res = Math.max(L.grid.res, TEXT_RES);
  runMerge([L], res, 'Pasando a vóxel', () => t('{0}: otra vez en vóxel', L.name), { textBack: true, makeJob: (m) => fieldVoxelJob(m, shapeField(L.shape), res) });
}
// La rejilla nueva a partir de una distancia con signo (texto o forma), poco a poco.
function* fieldVoxelJob(m, f, res) {
  const g = new SDFGrid(res, 'empty');
  g.growTo(f.lo, f.hi, MAX_SAMPLES);
  const b = (8 * Math.sqrt(3)) / 2 * g.h + g.band;
  const at = (i) => g.o + (i * 8 + (8 - 1) / 2) * g.h;
  const steps = g.buildSteps((x, y, z) => f.at(x, y, z, g.band * 1.5), (bx, by, bz) => {
    const d = f.at(at(bx), at(by), at(bz), b + g.band);
    return d > b ? 1 : d < -b ? -1 : 0;
  });
  m.grid = g;
  for (const p of steps) {
    m.p = p;
    yield;
  }
}
function textToQuads(L) {
  if (merge) return mergeBusy();
  if (!(L.text || L.shape) || L.remesh) return;
  rebuildParam(L);
  updateHud();
  drawPanel();
  live.structure();
  toast(L.shape ? 'Otra vez en forma, limpia' : 'Otra vez en quads, limpio');
}
const TEXT_ROWS = ['QWERTYUIOP⌫', 'ASDFGHJKLÑ-', 'ZXCVBNM.,! ', '0123456789'];
function buildTextTab() {
  const W = [], L = active.text ? active : null;
  const M = 32, IW = PW - 2 * M;
  W.push(panelBlock(8, 684, CERA.paper));
  let y = 54;
  if (text.writing || !L) {
    W.push({ type: 'label', x: M, y, head: true, text: 'Texto', size: 44 });
    W.push({ type: 'label', x: M, y: y + 40, size: 22, wrap: IW, text: 'Escribe con Añadir, en mayúsculas y con las letras separadas. O usa el teclado.' });
    const bw = (IW - 10) / 2, n = text.strokes.filter((s) => s.length).length;
    W.push({ type: 'button', x: M, y: 140, w: bw, h: 72, label: 'Convertir en texto', size: 26, active: () => n > 0, onClick: convertWriting });
    W.push({ type: 'button', x: M + bw + 10, y: 140, w: bw, h: 72, label: 'Borrar', size: 26, onClick: () => { clearDraft(); drawPanel(); } });
    W.push({ type: 'label', x: M, y: 262, size: 22, text: n ? t('{0} trazos', n) : t('Aún no hay trazos') });
  } else {
    const chars = [...L.text.str], cw = Math.min(64, (IW - (chars.length - 1) * 4) / Math.max(1, chars.length));
    chars.forEach((ch, i) => W.push({ type: 'button', x: M + i * (cw + 4), y: 22, w: cw, h: 64, label: ch === ' ' ? '␣' : ch, plain: true, size: Math.round(cw * 0.5), active: () => text.sel === i, onClick: () => { text.sel = text.sel === i ? -1 : i; drawPanel(); } }));
    const alts = text.sel >= 0 ? (text.alts[text.sel] || []).filter((a) => a !== chars[text.sel]).slice(0, 3) : [];
    alts.forEach((ch, i) => W.push({ type: 'button', x: M + i * 76, y: 94, w: 68, h: 46, label: ch, plain: true, size: 26, onClick: () => { typeKey(ch); } }));
    if (alts.length) W.push({ type: 'label', x: M + alts.length * 76 + 8, y: 124, size: 20, text: '¿Era otra?' });
    if (L.remesh) {
      W.push({ type: 'slider', x: M, y: 188, w: (IW - 20) / 2, h: 26, label: 'Grosor', get: () => (L.text.depth / L.text.height - 0.05) / 0.95, set: (v) => { L.text.depth = L.text.height * (0.05 + v * 0.95); setTextShape(L); }, text: () => Math.round((L.text.depth / L.text.height) * 100) + '%' });
      W.push({ type: 'slider', x: M + (IW + 20) / 2, y: 188, w: (IW - 20) / 2, h: 26, label: 'Altura', get: () => (L.text.height - 0.02) / 0.58, set: (v) => { const k = L.text.depth / L.text.height; L.text.height = 0.02 + v * 0.58; L.text.depth = L.text.height * k; setTextShape(L); }, text: () => Math.round(L.text.height * 100) + ' cm' });
    }
    const q = L.remesh ? L.remesh.quads.length / 4 : 0;
    const bw = (IW - 20) / 3;
    W.push({ type: 'button', x: M, y: 216, w: bw, h: 58, label: L.remesh ? 'A vóxel' : 'A quads', size: 24, onClick: () => (L.remesh ? toVoxel(L) : textToQuads(L)) });
    W.push({ type: 'button', x: M + bw + 10, y: 216, w: bw, h: 58, label: 'Escribir otro', size: 24, onClick: startWriting });
    W.push({ type: 'label', x: M + 2 * (bw + 10), y: 252, size: 22, text: L.remesh ? t('{0} quads', q) : t('En vóxel') });
  }
  const kw = (IW - 10 * 6) / 11;
  TEXT_ROWS.forEach((row, r) => [...row].forEach((k, i) => W.push({ type: 'button', x: M + i * (kw + 6), y: 296 + r * 74, w: kw, h: 66, label: k === ' ' ? '␣' : k, plain: true, size: 26, onClick: () => typeKey(k) })));
  return W;
}

// ---------- Formas paramétricas ----------
// Una capa con una caja, pirámide o cuña: la malla es la forma tal cual (una caja son 6 caras). Se edita
// cogiendo sus tiradores: amarillo = esquina, azul = arista, rojo = cara. «A vóxel» la pasa a plastilina.
const rebuildParam = (L) => (L.text ? buildText(L) : buildShape(L));
const SHAPE_NAMES = { box: 'Caja', pyramid: 'Pirámide', wedge: 'Cuña' };
const HANDLE_LOOK = {
  vertex: [new THREE.BoxGeometry(1, 1, 1), CERA.yellow],
  edge: [new THREE.SphereGeometry(0.55, 14, 10), CERA.blue],
  face: [new THREE.OctahedronGeometry(0.7), CERA.red],
};
const HANDLE_MATS = Object.fromEntries(Object.entries(HANDLE_LOOK).map(([k, [, c]]) => [k, new THREE.MeshBasicMaterial({ color: c, toneMapped: false })]));
const HANDLE_RING = new THREE.MeshBasicMaterial({ color: CERA.ink, side: THREE.BackSide, toneMapped: false });
const shapeUI = { L: null, group: new THREE.Group(), list: [], meshes: [], hot: -1, drag: null, extrude: false };
const shapeSnap = (s) => ({ v: s.v.map((p) => [...p]), f: s.f.map((f) => [...f]) });
function setExtrude(on) {
  shapeUI.extrude = on;
  if (shapeUI.L) placeHandles();
  toast(on ? 'Extruir: coge una cara roja y tira de ella' : 'Extruir apagado: las caras se mueven', 2200);
  updateHud();
  drawPanel();
}
// Formas y textos en quads no tienen vóxeles debajo: Mover los encuentra por su propia malla.
const paramLive = (L) => (L.shape || L.text) && L.remesh;
const vP = new THREE.Vector3(), vQ = new THREE.Vector3();
function paramField(L) {
  if (L.pField?.v !== L.version) L.pField = { v: L.version, f: L.shape ? shapeField(L.shape) : textField(L.text.str, L.text.height, L.text.depth) };
  return L.pField.f;
}
function paramDist(L, tipL) {
  model.updateMatrixWorld();
  const p = L.reGroup.worldToLocal(model.localToWorld(vP.fromArray(tipL)));
  const k = L.reGroup.getWorldScale(vQ).x / model.getWorldScale(vP.clone()).x;
  return paramField(L).at(p.x, p.y, p.z, 1) * k;
}
function paramRay(L, so) {
  const hit = raycaster.intersectObject(L.remesh.mesh, false)[0];
  if (!hit) return null;
  const p = spinner.worldToLocal(hit.point.clone());
  return [p.x, p.y, p.z, Math.hypot(p.x - so[0], p.y - so[1], p.z - so[2])];
}
function buildShape(L) {
  const m = shapeMesh(L.shape), base = L.base, colors = new Float32Array(m.positions.length);
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = base[0] / 255; colors[i + 1] = base[1] / 255; colors[i + 2] = base[2] / 255;
  }
  L.version++;
  L.setRemesh({ ...m, colors });
  if (state.wire) L.setWire(true);
  if (shapeUI.L === L) placeHandles();
}
function makeShape(kind) {
  if (merge) return mergeBusy();
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  const eye = cam.getWorldPosition(new THREE.Vector3()), dir = cam.getWorldDirection(new THREE.Vector3());
  const c = spinner.worldToLocal(eye.addScaledVector(dir, renderer.xr.isPresenting ? 0.55 : 1));
  const L = new Layer(TEXT_RES, 'empty', { name: t(SHAPE_NAMES[kind]) });
  L.shape = newShape(kind, SHAPE_SIZE);
  L.setPlace(L.f, new THREE.Matrix4().setPosition(c));
  layers.push(L);
  buildShape(L);
  if (state.tool === 'move') choose('add');
  setActive(L);
  noteEdit();
  live.structure();
  drawPanel();
  sfx.play('pop');
  toast(t('{0}: coge las esquinas, aristas o caras con el gatillo', L.name), 3500);
}
const SHAPE_SIZE = 0.16;
function resetShape(L) {
  if (!L.shape || !L.remesh) return;
  const before = shapeSnap(L.shape), fresh = newShape(L.shape.kind, SHAPE_SIZE);
  L.shape.v = fresh.v;
  L.shape.f = fresh.f;
  pushShapeEdit(L, before);
  buildShape(L);
}
function pushShapeEdit(L, before) {
  noteEdit();
  undoStack.push({ layer: L, grid: L.grid, shapeEdit: before, bytes: 512 });
  clearRedo();
  trimUndo();
  live.structure();
}
// Los tiradores salen en la forma activa mientras está en quads (no con Mover, que coge la capa entera).
function shapeFrame() {
  const want = active.shape && active.remesh && state.tool !== 'move' && !merge && active.visible ? active : null;
  if (want !== shapeUI.L) {
    endShapeDrag();
    shapeUI.group.removeFromParent();
    shapeUI.L = want;
    if (want) {
      want.reGroup.add(shapeUI.group);
      placeHandles();
    }
  }
  if (!shapeUI.L) return;
  // Del mismo tamaño en la vista aunque la forma esté escalada.
  const k = (renderer.xr.isPresenting ? 0.011 : 0.014) / (shapeUI.L.reGroup.getWorldScale(vShape).x || 1);
  shapeUI.meshes.forEach((m, i) => m.scale.setScalar(k * (i === shapeUI.hot || i === shapeUI.drag?.i ? 1.7 : 1)));
}
const vShape = new THREE.Vector3();
function placeHandles() {
  const L = shapeUI.L;
  if (!L) return;
  const list = shapeHandles(L.shape);
  if (list.length !== shapeUI.list.length || list.some((h, i) => h.type !== shapeUI.list[i].type)) {
    shapeUI.meshes.forEach((m) => shapeUI.group.remove(m));
    shapeUI.meshes = list.map((h, i) => {
      const m = new THREE.Mesh(HANDLE_LOOK[h.type][0], HANDLE_MATS[h.type]);
      const ring = new THREE.Mesh(HANDLE_LOOK[h.type][0], HANDLE_RING);
      ring.scale.setScalar(1.35);
      m.add(ring);
      m.userData.handle = i;
      shapeUI.group.add(m);
      return m;
    });
  }
  shapeUI.list = list;
  list.forEach((h, i) => {
    shapeUI.meshes[i].position.fromArray(handlePos(L.shape, h));
    // Extruyendo solo se cogen caras: las esquinas y aristas se apartan para no estorbar.
    shapeUI.meshes[i].visible = !shapeUI.extrude || h.type === 'face';
  });
}
// Con Extruir, coger una cara saca una copia de ella con paredes y lleva la copia, solo hacia fuera.
function startShapeDrag(i, p) {
  const L = shapeUI.L, h = shapeUI.list[i], before = shapeSnap(L.shape);
  let normal = null;
  if (shapeUI.extrude && h.type === 'face') {
    const fi = L.shape.f.findIndex((f) => f.length === h.ids.length && f.every((id, k) => id === h.ids[k]));
    normal = faceDir(L.shape, fi);
    extrudeFace(L.shape, fi);
    placeHandles();
    const list = shapeUI.list;
    i = list.length - L.shape.f.length + fi;
  }
  shapeUI.drag = { i, p0: p, v0: L.shape.v.map((v) => [...v]), before, normal, moved: false };
  sfx.play('grab');
}
function moveShapeDrag(p) {
  const d = shapeUI.drag, L = shapeUI.L;
  if (!d || !L) return;
  let delta = [p[0] - d.p0[0], p[1] - d.p0[1], p[2] - d.p0[2]];
  if (d.normal) {
    const k = Math.max(0, delta[0] * d.normal[0] + delta[1] * d.normal[1] + delta[2] * d.normal[2]);
    delta = d.normal.map((x) => x * k);
  }
  L.shape.v = d.v0.map((v) => [...v]);
  for (const id of shapeUI.list[d.i].ids) for (let a = 0; a < 3; a++) L.shape.v[id][a] = d.v0[id][a] + delta[a];
  d.moved = true;
  buildShape(L);
}
function endShapeDrag() {
  const d = shapeUI.drag, L = shapeUI.L;
  shapeUI.drag = null;
  if (!d || !L) return;
  // Una extrusión que no ha salido nada no deja caras metidas una dentro de otra.
  const flat = d.normal && d.v0.every((v, i) => v.every((x, a) => Math.abs(x - L.shape.v[i][a]) < 1e-4));
  if (!d.moved || flat) {
    if (d.normal) {
      Object.assign(L.shape, d.before);
      buildShape(L);
    }
    return;
  }
  pushShapeEdit(L, d.before);
  sfx.play('thock');
  updateHud();
  drawPanel();
}
// En las gafas: la punta del mando cerca de un tirador lo marca; con el gatillo lo llevas.
function shapeXR(tipW, trig, gp) {
  const L = shapeUI.L;
  if (!L) return false;
  const local = () => L.reGroup.worldToLocal(tipW.clone()).toArray();
  if (shapeUI.drag) {
    if (trig > 0.08) moveShapeDrag(local());
    else endShapeDrag();
    return true;
  }
  if (xr.stroking || moveOp.L) return false;
  let best = -1, bd = 0.035;
  shapeUI.meshes.forEach((m, i) => {
    if (!m.visible) return;
    const d = m.getWorldPosition(vShape).distanceTo(tipW);
    if (d < bd) { bd = d; best = i; }
  });
  shapeUI.hot = best;
  if (best < 0 || trig <= 0.08) return best >= 0;
  startShapeDrag(best, local());
  gp?.hapticActuators?.[0]?.pulse?.(0.5, 25);
  return true;
}
// En el Mac: clic sobre un tirador y arrastrar; se mueve en el plano que mira a la cámara.
function shapeMouseDown() {
  if (!shapeUI.L) return false;
  raycaster.setFromCamera(mouse.ndc, camera);
  const hit = raycaster.intersectObjects(shapeUI.meshes.filter((m) => m.visible), false)[0];
  if (!hit) return false;
  const L = shapeUI.L, i = hit.object.userData.handle, at = hit.object.getWorldPosition(new THREE.Vector3());
  shapeUI.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), at);
  startShapeDrag(i, L.reGroup.worldToLocal(at.clone()).toArray());
  shapeUI.drag.y0 = mouse.ndc.y;
  controls.enabled = false;
  return true;
}
function shapeMouseMove() {
  if (!shapeUI.drag || !shapeUI.plane || renderer.xr.isPresenting) return;
  raycaster.setFromCamera(mouse.ndc, camera);
  const d = shapeUI.drag, L = shapeUI.L;
  if (d.normal) {
    // Extruir: el punto de la línea de la cara más cercano al rayo del ratón. Si la cara te mira de
    // frente esa línea no se ve: entonces sale al subir el ratón.
    const o = L.reGroup.localToWorld(new THREE.Vector3().fromArray(d.p0));
    const n = L.reGroup.localToWorld(new THREE.Vector3().fromArray(d.p0).add(new THREE.Vector3().fromArray(d.normal))).sub(o).normalize();
    const r = raycaster.ray, w = o.clone().sub(r.origin), b = n.dot(r.direction), den = 1 - b * b;
    let t;
    if (den > 0.02) t = (b * w.dot(r.direction) - w.dot(n)) / den;
    else t = (d.y0 - mouse.ndc.y) * -0.5 * o.distanceTo(camera.position);
    moveShapeDrag(L.reGroup.worldToLocal(o.addScaledVector(n, t)).toArray());
    return;
  }
  const p = raycaster.ray.intersectPlane(shapeUI.plane, new THREE.Vector3());
  if (p) moveShapeDrag(L.reGroup.worldToLocal(p).toArray());
}
function buildShapesTab() {
  const W = [], L = active.shape ? active : null;
  const M = 32, IW = PW - 2 * M;
  W.push(panelBlock(8, 684, CERA.red));
  W.push({ type: 'label', x: M, y: 54, head: true, text: 'Formas', size: 44 });
  W.push({ type: 'button', x: PW - M - 220, y: 18, w: 220, h: 60, label: 'Texto ▸', size: 26, onClick: () => { noteUse('text'); openText(); } });
  W.push({ type: 'label', x: M, y: 94, size: 22, wrap: IW - 230, text: 'Mínima geometría: una caja son 6 caras.' });
  const bw = (IW - 20) / 3;
  [['box', 'Caja'], ['pyramid', 'Pirámide'], ['wedge', 'Cuña']].forEach(([k, l], i) => W.push({ type: 'button', x: M + i * (bw + 10), y: 124, w: bw, h: 80, label: l, size: 28, onClick: () => makeShape(k) }));
  if (L) {
    W.push({ type: 'label', x: M, y: 252, size: 26, text: L.remesh ? t('{0}: {1} caras', L.name, L.shape.f.length) : t('{0}: en vóxel', L.name) });
    const hw = (IW - 10) / 2;
    W.push({ type: 'button', x: M, y: 276, w: hw, h: 64, label: L.remesh ? 'A vóxel' : 'A forma', size: 26, onClick: () => (L.remesh ? toVoxel(L) : textToQuads(L)) });
    if (L.remesh) W.push({ type: 'button', x: M + hw + 10, y: 276, w: hw, h: 64, label: 'Como al principio', size: 24, onClick: () => resetShape(L) });
    if (L.remesh) W.push({ type: 'button', x: M, y: 352, w: IW, h: 64, label: shapeUI.extrude ? 'Extruir: sí (tira de una cara roja)' : 'Extruir: no', size: 26, active: () => shapeUI.extrude, onClick: () => setExtrude(!shapeUI.extrude) });
  }
  ['Coge con el gatillo: amarillo = esquina, azul = arista, rojo = cara.', 'Con Mover la llevas, giras y escalas entera.', '«A vóxel» la convierte en plastilina; «A forma» vuelve a la forma limpia.']
    .forEach((text, i) => W.push({ type: 'label', x: M, y: 460 + i * 76, size: 22, wrap: IW, text }));
  return W;
}

// ---------- Barra de la unión de capas ----------
// En las gafas flota delante de la vista y sigue a la cabeza con un poco de retraso, para no marear.
const BAR_W = 0.36, BAR_H = BAR_W * (144 / 512);
const barCanvas = document.createElement('canvas');
barCanvas.width = 512;
barCanvas.height = 144;
const barTex = new THREE.CanvasTexture(barCanvas);
barTex.colorSpace = THREE.SRGBColorSpace;
const barMat = (o) => new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false, ...o });
const barGroup = new THREE.Group();
const barBack = new THREE.Mesh(new THREE.PlaneGeometry(BAR_W, BAR_H), barMat({ map: barTex }));
const barPx = BAR_W / 512;
const barFillGeo = new THREE.PlaneGeometry(1, 36 * barPx);
barFillGeo.translate(0.5, 0, 0);
const barFill = new THREE.Mesh(barFillGeo, barMat({ color: CERA.yellow }));
const barGlow = new THREE.Mesh(new THREE.PlaneGeometry(40 * barPx, 36 * barPx), barMat({ color: 0xffffff, opacity: 0.55 }));
barFill.position.set(-BAR_W / 2 + 18 * barPx, -BAR_H / 2 + 36 * barPx, 0.001);
barGlow.position.set(0, barFill.position.y, 0.002);
barBack.renderOrder = 1100;
barFill.renderOrder = 1101;
barGlow.renderOrder = 1102;
barGroup.add(barBack, barFill, barGlow);
barGroup.visible = false;
scene.add(barGroup);
const barWant = new THREE.Vector3(), barQuat = new THREE.Quaternion();
let barTime = 0, barPlaced = false, barPct = -1, barTitle = '';
let barT0 = 0;
function mergeBarShow(on) {
  barPct = -1;
  if (on) barT0 = performance.now();
  barGroup.visible = on && renderer.xr.isPresenting;
  $('mergeBar').hidden = !on || renderer.xr.isPresenting;
  barPlaced = false;
  if (on) mergeBarPaint(0, 0);
}
function mergeBarPaint(p, dt) {
  const inXR = renderer.xr.isPresenting, room = BAR_W - 36 * barPx;
  barTime += dt;
  barGroup.visible = inXR;
  $('mergeBar').hidden = inXR;
  if (inXR) {
    const cam = renderer.xr.getCamera();
    cam.getWorldPosition(barWant);
    cam.getWorldQuaternion(barQuat);
    barWant.add(new THREE.Vector3(0, 0, -0.85).applyQuaternion(barQuat));
    const k = barPlaced ? 1 - Math.exp(-dt * 6) : 1;
    barGroup.position.lerp(barWant, k);
    barGroup.quaternion.slerp(barQuat, k);
    barPlaced = true;
    barFill.scale.x = Math.max(0.001, p * room);
    // Un brillo que recorre la barra: mientras se mueva, el programa está vivo.
    barGlow.position.x = -BAR_W / 2 + 18 * barPx + ((barTime * 0.6) % 1) * (room - 40 * barPx) + 20 * barPx;
  }
  const pct = Math.floor(p * 100);
  if (barPct === pct) return;
  barPct = pct;
  // A partir de un poco de avance se sabe cuánto queda; solo se dice si no es cosa de un momento.
  const spent = (performance.now() - barT0) / 1000, left = p > 0.06 && spent > 1 ? Math.ceil((spent * (1 - p)) / p) : 0;
  const label = t(merge?.title || barTitle) + ' · ' + pct + '%' + (left >= 3 ? ' · ' + t('quedan unos {0} s', left) : '');
  $('mergeBarText').textContent = label;
  $('mergeBarFill').style.width = pct + '%';
  if (!inXR) return;
  const g = barCanvas.getContext('2d');
  g.fillStyle = CERA.ink;
  g.fillRect(0, 0, 512, 144);
  g.fillStyle = CERA.paper;
  g.font = '700 40px Mali, system-ui, "Noto Sans Thai", sans-serif';
  g.fillText(label, 18, 58);
  g.fillRect(18, 90, 476, 36);
  barTex.needsUpdate = true;
}

// ---------- Panel de la mano izquierda (gafas) ----------
// El panel son dos columnas, cada una con dos pestañas: PW y PANE_H son lo que mide una columna por dentro.
const PW = 768, PANE_H = 700, TAB_H = 72, CW = PW * 2, CH = TAB_H + PANE_H, PANEL_W = 0.44, PANEL_H = PANEL_W * (CH / CW);
let delLayerUntil = 0;
let panelPage = 'main'; // 'main' = las pestañas; si no, una página abierta encima de ellas
const panel = new CanvasPanel(CW, CH, buildPanel);
panel.onFeel = (kind, w, v) => {
  if (kind === 'hover') return sfx.play('tick', { vol: 0.8, semi: PENTATONIC[Math.abs(Math.round(w.x + w.y)) % 5], pan: -0.2 });
  if (kind === 'step') return sfx.play('dial', { semi: v * 12 - 4, pan: -0.2 });
  if (w.type === 'slider') return; // ya suenan sus muescas
  sfx.play(w.type === 'swatch' ? 'plip' : w.type === 'tab' ? 'thock' : 'clic', { pan: -0.2 });
  xr.gpR?.hapticActuators?.[0]?.pulse?.(w.type === 'button' ? 0.45 : 0.25, 18);
};
const panelTex = new THREE.CanvasTexture(panel.canvas);
panelTex.colorSpace = THREE.SRGBColorSpace;
const panel3d = new THREE.Mesh(
  new THREE.PlaneGeometry(PANEL_W, PANEL_H),
  new THREE.MeshBasicMaterial({ map: panelTex, transparent: true }),
);
// En la mano: tumbado como una tablilla, justo después de la punta del mando y un poco hacia tu centro.
function panelToHand(left) {
  left.add(panel3d);
  panel3d.position.set(0.08, 0.1, -0.17);
  panel3d.rotation.set(-0.9, 0, 0);
  panel3d.scale.setScalar(1);
}
panel3d.visible = false;
// Las cuatro esquinas: tira de una con el mando derecho y el panel se queda donde lo sueltes.
const panelGrips = [[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([x, y]) => {
  const g = new THREE.Mesh(new THREE.CircleGeometry(0.005, 16), new THREE.MeshBasicMaterial({ color: CERA.yellow, toneMapped: false }));
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.005, 0.007, 16), new THREE.MeshBasicMaterial({ color: CERA.ink, toneMapped: false }));
  g.add(ring);
  g.position.set((x * PANEL_W) / 2 + x * 0.008, (y * PANEL_H) / 2 + y * 0.008, 0.002);
  panel3d.add(g);
  return g;
});
function pinPanel(on) {
  xr.panelPinned = on;
  if (on) scene.attach(panel3d);
  else if (xr.left) panelToHand(xr.left);
  drawPanel();
}
// La rueda de color, en un menú a la derecha del panel. Se abre con el círculo del + de COLOR.
const wheelCanvas = document.createElement('canvas');
wheelCanvas.width = wheelCanvas.height = 384;
{
  const g = wheelCanvas.getContext('2d'), n = 384, img = g.createImageData(n, n);
  g.fillStyle = CERA.ink;
  g.fillRect(0, 0, n, n);
  const bg = g.getImageData(0, 0, n, n).data;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (x + y * n) * 4, u = (x + 0.5) / n * 2 - 1, v = 1 - (y + 0.5) / n * 2;
    const r = Math.hypot(u, v) / 0.94;
    if (r > 1) { img.data[i] = bg[i]; img.data[i + 1] = bg[i + 1]; img.data[i + 2] = bg[i + 2]; img.data[i + 3] = 255; continue; }
    const hex = wheelColor(u / 0.94, v / 0.94);
    img.data[i] = parseInt(hex.slice(1, 3), 16); img.data[i + 1] = parseInt(hex.slice(3, 5), 16); img.data[i + 2] = parseInt(hex.slice(5, 7), 16); img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}
const wheelTex = new THREE.CanvasTexture(wheelCanvas);
wheelTex.colorSpace = THREE.SRGBColorSpace;
const WHEEL_SIZE = 0.2;
const wheelPanel = new THREE.Mesh(new THREE.PlaneGeometry(WHEEL_SIZE, WHEEL_SIZE), new THREE.MeshBasicMaterial({ map: wheelTex, toneMapped: false }));
wheelPanel.position.set(PANEL_W / 2 + WHEEL_SIZE / 2 + 0.012, PANEL_H / 2 - WHEEL_SIZE / 2, 0);
wheelPanel.visible = false;
panel3d.add(wheelPanel);
const wheelMark = new THREE.Mesh(new THREE.CircleGeometry(0.009, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
const wheelMarkRing = new THREE.Mesh(new THREE.RingGeometry(0.009, 0.0125, 24), new THREE.MeshBasicMaterial({ color: 0x141210, toneMapped: false }));
wheelMark.position.z = wheelMarkRing.position.z = 0.001;
wheelPanel.add(wheelMark, wheelMarkRing);
const placeWheelAt = (u, v) => {
  wheelMark.position.x = wheelMarkRing.position.x = u * 0.94 * WHEEL_SIZE / 2;
  wheelMark.position.y = wheelMarkRing.position.y = v * 0.94 * WHEEL_SIZE / 2;
};
function placeWheelMark(hex) {
  const [u, v] = wheelSpot(hex);
  placeWheelAt(u, v);
  wheelMark.material.color.set(hex);
}
// El rayo sobre la rueda. Mientras aprietas, el color cambia sin redibujar todo el panel a cada paso.
let wheelSetAt = 0;
function wheelPointer(uv, down) {
  const u = (uv.x * 2 - 1) / 0.94, v = (uv.y * 2 - 1) / 0.94, k = Math.min(1, 1 / (Math.hypot(u, v) || 1));
  if (!down) {
    if (xr.wheelHex) { setColor(xr.wheelHex); xr.wheelHex = null; }
    return;
  }
  const hex = wheelColor(u * k, v * k);
  placeWheelAt(u * k, v * k);
  wheelMark.material.color.set(hex);
  xr.wheelHex = hex;
  const now = performance.now();
  if (now - wheelSetAt > 200) {
    wheelSetAt = now;
    state.color = hex;
    cursor.material.color.set(hex);
  }
}
// Las letras van con la app; el lienzo no las coge solo, hay que pedirlas antes de dibujar.
Promise.all(['500 30px Kanit', '600 30px Kanit', '700 30px Mali'].map((f) => document.fonts.load(f, 'Aก')))
  .then(() => { if (panel3d.visible) drawPanel(); }, () => {});

// Bloque de color: agrupa lo que va junto. Azul: el pincel. Papel: color y capas. Rojo: la obra. Negro: lo técnico.
const panelBlock = (y, h, color) => ({ type: 'block', x: 8, y, w: PW - 16, h, color });
const PANEL_TABS = [[['brush', 'Pincel', CERA.blue], ['shapes', 'Crear', CERA.red], ['tech', 'Técnico', CERA.ink]], [['color', 'Color y capas', CERA.paper], ['obra', 'Obra', CERA.red]]];
const panelTab = ['brush', 'color'];
const PANEL_PAGES = { sonido: buildSoundPage, llamada: buildCallPage, unir: buildMergePage, pincel: buildBrushPage, sellos: buildStampsPage, material: buildMaterialPage, bg: buildBgPage, refs: buildRefPage, anim: buildAnimPage, export: buildExportPage, todo: buildAllPage };
const PAGE_PANE = { export: 1, unir: 1 }; // las demás se abren en la columna izquierda
const PAGE_SPAN = new Set(['pincel', 'refs', 'anim']);
let countedPage = null; // su segundo bloque va en la otra columna
const PANEL_TAB_PAGES = { brush: buildBrushTab, tech: buildTechTab, text: buildTextTab, shapes: buildShapesTab, color: buildColorTab, obra: buildObraTab };
function buildPanel() {
  const W = [];
  const put = (list, pane) => {
    // El último bloque llega hasta abajo: las dos columnas acaban igual.
    const last = list.filter((w) => w.type === 'block').pop();
    if (last) last.h = PANE_H - last.y;
    for (const w of list) { w.x += pane * PW; w.y += TAB_H; }
    W.push(...list);
  };
  const page = PANEL_PAGES[panelPage] ? panelPage : null;
  if (page !== countedPage) noteUse('page:' + (countedPage = page));
  const held = [null, null];
  if (page && PAGE_SPAN.has(page)) {
    const list = PANEL_PAGES[page](), blocks = list.filter((w) => w.type === 'block'), at = list.indexOf(blocks[1]), dy = blocks[1].y - 8;
    const second = list.splice(at);
    for (const w of second) w.y -= dy;
    held[0] = list;
    held[1] = second;
  } else if (page) held[PAGE_PANE[page] || 0] = PANEL_PAGES[page]();
  held.forEach((list, pane) => put(list || PANEL_TAB_PAGES[panelTab[pane]](), pane));
  // Pestañas, encima de cada columna. Pulsar una cierra la página que hubiera abierta en esa columna.
  PANEL_TABS.forEach((tabs, pane) => {
    const room = PW - 16 - (pane ? 176 : 0), tw = (room - 8 * (tabs.length - 1)) / tabs.length;
    tabs.forEach(([id, name, color], i) => W.push({
      type: 'tab', x: pane * PW + 8 + i * (tw + 8), y: 8, w: tw, h: TAB_H - 8, label: name, color,
      active: () => (panelTab[pane] === id || (id === 'shapes' && panelTab[pane] === 'text')) && !held[pane],
      onClick: () => {
        panelTab[pane] = id;
        noteUse(id);
        if (held[pane]) panelPage = 'main';
        if (id === 'text') return openText();
        if (!pane) text.writing = false;
        drawPanel();
      },
    }));
  });
  W.push({ type: 'button', x: CW - 8 - 168, y: 12, w: 168, h: TAB_H - 20, size: 24, label: xr.panelPinned ? 'A la mano' : 'Fijar', onClick: () => pinPanel(!xr.panelPinned) });
  return W;
}
// ---------- Lo que más usas ----------
// Se cuenta solo en estas gafas (o este Mac) y no sale de aquí. Los botones de «Lo que más usas» se fijan
// al abrir la app con lo de las sesiones anteriores: así no cambian de sitio mientras trabajas.
const FAV = {
  ...Object.fromEntries(TOOL_KEYS.map((k) => [k, { label: () => ({ move: 'Mover', grab: 'Arrastrar', smooth: 'Suaviz.' }[k] || label(k)), go: () => choose(k), on: () => state.tool === k && !clayTool }])),
  ...Object.fromEntries(['tool:palillo', 'tool:cuter', 'tool:cuchara', 'tool:dedo', 'tool:rodillo', 'tool:espatula'].map((k) => [k, { label: () => label(k), go: () => choose(k), on: () => clayTool === k }])),
  sym: { label: () => 'Simetría', go: () => choose('sym'), on: () => symOn() },
  'sym:lathe': { label: () => 'Torno', go: () => choose('sym:lathe'), on: () => state.lathe },
  'stroke:sens': { label: () => 'Presión', go: () => choose('stroke:sens'), on: () => state.sens },
  remesh: { label: () => (active.remesh ? 'A vóxel' : 'Remesh'), go: () => choose(active.remesh ? 'voxel' : 'remesh') },
  resDown: { label: () => '− Res', go: () => choose('resDown') },
  resUp: { label: () => '+ Res', go: () => choose('resUp') },
  wire: { label: () => 'Malla', go: () => choose('wire'), on: () => state.wire },
  floor: { label: () => 'Suelo', go: () => choose('floor'), on: () => state.floor },
  text: { label: () => 'Texto', go: () => { noteUse('text'); openText(); } },
  shapes: { label: () => 'Formas', go: () => { noteUse('shapes'); panelTab[0] = 'shapes'; panelPage = 'main'; drawPanel(); macShow('shapeBox'); } },
  escala: { label: () => 'Tamaño normal', go: () => { noteUse('escala'); resetScale(); } },
  traer: { label: () => 'Traer aquí', go: () => { noteUse('traer'); placeWorkspace(true); } },
  ...Object.fromEntries([['pincel', 'Pincel ▸'], ['material', 'Material ▸'], ['bg', 'Fondo ▸'], ['sellos', 'Sellos ▸'], ['anim', 'Animar ▸'], ['refs', 'Importar ▸']]
    .map(([k, l]) => ['page:' + k, { label: () => l, go: () => {
      if (!renderer.xr.isPresenting) { noteUse('page:' + k); return macShow(MAC_PAGE[k]); }
      if (k === 'refs') openRefPage();
      else { panelPage = k; drawPanel(); }
    } }])),
};
// Lo que en las gafas es una página, en el Mac es un trozo del menú: se abre y se lleva a la vista.
const MAC_PAGE = { pincel: 'foldPincel', material: 'material', bg: 'bgRow', sellos: 'btnStamps', anim: 'foldAnim', refs: 'btnImport' };
function macShow(id) {
  const el = $(id);
  if (!el) return;
  for (let d = el; d; d = d.parentElement) if (d.tagName === 'DETAILS') d.open = true;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (id === 'btnStamps') choose('shape:more');
}
uso = (() => { try { return JSON.parse(localStorage.getItem('plastilinaUso')) || {}; } catch { return {}; } })();
const FAV_N = 10, FAV_DEFAULT = ['add', 'remove', 'smooth', 'move', 'grab', 'flatten', 'inflate', 'paint', 'sym', 'page:material'];
const favorites = (() => {
  const ranked = Object.keys(uso).filter((k) => FAV[k] && uso[k] >= 3).sort((a, b) => uso[b] - uso[a]);
  const out = ranked.slice(0, FAV_N);
  for (const k of FAV_DEFAULT) if (out.length < FAV_N && !out.includes(k)) out.push(k);
  return out;
})();
// En el Mac, los mismos favoritos arriba del todo; lo demás va plegado y la app recuerda qué dejaste abierto.
function buildFavRow() {
  favRow = favorites.map((k) => {
    const b = document.createElement('button');
    b.textContent = t(FAV[k].label());
    b.onclick = () => { FAV[k].go(); updateHud(); };
    $('favRow').append(b);
    return [k, b];
  });
  let open = {};
  try { open = JSON.parse(localStorage.getItem('plastilinaAbiertos')) || {}; } catch {}
  document.querySelectorAll('details.fold').forEach((d) => {
    d.open = !!open[d.id];
    d.addEventListener('toggle', () => {
      open[d.id] = d.open;
      try { localStorage.setItem('plastilinaAbiertos', JSON.stringify(open)); } catch {}
    });
  });
}
function paintFavRow() {
  for (const [k, b] of favRow) {
    b.textContent = t(FAV[k].label());
    b.classList.toggle('on', !!FAV[k].on?.());
  }
}
function noteUse(id) {
  id = id === 'voxel' ? 'remesh' : id;
  if (!uso || !FAV[id]) return;
  uso[id] = (uso[id] || 0) + 1;
  clearTimeout(noteUse.t);
  noteUse.t = setTimeout(() => { try { localStorage.setItem('plastilinaUso', JSON.stringify(uso)); } catch {} }, 2000);
}
// La pestaña Pincel: lo justo. Tamaño, fuerza y tus diez botones; el resto en «Todo ▸».
function buildBrushTab() {
  const W = [];
  const M = 32, IW = PW - 2 * M;
  W.push(panelBlock(8, 548, CERA.blue));
  W.push({ type: 'label', x: M, y: 54, head: true, text: label(activeTool()) + (state.invert ? ' ' + t('(invertido)') : ''), size: 50, max: IW * 0.55 });
  W.push({ type: 'label', x: PW - M, y: 54, text: infoText(), align: 'right', size: 22, max: IW * 0.43 });
  W.push({
    type: 'slider', x: M, y: 128, w: IW, h: 30, label: 'Tamaño',
    get: () => radiusToT(state.radius), set: (t) => (state.radius = tToRadius(t)),
    text: () => Math.round(state.radius * 1000) / 10 + '',
  });
  W.push({
    type: 'slider', x: M, y: 208, w: IW, h: 30, label: 'Fuerza',
    get: () => (state.strength - 0.05) / 0.95, set: (t) => (state.strength = 0.05 + t * 0.95),
    text: () => Math.round(state.strength * 100) + '%',
  });
  W.push({ type: 'label', x: M, y: 280, size: 22, text: 'Lo que más usas' });
  const fw = (IW - 4 * 8) / 5;
  favorites.forEach((k, i) => W.push({
    type: 'button', x: M + (i % 5) * (fw + 8), y: 300 + Math.floor(i / 5) * 68, w: fw, h: 58, size: 22, group: 'fav',
    label: FAV[k].label(), active: () => FAV[k].on?.() || false, onClick: FAV[k].go,
  }));
  const tw2 = (IW - 10) / 2;
  W.push({ type: 'button', x: M, y: 450, w: tw2, h: 64, label: 'Todo ▸', size: 28, onClick: () => { panelPage = 'todo'; drawPanel(); } });
  W.push({ type: 'button', x: M + tw2 + 10, y: 450, w: tw2, h: 64, label: 'Tamaño normal', size: 26, onClick: () => { noteUse('escala'); resetScale(); } });
  if (state.lathe) {
    W.push({ type: 'slider', x: M, y: 606, w: IW, h: 28, label: 'Velocidad del torno', get: () => state.latheSpeed / 1.5, set: (v) => (state.latheSpeed = Math.max(0.05, v * 1.5)), text: () => Math.round(state.latheSpeed * 60) + ' rpm' });
  } else if (tut?.active) {
    const bw = (IW - 10) / 2;
    W.push({ type: 'button', x: M, y: 576, w: bw, h: 54, label: 'Saltar paso', size: 24, group: 'tut', onClick: () => { tut.next(); drawPanel(); } });
    W.push({ type: 'button', x: M + bw + 10, y: 576, w: bw, h: 54, label: 'Salir del tutorial', size: 24, group: 'tut', onClick: () => { tut.stop(); drawPanel(); } });
  } else W.push({ type: 'label', x: M, y: 600, size: 20, wrap: IW, text: 'Estos botones se ordenan solos con lo que más usas, cada vez que abres la app.' });
  return W;
}
// Todo lo del pincel, como estaba antes.
function buildAllPage() {
  const W = [];
  const M = 32, IW = PW - 2 * M;
  W.push(panelBlock(8, 548, CERA.blue));
  W.push({ type: 'label', x: M, y: 54, head: true, text: label(activeTool()) + (state.invert ? ' ' + t('(invertido)') : ''), size: 50, max: IW * 0.55 });
  W.push({ type: 'button', x: PW - M - 160, y: 24, w: 160, h: 56, label: '◂ Volver', size: 24, onClick: () => { panelPage = 'main'; drawPanel(); } });
  W.push({
    type: 'slider', x: M, y: 128, w: IW, h: 30, label: 'Tamaño',
    get: () => radiusToT(state.radius), set: (t) => (state.radius = tToRadius(t)),
    text: () => Math.round(state.radius * 1000) / 10 + '',
  });
  W.push({
    type: 'slider', x: M, y: 208, w: IW, h: 30, label: 'Fuerza',
    get: () => (state.strength - 0.05) / 0.95, set: (t) => (state.strength = 0.05 + t * 0.95),
    text: () => Math.round(state.strength * 100) + '%',
  });
  W.push({
    type: 'slider', x: M, y: 288, w: IW - 176, h: 30, label: 'Estabilizar (línea recta)',
    get: () => state.stab, set: (t) => (state.stab = Math.round(t * 20) / 20),
    text: () => (state.stab ? Math.round(state.stab * 100) + '%' : t('no')),
  });
  W.push({ type: 'button', x: PW - M - 160, y: 262, w: 160, h: 58, label: 'Presión', size: 24, group: 'press', active: () => state.sens, onClick: () => choose('stroke:sens') });
  const tw = (IW - 4 * 8) / 5;
  TOOL_KEYS.forEach((tl, i) => W.push({
    type: 'button', x: M + (i % 5) * (tw + 8), y: 340 + Math.floor(i / 5) * 68, w: tw, h: 58, size: 24, group: 'tools',
    label: { move: 'Mover', grab: 'Arrastrar', smooth: 'Suaviz.' }[tl] || label(tl),
    active: () => state.tool === tl, onClick: () => choose(tl),
  }));
  const hw = (IW - 3 * 10) / 4;
  W.push({ type: 'button', x: M, y: 480, w: hw, h: 58, label: 'Traer aquí', size: 24, group: 'nav',
    onClick: FAV.traer.go });
  W.push({ type: 'button', x: M + hw + 10, y: 480, w: hw, h: 58, label: 'Pincel ▸', size: 24, group: 'nav',
    onClick: () => { panelPage = 'pincel'; drawPanel(); } });
  W.push({ type: 'button', x: M + 2 * (hw + 10), y: 480, w: hw, h: 58, label: 'Material ▸', size: 24, group: 'nav',
    onClick: () => { panelPage = 'material'; drawPanel(); } });
  W.push({ type: 'button', x: M + 3 * (hw + 10), y: 480, w: hw, h: 58, label: 'Fondo ▸', size: 24, group: 'nav',
    onClick: () => { panelPage = 'bg'; drawPanel(); } });
  if (state.lathe) {
    W.push({ type: 'slider', x: M, y: 586, w: IW, h: 28, label: 'Velocidad del torno', get: () => state.latheSpeed / 1.5, set: (v) => (state.latheSpeed = Math.max(0.05, v * 1.5)), text: () => Math.round(state.latheSpeed * 60) + ' rpm' });
  } else if (tut?.active) {
    const bw = (IW - 10) / 2;
    W.push({ type: 'button', x: M, y: 556, w: bw, h: 54, label: 'Saltar paso', size: 24, group: 'tut', onClick: () => { tut.next(); drawPanel(); } });
    W.push({ type: 'button', x: M + bw + 10, y: 556, w: bw, h: 54, label: 'Salir del tutorial', size: 24, group: 'tut', onClick: () => { tut.stop(); drawPanel(); } });
  } else W.push({ type: 'button', x: M, y: 556, w: IW, h: 54, label: '▶ Jugar tutorial', size: 28, onClick: startTutorial });
  W.push({ type: 'label', x: M, y: 634, size: 22, text: 'Resolución' });
  const rw = (IW - (RES_STEPS.length - 1) * 6) / RES_STEPS.length;
  RES_STEPS.forEach((n, i) => W.push({
    type: 'button', x: M + i * (rw + 6), y: 650, w: rw, h: 44, label: String(n), plain: true, size: 22, group: 'res',
    active: () => brushRes() === n, onClick: () => setRes(n),
  }));
  return W;
}
const LAYER_ROWS = 4;
let layerTop = null; // la primera capa que se ve en la lista del panel; null = las últimas
const layerFirst = () => Math.max(0, Math.min(layerTop ?? Infinity, layers.length - LAYER_ROWS));
function scrollLayers(dir) {
  const next = Math.max(0, Math.min(layers.length - LAYER_ROWS, layerFirst() + dir));
  if (next === layerFirst()) return;
  layerTop = next;
  sfx.play('dial', { semi: dir < 0 ? 3 : -2, pan: -0.2 });
  drawPanel();
}
function showLayerRow(L) {
  const i = layers.indexOf(L), first = layerFirst();
  if (i >= 0 && i < first) layerTop = i;
  else if (i >= first + LAYER_ROWS) layerTop = i - LAYER_ROWS + 1;
}
function buildColorTab() {
  const W = [];
  const M = 32, IW = PW - 2 * M;
  W.push(panelBlock(8, 616, CERA.paper));
  W.push({ type: 'label', x: M, y: 44, head: true, text: 'COLOR', size: 28 });
  W.push({ type: 'swatch', plus: true, x: PW - M - 48, y: 14, w: 48, h: 48, color: CERA.white, active: () => wheelPanel.visible,
    onClick: () => { wheelPanel.visible = !wheelPanel.visible; if (wheelPanel.visible) placeWheelMark(state.color); } });
  const sw = (IW - 7 * 8) / 8;
  PALETTE.forEach((hex, i) => W.push({
    type: 'swatch', x: M + (i % 8) * (sw + 8), y: 66 + Math.floor(i / 8) * (sw + 8), w: sw, h: sw,
    color: hex, active: () => state.color === hex, onClick: () => setColor(hex),
  }));
  const yl = 278;
  W.push({ type: 'label', x: M, y: yl, head: true, text: 'CAPAS', size: 28 });
  // Quitar pide un segundo toque: dentro de las gafas no hay ventana de confirmar.
  const armed = performance.now() < delLayerUntil;
  W.push({ type: 'button', x: PW - M - 134, y: yl - 26, w: 134, h: 50, label: '+ Capa', size: 22, group: 'lay', onClick: newLayer });
  const many = mergePick.size > 1;
  W.push({ type: 'button', x: PW - M - 134 - 8 - 134, y: yl - 26, w: 134, h: 50, label: armed ? '¿Seguro?' : many ? t('− {0} capas', mergePick.size) : '− Capa', size: 22, group: 'lay', active: () => armed, onClick: () => {
    if (performance.now() < delLayerUntil) { delLayerUntil = 0; deleteLayers(deleteTargets(), false); }
    else {
      delLayerUntil = performance.now() + 3000;
      setTimeout(() => panel3d.visible && drawPanel(), 3050);
    }
    drawPanel();
  } });
  // Con varias elegidas, al lado de borrarlas está unirlas.
  if (mergePick.size > 1) W.push({ type: 'button', x: PW - M - 2 * 134 - 16 - 150, y: yl - 26, w: 150, h: 50, label: t('Unir {0}', mergePick.size), size: 22, group: 'lay', active: () => true, onClick: mergeLayers });
  else W.push({ type: 'button', x: PW - M - 2 * 134 - 16 - 150, y: yl - 26, w: 150, h: 50, label: 'Animar ▸', size: 22, group: 'lay', onClick: () => { panelPage = 'anim'; drawPanel(); } });
  const first = layerFirst();
  layers.slice(first, first + LAYER_ROWS).forEach((L, i) => {
    const y = yl + 36 + i * 60;
    W.push({ type: 'button', x: M, y, w: IW - 96, h: 50, label: `${L.name}  ·  ${L.frames.length > 1 ? t('{0} fot.', L.frames.length) : L.grid.res + '³'}${L.remesh ? '  ⊞' : ''}`, plain: true,
      dot: L.color, size: 22, active: () => L === active, onClick: () => setActive(L) });
    // El círculo de color elige la capa para unirla; se puede pulsar con holgura.
    W.push({ type: 'swatch', x: M + 3, y: y + 1, w: 48, h: 48, color: L.color, active: () => mergePick.has(L), onClick: () => pickForMerge(L) });
    W.push({ type: 'button', x: PW - M - 84, y, w: 84, h: 50, label: L.visible ? 'Ver' : '—', size: 20,
      onClick: () => { L.visible = !L.visible; updateHud(); live.structure(); } });
  });
  const yb = yl + 36 + LAYER_ROWS * 60;
  W.push({ type: 'button', x: M, y: yb, w: 76, h: 50, label: '▲', size: 24, plain: true, group: 'scroll', onClick: () => scrollLayers(-1) });
  W.push({ type: 'button', x: M + 84, y: yb, w: 76, h: 50, label: '▼', size: 24, plain: true, group: 'scroll', onClick: () => scrollLayers(1) });
  W.push({ type: 'label', x: M + 172, y: yb + 25, size: 22, text: `${first + 1}–${Math.min(first + LAYER_ROWS, layers.length)} / ${layers.length}` });
  if (mergePick.size > 1) W.push({ type: 'button', x: PW - M - 240, y: yb, w: 240, h: 50, label: t('Unir {0} capas', mergePick.size), plain: true, size: 24, active: () => true, onClick: mergeLayers });
  else W.push({ type: 'label', x: PW - M - 330, y: yb + 25, size: 20, max: 330, text: 'Toca los círculos para unir o borrar' });
  W.push(panelBlock(632, 60, CERA.red));
  W.push({ type: 'label', x: M, y: 666, head: true, text: t('OBRA: {0}', obraName()) + (obraDirty() ? ' •' : ''), size: 24, max: IW - 190 });
  W.push({ type: 'button', x: PW - M - 170, y: 642, w: 170, h: 46, label: 'Guardar', size: 22, active: () => obraDirty(), onClick: () => saveObra() });
  return W;
}
function buildObraTab() {
  const W = [];
  const M = 32, IW = PW - 2 * M;
  W.push(panelBlock(8, 684, CERA.red));
  W.push({ type: 'label', x: M, y: 48, head: true, text: t('OBRA: {0}', obraName()) + (obraDirty() ? ' •' : ''), size: 30, max: IW });
  const ow = (IW - 2 * 10) / 3;
  [['Guardar', () => saveObra()], ['Nueva', newObra], ['Exportar ▸', () => { exportBase(); panelPage = 'export'; drawPanel(); }]]
    .forEach(([l, f], i) => W.push({ type: 'button', x: M + i * (ow + 10), y: 80, w: ow, h: 62, label: l, size: 24, group: 'obra',
      active: () => i === 0 && obraDirty(), onClick: f }));
  W.push({ type: 'label', x: M, y: 176, head: true, text: 'Obras en las gafas', size: 26 });
  const list = obras.slice(0, 14), cw = (IW - 10) / 2;
  if (!list.length) W.push({ type: 'label', x: M, y: 222, text: 'Aún no has guardado ninguna. Pulsa Guardar.', size: 24, max: IW });
  list.forEach((o, i) => W.push({
    type: 'button', x: M + (i % 2) * (cw + 10), y: 200 + Math.floor(i / 2) * 62, w: cw, h: 54, size: 20, plain: true,
    label: `${o.name} · ${fmtDate(o.date)}`, active: () => o.id === obraId,
    onClick: async () => { await openObra(o.id); drawPanel(); },
  }));
  W.push({ type: 'label', x: M, y: 662, size: 20, max: IW, text: 'Abrir otra guarda antes la actual' });
  return W;
}
// Técnico, por grupos: la malla, lo que se ve, los archivos y los ajustes.
function buildTechTab() {
  const W = [];
  const M = 32, IW = PW - 2 * M;
  W.push(panelBlock(8, 684, CERA.ink));
  const row = (y, title, items, group) => {
    W.push({ type: 'label', x: M, y, head: true, text: title, size: 24 });
    const bw = (IW - (items.length - 1) * 8) / items.length;
    items.forEach(([l, on, go], i) => W.push({ type: 'button', x: M + i * (bw + 8), y: y + 20, w: bw, h: 58, label: l, size: 24, group, active: on || (() => false), onClick: go }));
  };
  const page = (p) => () => { panelPage = p; drawPanel(); };
  row(40, 'Malla', [['− Res', null, () => choose('resDown')], ['+ Res', null, () => choose('resUp')], active.remesh ? ['A vóxel', null, () => choose('voxel')] : ['Remesh', null, () => choose('remesh')], ['Ver malla', () => state.wire, () => choose('wire')]], 'tech1');
  W.push({
    type: 'slider', x: M, y: 176, w: IW, h: 26, label: 'Quads del remesh',
    get: () => (state.quads - 1000) / 59000, set: (t) => (state.quads = Math.round((1000 + t * 59000) / 1000) * 1000),
    text: () => state.quads.toLocaleString(),
  });
  row(236, 'Vista', [['Simetría', () => symOn(), () => choose('sym')], ['Suelo', () => state.floor, () => choose('floor')], ['Material ▸', null, page('material')], ['Fondo ▸', null, page('bg')]], 'tech2');
  row(346, 'Archivos', [['Importar ▸', null, openRefPage], ['A Blender', null, () => choose('export')], ['Exportar ▸', null, () => { exportBase(); panelPage = 'export'; drawPanel(); }]], 'tech3');
  row(456, 'Ajustes', [['Sonido ▸', null, page('sonido')], ['Llamada ▸', null, page('llamada')], ['Tutorial', null, startTutorial]], 'tech4');
  // Idiomas: siempre en español y siempre abajo del todo, para encontrarlo en cualquier idioma.
  W.push({ type: 'label', x: M, y: 566, head: true, text: 'Idiomas', size: 24 });
  const lw = (IW - 2 * 8) / 3;
  [['es', 'Español'], ['en', 'English'], ['th', 'ไทย']].forEach(([l, name], i) => W.push({
    type: 'button', x: M + i * (lw + 8), y: 586, w: lw, h: 56, label: name, plain: true, size: 30,
    active: () => getLang() === l, onClick: () => changeLang(l),
  }));
  W.push({ type: 'label', x: M, y: 668, size: 18, max: IW, text: 'Gatillo derecho = pulsar · clic stick izq. = cerrar · esquinas amarillas = mover el panel' });
  return W;
}
function buildSoundPage() {
  const W = [];
  const M = 32, IW = PW - 2 * M;
  W.push(panelBlock(8, 92, CERA.ink));
  pageHead(W, 'Sonido');
  W.push(panelBlock(108, 300, CERA.paper));
  W.push({
    type: 'slider', x: M, y: 180, w: IW, h: 34, label: 'Sonidos',
    get: () => sfx.volume, set: (v) => sfx.setVolume(Math.round(v * 20) / 20),
    text: () => (sfx.volume ? Math.round(sfx.volume * 100) + '%' : t('no')),
  });
  W.push({ type: 'label', x: M, y: 262, size: 24, text: 'Sonido de Añadir' });
  const sw = (IW - 3 * 8) / 4;
  Object.entries(OPCIONES).forEach(([id, op], i) => W.push({
    type: 'button', x: M + i * (sw + 8), y: 288, w: sw, h: 60, label: op.name, size: 22, group: 'addSound',
    active: () => sfx.addSound === id, onClick: () => { sfx.setAddSound(id); drawPanel(); },
  }));
  return W;
}
const CALL_TEXT = { off: 'Apagada', waiting: 'Esperando al Mac…', connecting: 'Conectando…', connected: 'Conectada' };
// Antes de una unión pesada: reducir o dejarla tal cual.
function buildMergePage() {
  const W = [], plan = mergeAsk;
  const M = 32, IW = PW - 2 * M;
  W.push(panelBlock(8, 92, CERA.ink));
  pageHead(W, plan?.title || 'Unir capas');
  W.push(panelBlock(108, 500, CERA.paper));
  if (!plan) return W;
  W.push({ type: 'label', x: M, y: 150, size: 26, wrap: IW, text: plan.text });
  plan.choices.forEach((o, i) => W.push({ type: 'button', x: M, y: 250 + i * 84, w: IW, h: 72, size: 24, label: plan.label(o, i), active: () => !i, onClick: () => plan.go(o) }));
  W.push({ type: 'label', x: M, y: 530, size: 22, wrap: IW, text: plan.note });
  return W;
}
function buildCallPage() {
  const W = [];
  const M = 32, IW = PW - 2 * M, bw = (IW - 10) / 2;
  W.push(panelBlock(8, 92, CERA.ink));
  pageHead(W, 'Llamada');
  W.push(panelBlock(108, 500, CERA.paper));
  W.push({ type: 'button', x: M, y: 132, w: bw, h: 64, label: 'Ver llamada', size: 26, active: () => call.on, onClick: () => setCall(!call.on) });
  W.push({ type: 'button', x: M + bw + 10, y: 132, w: bw, h: 64, label: 'Traer aquí', size: 26, onClick: () => placeCall() });
  W.push({ type: 'slider', x: M, y: 260, w: IW, h: 34, label: 'Tamaño', get: () => (call.size - 0.3) / 1.2, set: (v) => { call.size = 0.3 + v * 1.2; sizeCall(); }, text: () => Math.round(call.size * 100) + ' cm' });
  W.push({ type: 'label', x: M, y: 330, size: 26, text: t(CALL_TEXT[call.rx?.state || 'off']) + (call.on && !server.ok ? ' · ' + t('sin Mac') : '') });
  W.push({ type: 'label', x: M, y: 380, size: 22, wrap: IW, text: 'En el Mac abre Llamada VR y elige la ventana de Discord. Las gafas y el Mac deben estar en la misma Wi-Fi.' });
  W.push({ type: 'label', x: M, y: 470, size: 22, wrap: IW, text: 'Solo llega la imagen: la voz sigue sonando en el Mac o en el móvil.' });
  return W;
}
// Cabecera de las páginas de dentro: título y volver, sobre el bloque del que vienen.
function pageHead(W, title) {
  W.push({ type: 'label', x: 32, y: 54, head: true, text: title, size: 44, max: PW - 240 });
  W.push({ type: 'button', x: PW - 32 - 160, y: 24, w: 160, h: 56, label: '◂ Volver', size: 24,
    onClick: () => { panelPage = 'main'; drawPanel(); } });
}
// Página del material: tres retoques suaves de cómo se ve la plastilina.
function buildMaterialPage() {
  const W = [];
  const M = 32, IW = PW - 2 * M;
  W.push(panelBlock(8, 92, CERA.blue));
  pageHead(W, 'Material');
  W.push(panelBlock(108, 450, CERA.paper));
  LOOK_SLIDERS.forEach(([key, text, min, max], i) => W.push({
    type: 'slider', x: M, y: 170 + i * 100, w: IW, h: 34, label: text,
    get: () => (state.look[key] - min) / (max - min), set: (v) => changeLook(key, min + v * (max - min)),
    text: () => Math.round(((state.look[key] - min) / (max - min)) * 100) + '%',
  }));
  W.push({ type: 'button', x: M, y: 464, w: IW, h: 66, label: 'Volver a la plastilina normal', size: 26,
    onClick: () => { for (const k in LOOK_DEFAULT) changeLook(k, LOOK_DEFAULT[k]); drawPanel(); } });
  return W;
}
const LOOK_SLIDERS = [['rough', 'Rugosidad', 0.15, 1], ['wax', 'Translucidez', 0, 0.6], ['shine', 'Brillo', 0, 1]];
// Página del pincel: forma, borde, textura y trazo en azul; simetría en papel.
function buildBrushPage() {
  const W = [];
  const M = 32, IW = PW - 2 * M;
  const yEnd = 640;
  W.push(panelBlock(8, yEnd - 8, CERA.blue));
  pageHead(W, 'Pincel');
  let y = 116;
  const row = (title, items, h = 66) => {
    W.push({ type: 'label', x: M, y, head: true, text: title, size: 26 });
    const w = (IW - (items.length - 1) * 10) / items.length;
    items.forEach(([id, text], i) => W.push({ type: 'button', x: M + i * (w + 10), y: y + 22, w, h, label: text, size: 26, group: title,
      active: () => optionOn(id), onClick: () => choose(id) }));
    y += h + 62;
  };
  row('FORMA', [...['sphere', 'cube', 'pyramid'].map((sh) => ['shape:' + sh, `${SHAPE_ICON[sh]}  ${label('shape:' + sh)}`]), ['shape:more', '+']]);
  row('BORDE', [['edge:soft', 'Suave'], ['edge:even', 'Normal'], ['edge:hard', 'Duro']]);
  row('TEXTURA', [['tex:plain', 'Liso'], ['tex:rough', 'Rugoso'], ['tex:dots', 'Puntos'], ['tex:stripes', 'Rayas'], ['tex:scales', 'Escamas']]);
  y -= 16;
  W.push({ type: 'button', x: M, y, w: IW, h: 44, size: 22, label: 'Textura en todas', active: () => optionOn('tex:all'), onClick: () => choose('tex:all') });
  y += 74;
  row('TRAZO', [['stroke:free', 'Libre'], ['stroke:line', 'Recto']]);
  W.push(panelBlock(yEnd + 8, 848, CERA.paper));
  y = yEnd + 52;
  row('SIMETRÍA', [['sym:x', 'X'], ['sym:y', 'Y'], ['sym:z', 'Z'], ['sym:radial', 'Radial'], ['sym:reset', 'Centrar']]);
  row('COPIAS DE LA RADIAL', [3, 4, 5, 6, 8].map((n) => ['radial:' + n, String(n)]));
  row('TORNO', [['sym:lathe', 'Girar']]);
  W.push({ type: 'slider', x: M, y: y + 32, w: IW, h: 30, label: 'Velocidad', get: () => state.latheSpeed / 1.5, set: (v) => (state.latheSpeed = Math.max(0.05, v * 1.5)), text: () => Math.round(state.latheSpeed * 60) + ' rpm' });
  W.push({ type: 'label', x: M, y: y + 88, size: 22, wrap: IW, text: 'Torno: deja la mano quieta y la pieza se forma al girar. Mueve el eje con la bola amarilla.' });
  y += 170;
  W.push({ type: 'label', x: M, y: y - 8, size: 20, max: IW, text: 'Simetría: coge la bola amarilla con el gatillo para moverla y girarla.' });
  return W;
}
// Página de los sellos: una rejilla de dibujitos; primero el botón de guardar tu capa.
function buildStampsPage() {
  const W = [];
  const M = 32, IW = PW - 2 * M, cols = 7, gap = 8, size = (IW - (cols - 1) * gap) / cols;
  const list = [...STAMPS.values()];
  const rows = Math.ceil(list.length / cols);
  const yGrid = 196, yText = yGrid + rows * (size + gap) + 22, yEnd = yText + (ownStamps.length ? 164 : 84);
  W.push(panelBlock(8, yEnd, CERA.blue));
  pageHead(W, 'Sellos');
  W.push({ type: 'button', x: M, y: 108, w: IW, h: 66, size: 26, label: 'Guardar mi capa como sello', onClick: () => choose('stamp:save') });
  list.forEach((s, i) => W.push({ type: 'thumb', x: M + (i % cols) * (size + gap), y: yGrid + Math.floor(i / cols) * (size + gap), w: size, h: size,
    img: stampThumbs.get(s.id), active: () => optionOn(s.id), onClick: () => choose(s.id) }));
  W.push({ type: 'label', x: M, y: yText, size: 22, wrap: IW, text: 'Sellos: pulsa una vez y queda puesto. El tamaño es el del pincel.' });
  if (ownStamps.length) W.push({ type: 'button', x: M, y: yText + 64, w: IW, h: 66, size: 24, label: 'Borrar mi último sello', onClick: () => choose('stamp:delete') });
  return W;
}
// Página del fondo: colores planos, luz de lugares reales y su giro.
function buildBgPage() {
  const W = [];
  const M = 32, IW = PW - 2 * M, bw = (IW - 10) / 2;
  W.push(panelBlock(8, 684, CERA.paper));
  pageHead(W, 'Fondo');
  if (bg.arSession) W.push({ type: 'button', x: PW - 32 - 160 - 190, y: 24, w: 180, h: 56, size: 22, label: 'Ver la sala', active: () => bg.ar, onClick: () => setBg('room') });
  const list = (title, items, y) => {
    W.push({ type: 'label', x: M, y, head: true, size: 26, text: title });
    items.forEach(([id, name, c], i) => W.push({ type: 'button', x: M + (i % 2) * (bw + 10), y: y + 22 + Math.floor(i / 2) * 70, w: bw, h: 60, size: 26, plain: true,
      group: 'bg', label: name, dot: c[0] === '#' ? c : undefined, active: () => bg.id === id && !bg.ar, onClick: () => setBg(id) }));
  };
  list('Color plano', BG_COLORS, 118);
  list('Luz de un lugar real', BG_HDRI, 312);
  W.push({ type: 'slider', x: M, y: 544, w: IW, h: 30, label: 'Girar la luz', get: () => bg.rot, set: (v) => { bg.rot = v; bgChanged(); }, text: () => Math.round(bg.rot * 360) + '°' });
  W.push({ type: 'slider', x: M, y: 624, w: IW, h: 30, label: 'Cuánto se ve el fondo', get: () => (bg.show - 0.1) / 0.9, set: (v) => { bg.show = 0.1 + v * 0.9; bgChanged(); }, text: () => Math.round(bg.show * 100) + '%' });
  return W;
}
// Página de exportar: formato, quads y a dónde.
function buildExportPage() {
  const W = [];
  const M = 32, IW = PW - 2 * M, fw = (IW - 20) / 3;
  W.push(panelBlock(8, 490, CERA.red));
  pageHead(W, 'Exportar');
  EXPORT_FORMATS.forEach((f, i) => W.push({ type: 'button', x: M + i * (fw + 10), y: 120, w: fw, h: 70, size: 30, group: 'fmt', label: f.toUpperCase(),
    active: () => state.exportFmt === f, onClick: () => { state.exportFmt = f; exportUi(); drawPanel(); } }));
  W.push({ type: 'slider', x: M, y: 268, w: IW, h: 30, label: 'Quads al exportar', get: () => state.exportT, set: (v) => { state.exportT = v; exportUi(); }, text: exportQuadsText });
  W.push({ type: 'label', x: M, y: 334, size: 24, max: IW, text: t('Ahora: {0} quads', (state.exportNow || 0).toLocaleString()) });
  const bw = (IW - 10) / 2;
  W.push({ type: 'button', x: M, y: 372, w: bw, h: 70, size: 26, group: 'to', label: 'Compartir', onClick: () => shareModel() });
  W.push({ type: 'button', x: M + bw + 10, y: 372, w: bw, h: 70, size: 26, group: 'to', label: 'A Blender', onClick: () => choose('export') });
  return W;
}
// Página de animación: la tira de fotogramas de la capa activa y los mandos para reproducir.
// Animación, en sencillo: a la izquierda Play y la velocidad; a la derecha los fotogramas en una lista,
// como las capas. Cada fotograma es una copia de la capa que se retoca.
const FRAME_ROWS = 7;
function buildAnimPage() {
  const W = [];
  const M = 32, IW = PW - 2 * M;
  const n = active.frames.length, i = frameIndex();
  W.push(panelBlock(8, 684, CERA.paper));
  pageHead(W, 'Animación');
  W.push({ type: 'label', x: M, y: 122, size: 26, max: IW, text: active.name + '  ·  ' + t('Fotograma {0} de {1}', i + 1, n) });
  const bw = (IW - 2 * 10) / 3;
  W.push({ type: 'button', x: M, y: 150, w: bw, h: 110, size: 72, label: '◂', group: 'tr', onClick: () => stepFrame(-1) });
  W.push({ type: 'button', x: M + bw + 10, y: 150, w: bw, h: 110, size: 36, label: anim.playing ? 'Pausa' : 'Play', group: 'tr', active: () => anim.playing, onClick: () => setPlaying(!anim.playing) });
  W.push({ type: 'button', x: M + 2 * (bw + 10), y: 150, w: bw, h: 110, size: 72, label: '▸', group: 'tr', onClick: () => stepFrame(1) });
  W.push({ type: 'slider', x: M, y: 330, w: IW, h: 30, label: 'Velocidad',
    get: () => (anim.fps - 2) / 22, set: (v) => { anim.fps = Math.round(2 + v * 22); live.anim(); }, text: () => t('{0} por segundo', anim.fps) });
  W.push({ type: 'button', x: M, y: 392, w: IW, h: 62, size: 26, label: 'Ver el de antes y el de después', active: () => anim.onion,
    onClick: () => { anim.onion = !anim.onion; paintOnion(); drawPanel(); } });
  ['1. Pulsa «+ Fotograma»: es una copia de lo que ves.', '2. Cambia algo: mueve, añade, quita.', '3. Repite y dale a Play.']
    .forEach((text, k) => W.push({ type: 'label', x: M, y: 510 + k * 44, size: 24, max: IW, text }));
  if (anim.mb > 200) W.push({ type: 'label', x: M, y: 656, size: 20, max: IW, text: t('La animación ocupa ≈ {0} MB', anim.mb) });
  // Los fotogramas, en lista. Sigue al que estás viendo.
  W.push(panelBlock(816, 684, CERA.blue));
  W.push({ type: 'label', x: M, y: 860, head: true, size: 30, text: 'FOTOGRAMAS' });
  const hw = 170;
  W.push({ type: 'button', x: PW - M - hw, y: 834, w: hw, h: 54, size: 22, label: 'Borrar', group: 'fr', onClick: deleteFrame });
  W.push({ type: 'button', x: PW - M - 2 * hw - 8 - 60, y: 834, w: hw + 60, h: 54, size: 22, label: '+ Fotograma', group: 'fr', active: () => true, onClick: () => addFrame(true) });
  const first = Math.max(0, Math.min(n - FRAME_ROWS, i - 3));
  for (let k = first; k < Math.min(n, first + FRAME_ROWS); k++) {
    W.push({ type: 'button', x: M, y: 908 + (k - first) * 70, w: IW, h: 60, size: 26, plain: true, dot: active.color, label: t('Fotograma {0}', k + 1),
      active: () => frameIndex() === k, onClick: () => { if (anim.playing) setPlaying(false); goToFrame(active, active.frames[k]); frameToast(); } });
  }
  W.push({ type: 'label', x: M, y: 1420, size: 20, max: IW, text: 'Stick derecho ←/→ cambia de fotograma · B = Play' });
  return W;
}
function openRefPage() { panelPage = 'refs'; drawPanel(); refreshMacRefs(); }
// Página de la referencia: dentro de las gafas no se pueden elegir archivos, así que se elige de la lista.
function buildRefPage() {
  const W = [];
  const M = 32, IW = PW - 2 * M, names = refNames().slice(0, 6);
  const yList = 184;
  W.push(panelBlock(8, 684, CERA.ink));
  pageHead(W, 'Referencia');
  W.push({ type: 'button', x: M, y: 104, w: IW, h: 64, size: 26, label: 'Sacar foto', onClick: () => takeRefPhoto() });
  if (!names.length) W.push({ type: 'label', x: M, y: yList + 22, size: 24, wrap: IW, text: 'Aún no hay modelos. Importa uno fuera de VR, o déjalo en la carpeta referencias del Mac.' });
  names.forEach((n, i) => W.push({ type: 'button', x: M, y: yList + i * 72, w: IW, h: 60, size: 26, plain: true, label: n,
    active: () => ref.name === n, onClick: () => showRef(n) }));
  // Los controles van en la otra columna.
  W.push(panelBlock(8, 684, CERA.ink));
  const yCtl = 80;
  W.push({ type: 'slider', x: M, y: yCtl, w: IW, h: 30, label: 'Tamaño de la referencia', get: () => refSizeToT(ref.size), set: (v) => setRefSize(tToRefSize(v)), text: () => '×' + ref.size.toFixed(2) });
  W.push({ type: 'slider', x: M, y: yCtl + 88, w: IW, h: 30, label: 'Transparencia', get: () => ref.opacity / 0.9, set: (v) => setRefOpacity(v * 0.9), text: () => Math.round(ref.opacity * 100) + '%' });
  const bw = (IW - 10) / 2;
  W.push({ type: 'button', x: M, y: yCtl + 140, w: bw, h: 58, size: 24, group: 'rf', label: refRoot.visible ? 'Ocultar' : 'Mostrar', onClick: () => setRefShown(!refRoot.visible) });
  W.push({ type: 'button', x: M + bw + 10, y: yCtl + 140, w: bw, h: 58, size: 24, group: 'rf', label: 'Quitar de la lista', onClick: () => { if (ref.name) dropRef(ref.name); } });
  ['Coge la bola azul con el gatillo para colocarla.', 'Solo se usa para mirar: no se esculpe ni se exporta.'].forEach((text, i) =>
    W.push({ type: 'label', x: M, y: yCtl + 228 + i * 44, size: 22, max: IW, text }));
  return W;
}

// Cambiar de idioma: el HTML se traduce solo; los lienzos se redibujan.
function changeLang(l) {
  setLang(l, () => {
    updateHud();
    drawHud3D();
    if (panel3d.visible) drawPanel();
    if (tut.index >= 0) tut.draw();
    if (SPECTATOR) setSpecBg(spec.bg);
    if (!webcam?.rec && SPECTATOR) $('recBtn').textContent = t('● Grabar');
    document.querySelectorAll('[data-lang]').forEach((b) => b.classList.toggle('on', b.dataset.lang === getLang()));
  });
}

function drawPanel() {
  panel.draw();
  panelTex.needsUpdate = true;
}

const xr = {
  bPrev: false, frameFlick: 0, flowerHand: 'right', flowerR: new THREE.Vector3(), flowerL: new THREE.Vector3(), dupPrev: false,
  panelPinned: false, panelDrag: null, left: null, menuPrev: false, menuOpen: false, menuMode: null, stroking: false, grabMode: 'none',
  xPrev: false, yPrev: false, lStickPrev: false, rStickPrev: false, trigPrev: false, flick: 0,
};
const grabOffset = new THREE.Matrix4();
const tmpM = new THREE.Matrix4(), tmpS = new THREE.Vector3();
const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vT0 = new THREE.Vector3();
const scale0 = { d: 1, s: 1, mid: new THREE.Vector3(), pos: new THREE.Vector3(), dir: new THREE.Vector3(), quat: new THREE.Quaternion(), turn: new THREE.Quaternion() };
const panelRay = new THREE.Raycaster();
let hudMsgShown = false;

function openFlower(tipW, mode) {
  xr.menuOpen = true;
  xr.menuMode = mode;
  xr.menuOpenedFrame = true; // el mismo clic que lo abre no debe cerrarlo
  sfx.play('open');
  // La flor sale de la cabeza del mando, un poco por detrás de él visto desde tus ojos.
  // Justo detrás de la punta, vista desde tus ojos: la punta queda en el centro de la flor.
  const head = renderer.xr.getCamera().getWorldPosition(vA);
  const at = vB.copy(tipW).addScaledVector(vT0.copy(tipW).sub(head).normalize(), 0.04);
  flower.open(at, head, optionOn, tipW, state.color);
  xr.flowerHand = 'right';
  xr.flowerR.copy(tipW);
  xr.flowerL.set(0, -99, 0);
}
function closeFlower(pick) {
  xr.menuOpen = false;
  sfx.play('close');
  const h = flower.highlight, done = h === flower.done;
  flower.close();
  if (pick && !done) pickFlower(h);
}
function pickFlower(h) {
  if (!h || h === 'shape:more') return;
  sfx.play(h === 'color:wheel' ? 'plip' : 'thock');
  if (h === 'color:wheel') {
    choose('paint');
    setColor(flower.wheelHex);
    return;
  }
  // Las texturas se eligen en el pétalo de Inflar, y las formas y sellos en el de Añadir.
  if (h.startsWith('tex:')) choose('inflate');
  if (h.startsWith('shape:') || STAMPS.has(h)) choose('add');
  choose(h);
}

// Espacio de trabajo: grande, a tu alrededor y delante de ti. Mientras no empiezas a esculpir te
// sigue con la vista (suave); en cuanto tocas algo se queda quieto para no marear.
const WS = { scale: 1.3, dist: 0.6, drop: 0.25 };
// Cuánto se puede acercar o alejar el modelo. Antes iba de ×0,05 a ×8 y era fácil perderse: con el modelo
// diminuto los trazos salían enormes (y pesaban), y muy de cerca se veían los vóxeles.
const SCALE_MIN = 0.3, SCALE_MAX = 4;
const scaleUI = { last: 0, notch: true, hinted: false };
// Al cambiar el tamaño: cuánto es (en un cartel), un toque al pasar por el tamaño normal y, muy de
// cerca, un aviso de que la resolución se va a notar.
function scaleFeel(gpL, gpR) {
  const s = model.scale.x;
  if (Math.abs(s - scaleUI.last) < 0.004) return;
  scaleUI.last = s;
  const notch = Math.abs(s - WS.scale) < 1e-6;
  if (notch && !scaleUI.notch) {
    gpL?.hapticActuators?.[0]?.pulse?.(0.4, 25);
    gpR?.hapticActuators?.[0]?.pulse?.(0.4, 25);
    sfx.play('thock', { vol: 0.6 });
  }
  scaleUI.notch = notch;
  toast(notch ? t('Tamaño normal') : t('Tamaño ×{0}', (s / WS.scale).toLocaleString(getLang(), { maximumFractionDigits: 1 })), 1200);
  if (s / WS.scale > 2 && !scaleUI.hinted && active.grid.res < 256) {
    scaleUI.hinted = true;
    setTimeout(() => toast('Muy de cerca se ven los vóxeles: + Res da más detalle', 3500), 1300);
  }
}
function resetScale() {
  model.scale.setScalar(renderer.xr.isPresenting ? WS.scale : 1);
  if (renderer.xr.isPresenting) placeWorkspace(true);
  scaleUI.notch = true;
  model.updateMatrixWorld();
  toast('Tamaño normal');
}
const wsHead = new THREE.Vector3(), wsDir = new THREE.Vector3(), wsPos = new THREE.Vector3(), wsQ = new THREE.Quaternion();
const wsUp = new THREE.Vector3(0, 1, 0);
function placeWorkspace(snap, dt = 0) {
  const cam = renderer.xr.getCamera();
  cam.getWorldPosition(wsHead);
  if (wsHead.lengthSq() < 1e-6) return; // aún no hay pose de cabeza
  cam.getWorldDirection(wsDir);
  wsDir.y = 0;
  if (wsDir.lengthSq() < 0.04) return; // mirando recto arriba o abajo: se queda como está
  wsDir.normalize();
  wsPos.copy(wsHead).addScaledVector(wsDir, WS.dist);
  wsPos.y -= WS.drop;
  wsQ.setFromAxisAngle(wsUp, Math.atan2(-wsDir.x, -wsDir.z));
  const first = xr.followSnap || snap;
  const k = first ? 1 : 1 - Math.exp(-dt * 3);
  model.position.lerp(wsPos, k);
  model.quaternion.slerp(wsQ, k);
  xr.followSnap = false;
  if (snap) xr.follow = false;
  model.updateMatrixWorld();
}

// Mover el stick cambia un valor poco a poco: suena como una ruedecita con muescas, más agudo o más grave.
const dialAt = {};
function dialFeel(key, v, base, k) {
  if (Math.abs(Math.log(v / (dialAt[key] ??= v))) < 0.08) return;
  dialAt[key] = v;
  sfx.play('dial', { semi: THREE.MathUtils.clamp(k * Math.log2(v / base), -9, 9), pan: 0.2 });
  xr.gpR?.hapticActuators?.[0]?.pulse?.(0.12, 8);
}

function xrFrame(dt) {
  let right = null, left = null;
  for (const c of ctrls) {
    c.updateMatrixWorld(true);
    const src = c.userData.src;
    if (!src || !src.gamepad) continue;
    const rig = rigs[src.handedness];
    if (rig) {
      rig.group.visible = !src.hand; // con las manos desnudas no hay mando que enseñar
      rig.update(src.gamepad, dt);
    }
    if (src.handedness === 'left') left = c;
    else right = c;
  }
  xr.left = left;
  if (left && hud3d.parent !== left) left.add(hud3d);
  if (left && !xr.panelPinned && panel3d.parent !== left) panelToHand(left);
  hud3d.visible = !panel3d.visible || xr.panelPinned; // con el panel en la mano, el aviso de herramienta lo taparía
  if (right && ray.parent !== right) right.add(ray);
  const gpL = left?.userData.src.gamepad, gpR = right?.userData.src.gamepad;
  xr.gpR = gpR;

  if (xr.follow) placeWorkspace(false, dt);
  // El suelo va contigo para que no se acabe, pero sus líneas se quedan quietas en la habitación.
  renderer.xr.getCamera().getWorldPosition(vA);
  floor.position.set(vA.x, 0, vA.z);

  // Grips: uno agarra y mueve el modelo (palanca adelante/atrás = más grande/más pequeño);
  // los dos a la vez lo escalan (separando las manos), lo giran y lo mueven.
  const gL = !!gpL?.buttons[1]?.pressed, gR = !!gpR?.buttons[1]?.pressed;
  const mode = gL && gR ? 'scale' : gL ? 'grabL' : gR ? 'grabR' : 'none';
  if (mode !== 'none') {
    xr.follow = false;
    tut?.emit('turn', dt);
  }
  if (mode !== xr.grabMode) {
    xr.grabMode = mode;
    model.updateMatrixWorld();
    if (mode === 'grabL' || mode === 'grabR') {
      const c = mode === 'grabL' ? left : right;
      grabOffset.copy(c.matrixWorld).invert().multiply(model.matrixWorld);
    } else if (mode === 'scale') {
      vA.setFromMatrixPosition(left.matrixWorld);
      vB.setFromMatrixPosition(right.matrixWorld);
      scale0.d = vA.distanceTo(vB) || 1;
      scale0.s = model.scale.x;
      scale0.mid.addVectors(vA, vB).multiplyScalar(0.5);
      scale0.pos.copy(model.position);
      scale0.dir.subVectors(vB, vA).normalize();
      scale0.quat.copy(model.quaternion);
    }
  }
  if (mode === 'grabL' || mode === 'grabR') {
    const c = mode === 'grabL' ? left : right;
    const stick = (mode === 'grabL' ? gpL : gpR).axes[3] || 0;
    if (Math.abs(stick) > 0.2) {
      // Se escala alrededor de la mano que agarra.
      const f = THREE.MathUtils.clamp(Math.exp(-stick * dt * 1.5), SCALE_MIN / model.scale.x, SCALE_MAX / model.scale.x);
      grabOffset.premultiply(tmpM.makeScale(f, f, f));
    }
    tmpM.multiplyMatrices(c.matrixWorld, grabOffset).decompose(model.position, model.quaternion, model.scale);
  } else if (mode === 'scale') {
    vA.setFromMatrixPosition(left.matrixWorld);
    vB.setFromMatrixPosition(right.matrixWorld);
    let s = THREE.MathUtils.clamp((scale0.s * vA.distanceTo(vB)) / scale0.d, SCALE_MIN, SCALE_MAX);
    if (Math.abs(s / WS.scale - 1) < 0.06) s = WS.scale; // una muesca en el tamaño normal
    model.scale.setScalar(s);
    // La línea entre las dos manos es como un eje que agarras: lo que gira ella, gira el modelo.
    scale0.turn.setFromUnitVectors(scale0.dir, vT0.subVectors(vB, vA).normalize());
    model.quaternion.copy(scale0.turn).multiply(scale0.quat);
    const midNow = vT0.addVectors(vA, vB).multiplyScalar(0.5);
    model.position.copy(scale0.pos).sub(scale0.mid).multiplyScalar(s / scale0.s).applyQuaternion(scale0.turn).add(midNow);
  }
  model.updateMatrixWorld();
  if (mode !== 'none') scaleFeel(gpL, gpR);

  // Mando izquierdo: clic stick = panel · stick ←/→ = deshacer/rehacer · stick ↑/↓ = fuerza
  //                  gatillo = suavizar · X (mantener) = invertir · Y = deshacer
  if (gpL) {
    // Agarrando una capa, el gatillo izquierdo deja una copia donde está; si no, suaviza.
    const lTrigger = (gpL.buttons[0]?.value || 0) > 0.5;
    if (lTrigger && !xr.dupPrev && moveOp.L) {
      duplicateHeld();
      gpL.hapticActuators?.[0]?.pulse?.(0.7, 50);
    }
    xr.dupPrev = lTrigger;
    const soft = lTrigger && !moveOp.L;
    if (soft !== state.smoothHold) { state.smoothHold = soft; updateHud(); }
    const inv = !!gpL.buttons[4]?.pressed, Y = !!gpL.buttons[5]?.pressed;
    if (inv !== state.invert) { state.invert = inv; updateHud(); }
    if (Y && !xr.yPrev && !xr.menuOpen) undo();
    xr.yPrev = Y;
    const lStick = !!gpL.buttons[3]?.pressed;
    if (lStick && !xr.lStickPrev) {
      panel3d.visible = !panel3d.visible;
      sfx.play(panel3d.visible ? 'open' : 'close', { pan: -0.2 });
      if (panel3d.visible) drawPanel();
    }
    xr.lStickPrev = lStick;
    const grabbing = mode !== 'none'; // con grip, el stick es para escalar
    const sx = grabbing ? 0 : gpL.axes[2] || 0, sy = grabbing ? 0 : gpL.axes[3] || 0;
    if (xr.flick === 0 && Math.abs(sx) > 0.75 && Math.abs(sx) > Math.abs(sy)) {
      xr.flick = sx < 0 ? -1 : 1;
      sx < 0 ? undo() : redo();
      gpL.hapticActuators?.[0]?.pulse?.(0.4, 30);
    } else if (xr.flick !== 0 && Math.abs(sx) < 0.3) xr.flick = 0;
    if (Math.abs(sy) > 0.4 && Math.abs(sy) > Math.abs(sx)) {
      state.strength = THREE.MathUtils.clamp(state.strength - sy * dt * 0.8, 0.05, 1);
      dialFeel('strength', state.strength, 0.6, 6);
      updateHud();
    }
  }

  cursor.visible = false;
  ray.visible = false;
  if (!gpR) return;

  brushObj = right;
  const tipW = right.localToWorld(TIP.clone());
  const tipL = model.worldToLocal(tipW.clone()).toArray();
  const trig = gpR.buttons[0]?.value || 0;
  const trigDown = trig > 0.5;
  const ax = gpR.axes[2] || 0, ay = gpR.axes[3] || 0;

  // Panel izquierdo abierto: el mando derecho apunta con un rayo.
  if (panel3d.visible && !xr.stroking) {
    panelRay.ray.origin.setFromMatrixPosition(right.matrixWorld);
    panelRay.ray.direction.set(0, 0, -1).transformDirection(right.matrixWorld);
    // Tirando de una esquina: el panel va con el mando y se queda donde lo sueltes.
    if (xr.panelDrag) {
      if (trigDown) {
        tmpM.multiplyMatrices(right.matrixWorld, xr.panelDrag).decompose(panel3d.position, panel3d.quaternion, tmpS);
        // Joystick adelante / atrás: más grande / más pequeño.
        if (Math.abs(ay) > 0.2) panel3d.scale.setScalar(THREE.MathUtils.clamp(panel3d.scale.x * Math.exp(-ay * dt * 1.2), 0.4, 2.5));
        xr.trigPrev = true;
        return;
      }
      xr.panelDrag = null;
      sfx.play('drop', { pan: -0.2 });
      drawPanel();
    }
    // Las esquinas son pequeñas de ver, pero se cogen con holgura: con el rayo o acercando la punta.
    const gripHit = panelGrips.find((g) => panelRay.ray.distanceToPoint(g.getWorldPosition(vT0)) < 0.012 * panel3d.scale.x);
    const near = panelGrips.find((g) => tipW.distanceTo(g.getWorldPosition(vT0)) < 0.03);
    panelGrips.forEach((g) => g.scale.setScalar(g === gripHit || g === near ? 1.6 : 1));
    if ((gripHit || near) && trigDown && !xr.trigPrev) {
      xr.panelPinned = true;
      scene.attach(panel3d);
      panel3d.updateMatrixWorld();
      xr.panelDrag = right.matrixWorld.clone().invert().multiply(panel3d.matrixWorld);
      sfx.play('grab', { pan: -0.2 });
      gpR.hapticActuators?.[0]?.pulse?.(0.5, 30);
      xr.trigPrev = true;
      return;
    }
    if (gripHit) {
      ray.visible = true;
      ray.scale.z = panelRay.ray.origin.distanceTo(gripHit.getWorldPosition(vT0));
      xr.trigPrev = trigDown;
      return;
    }
    const wheelHit = wheelPanel.visible && panelRay.intersectObject(wheelPanel, false)[0];
    if (wheelHit) {
      ray.visible = true;
      ray.scale.z = wheelHit.distance;
      wheelPointer(wheelHit.uv, trigDown);
      if (panel.pointer(null, null, trigDown)) drawPanel();
      xr.trigPrev = trigDown;
      return;
    }
    if (xr.wheelHex) wheelPointer({ x: 0.5, y: 0.5 }, false);
    const hit = panelRay.intersectObject(panel3d, false)[0];
    if (hit) {
      ray.visible = true;
      ray.scale.z = hit.distance;
      if (panel.pointer(hit.uv.x * CW, (1 - hit.uv.y) * CH, trigDown)) drawPanel();
      // Apuntando a la columna de las capas, el stick derecho sube y baja por la lista.
      xr.layerFlick = Math.max(0, (xr.layerFlick || 0) - dt);
      if (hit.uv.x > 0.5 && panelTab[1] === 'color' && panelPage === 'main' && Math.abs(ay) > 0.5 && !xr.layerFlick) {
        scrollLayers(ay > 0 ? 1 : -1);
        xr.layerFlick = 0.2;
      }
      xr.trigPrev = trigDown;
      return;
    }
    if (panel.pointer(null, null, trigDown)) drawPanel();
  }

  // La flor: clic en el stick derecho (o mantener A/B). Eliges con el stick o moviendo la mano.
  const rStick = !!gpR.buttons[3]?.pressed;
  // Animando, B reproduce; la flor sigue en A y en el clic del stick.
  const btnB = !!gpR.buttons[5]?.pressed, bPlays = animating() && !xr.menuOpen;
  const ab = !!(gpR.buttons[4]?.pressed || (btnB && !bPlays));
  if (bPlays && btnB && !xr.bPrev) setPlaying(!anim.playing);
  xr.bPrev = btnB;
  if (!xr.menuOpen) {
    if (rStick && !xr.rStickPrev) openFlower(tipW, 'toggle');
    else if (ab && !xr.menuPrev) openFlower(tipW, 'hold');
  }
  if (xr.menuOpen) {
    // Manda lo último que se ha movido: el stick o una de las dos puntas. Una mano quieta nunca le
    // quita el sitio a la otra, y lo elegido con el stick se queda aunque lo sueltes.
    const eye = renderer.xr.getCamera().getWorldPosition(vA);
    const tipLeft = left ? left.localToWorld(TIP.clone()) : null;
    if (tipLeft && tipLeft.distanceTo(xr.flowerL) > 0.015) {
      xr.flowerL.copy(tipLeft);
      if (flower.isOver(eye, tipLeft)) xr.flowerHand = 'left';
    }
    if (tipW.distanceTo(xr.flowerR) > 0.015) {
      xr.flowerR.copy(tipW);
      xr.flowerHand = 'right';
    }
    if (Math.hypot(ax, ay) > 0.5) xr.flowerHand = 'stick';
    const hand = xr.flowerHand;
    if (hand === 'left' && !flower.isOver(eye, tipLeft)) xr.flowerHand = 'right';
    const moved = xr.flowerHand === 'stick' ? Math.hypot(ax, ay) > 0.5 && flower.hoverDir(ax, ay)
      : xr.flowerHand === 'left' ? flower.hoverRay(eye, tipLeft) : flower.hoverRay(eye, tipW);
    if (moved && flower.highlight) {
      (xr.flowerHand === 'left' ? gpL : gpR).hapticActuators?.[0]?.pulse?.(0.25, 12);
      // Cada pétalo su nota: pasar por la flor suena a instrumento, no a un tic repetido.
      const id = flower.highlight;
      let note = 0;
      for (let i = 0; i < id.length; i++) note = (note * 31 + id.charCodeAt(i)) % 997;
      sfx.play('tick', { semi: PENTATONIC[note % 5] + (note % 2) * 12 - 3, pan: xr.flowerHand === 'left' ? -0.2 : 0.2 });
    }
    flower.update(dt);
    // Un rato encima: se pone, y la flor sigue abierta para cambiar de idea.
    if (flower.fired) {
      gpR.hapticActuators?.[0]?.pulse?.(0.5, 40);
      pickFlower(flower.fired);
      flower.fired = null;
      flower.refresh();
    }
    // Se cierra al soltar el botón con el que la abriste, con otro clic del stick o con cualquier botón.
    const lTrig = (gpL?.buttons[0]?.value || 0) > 0.5, lX = !!gpL?.buttons[4]?.pressed, lY = !!gpL?.buttons[5]?.pressed;
    const pressed = !xr.menuOpenedFrame && ((trigDown && !xr.trigPrev) || (lTrig && !xr.lTrigPrev) || (lX && !xr.lXPrev) || (lY && !xr.lYPrev));
    xr.lTrigPrev = lTrig;
    xr.lXPrev = lX;
    xr.lYPrev = lY;
    if (xr.menuMode === 'hold' ? !ab || pressed : pressed || (ab && !xr.menuPrev) || (rStick && !xr.rStickPrev && xr.menuOpenedFrame !== true)) closeFlower(true);
    xr.menuOpenedFrame = false;
    xr.rStickPrev = rStick;
    xr.menuPrev = ab;
    xr.trigPrev = trigDown;
    return;
  }
  xr.rStickPrev = rStick;
  xr.menuPrev = ab;
  xr.trigPrev = trigDown;

  // Animando, stick derecho ←/→ = fotograma anterior/siguiente; al final crea una copia.
  if (animating() && !state.lathe && !moveOp.L && !gR) {
    if (xr.frameFlick === 0 && Math.abs(ax) > 0.75 && Math.abs(ax) > Math.abs(ay)) {
      xr.frameFlick = ax < 0 ? -1 : 1;
      stepFrame(xr.frameFlick, true);
      gpR.hapticActuators?.[0]?.pulse?.(0.4, 30);
    } else if (xr.frameFlick !== 0 && Math.abs(ax) < 0.3) xr.frameFlick = 0;
  }
  // Stick derecho ↑/↓ = tamaño del pincel (o de la capa agarrada con Mover).
  if (Math.abs(ay) > 0.2 && moveOp.L) scaleMove(Math.exp(-ay * dt * 1.2));
  else if (Math.abs(ay) > 0.2 && !gR) {
    state.radius = clampRadius(state.radius * (1 - ay * dt * 1.5));
    dialFeel('radius', state.radius, 0.025, -7);
    drawHud3D();
  }
  cursor.position.fromArray(tipL);
  cursor.scale.setScalar(state.radius);
  updateCursorShape();
  cursor.visible = true;
  if (trig > 0.08) xr.follow = false;
  // La bola de la simetría: si aprietas el gatillo sobre ella, la llevas tú en vez de esculpir.
  if (xr.symGrab) {
    if (trig > 0.08) moveSymWithHand(right, gpR);
    else { xr.symGrab = false; setSymBallHot(false); }
    cursor.visible = false;
    return;
  }
  // Los tiradores de una forma se cogen con la punta, antes que esculpir.
  if (!xr.refGrab && shapeXR(tipW, trig, gpR)) {
    cursor.visible = false;
    return;
  }
  // La bola azul de la referencia se coge igual.
  if (xr.refGrab) {
    if (trig > 0.08) {
      ctrlLocal.copy(model.matrixWorld).invert().multiply(right.matrixWorld);
      tmpM.multiplyMatrices(ctrlLocal, refGrabOff).decompose(refRoot.position, refRoot.quaternion, tmpS);
    } else { xr.refGrab = false; saveRefState(); }
    cursor.visible = false;
    return;
  }
  if (refRoot.visible && !xr.stroking && !moveOp.L && trig > 0.08 && tipW.distanceTo(refBall.getWorldPosition(vT0)) < 0.05) {
    xr.refGrab = true;
    refRoot.updateMatrix();
    refGrabOff.copy(ctrlLocal.copy(model.matrixWorld).invert().multiply(right.matrixWorld)).invert().multiply(refRoot.matrix);
    gpR.hapticActuators?.[0]?.pulse?.(0.5, 25);
    cursor.visible = false;
    return;
  }
  // Con el torno, el stick derecho a los lados cambia la velocidad.
  if (state.lathe && Math.abs(ax) > 0.3 && Math.abs(ax) > Math.abs(ay)) state.latheSpeed = THREE.MathUtils.clamp(state.latheSpeed + ax * dt * 0.6, 0.05, 1.5);
  const overBall = symOn() && !xr.stroking && !moveOp.L && tipW.distanceTo(symBall.getWorldPosition(vT0)) < 0.05;
  setSymBallHot(overBall);
  if (overBall && trig > 0.08) {
    xr.symGrab = true;
    symFrame.updateMatrix();
    symGrabOff.copy(ctrlLocal.copy(model.matrixWorld).invert().multiply(right.matrixWorld)).invert().multiply(symFrame.matrix);
    gpR.hapticActuators?.[0]?.pulse?.(0.5, 25);
    cursor.visible = false;
    return;
  }
  if (state.tool === 'move') {
    xrMove(right, gpR, tipL, trigDown);
    return;
  }
  if (trig > 0.08) {
    if (!xr.stroking) {
      beginStroke();
      xr.stroking = true;
    }
    const q = stabilize(tipL);
    cursor.position.fromArray(q);
    applyAt(q, dt, 0.3 + 0.7 * trig);
    if (strokeRadius !== null) cursor.scale.setScalar(strokeRadius);
    gpR.hapticActuators?.[0]?.pulse?.(0.05 * trig, 16);
  } else {
    if (xr.stroking) endStroke();
    xr.stroking = false;
    rope.visible = false;
  }
}

// Gatillo con Mover: agarra la capa que toca el cursor y la lleva con la mano (posición y giro).
const ctrlLocal = new THREE.Matrix4();
let latheDepth = null;
const symGrabOff = new THREE.Matrix4(), refGrabOff = new THREE.Matrix4();
function moveSymWithHand(right, gp) {
  ctrlLocal.copy(model.matrixWorld).invert().multiply(right.matrixWorld);
  tmpM.multiplyMatrices(ctrlLocal, symGrabOff).decompose(symFrame.position, symFrame.quaternion, tmpS);
  const snapped = snapSymFrame();
  if (snapped && !xr.symSnapped) {
    gp.hapticActuators?.[0]?.pulse?.(0.35, 18);
    sfx.play('thock', { vol: 0.7 });
  }
  xr.symSnapped = snapped;
  rebuildSym();
}
function xrMove(right, gp, tipL, down) {
  ctrlLocal.copy(model.matrixWorld).invert().multiply(right.matrixWorld);
  if (down && !moveOp.L && !xr.moveHeld) {
    xr.moveHeld = true;
    let best = null, bestD = state.radius;
    for (const L of layers) {
      if (!L.visible) continue;
      const q = toGrid(L.f, tipL);
      // Las letras y formas son finas: se cogen con 3 cm de margen.
      const d = paramLive(L) ? paramDist(L, tipL) - 0.03 : L.grid.sample(q[0], q[1], q[2]) * L.f.s;
      if (d < bestD) { bestD = d; best = L; }
    }
    if (!best) {
      toast('Acerca el cursor a una capa para agarrarla', 1500);
      return;
    }
    beginMove(best);
    moveOp.p0.fromArray(tipL);
    moveOp.start.copy(ctrlLocal).invert();
    gp.hapticActuators?.[0]?.pulse?.(0.6, 40);
  }
  if (!down) {
    xr.moveHeld = false;
    if (moveOp.L) { endMove(); gp.hapticActuators?.[0]?.pulse?.(0.3, 30); }
    return;
  }
  if (moveOp.L) setMoveMatrix(new THREE.Matrix4().multiplyMatrices(ctrlLocal, moveOp.start));
}

// ---------- Espejo en directo (gafas -> Mac) ----------
// Quien esculpe (en las gafas) manda cada pincelada; la página "?ver" las reproduce.
const live = {
  hub: null,
  structTimer: 0,
  get emitting() { return !SPECTATOR && (renderer.xr.isPresenting || FORCE_EMIT); },

  brush(L, tool, a, b, r, s, inv, dt, paint, o) {
    if (!this.emitting) return;
    this.hub.send({ t: 'b', l: L.id, tool, a, b, r, s, inv, dt, paint, o });
  },
  // Deshacer/rehacer: se mandan los bloques restaurados.
  patch(L, keys) {
    if (!this.emitting) return;
    const g = L.grid, items = [], parts = [];
    for (const bi of keys) {
      const d = g.bricks[bi], c = g.colors[bi];
      items.push({ bi, f: g.fill[bi], d: !!d, c: !!c });
      if (d) parts.push(d.slice().buffer);
      if (c) parts.push(c.slice().buffer);
    }
    this.hub.sendBlob('patch', pack({ l: L.id, n: g.n, items }, parts));
  },
  // Por dónde va la animación. Es un mensaje pequeño: el espejo lleva su propio reloj al reproducir.
  anim() {
    if (!this.emitting) return;
    this.hub.send({ t: 'anim', f: anim.frame, play: anim.playing, fps: anim.fps });
  },
  // Capa movida: el espejo la mueve igual, sin volver a mandar toda la obra.
  move(L, f) {
    if (!this.emitting) return;
    this.hub.send({ t: 'mv', l: L.id, f: L.frames.indexOf(f), m: Array.from(f.voxels.matrix.elements) });
  },
  // Fotograma nuevo o borrado: el espejo hace lo mismo, sin volver a mandar toda la obra.
  frameOp(L, op, from, at) {
    if (!this.emitting) return;
    this.hub.send({ t: 'fr', l: L.id, op, from, at });
  },
  // Cambios de estructura (capas, resolución, remesh...): estado completo, agrupado.
  structure() {
    if (!this.emitting) return;
    clearTimeout(this.structTimer);
    this.structTimer = setTimeout(() => this.snapshot(), 250);
  },
  async snapshot() {
    if (!server.ok) return; // sin Mac no hace falta empaquetar la obra entera
    if (this.snapBusy) { this.snapAgain = true; return; }
    this.snapBusy = true;
    await this.hub.sendBlob('snap', packScene());
    this.snapBusy = false;
    if (this.snapAgain) { this.snapAgain = false; this.snapshot(); }
  },
  pose() {
    if (!this.emitting) return;
    const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
    const tr = (o) => {
      o.updateMatrixWorld();
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      o.matrixWorld.decompose(p, q, s);
      return [...p.toArray(), ...q.toArray()];
    };
    const hands = ctrls.map((c) => (c.userData.src ? tr(c) : null));
    this.hub.setPose({
      t: 'p', head: tr(cam), hands,
      model: [...model.position.toArray(), ...model.quaternion.toArray(), model.scale.x],
      cursor: cursor.visible ? [...cursor.position.toArray(), state.radius, '#' + cursor.material.color.getHexString()] : null,
      bg: bg.ar ? 'ar' : 'vr',
    });
  },
};

// Lado espectador: aplica los mensajes en orden (los binarios se descargan antes de seguir).
const inbox = [];
let inboxBusy = false;
async function onLiveMessage(m) {
  if (m.t === 'rtc') return call.rx?.signal(m);
  if (!SPECTATOR) {
    if (m.t === 'hello' && live.emitting && !live.snapBusy) live.snapshot();
    // La calibración de la webcam se sigue desde dentro de las gafas.
    if (m.t === 'cal' && live.emitting) {
      if (m.key) toast(t(m.key, ...(m.args || [])), 6000);
      if (m.buzz) ctrls.forEach((c) => c.userData.src?.gamepad?.hapticActuators?.[0]?.pulse?.(0.8, 150));
    }
    return;
  }
  if (m.t === 'p') { spectatorPose(m); return; }
  inbox.push(m);
  if (inboxBusy) return;
  inboxBusy = true;
  while (inbox.length) {
    const msg = inbox.shift();
    try {
      await applyRemote(msg);
    } catch (e) {
      console.error('espejo', e);
    }
  }
  inboxBusy = false;
}

async function applyRemote(m) {
  if (m.t === 'b') {
    if (!synced) return;
    const L = layerById(m.l);
    if (!L) return;
    L.fit(m.a, m.b, m.r);
    const res = L.grid.applyBrush(m.tool, m.a, m.b, m.r, m.s, m.inv, m.dt, null, m.paint, stampOpts(m.o));
    if (res) L.markDirty(res.lo, res.hi);
  } else if (m.t === 'bg') {
    bg.rot = m.rot;
    bg.show = m.show;
    setBg(m.id);
  } else if (m.t === 'mv') {
    const L = synced && layerById(m.l);
    if (!L) return;
    if (L.frames[m.f]) L.setPlace(L.frames[m.f], new THREE.Matrix4().fromArray(m.m));
  } else if (m.t === 'anim') {
    if (!synced) return;
    Object.assign(anim, { frame: m.f, playing: m.play, fps: m.fps });
    showFrames();
  } else if (m.t === 'fr') {
    const L = synced && layerById(m.l);
    if (!L) return;
    if (m.op === 'del') {
      const f = L.frames[m.at];
      if (f && L.frames.length > 1) { L.removeFrame(f); L.disposeFrame(f); }
    } else if (L.frames[m.from]) {
      L.insertFrame(m.op === 'copy' ? L.copyFrame(L.frames[m.from]) : L.frameFromGrid(L.grid.blank()), m.at);
    }
    showFrames();
  } else if (m.t === 'look') {
    setLook(m.look);
  } else if (m.t === 'blob') {
    const buf = await fetchBlob(m.id);
    if (m.kind === 'snap') applySnapshot(buf);
    else if (m.kind === 'patch' && synced) applyPatch(buf);
  }
}

// Escena completa (todas las capas) en un binario: espejo y autoguardado.
function packScene() {
  const meta = { active: active.id, look: state.look, bg: { id: bg.id, rot: bg.rot, show: bg.show }, layers: [], anim: { frame: anim.frame, fps: anim.fps, playing: anim.playing } };
  const parts = [];
  for (const L of layers) {
    const s = L.frames.length > 1 ? SDFGrid.serializeFrames(L.frames.map((f) => f.grid)) : L.grid.serialize();
    const lm = { id: L.id, name: L.name, color: L.color, visible: L.visible, grid: s.meta, places: L.frames.map((f) => (f.moved ? Array.from(f.voxels.matrix.elements) : null)) };
    parts.push(...s.parts);
    if (L.text) lm.text = L.text;
    if (L.shape) lm.shape = L.shape;
    if (L.remesh) {
      const d = L.remesh.data;
      lm.remesh = { nv: d.positions.length, nq: d.quads.length, bake: L.remesh.bake ? L.remesh.bake.size : 0 };
      parts.push(d.positions.slice().buffer, d.colors.slice().buffer, d.quads.slice().buffer);
    }
    meta.layers.push(lm);
  }
  return pack(meta, parts);
}

let synced = false;
function applySnapshot(buf) {
  const { meta, off: start } = unpack(buf);
  let off = start;
  layers.forEach((L) => L.dispose());
  layers = [];
  for (const lm of meta.layers) {
    const fr = lm.grid.frames ? SDFGrid.deserializeFrames(lm.grid, buf, off) : null;
    const { grid, off: o2 } = fr ? { grid: fr.grids[0], off: fr.off } : SDFGrid.deserialize(lm.grid, buf, off);
    off = o2;
    const L = new Layer(grid.n, 'empty', { id: lm.id, name: lm.name, color: lm.color, visible: lm.visible, grid });
    L.flush();
    // El resto de fotogramas se malla poco a poco, sin congelar la pantalla al abrir.
    if (fr) fr.grids.slice(1).forEach((g, i) => L.insertFrame(L.frameFromGrid(g), i + 1));
    lm.places?.forEach((m, i) => { if (m && L.frames[i]) L.setPlace(L.frames[i], new THREE.Matrix4().fromArray(m)); });
    if (lm.text) L.text = lm.text;
    if (lm.shape) L.shape = lm.shape;
    if (lm.remesh) {
      const { nv, nq } = lm.remesh;
      const positions = new Float32Array(buf.slice(off, off + nv * 4)); off += nv * 4;
      const colors = new Float32Array(buf.slice(off, off + nv * 4)); off += nv * 4;
      const quads = new Uint32Array(buf.slice(off, off + nq * 4)); off += nq * 4;
      L.setRemesh({ positions, colors, quads });
      // Las texturas no se guardan (pesan mucho): se vuelven a hornear al abrir.
      if (lm.remesh.bake) {
        const d = L.remesh.data;
        L.busy = true;
        bakeRemesh(L, d, L.version, lm.remesh.bake).catch(() => {}).finally(() => { L.busy = false; updateHud(); });
      }
    }
    layers.push(L);
  }
  active = layerById(meta.active) || layers[0];
  onionFrames = [];
  if (SPECTATOR && meta.bg) {
    bg.rot = meta.bg.rot;
    bg.show = meta.bg.show;
    setBg(meta.bg.id);
  }
  Object.assign(anim, { frame: meta.anim?.frame || 0, fps: meta.anim?.fps || 8, acc: 0, playing: SPECTATOR && !!meta.anim?.playing });
  showFrames();
  setLook(meta.look || LOOK_DEFAULT);
  syncLookInputs();
  synced = true;
  if (SPECTATOR) $('specStatus').textContent = t('En directo');
}

function applyPatch(buf) {
  const { meta, off: start } = unpack(buf);
  const L = layerById(meta.l);
  if (!L || L.grid.n !== meta.n) return;
  let off = start;
  const rec = new Map();
  for (const it of meta.items) {
    let d = null, c = null;
    if (it.d) { d = new Float32Array(buf.slice(off, off + 2048)); off += 2048; }
    if (it.c) { c = new Uint8Array(buf.slice(off, off + 2048)); off += 2048; }
    rec.set(it.bi, { d, f: it.f, c });
  }
  const { lo, hi } = L.grid.restoreBricks(rec);
  if (rec.size) L.markDirty(lo, hi);
}

// ---------- Modo espectador (Mac) ----------
const avatar = new THREE.Group();
const headMesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.17, 0.09, 0.1),
  new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.3 }),
);
const handMeshes = [controllerModel(), controllerModel()];
avatar.add(headMesh, ...handMeshes);
const spec = { view: 'gafas', bg: 'oscuro', smooth: 0.2, orbitT: 0, lastPose: null, vertical: false };
const BGS = { oscuro: 0x15171c, croma: 0x00ff00, blanco: 0xf4f4f2, negro: 0x000000 };

// Cámara externa (webcam o iPhone) con la escultura encima; ver camara.js.
const webcam = SPECTATOR ? createWebcam({ renderer, scene, camera, toast, api: API, onLayoutReset: fitWindow,
  notify: (key, args, buzz) => live.hub.send({ t: 'cal', key, args, buzz }) }) : null;

function spectatorPose(m) {
  spec.lastPose = m;
  webcam.push(m);
  // Con la webcam, la pose se aplica con retraso en spectatorFrame.
  if (spec.view !== 'webcam') applyPose(m);
}
function applyPose(m) {
  const [x, y, z, qx, qy, qz, qw, s] = m.model;
  model.position.set(x, y, z);
  model.quaternion.set(qx, qy, qz, qw);
  model.scale.setScalar(s);
  headMesh.position.fromArray(m.head, 0);
  headMesh.quaternion.fromArray(m.head, 3);
  m.hands.forEach((h, i) => {
    handMeshes[i].visible = !!h;
    if (h) { handMeshes[i].position.fromArray(h, 0); handMeshes[i].quaternion.fromArray(h, 3); }
  });
  cursor.visible = !!m.cursor;
  if (m.cursor) {
    cursor.position.fromArray(m.cursor, 0);
    cursor.scale.setScalar(m.cursor[3]);
    cursor.material.color.set(m.cursor[4]);
  }
}

function spectatorKey(e) {
  const k = e.key.toLowerCase();
  if (k === '1') setSpecView('gafas');
  else if (k === '2') setSpecView('libre');
  else if (k === '3') setSpecView('giro');
  else if (k === 'f') setSpecBg();
  else if (k === 'h') $('spec').classList.toggle('hidden');
  else if (k === 'm') { state.wire = !state.wire; layers.forEach((L) => L.setWire(state.wire)); }
  else if (k === '4') setSpecView('webcam');
  else if (k === 'r') toggleRecord();
  else if (k === 'v') setFormat(!spec.vertical);
  else if (spec.view === 'webcam' && webcam.nudge(e)) e.preventDefault();
}
async function setSpecView(v) {
  if (v === 'webcam' && !webcam.active) {
    if (!(await webcam.start($('camSel').value))) return;
    await fillCams();
  } else if (v !== 'webcam' && webcam.active) {
    webcam.stop();
    setSpecBg(spec.bg);
  }
  spec.view = v;
  controls.enabled = v === 'libre';
  headMesh.visible = v === 'libre';
  $('camSec').classList.toggle('hidden', v !== 'webcam');
  $('cropRow').classList.toggle('hidden', v !== 'webcam' || !spec.vertical);
  if (v === 'webcam') {
    webcam.layout();
  } else if (v !== 'gafas') {
    controls.target.copy(model.position);
    camera.fov = 40;
  } else camera.fov = 75;
  camera.updateProjectionMatrix();
  document.querySelectorAll('#spec [data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
}
// Perfil de grabación: horizontal, o vertical para redes (bandas negras alrededor).
function setFormat(vertical) {
  if (webcam.rec) { toast('No se puede cambiar el formato mientras grabas'); return; }
  spec.vertical = webcam.vertical = vertical;
  try { localStorage.setItem('plastilinaFormato', vertical ? 'v' : 'h'); } catch {}
  document.body.classList.toggle('vertical', vertical);
  document.querySelectorAll('#spec [data-format]').forEach((b) => b.classList.toggle('on', (b.dataset.format === 'v') === vertical));
  $('cropRow').classList.toggle('hidden', spec.view !== 'webcam' || !vertical);
  if (webcam.active) webcam.layout();
  else fitWindow();
  warnFollow();
}
function warnFollow() {
  if (webcam.active && spec.vertical && webcam.follow && !webcam.calib) toast('Calibra la cámara para que el plano pueda seguir el casco', 5000);
}
function setSpecBg(name) {
  const names = Object.keys(BGS);
  spec.bg = name || names[(names.indexOf(spec.bg) + 1) % names.length];
  if (!webcam.active) scene.background = new THREE.Color(BGS[spec.bg]);
  $('specBg').textContent = t('Fondo: {0}', t(spec.bg));
}

async function fillCams() {
  const sel = $('camSel'), cur = sel.value;
  const cams = await webcam.devices();
  sel.innerHTML = cams.map((c, i) => `<option value="${c.deviceId}">${c.label || t('Cámara {0}', i + 1)}</option>`).join('');
  const active = webcam.stream?.getVideoTracks()[0]?.getSettings().deviceId;
  sel.value = active || cur || sel.value;
}
async function toggleRecord() {
  const b = $('recBtn');
  if (webcam.rec) {
    b.textContent = t('Guardando…');
    await webcam.stopRecord();
    b.textContent = t('● Grabar');
    b.classList.remove('rec');
    return;
  }
  if (!(await webcam.record({ mic: $('recMic').checked }))) return;
  b.textContent = t('■ Parar');
  b.classList.add('rec');
}
function recTimer() {
  const r = webcam.rec;
  if (!r) return;
  const s = Math.floor((performance.now() - r.t0) / 1000);
  $('recBtn').textContent = t('■ Parar {0}', `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} · ${(r.bytes / 1048576).toFixed(0)} MB`);
}

function spectatorFrame(dt) {
  const p = spec.lastPose;
  recTimer();
  if (spec.view === 'webcam') {
    const d = webcam.delayed();
    if (d) applyPose(d);
    webcam.applyCamera();
    webcam.followPose(d, dt);
    handMeshes.forEach((h, i) => (h.visible = webcam.showCtrls && !!d?.hands[i]));
    return;
  }
  if (spec.view === 'gafas' && p) {
    // Cámara = tu cabeza, suavizada para que el vídeo no tiemble.
    const k = 1 - Math.pow(spec.smooth, dt * 10);
    camera.position.lerp(new THREE.Vector3().fromArray(p.head, 0), k);
    camera.quaternion.slerp(new THREE.Quaternion().fromArray(p.head, 3), k);
  } else if (spec.view === 'giro') {
    spec.orbitT += dt * 0.25;
    const r = 1.4 * model.scale.x + 0.4;
    camera.position.set(
      model.position.x + Math.sin(spec.orbitT) * r,
      model.position.y + 0.25 * model.scale.x + 0.1,
      model.position.z + Math.cos(spec.orbitT) * r,
    );
    camera.lookAt(model.position);
  } else controls.update();
}

if (SPECTATOR) {
  document.body.classList.add('spectator');
  scene.add(avatar);
  model.position.set(0, 1.1, -0.6);
  model.scale.setScalar(0.7);
  camera.position.set(0, 1.5, 0.3);
  camera.lookAt(model.position);
  controls.target.copy(model.position);
  setSpecView('gafas');
  setSpecBg('oscuro');
  document.querySelectorAll('#spec [data-view]').forEach((b) => (b.onclick = () => setSpecView(b.dataset.view)));
  $('specBg').onclick = () => setSpecBg();
  $('specHide').onclick = () => $('spec').classList.add('hidden');
  const cal = calibUI();
  $('camSel').onchange = async () => { if (webcam.active) { await webcam.start($('camSel').value); webcam.layout(); } };
  $('camCal').onclick = async () => {
    await webcam.calibrate(cal);
    $('camCtrl').classList.toggle('on', webcam.showCtrls);
    $('camDelay').value = webcam.delay;
    $('camDelayV').textContent = webcam.delay + ' ms';
  };
  $('camCtrl').onclick = () => { webcam.showCtrls = !webcam.showCtrls; $('camCtrl').classList.toggle('on', webcam.showCtrls); };
  $('camDelay').value = webcam.delay;
  $('camDelayV').textContent = webcam.delay + ' ms';
  $('camDelay').oninput = (e) => { webcam.setDelay(+e.target.value); $('camDelayV').textContent = e.target.value + ' ms'; };
  $('recBtn').onclick = toggleRecord;
  document.querySelectorAll('#spec [data-format]').forEach((b) => (b.onclick = () => setFormat(b.dataset.format === 'v')));
  $('camCrop').value = webcam.cropX * 100;
  $('camCrop').oninput = (e) => webcam.setCrop(e.target.value / 100);
  const showFollow = () => {
    $('camFollow').classList.toggle('on', webcam.follow);
    $('camFollowHands').classList.toggle('on', webcam.followHands);
    $('camFollowHands').disabled = !webcam.follow;
    $('cropManual').classList.toggle('hidden', webcam.follow);
    $('camCrop').value = webcam.cropX * 100;
  };
  $('camFollow').onclick = () => { webcam.setFollow(!webcam.follow); showFollow(); warnFollow(); };
  $('camFollowHands').onclick = () => { webcam.setFollowHands(!webcam.followHands); showFollow(); };
  showFollow();
  let savedFormat = 'h';
  try { savedFormat = localStorage.getItem('plastilinaFormato') || 'h'; } catch {}
  setFormat(savedFormat === 'v');
  fillCams();
}

live.hub = new Live(onLiveMessage);

// ---------- La llamada: una pantalla flotante con la ventana que manda el Mac ----------
const call = { on: false, size: 0.7, placed: false, rx: null, screen: null, tex: null };
function setCall(on) {
  call.on = on;
  if (on && !call.rx) {
    call.rx = new Receptor(live.hub, callChanged);
    call.tex = new THREE.VideoTexture(call.rx.video);
    call.tex.colorSpace = THREE.SRGBColorSpace;
    const plane = new THREE.PlaneGeometry(1, 1);
    call.screen = new THREE.Group();
    const back = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ color: 0x141210 }));
    back.position.z = -0.002;
    back.name = 'back';
    const front = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ map: call.tex, toneMapped: false }));
    front.name = 'front';
    call.screen.add(back, front);
    call.screen.visible = false;
    scene.add(call.screen);
  }
  if (on) call.rx.start();
  else call.rx?.stop();
  callChanged();
}
function callChanged() {
  const showing = call.on && call.rx?.state === 'connected';
  if (call.screen) {
    if (showing && !call.placed) placeCall();
    call.screen.visible = showing;
    sizeCall();
  }
  if (panelPage === 'llamada') drawPanel();
}
function sizeCall() {
  if (!call.screen) return;
  const v = call.rx.video, h = call.size * ((v.videoHeight || 9) / (v.videoWidth || 16));
  const front = call.screen.getObjectByName('front'), back = call.screen.getObjectByName('back');
  front.scale.set(call.size, h, 1);
  back.scale.set(call.size + 0.03, h + 0.03, 1);
}
const callHead = new THREE.Vector3(), callDir = new THREE.Vector3();
function placeCall() {
  if (!call.screen) return;
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  cam.getWorldPosition(callHead);
  cam.getWorldDirection(callDir);
  callDir.y = 0;
  if (callDir.lengthSq() < 0.04) callDir.set(0, 0, -1);
  callDir.normalize();
  call.screen.position.copy(callHead).addScaledVector(callDir, 1.2);
  call.screen.position.y += 0.12;
  call.screen.lookAt(callHead);
  call.placed = true;
}
// Al (re)conectar se ha podido perder algo: el espejo vuelve a pedir la escena entera.
live.hub.onOpen = () => {
  if (SPECTATOR) {
    synced = false;
    $('specStatus').textContent = t('Esperando a las gafas…');
    live.hub.send({ t: 'hello' });
  } else live.structure();
};
// Las gafas pueden entrar más tarde que el espejo: se insiste hasta tener la escena.
if (SPECTATOR) setInterval(() => { if (server.ok && !synced && !inboxBusy) live.hub.send({ t: 'hello' }); }, 3000);
server.listeners.push((ok) => {
  if (!SPECTATOR && !ok) toast('Sin conexión con el Mac: sigues trabajando y se guarda en las gafas');
});
checkServer();
if (FORCE_EMIT) setTimeout(() => live.structure(), 500);

// ---------- Bucle ----------
const clock = new THREE.Clock();
let poseT = 0;
renderer.setAnimationLoop(() => {
  const frameT0 = performance.now();
  const dt = Math.min(clock.getDelta(), 0.05);
  updateLathe(dt);
  updateAnim(dt);
  tutFrame(dt);
  if (SPECTATOR) {
    spectatorFrame(dt);
  } else if (renderer.xr.isPresenting) {
    xrFrame(dt);
    if (hudMsgShown !== performance.now() < hudMsgUntil) {
      hudMsgShown = !hudMsgShown;
      drawHud3D();
    }
  } else {
    controls.update();
    if (radialOpen && radial.tick()) radial.draw(state, infoText());
    brushObj = camera;
    if (moveOp.L && moveOp.mode !== 'wheel') dragMoveDesktop();
    const airOk = state.tool === 'add' && !state.invert && !state.smoothHold;
    let hit = (mouse.inside || sculpting) && !radialOpen ? pickLocal(airOk) : null;
    if (sculpting) hit = strokePoint(hit);
    updateCursorShape();
    cursor.visible = !!hit;
    if (hit && sculpting) hit = stabilize(hit);
    else rope.visible = false;
    if (hit) {
      cursor.position.set(hit[0], hit[1], hit[2]);
      cursor.scale.setScalar(state.radius);
      if (sculpting) applyAt(hit, dt);
    }
  }
  syncCursorCopies();
  syncSymBall();
  floor.visible = state.floor;
  poseT += dt;
  if (poseT > 1 / 30) { poseT = 0; live.pose(); }
  mergeFrame(dt);
  textFrame(dt);
  shapeFrame();
  // Re-mallado con presupuesto de tiempo: la capa activa primero, el resto después.
  // En el casco cada imagen tiene unos 13 ms: el remallado no puede comérselos todos.
  const inXR = renderer.xr.isPresenting;
  // En las gafas, lo que ya ha gastado el pincel en esta imagen se descuenta: entre los dos no pasan de
  // unos 9 ms, que es lo que deja libre una imagen a 72 Hz. Así no hay tirones al esculpir.
  const spent = performance.now() - frameT0;
  if (active.dirty.size) {
    active.flush(inXR ? Math.max(2.5, 9 - spent) : 30);
    if (active.frames.length > 1) paintOnion();
  }
  if (!inXR || performance.now() - frameT0 < 10) for (const L of layers) if (L !== active && L.dirty.size) { L.flush(inXR ? 2 : 8); if (inXR) break; }
  for (const L of layers) if (L.frames.length > 1 && L.flushHidden(inXR ? 3 : 8)) {
    if (L === active) paintOnion();
    break;
  }
  renderer.render(scene, camera);
});

// ---------- Autoguardado en las gafas (sin Wi-Fi no se pierde nada) ----------
let savedSig = '';
const sceneSig = () => active.id + '|' + JSON.stringify(state.look) + '|' + layers.map((L) => [L.id, L.version, L.moves, L.name, L.color, L.visible, !!L.remesh, L.frames.length].join(':')).join('|') + '|' + anim.fps;
async function autosave() {
  if (sculpting || moveOp.L || layers.some((L) => L.busy) || performance.now() - lastEdit < 6000) return;
  const sig = sceneSig();
  if (sig === savedSig) return;
  try {
    await idbSet('escena', packScene());
    await idbSet('escenaMeta', { obraId, dirty: obraDirty() });
    savedSig = sig;
    if (obrasReady) renderObras();
  } catch (e) {
    console.warn('autoguardado', e);
  }
}
async function restoreScene() {
  try {
    const buf = await idbGet('escena');
    if (!buf) return;
    applySnapshot(buf);
    synced = false;
    savedSig = sceneSig();
    updateHud();
    toast('Recuperado tu último trabajo');
  } catch (e) {
    console.warn('recuperar', e);
  }
}
// ---------- Obras guardadas (dentro de las gafas, sin internet) ----------
// "Guardar" guarda la obra abierta; abrir otra o empezar una nueva guarda antes la actual.

const obraDirty = () => sceneSig() !== obraSig;
const obraName = () => obras.find((o) => o.id === obraId)?.name || t('sin guardar');
const fmtDate = (d) => new Date(d).toLocaleString(getLang(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

// ---------- Copia en el Mac ----------
// Cada obra guardada y cada exportación pasan al Mac en cuanto está al alcance. Lo pendiente se
// deduce de lo guardado en las gafas, así que un corte de Wi-Fi solo lo retrasa.
const MAC_APP = !!API || !location.hostname.endsWith('github.io');
let syncing = null;
function syncToMac() {
  if (!syncing) syncing = runSync().finally(() => { syncing = null; });
  return syncing;
}
async function postObra(o, kind, date, body, stamp = '') {
  const q = new URLSearchParams({ id: o.id, name: o.name, kind, date, stamp });
  const r = await fetch(`${API}/api/obra?${q}`, { method: 'POST', body });
  if (!r.ok) throw new Error(r.status);
}
async function runSync() {
  if (SPECTATOR || !server.ok) return false;
  try {
    for (const o of obras) {
      if (o.remote) continue;
      if (o.sentDate !== o.date) {
        const date = o.date, buf = await idbGet('obra:' + o.id);
        if (!buf) continue;
        await postObra(o, 'escena', date, buf);
        o.sentDate = date;
        o.sentName = o.name;
        await idbSet('obras', obras);
      } else if (o.sentName !== o.name) {
        await postObra(o, 'nombre', o.date, '');
        o.sentName = o.name;
        await idbSet('obras', obras);
      }
    }
    for (const key of await idbKeys()) {
      if (!String(key).startsWith('envio:')) continue;
      const e = await idbGet(key), o = obras.find((x) => x.id === e.id) || { id: e.id, name: 'Obra' };
      await postObra(o, e.kind, o.date || 0, e.data, e.stamp);
      await idbDel(key);
    }
    return true;
  } catch (e) {
    console.warn('copia en el Mac', e);
    return false;
  }
}
// Lo que hay en el Mac y no en esta dirección (otra Wi-Fi, o el enlace de antes) también se ve aquí.
async function fetchMacObras() {
  if (SPECTATOR || !server.ok) return;
  try {
    const list = await (await fetch(API + '/api/obras', { cache: 'no-store' })).json();
    const gone = (await idbGet('obrasBorradas')) || [];
    for (const r of list) {
      if (gone.includes(r.id)) continue;
      const o = obras.find((x) => x.id === r.id);
      if (!o) obras.push({ ...r, remote: true, sentDate: r.date, sentName: r.name });
      else if (r.date > o.date) Object.assign(o, { date: r.date, size: r.size, name: r.name, remote: true, sentDate: r.date, sentName: r.name });
    }
    obras.sort((a, b) => b.date - a.date);
    await idbSet('obras', obras);
    updateHud();
    if (panel3d.visible) drawPanel();
  } catch (e) {
    console.warn('obras del Mac', e);
  }
}
// La escultura en curso también, aunque no pulses Guardar: la obra "Autoguardado".
const AUTO_ID = 1;
let autoSig = '';
async function autoCopy() {
  if (SPECTATOR || !server.ok || sculpting || layers.some((L) => L.busy)) return;
  const sig = sceneSig();
  if (sig === autoSig || !obraDirty()) return;
  try {
    const date = Date.now();
    await postObra({ id: AUTO_ID, name: t('Autoguardado') }, 'escena', date, packScene());
    autoSig = sig;
  } catch (e) {
    console.warn('autoguardado en el Mac', e);
  }
}

async function saveObra(asNew = false, quiet = false) {
  if (sculpting) return;
  let o = !asNew && obras.find((x) => x.id === obraId);
  if (!o) {
    const num = Math.max(0, ...obras.map((x) => +(x.name.match(/ (\d+)$/)?.[1] || 0))) + 1;
    o = { id: Date.now(), name: t('Obra {0}', num) };
    obras.push(o);
  }
  try {
    const buf = packScene();
    await idbSet('obra:' + o.id, buf);
    o.date = Date.now();
    o.size = buf.byteLength;
    obras.sort((a, b) => b.date - a.date);
    await idbSet('obras', obras);
    obraId = o.id;
    obraSig = sceneSig();
    await idbSet('escenaMeta', { obraId, dirty: false });
    if (!quiet) {
      sfx.saved();
      toast(t('Guardado: {0} (en las gafas)', o.name));
    }
    syncToMac().then((sent) => { if (sent && !quiet) toast(t('Guardado: {0} (también en el Mac)', o.name)); });
  } catch (e) {
    console.error(e);
    toast(t('No se pudo guardar: {0}', e.message));
  }
  updateHud();
}

function resetHistory() {
  undoStack.forEach(forgetEntry);
  undoStack.length = 0;
  clearRedo();
}

async function openObra(id) {
  if (id === obraId) return;
  if (obraDirty()) await saveObra(false, true);
  const o = obras.find((x) => x.id === id);
  if (o?.remote) { // está en el Mac: se trae a las gafas
    try {
      toast('Trayendo la obra del Mac…');
      const r = await fetch(`${API}/api/obra?id=${id}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      await idbSet('obra:' + id, await r.arrayBuffer());
      o.remote = false;
      await idbSet('obras', obras);
    } catch {
      return toast('Esa obra está en el Mac y ahora no llego a él');
    }
  }
  const buf = await idbGet('obra:' + id);
  if (!buf) return toast('No encuentro esa obra');
  applySnapshot(buf);
  synced = false;
  resetHistory();
  obraId = id;
  obraSig = sceneSig();
  await idbSet('escenaMeta', { obraId, dirty: false });
  updateHud();
  live.structure();
  toast(t('Abierta: {0}', obraName()));
}

async function newObra() {
  if (obraDirty()) await saveObra(false, true);
  layers.forEach((L) => L.dispose());
  layers = [new Layer(DEFAULT_RES, 'sphere')];
  active = layers[0];
  onionFrames = [];
  Object.assign(anim, { frame: 0, playing: false, acc: 0, mb: 0 });
  setLook(LOOK_DEFAULT);
  syncLookInputs();
  resetHistory();
  obraId = null;
  obraSig = sceneSig();
  await idbSet('escenaMeta', { obraId, dirty: false });
  updateHud();
  live.structure();
  toast('Obra nueva (la anterior está guardada)');
}

async function deleteObra(id) {
  const o = obras.find((x) => x.id === id);
  if (!o || !confirm(t('¿Borrar {0} de las gafas? No se puede deshacer.', o.name))) return;
  await idbDel('obra:' + id);
  obras = obras.filter((x) => x !== o);
  await idbSet('obras', obras);
  // La copia del Mac se queda, por seguridad, pero no vuelve a aparecer aquí.
  await idbSet('obrasBorradas', [...((await idbGet('obrasBorradas')) || []), id]);
  if (obraId === id) { obraId = null; obraSig = ''; }
  updateHud();
}

function renderObras() {
  $('obraName').textContent = obraName() + (obraDirty() ? ' •' : '');
  const list = $('obraList');
  list.innerHTML = '';
  for (const o of obras) {
    const row = document.createElement('div');
    row.className = 'obra' + (o.id === obraId ? ' active' : '');
    row.innerHTML = '<span class="lname"></span><span class="lres"></span><button class="eye" title="' + t('Borrar') + '">✕</button>';
    row.children[0].textContent = o.name;
    row.children[0].title = t('Doble clic para renombrar');
    row.children[1].textContent = fmtDate(o.date);
    row.onclick = () => openObra(o.id);
    row.children[0].ondblclick = async (e) => {
      e.stopPropagation();
      const v = prompt(t('Nombre de la obra'), o.name);
      if (v) { o.name = v.trim().slice(0, 30); await idbSet('obras', obras); updateHud(); }
    };
    row.children[2].onclick = (e) => { e.stopPropagation(); deleteObra(o.id); };
    list.append(row);
  }
}

async function loadObras() {
  try {
    obras = (await idbGet('obras')) || [];
    const meta = (await idbGet('escenaMeta')) || {};
    obraId = obras.some((o) => o.id === meta.obraId) ? meta.obraId : null;
    obraSig = obraId && !meta.dirty ? sceneSig() : '';
    if (!obraId && !meta.dirty) obraSig = sceneSig();
  } catch (e) {
    console.warn('obras', e);
  }
  obrasReady = true;
  updateHud();
}

if (!SPECTATOR) {
  (params.has('nuevo') ? Promise.resolve() : restoreScene()).then(loadObras).then(() => {
    setInterval(autosave, 3000);
    setInterval(syncToMac, 15000);
    setInterval(autoCopy, 120000);
    const whenOnline = (ok) => { if (ok) fetchMacObras().then(syncToMac); };
    server.listeners.push(whenOnline);
    whenOnline(server.ok);
    addEventListener('visibilitychange', () => document.hidden && autosave());
  });
}

// App instalable que funciona sin internet (ver sw.js).
if ('serviceWorker' in navigator && window.isSecureContext && !SPECTATOR) {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('sin modo offline:', e.message));
} else if (SPECTATOR && 'serviceWorker' in navigator) {
  // El espejo vive en el Mac junto al servidor: siempre el código recién servido, nunca una copia guardada.
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
}

updateHud();
if (!window.isSecureContext && !SPECTATOR) toast('Abre la app por https:// para usar las gafas');
document.querySelectorAll('[data-lang]').forEach((b) => (b.onclick = () => changeLang(b.dataset.lang)));
changeLang(getLang());

exportUi();
bgUi();
setBg(bg.id);
// ---------- Tutorial: tu primer tomate ----------
// Nunca arranca solo: se abre con «Jugar tutorial». Empieza en una obra nueva y guarda antes la tuya.
const strokeOf = (tool) => ({ stroke: (e) => e.tool === tool && e.touched && e.time > 0.3 });
tut = new Tutorial([
  { text: 'Mantén el gatillo y pasa la punta por la bola para añadirle barro.',
    mac: 'Mantén el clic izquierdo y pasa por la bola para añadirle barro.', setup: () => choose('add'), on: strokeOf('add') },
  { text: 'Clic en el stick derecho: se abre la flor. Deja la punta sobre Inflar.',
    mac: 'Clic derecho: se abre el dial de herramientas. Elige Inflar.', check: () => state.tool === 'inflate' },
  { text: 'Aprieta el gatillo sobre la bola y hazla gorda como un tomate.',
    mac: 'Mantén el clic sobre la bola y hazla gorda como un tomate.', on: strokeOf('inflate') },
  { text: 'Abre la flor otra vez y deja la punta sobre Pintar.',
    mac: 'Abre el dial otra vez y elige Pintar.', check: () => state.tool === 'paint' },
  { text: 'Píntalo de rojo con el gatillo.',
    mac: 'Píntalo de rojo pasando por encima.', setup: () => setColor('#e04f4f'), on: strokeOf('paint') },
  { text: '¿Te has pasado? Pulsa Y en el mando izquierdo para deshacer.',
    mac: '¿Te has pasado? Pulsa Cmd+Z para deshacer.', on: { undo: () => true } },
  { text: 'Empuja el stick izquierdo a la derecha y lo recuperas.',
    mac: 'Pulsa Cmd+Mayús+Z y lo recuperas.', on: { redo: () => true } },
  { text: 'Mantén un botón lateral del mando: mueve y gira tu tomate.',
    mac: 'Arrastra fuera del tomate para darle la vuelta.', on: { turn: (dt, T) => (T.count += dt) >= 0.8 } },
], {
  isXR: () => renderer.xr.isPresenting,
  onChange: tutShow,
  onStep: (i) => sfx.step(i),
  onDone: () => {
    sfx.party();
    tutBurst();
    setTimeout(() => { if (tut.finished) tut.stop(); }, 8000);
  },
});
const tutTex = new THREE.CanvasTexture(tut.canvas);
tutTex.colorSpace = THREE.SRGBColorSpace;
tut.onDraw = () => { tutTex.needsUpdate = true; };
const tutCard = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.15), new THREE.MeshBasicMaterial({ map: tutTex, depthTest: false }));
tutCard.renderOrder = 1000;
tutCard.visible = false;
scene.add(tutCard);
const tutBox = document.createElement('div');
tutBox.id = 'tutBox';
tutBox.hidden = true;
tutBox.appendChild(tut.canvas);
const tutRow = document.createElement('div');
tutRow.className = 'row';
[['Saltar paso', () => tut.next()], ['Salir del tutorial', () => tut.stop()]].forEach(([l, f]) => {
  const b = document.createElement('button');
  b.textContent = l;
  b.onclick = f;
  tutRow.appendChild(b);
});
tutBox.appendChild(tutRow);
document.body.appendChild(tutBox);
translateDOM(tutBox);
function tutShow() {
  tutBox.hidden = tut.index < 0;
  tutRow.hidden = tut.finished;
  if (panel3d.visible) drawPanel();
}
async function startTutorial() {
  if (sculpting || xr.stroking) return;
  await newObra();
  state.lathe = false;
  if (renderer.xr.isPresenting) {
    placeWorkspace(true);
    if (!xr.panelPinned) panel3d.visible = false;
    xr.cardSnap = true;
  }
  tut.start();
}
// La tarjeta flota encima de lo que estás haciendo y te sigue sin prisa; el confeti es de plastilina.
const cardHead = new THREE.Vector3(), cardDir = new THREE.Vector3(), cardAt = new THREE.Vector3();
let burst = null;
function tutBurst() {
  const n = 70, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), vel = [], c = new THREE.Color();
  const from = model.getWorldPosition(new THREE.Vector3());
  for (let i = 0; i < n; i++) {
    from.toArray(pos, i * 3);
    c.set(PALETTE[7 + (i % 9)]).toArray(col, i * 3);
    const a = Math.random() * Math.PI * 2, up = 0.5 + Math.random() * 0.9, r = 0.2 + Math.random() * 0.5;
    vel.push(Math.cos(a) * r, up, Math.sin(a) * r);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.016, vertexColors: true }));
  points.frustumCulled = false;
  scene.add(points);
  burst = { points, vel, life: 1.8 };
}
function tutFrame(dt) {
  tut.tick();
  if (burst) {
    const a = burst.points.geometry.attributes.position;
    for (let i = 0; i < burst.vel.length; i += 3) {
      burst.vel[i + 1] -= 1.5 * dt;
      a.array[i] += burst.vel[i] * dt;
      a.array[i + 1] += burst.vel[i + 1] * dt;
      a.array[i + 2] += burst.vel[i + 2] * dt;
    }
    a.needsUpdate = true;
    if ((burst.life -= dt) <= 0) {
      scene.remove(burst.points);
      burst.points.geometry.dispose();
      burst.points.material.dispose();
      burst = null;
    }
  }
  tutCard.visible = tut.index >= 0 && renderer.xr.isPresenting;
  if (!tutCard.visible) return;
  const cam = renderer.xr.getCamera();
  cam.getWorldPosition(cardHead);
  cam.getWorldDirection(cardDir);
  cardDir.y = 0;
  if (cardDir.lengthSq() > 0.04) {
    cardAt.copy(cardHead).addScaledVector(cardDir.normalize(), 0.75);
    cardAt.y += 0.24;
    tutCard.position.lerp(cardAt, xr.cardSnap ? 1 : 1 - Math.exp(-dt * 2.5));
    xr.cardSnap = false;
  }
  tutCard.lookAt(cardHead);
}
if (!SPECTATOR) {
  $('btnTut')?.addEventListener('click', startTutorial);
  const pick = $('addSound');
  if (pick) {
    for (const [id, op] of Object.entries(OPCIONES)) pick.add(new Option(op.name, id));
    translateDOM(pick);
    pick.value = sfx.addSound;
    pick.addEventListener('change', () => sfx.setAddSound(pick.value));
  }
  const vol = $('sfxVol');
  if (vol) {
    vol.value = sfx.volume;
    vol.addEventListener('input', () => sfx.setVolume(+vol.value));
  }
  controls.addEventListener('start', () => tut.emit('turn', 1));
  // El navegador solo deja sonar después de tocar algo.
  for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => sfx.unlock(), { capture: true });
  renderer.xr.addEventListener('sessionstart', () => { sfx.unlock(); xr.cardSnap = true; });
  // Los botones de la pantalla del Mac suenan igual que los de las gafas.
  document.addEventListener('click', (e) => { if (e.target.closest?.('button, summary')) sfx.play('clic'); });
  document.addEventListener('input', (e) => { if (e.target.type === 'range') sfx.play('dial', { semi: (e.target.value - e.target.min) / (e.target.max - e.target.min) * 12 - 4 }); });
}

buildFavRow();
updateHud();
window.__miMedium = { paramDist, model, setExtrude, buildPanel, uso, favorites, makeShape, shapeUI, startShapeDrag, moveShapeDrag, endShapeDrag, resetShape, duplicateHeld, bakeRemesh, text, openText, convertWriting, typeKey, textToQuads, toVoxel, mergeLayers, startMerge, mergeFrame, mergePlan, mergeBarPaint, barGroup, get merge() { return merge; }, get mergeAsk() { return mergeAsk; }, set mergeAsk(v) { mergeAsk = v; }, undoStack, pickForMerge, mergePick, scrollLayers, layerFirst, brushRes, call, setCall, setRes, toVoxel, tut, sfx, startTutorial, tutCard, applyAt, beginStroke, endStroke, brushOpts, bgDome, brushCall, pickLocal, mouse, xrPinPanel: pinPanel, panelGrips, panel3d, panelTab, bg, setBg, bgChanged, takeRefPhoto, toFBX, exportMeshes, shareModel, ref, duplicateHeld, beginMove, endMove, moveOp, setMoveMatrix, wheelPanel, wheelPointer, rigsReady: true, applyRemote, anim, addFrame, deleteFrame, stepFrame, setPlaying, undo, redo, packScene, applySnapshot, state, choose, get layers() { return layers; }, active: () => active, remeshLayer, live, panel, drawPanel,
  glb: () => buildGLB(exportObjects()), closeFlower, saveStamp, setPage: (p) => { panelPage = p; drawPanel(); }, stamps: STAMPS, camera, spin, spinner, importRef, ref, refRoot, updateLathe, webcam, changeLang, xrFrame, xr, ctrls, model, radial, flower, rigs, renderer, setSpecView: SPECTATOR ? setSpecView : null, setFormat: SPECTATOR ? setFormat : null, spectatorPose: SPECTATOR ? spectatorPose : null };
