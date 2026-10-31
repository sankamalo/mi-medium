import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { SDFGrid } from './sdf.js';
import { meshRegion, mergeChunks, quadsToTris, quadsToLines, toOBJ, parseOBJ, srgbToLinear } from './mesher.js';
import { RadialMenu, LABELS, TOOL_COLORS, SHAPE_ICON } from './radial.js';
import { CanvasPanel } from './panel.js';
import { Live, fetchBlob, pack, unpack, API, server, checkServer } from './live.js';
import { idbGet, idbSet, idbDel, idbKeys } from './store.js';
import { remeshSDF, bakeMesh, meshArea } from './remesh.js';
import { createWebcam, calibUI } from './camara.js';
import { t, getLang, setLang } from './i18n.js';

const RES_STEPS = [64, 96, 128, 192, 256, 320, 384, 512];
const DEFAULT_RES = 320;
const CHUNK = 32;
// En el casco la memoria es mucho más justa que en el Mac: menos historial de deshacer.
const ON_QUEST = /OculusBrowser|Quest/i.test(navigator.userAgent);
const UNDO_BYTES = ON_QUEST ? 300e6 : 800e6;
const BRICK_BYTES = 512 * 4;
const TOOL_KEYS = ['add', 'remove', 'smooth', 'flatten', 'inflate', 'paint', 'move', 'grab'];
const LAYER_COLORS = ['#cfc6bb', '#8fb8de', '#e0a07a', '#9ccf8f', '#c9a0dc', '#e6d27a', '#7ac9c2', '#e08a9a'];
const PALETTE = [
  '#f2efe9', '#cfc6bb', '#8a8580', '#2b2b2e', '#e8b796', '#c47a5a', '#7a4a33', '#e04f4f',
  '#f28c38', '#f2c94c', '#9ccf5f', '#3f9b6b', '#5ab4e0', '#3d6fd1', '#8f6fd6', '#e07ab4',
];

const params = new URLSearchParams(location.search);
const SPECTATOR = params.has('ver');      // Mac: espejo para grabar
const FORCE_EMIT = params.has('emitir');  // pruebas: emitir sin estar en las gafas

const state = {
  tool: 'add', radius: 0.025, strength: 0.6, stab: 0, sym: false, wire: false,
  invert: false, smoothHold: false, quads: 8000, shape: 'sphere',
  color: '#cfc6bb', bakeSize: 2048,
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

scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3d48, 1.4));
const key = new THREE.DirectionalLight(0xffffff, 1.8);
key.position.set(1, 2, 1.5);
scene.add(key);
const rim = new THREE.DirectionalLight(0x9db4ff, 0.7);
rim.position.set(-1.5, -0.5, -1);
scene.add(rim);

const model = new THREE.Group();
scene.add(model);
const clay = new THREE.MeshStandardMaterial({
  roughness: 0.55, metalness: 0, vertexColors: true,
  polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
});
const wireMat = new THREE.LineBasicMaterial({ color: 0x15171c, transparent: true, opacity: 0.5 });
const bounds = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12 }),
);
model.add(bounds);

const cursor = new THREE.Mesh(
  new THREE.SphereGeometry(1, 24, 16),
  new THREE.MeshBasicMaterial({ color: TOOL_COLORS.add, wireframe: true, transparent: true, opacity: 0.35, depthWrite: false }),
);
cursor.visible = false;
model.add(cursor);
const cursorMirror = cursor.clone();
cursorMirror.material = cursor.material;
model.add(cursorMirror);
// Forma del cursor = huella del pincel (a escala r): esfera, cubo o pirámide.
const CURSOR_GEO = {
  sphere: cursor.geometry,
  cube: new THREE.BoxGeometry(1.5, 1.5, 1.5, 2, 2, 2),
  pyramid: new THREE.ConeGeometry(Math.SQRT2, 2, 4, 1).rotateY(Math.PI / 4).translate(0, 0.4, 0),
};
function updateCursorShape() {
  const sh = shapeActive() ? state.shape : 'sphere';
  if (cursor.geometry !== CURSOR_GEO[sh]) cursor.geometry = cursorMirror.geometry = CURSOR_GEO[sh];
  if (sh === 'sphere') {
    cursor.quaternion.identity();
    cursorMirror.quaternion.identity();
    return;
  }
  const e = brushRot();
  if (!e) return;
  rotM.set(e[0], e[3], e[6], 0, e[1], e[4], e[7], 0, e[2], e[5], e[8], 0, 0, 0, 0, 1);
  cursor.quaternion.setFromRotationMatrix(rotM);
  const q = cursor.quaternion;
  cursorMirror.quaternion.set(q.x, -q.y, -q.z, q.w);
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
  const r = { mesh: new THREE.Mesh(geo, mat), lines: null, quads, group: null };
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
  r.mesh.geometry.dispose();
  setMeshWire(r, false);
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

let layerSeq = 0;
class Layer {
  constructor(n, shape, opts = {}) {
    this.id = opts.id ?? ++layerSeq;
    layerSeq = Math.max(layerSeq, this.id);
    this.name = opts.name ?? t('Capa {0}', this.id);
    this.color = opts.color ?? LAYER_COLORS[(this.id - 1) % LAYER_COLORS.length];
    this.grid = opts.grid ?? new SDFGrid(n, shape);
    this.group = new THREE.Group();
    this.voxels = new THREE.Group();
    this.group.add(this.voxels);
    model.add(this.group);
    this.chunks = [];
    this.dirty = new Set();
    this.remesh = null;
    this.version = 0;
    this.busy = false;
    if (opts.visible === false) this.group.visible = false;
    this.rebuildAll();
  }

  get visible() { return this.group.visible; }
  set visible(v) { this.group.visible = v; }
  get base() { return hexToRgb(this.color); }

  setBase(hex) {
    this.color = hex;
    this.rebuildAll();
  }

  rebuildAll() {
    this.chunks.forEach((ch) => ch && disposeMesh(this.voxels, ch));
    this.C = Math.ceil((this.grid.n - 1) / CHUNK);
    this.chunks = new Array(this.C ** 3).fill(null);
    this.dirty.clear();
    for (let i = 0; i < this.chunks.length; i++) this.dirty.add(i);
    this.changed();
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
  flush(budgetMs = Infinity) {
    const t0 = performance.now();
    const C = this.C, base = this.base;
    for (const ci of this.dirty) {
      this.dirty.delete(ci);
      const cx = ci % C, cy = Math.floor(ci / C) % C, cz = Math.floor(ci / (C * C));
      const m = meshRegion(this.grid, cx * CHUNK, cy * CHUNK, cz * CHUNK, CHUNK, base);
      if (this.chunks[ci]) disposeMesh(this.voxels, this.chunks[ci]);
      this.chunks[ci] = null;
      if (m) {
        const r = buildMesh(m.positions, m.normals, m.colors, m.quads, clay);
        r.m = m;
        addMesh(this.voxels, r);
        this.chunks[ci] = r;
      }
      if (performance.now() - t0 > budgetMs) break;
    }
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
    addMesh(this.group, this.remesh);
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
    const mat = new THREE.MeshStandardMaterial({
      map: tex(bake.colorMap, true), normalMap: tex(bake.normalMap, false),
      normalScale: new THREE.Vector2(1, -1), roughness: 0.55, metalness: 0,
    });
    r.baked = new THREE.Mesh(geo, mat);
    r.bake = bake;
    r.mesh.visible = false;
    this.group.add(r.baked);
  }

  clearBake() {
    const r = this.remesh;
    if (!r?.baked) return;
    this.group.remove(r.baked);
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
    disposeMesh(this.group, this.remesh);
    this.remesh = null;
    this.voxels.visible = true;
  }

  setWire(v) {
    this.chunks.forEach((ch) => ch && setMeshWire(ch, v));
    if (this.remesh) setMeshWire(this.remesh, v);
  }

  dispose() {
    this.chunks.forEach((ch) => ch && disposeMesh(this.voxels, ch));
    this.clearRemesh();
    model.remove(this.group);
  }
}

let layers = [new Layer(DEFAULT_RES, 'sphere')];
let active = layers[0];
const layerById = (id) => layers.find((L) => L.id === id);

function setActive(L) {
  active = L;
  if (!L.visible) L.visible = true;
  updateHud();
}

function newLayer() {
  const L = new Layer(active.grid.n, 'empty');
  layers.push(L);
  setActive(L);
  live.structure();
  toast(t('{0} creada (vacía): añade barro con "Añadir"', L.name));
}

function nextLayer() {
  setActive(layers[(layers.indexOf(active) + 1) % layers.length]);
  live.structure();
  toast(t('Capa activa: {0}', active.name));
}

function deleteLayer(L, ask = true) {
  if (layers.length === 1) return toast('No puedes borrar la única capa');
  if (ask && !confirm(t('¿Borrar {0}? No se puede deshacer.', L.name))) return;
  for (const s of [undoStack, redoStack]) {
    for (let i = s.length - 1; i >= 0; i--) if (s[i].layer === L) s.splice(i, 1);
  }
  const idx = layers.indexOf(L);
  L.dispose();
  layers.splice(idx, 1);
  setActive(layers[Math.max(0, idx - 1)]);
  live.structure();
}

function setLayerBase(L, hex) {
  L.setBase(hex);
  updateHud();
  live.structure();
}

// ---------- Deshacer ----------
// Los trazos guardan solo los bloques que tocan; los cambios de resolución guardan la rejilla entera.
const undoStack = [], redoStack = [];
const entryBytes = (e) => (e.rec ? e.rec.size * BRICK_BYTES * 2 : e.bytes);

function pushStroke(L) {
  const rec = new Map();
  undoStack.push({ layer: L, rec });
  redoStack.length = 0;
  trimUndo();
  return rec;
}
function pushFull(L) {
  undoStack.push({ layer: L, full: L.grid.state(), bytes: L.grid.bytes() });
  redoStack.length = 0;
  trimUndo();
}
function trimUndo() {
  let total = undoStack.reduce((a, e) => a + entryBytes(e), 0);
  while (total > UNDO_BYTES && undoStack.length > 1) total -= entryBytes(undoStack.shift());
}
function swapEntry(e) {
  const L = e.layer;
  if (e.rec) {
    const { inv, lo, hi } = L.grid.restoreBricks(e.rec);
    if (e.rec.size) L.markDirty(lo, hi);
    live.patch(L, e.rec.keys());
    return { layer: L, rec: inv };
  }
  const cur = { layer: L, full: L.grid.state(), bytes: L.grid.bytes() };
  L.grid.setState(e.full);
  L.rebuildAll();
  live.structure();
  return cur;
}
function undo() {
  if (!undoStack.length) return toast('Nada que deshacer');
  const e = undoStack.pop();
  redoStack.push(swapEntry(e));
  setActive(e.layer);
  toast('Deshacer', 900);
}
function redo() {
  if (!redoStack.length) return toast('Nada que rehacer');
  const e = redoStack.pop();
  undoStack.push(swapEntry(e));
  setActive(e.layer);
  toast('Rehacer', 900);
}

// ---------- Herramientas ----------
// Mantener Shift suaviza sin cambiar de herramienta.
const activeTool = () => (state.smoothHold ? 'smooth' : state.tool);
let strokeRec = null;
let strokePrev = null;

function beginStroke() {
  strokeRec = pushStroke(active);
  strokePrev = null;
  lazy = null;
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
function brushCall(L, tool, a, b, r, s, inv, dt, paint, opts) {
  const res = L.grid.applyBrush(tool, a, b, r, s, inv, dt, L === active ? strokeRec : null, paint, opts);
  if (res) L.markDirty(res.lo, res.hi);
  live.brush(L, tool, a, b, r, s, inv, dt, paint, opts);
}

// Orientación del pincel de forma (cubo, pirámide) en coordenadas del modelo:
// en el Mac mira a la cámara; en las gafas sigue al mando derecho.
let brushObj = null;
const rotM = new THREE.Matrix4(), rot3 = new THREE.Matrix3();
function brushRot() {
  if (!brushObj) return null;
  model.updateMatrixWorld();
  brushObj.updateMatrixWorld();
  rotM.copy(model.matrixWorld).invert().multiply(brushObj.matrixWorld);
  rot3.setFromMatrix4(rotM);
  const e = rot3.elements;
  for (let c = 0; c < 3; c++) {
    const l = Math.hypot(e[3 * c], e[3 * c + 1], e[3 * c + 2]) || 1;
    e[3 * c] /= l; e[3 * c + 1] /= l; e[3 * c + 2] /= l;
  }
  return Array.from(e, (v) => Math.round(v * 1e4) / 1e4);
}
const shapeActive = () => (activeTool() === 'add' || activeTool() === 'remove') && state.shape !== 'sphere';

function applyAt(p, dt, pressure = 1) {
  const tool = activeTool();
  const a = strokePrev || p;
  // Si el punto apenas se ha movido, los pinceles "de golpe" (añadir/quitar) no repiten.
  const moved = Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]);
  if (strokePrev && moved < state.radius * 0.05 && (tool === 'add' || tool === 'remove')) return;
  if (tool === 'grab') {
    // Arrastrar: lleva el barro con la mano en pasos pequeños (elástico, sin romperse).
    if (!strokePrev) { strokePrev = [p[0], p[1], p[2]]; return; }
    if (moved < active.grid.h * 0.05) return;
    const steps = Math.ceil(moved / (state.radius * 0.2));
    for (let i = 1; i <= steps; i++) {
      const q0 = strokePrev, q1 = [a[0] + (p[0] - a[0]) * (i / steps), a[1] + (p[1] - a[1]) * (i / steps), a[2] + (p[2] - a[2]) * (i / steps)];
      brushCall(active, 'grab', q0, q1, state.radius, 1, false, dt, null);
      if (state.sym && Math.abs(q0[0]) > active.grid.h * 0.5) {
        brushCall(active, 'grab', [-q0[0], q0[1], q0[2]], [-q1[0], q1[1], q1[2]], state.radius, 1, false, dt, null);
      }
      strokePrev = q1;
    }
    return;
  }
  strokePrev = [p[0], p[1], p[2]];
  const s = state.strength * pressure;
  const paint = {
    rgb: hexToRgb(state.color),
    base: active.base,
  };
  const usePaint = tool === 'paint' || tool === 'add' ? paint : null;
  const rot = shapeActive() ? brushRot() : null;
  const opts = rot ? { shape: state.shape, rot } : null;
  brushCall(active, tool, a, p, state.radius, s, state.invert, dt, usePaint, opts);
  if (state.sym && Math.abs(p[0]) > active.grid.h * 0.5) {
    // Espejo en X: la forma también se refleja.
    const mOpts = opts ? { shape: opts.shape, rot: rot.map((v, i) => (i % 3 === 0 ? -v : v)) } : null;
    brushCall(active, tool, [-a[0], a[1], a[2]], [-p[0], p[1], p[2]], state.radius, s, state.invert, dt, usePaint, mOpts);
  }
}

function changeRes(dir) {
  const n = active.grid.n;
  let i = RES_STEPS.findIndex((r) => r >= n);
  if (i < 0) i = RES_STEPS.length - 1;
  const ni = Math.max(0, Math.min(RES_STEPS.length - 1, i + dir));
  if (RES_STEPS[ni] === n) return toast(dir > 0 ? 'Resolución máxima' : 'Resolución mínima');
  pushFull(active);
  active.grid.resample(RES_STEPS[ni]);
  active.rebuildAll();
  live.structure();
  toast(t('{0}: resolución {1}³', active.name, active.grid.n));
}

function resetLayer(shape) {
  pushFull(active);
  const g = active.grid;
  g.setResolution(g.n);
  if (shape === 'sphere') g.reset();
  active.rebuildAll();
  live.structure();
}

function choose(id) {
  switch (id) {
    case 'add': case 'remove': case 'smooth': case 'flatten': case 'inflate': case 'paint': case 'move': case 'grab':
      state.tool = id;
      break;
    case 'shape:sphere': case 'shape:cube': case 'shape:pyramid':
      state.shape = id.slice(6);
      if (state.tool !== 'remove') state.tool = 'add';
      toast(t('Pincel: {0}', t(LABELS[id])), 1200);
      break;
    case 'resUp': changeRes(1); break;
    case 'resDown': changeRes(-1); break;
    case 'sym': state.sym = !state.sym; toast(state.sym ? 'Simetría ON' : 'Simetría OFF'); break;
    case 'wire':
      state.wire = !state.wire;
      layers.forEach((L) => L.setWire(state.wire));
      break;
    case 'undo': undo(); break;
    case 'remesh': remeshLayer(active); break;
    case 'export': exportModel(); break;
    case 'save': saveObra(); break;
    case 'share': shareModel(); break;
    case 'layerNew': newLayer(); break;
    case 'layerNext': nextLayer(); break;
  }
  updateHud();
}

function setColor(hex) {
  state.color = hex;
  updateHud();
}

// ---------- Remesh en el casco: malla nueva de quads + horneado del detalle ----------
// La malla nueva sale de la propia rejilla (sin Blender) y el detalle de alta resolución se
// hornea en un mapa de normales y otro de color. Va por tramos: la escena no se congela.
async function remeshLayer(L) {
  if (L.busy) return toast('Ya está haciendo remesh…');
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
async function sendToMac(name, blob) {
  const r = await fetch(API + '/api/export?name=' + encodeURIComponent(name), { method: 'POST', body: blob });
  if (!r.ok) throw new Error(r.status);
}

function exportObjects() {
  return layers
    .filter((L) => L.visible)
    .map((L) => ({
      name: L.name.replace(/[^\w-]+/g, '_'),
      mesh: L.remesh ? L.remesh.data : L.merged(),
      bake: L.remesh?.bake || null,
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
      mat = new THREE.MeshStandardMaterial({ map: tex(b.colorMap, true), normalMap: tex(b.normalMap, false), roughness: 0.55 });
    } else {
      geo.setAttribute('position', new THREE.BufferAttribute(o.mesh.positions, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(o.mesh.normals, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(srgbToLinear(o.mesh.colors), 3));
      geo.setIndex(new THREE.BufferAttribute(quadsToTris(o.mesh.quads), 1));
      mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
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
  // Sin el Mac a mano (sin Wi-Fi, o la app instalada desde GitHub): compartir el archivo.
  if (!(await checkServer())) return shareModel();
  exporting = true;
  toast('Exportando…');
  try {
    const objects = exportObjects();
    if (!objects.length) throw new Error('nada visible');
    const base = exportName();
    const glb = await buildGLB(objects);
    await sendToMac(base + '.obj', new Blob([toOBJ(objects)], { type: 'text/plain' }));
    await sendToMac(base + '.glb', new Blob([glb], { type: 'model/gltf-binary' }));
    const total = objects.reduce((a, o) => a + o.mesh.quads.length / 4, 0);
    toast(t('Guardado en el Mac: {0} capa(s) · {1} quads', objects.length, total));
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
  const objects = exportObjects();
  if (!objects.length) return toast('No hay nada visible que exportar');
  // El menú de compartir no se puede abrir dentro de la vista inmersiva: se sale primero.
  if (renderer.xr.isPresenting) await renderer.xr.getSession().end();
  const base = exportName();
  const baked = objects.some((o) => o.bake);
  let files;
  if (baked) {
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
$('btnBase').onclick = () => setLayerBase(active, state.color);
$('btnUndo').onclick = undo;
$('btnExport').onclick = exportModel;
$('btnShare').onclick = shareModel;
$('btnSym').onclick = () => choose('sym');
$('btnWire').onclick = () => choose('wire');
document.querySelectorAll('#bakeSizes [data-bake]').forEach((b) => (b.onclick = () => { state.bakeSize = +b.dataset.bake; updateHud(); }));
document.querySelectorAll('#shapes [data-shape]').forEach((b) => (b.onclick = () => choose('shape:' + b.dataset.shape)));
$('btnSave').onclick = () => saveObra();
$('btnSaveAs').onclick = () => saveObra(true);
$('btnNew').onclick = newObra;
$('btnRemesh').onclick = () => remeshLayer(active);
$('btnRemeshMac').onclick = () => remeshBlender(active);
$('layerAdd').onclick = newLayer;
$('layerDel').onclick = () => deleteLayer(active);
$('layerSphere').onclick = () => resetLayer('sphere');
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

const label = (id) => t(LABELS[id] || id);
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
  return `${active.name} · ${active.grid.n}³ · ${k} quads · ${mb.toFixed(0)} MB${state.sym ? t(' · simetría') : ''}${state.wire ? t(' · malla') : ''}`;
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
    const name = document.createElement('span');
    name.className = 'lname';
    name.textContent = L.name + (L.remesh ? ' ⊞' : '') + (L.busy ? ' …' : '');
    name.title = t('Doble clic para renombrar');
    const res = document.createElement('span');
    res.className = 'lres';
    res.textContent = `${L.grid.n}³`;
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
}

let hudMsg = '', hudMsgUntil = 0;
function updateHud() {
  const el = $('tool');
  const tool = activeTool();
  el.textContent = label(tool) + (state.invert ? ' ' + t('(invertido)') : '');
  el.style.color = TOOL_COLORS[tool];
  $('info').textContent = infoText();
  sizeIn.value = radiusToT(state.radius);
  $('stab').value = state.stab;
  $('stabVal').textContent = state.stab ? Math.round(state.stab * 100) + '%' : t('no');
  strIn.value = state.strength;
  quadsIn.value = state.quads;
  colorIn.value = state.color;
  $('btnPaint').classList.toggle('on', state.tool === 'paint');
  $('btnSym').classList.toggle('on', state.sym);
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

// Mientras arrastras solo se mueve su grupo 3D; al soltar, el movimiento se "hornea" en la
// rejilla de la capa (así esculpir, deshacer, exportar y el espejo siguen igual).
const moveOp = { L: null, mode: 'move', p0: new THREE.Vector3(), n: new THREE.Vector3(), x0: 0, y0: 0, start: new THREE.Matrix4(), scale: 1, toastT: 0 };

function beginMove(L) {
  moveOp.L = L;
  moveOp.scale = 1;
  if (L !== active) setActive(L);
  L.group.position.set(0, 0, 0);
  L.group.quaternion.identity();
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
  L.group.updateMatrix();
  const m = L.group.matrix.clone();
  const s = L.group.scale.x;
  const moved = L.group.position.length() > 1e-4 || 1 - Math.abs(L.group.quaternion.w) > 1e-6 || Math.abs(s - 1) > 1e-3;
  if (moved && layers.includes(L)) {
    const hadRemesh = !!L.remesh;
    pushFull(L);
    L.grid.applyTransform(m.invert().elements, s);
    L.rebuildAll();
    L.flush(); // todo de golpe, para que no parpadee en la posición vieja
    live.structure();
    if (hadRemesh) toast('Capa movida: el remesh se descarta (vuelve a lanzarlo)');
  }
  L.group.position.set(0, 0, 0);
  L.group.quaternion.identity();
  L.group.scale.set(1, 1, 1);
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
  let best = null, bestLayer = null;
  // Durante un trazo de Añadir/Quitar, la capa activa se lee tal como estaba al empezar.
  const frozen = sculpting && (activeTool() === 'add' || activeTool() === 'remove');
  for (const L of layers) {
    if (!L.visible) continue;
    if (frozen && L === active) L.grid.view = strokeRec;
    const hit = L.grid.raymarch(o, d);
    L.grid.view = null;
    if (hit && (!best || hit[3] < best[3])) { best = hit; bestLayer = L; }
  }
  if (!best && allowAir) {
    const t = -(o[0] * d[0] + o[1] * d[1] + o[2] * d[2]);
    const p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
    if (t > 0 && p.every((v) => Math.abs(v) < 0.5)) best = [...p, t];
  }
  if (best) best.layer = bestLayer;
  return best;
}
// Añadir/Quitar siguen la superficie original del trazo (si no, el barro "trepa" hacia la cámara
// o el corte excava sin fin). Fuera del modelo, mantienen la última profundidad.
function strokePoint(hit) {
  const tool = activeTool();
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
  const c = L.grid.sampleColor(hit[0], hit[1], hit[2]);
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
addEventListener('pointermove', (e) => {
  setMouse(e);
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
  // Dial con clic derecho: suelta sobre una herramienta para elegirla.
  // Si lo sueltas sin moverte, se queda abierto para elegir con un clic.
  if (e.button === 2 && radialOpen && radialMode === 'hold') {
    if (radial.highlight) closeMenu(true);
    else radialMode = 'click';
  }
  if (sculpting) {
    sculpting = false;
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
  else if (k >= '1' && k <= '8') choose(TOOL_KEYS[+k - 1]);
  else if (k === 'b') choose('shape:' + { sphere: 'cube', cube: 'pyramid', pyramid: 'sphere' }[state.shape]);
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
    scene.background = mode === 'immersive-ar' ? null : new THREE.Color(0x15171c);
    model.position.set(0, 1.1, -0.6);
    model.quaternion.identity();
    model.scale.setScalar(WS.scale);
    bounds.material.opacity = 0.4;
    xr.follow = true; // el espacio te sigue con la vista hasta que empiezas a esculpir
    xr.followSnap = true;
    hud3d.visible = true;
    live.structure();
    session.addEventListener('end', () => {
      scene.background = deskBg;
      model.position.set(0, 0, 0);
      model.quaternion.identity();
      model.scale.setScalar(1);
      bounds.material.opacity = 0.12;
      menu3d.visible = false;
      hud3d.visible = false;
      panel3d.visible = false;
      ray.visible = false;
      cursor.visible = cursorMirror.visible = false;
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
  c.add(controllerModel());
  scene.add(c);
  return c;
});
const TIP = new THREE.Vector3(0, 0, -0.055);

// Rayo del mando derecho (para el panel)
const ray = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -0.055), new THREE.Vector3(0, 0, -1)]),
  new THREE.LineBasicMaterial({ color: 0x7fb6ff, transparent: true, opacity: 0.8 }),
);
ray.visible = false;

// Menú radial en 3D
const radialTex = new THREE.CanvasTexture(radial.canvas);
radialTex.colorSpace = THREE.SRGBColorSpace;
const menu3d = new THREE.Mesh(
  new THREE.PlaneGeometry(0.26, 0.26),
  new THREE.MeshBasicMaterial({ map: radialTex, transparent: true, depthTest: false }),
);
menu3d.renderOrder = 999;
// Gafas: muestra del pincel a tamaño real encima del dial mientras ajustas Tamaño.
const preview3d = new THREE.Mesh(cursor.geometry, cursor.material);
preview3d.visible = false;
scene.add(preview3d);
function updatePreview3D() {
  preview3d.visible = radialOpen && menu3d.visible && radial.highlight === 'slider:size';
  if (!preview3d.visible) return;
  const r = state.radius * model.scale.x;
  preview3d.geometry = cursor.geometry;
  preview3d.scale.setScalar(r);
  preview3d.quaternion.copy(menu3d.quaternion);
  preview3d.position.set(0, 0.13 + r * 1.5 + 0.015, 0).applyQuaternion(menu3d.quaternion).add(menu3d.position);
}
menu3d.visible = false;
scene.add(menu3d);

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

// ---------- Panel de la mano izquierda (gafas) ----------
const PW = 768, PH = 1528;
let panelPage = 'main'; // 'main' | 'obras'
const panel = new CanvasPanel(PW, PH, buildPanel);
const panelTex = new THREE.CanvasTexture(panel.canvas);
panelTex.colorSpace = THREE.SRGBColorSpace;
const panel3d = new THREE.Mesh(
  new THREE.PlaneGeometry(0.24, 0.24 * (PH / PW)),
  new THREE.MeshBasicMaterial({ map: panelTex, transparent: true }),
);
panel3d.position.set(0.02, 0.19, -0.06);
panel3d.rotation.x = -0.35;
panel3d.visible = false;

function buildPanel() {
  if (panelPage === 'obras') return buildObrasPage();
  const W = [];
  const M = 32, IW = PW - 2 * M;
  W.push({ type: 'label', x: M, y: 44, text: label(activeTool()) + (state.invert ? ' ' + t('(invertido)') : ''), color: TOOL_COLORS[activeTool()], size: 40 });
  W.push({ type: 'label', x: PW - M, y: 44, text: infoText(), align: 'right', size: 22, weight: 500 });
  W.push({
    type: 'slider', x: M, y: 112, w: IW, h: 30, label: 'Tamaño',
    get: () => radiusToT(state.radius), set: (t) => (state.radius = tToRadius(t)),
    text: () => Math.round(state.radius * 1000) / 10 + '',
  });
  W.push({
    type: 'slider', x: M, y: 190, w: IW, h: 30, label: 'Fuerza',
    get: () => (state.strength - 0.05) / 0.95, set: (t) => (state.strength = 0.05 + t * 0.95),
    text: () => Math.round(state.strength * 100) + '%',
  });
  W.push({
    type: 'slider', x: M, y: 268, w: IW, h: 30, label: 'Estabilizar (línea recta)',
    get: () => state.stab, set: (t) => (state.stab = Math.round(t * 20) / 20),
    text: () => (state.stab ? Math.round(state.stab * 100) + '%' : t('no')),
  });
  const tools = TOOL_KEYS;
  const tw = (IW - (tools.length - 1) * 8) / tools.length;
  tools.forEach((tl, i) => W.push({
    type: 'button', x: M + i * (tw + 8), y: 318, w: tw, h: 64, size: 18,
    label: { move: 'Mover', grab: 'Arrastrar', smooth: 'Suaviz.' }[tl] || label(tl),
    active: () => state.tool === tl, onClick: () => choose(tl),
  }));
  // Forma del pincel de Añadir / Quitar.
  const shw = (IW - 2 * 8) / 3;
  ['sphere', 'cube', 'pyramid'].forEach((sh, i) => W.push({
    type: 'button', x: M + i * (shw + 8), y: 394, w: shw, h: 52, size: 22,
    label: `${SHAPE_ICON[sh]}  ${label('shape:' + sh)}`, active: () => state.shape === sh,
    onClick: () => choose('shape:' + sh),
  }));
  W.push({ type: 'label', x: M, y: 483, text: 'COLOR', size: 22 });
  const sw = (IW - 7 * 8) / 8;
  PALETTE.forEach((hex, i) => W.push({
    type: 'swatch', x: M + (i % 8) * (sw + 8), y: 503 + Math.floor(i / 8) * (sw * 0.7 + 8), w: sw, h: sw * 0.7,
    color: hex, active: () => state.color === hex, onClick: () => setColor(hex),
  }));
  const yc = 503 + 2 * (sw * 0.7 + 8) + 4;
  W.push({ type: 'button', x: M, y: yc, w: IW, h: 56, label: 'Traer el espacio aquí', size: 24,
    onClick: () => placeWorkspace(true) });
  const yl = yc + 92;
  W.push({ type: 'label', x: M, y: yl, text: 'CAPAS', size: 22 });
  W.push({ type: 'button', x: PW - M - 150, y: yl - 26, w: 150, h: 50, label: '+ Capa', size: 22, onClick: newLayer });
  layers.slice(-4).forEach((L, i) => {
    const y = yl + 34 + i * 62;
    W.push({ type: 'button', x: M, y, w: IW - 90, h: 54, label: `${L.name}  ·  ${L.grid.n}³${L.remesh ? '  ⊞' : ''}`,
      dot: L.color, size: 22, active: () => L === active, onClick: () => setActive(L) });
    W.push({ type: 'button', x: PW - M - 80, y, w: 80, h: 54, label: L.visible ? 'Ver' : '—', size: 20,
      onClick: () => { L.visible = !L.visible; updateHud(); live.structure(); } });
  });
  const yo = 1028;
  W.push({ type: 'label', x: M, y: yo, text: t('OBRA: {0}', obraName()) + (obraDirty() ? ' •' : ''), size: 22 });
  const ow = (IW - 3 * 8) / 4;
  [['Guardar', () => saveObra()], ['Obras ▸', () => { panelPage = 'obras'; drawPanel(); }],
    ['Nueva', newObra], ['Compartir', shareModel]]
    .forEach(([l, f], i) => W.push({ type: 'button', x: M + i * (ow + 8), y: yo + 22, w: ow, h: 64, label: l, size: 22,
      active: () => i === 0 && obraDirty(), onClick: f }));
  const yb = 1188;
  W.push({
    type: 'slider', x: M, y: yb, w: IW, h: 30, label: 'Quads del remesh',
    get: () => (state.quads - 1000) / 59000, set: (t) => (state.quads = Math.round((1000 + t * 59000) / 1000) * 1000),
    text: () => state.quads.toLocaleString(),
  });
  const bw = (IW - 5 * 8) / 6;
  [['− Res', 'resDown'], ['+ Res', 'resUp'], ['Simetría', 'sym'], ['Malla', 'wire'], ['Remesh', 'remesh'], ['A Blender', 'export']]
    .forEach(([l, id], i) => W.push({ type: 'button', x: M + i * (bw + 8), y: yb + 56, w: bw, h: 64, label: l, size: 19,
      active: () => (id === 'sym' && state.sym) || (id === 'wire' && state.wire), onClick: () => choose(id) }));
  // Idiomas: siempre en español y siempre abajo del todo, para encontrarlo en cualquier idioma.
  const yi = yb + 150;
  W.push({ type: 'label', x: M, y: yi, text: 'Idiomas', size: 28, color: '#ffffff' });
  const lw = (IW - 2 * 8) / 3;
  [['es', 'Español'], ['en', 'English'], ['th', 'ไทย']].forEach(([l, name], i) => W.push({
    type: 'button', x: M + i * (lw + 8), y: yi + 22, w: lw, h: 100, label: name, size: 36,
    active: () => getLang() === l, onClick: () => changeLang(l),
  }));
  W.push({ type: 'label', x: PW / 2, y: PH - 34, align: 'center', size: 20, weight: 500,
    text: 'Apunta con el mando derecho · gatillo = pulsar · clic stick izq. = cerrar' });
  return W;
}
function buildObrasPage() {
  const W = [];
  const M = 32, IW = PW - 2 * M;
  W.push({ type: 'label', x: M, y: 44, text: 'Obras en las gafas', size: 36 });
  W.push({ type: 'button', x: PW - M - 160, y: 18, w: 160, h: 54, label: '◂ Volver', size: 22,
    onClick: () => { panelPage = 'main'; drawPanel(); } });
  if (!obras.length) W.push({ type: 'label', x: M, y: 130, text: 'Aún no has guardado ninguna. Pulsa Guardar.', size: 24, weight: 500 });
  obras.slice(0, 14).forEach((o, i) => W.push({
    type: 'button', x: M, y: 100 + i * 72, w: IW, h: 62, size: 24,
    label: `${o.name}   ·   ${fmtDate(o.date)}`, active: () => o.id === obraId,
    onClick: async () => { await openObra(o.id); panelPage = 'main'; drawPanel(); },
  }));
  W.push({ type: 'label', x: PW / 2, y: PH - 34, align: 'center', size: 20, weight: 500,
    text: 'Abrir otra guarda antes la actual' });
  return W;
}

// Cambiar de idioma: el HTML se traduce solo; los lienzos se redibujan.
function changeLang(l) {
  setLang(l, () => {
    updateHud();
    drawHud3D();
    if (panel3d.visible) drawPanel();
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
  menuPrev: false, menuOpen: false, menuMode: null, stroking: false, grabMode: 'none',
  xPrev: false, yPrev: false, lStickPrev: false, rStickPrev: false, trigPrev: false, flick: 0,
};
const grabOffset = new THREE.Matrix4();
const tmpM = new THREE.Matrix4(), tmpS = new THREE.Vector3();
const vA = new THREE.Vector3(), vB = new THREE.Vector3();
const scale0 = { d: 1, s: 1, mid: new THREE.Vector3(), pos: new THREE.Vector3() };
const panelRay = new THREE.Raycaster();
let hudMsgShown = false;

function openRadial3D(tipW, mode) {
  xr.menuOpen = true;
  xr.menuMode = mode;
  xr.menuOpenedFrame = true; // el mismo clic que lo abre no debe cerrarlo
  radialOpen = true;
  radial.reset();
  xr.radialDrag = -1;
  radial.draw(state, infoText());
  radialTex.needsUpdate = true;
  menu3d.position.copy(tipW);
  menu3d.lookAt(renderer.xr.getCamera().getWorldPosition(vA));
  menu3d.visible = true;
}
function closeRadial3D(pick) {
  xr.menuOpen = false;
  radialOpen = false;
  menu3d.visible = false;
  preview3d.visible = false;
  if (pick && radial.highlight) choose(radial.highlight);
}

// Espacio de trabajo: grande, a tu alrededor y delante de ti. Mientras no empiezas a esculpir te
// sigue con la vista (suave); en cuanto tocas algo se queda quieto para no marear.
const WS = { scale: 1.3, dist: 0.6, drop: 0.25 };
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

function xrFrame(dt) {
  let right = null, left = null;
  for (const c of ctrls) {
    c.updateMatrixWorld(true);
    const src = c.userData.src;
    if (!src || !src.gamepad) continue;
    if (src.handedness === 'left') left = c;
    else right = c;
  }
  if (left && hud3d.parent !== left) left.add(hud3d, panel3d);
  hud3d.visible = !panel3d.visible; // con el panel abierto, el aviso de herramienta lo taparía
  if (right && ray.parent !== right) right.add(ray);
  const gpL = left?.userData.src.gamepad, gpR = right?.userData.src.gamepad;

  if (xr.follow) placeWorkspace(false, dt);

  // Grips: uno agarra y mueve el modelo (palanca adelante/atrás = más grande/más pequeño);
  // los dos a la vez también lo escalan, separando las manos.
  const gL = !!gpL?.buttons[1]?.pressed, gR = !!gpR?.buttons[1]?.pressed;
  const mode = gL && gR ? 'scale' : gL ? 'grabL' : gR ? 'grabR' : 'none';
  if (mode !== 'none') xr.follow = false;
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
    }
  }
  if (mode === 'grabL' || mode === 'grabR') {
    const c = mode === 'grabL' ? left : right;
    const stick = (mode === 'grabL' ? gpL : gpR).axes[3] || 0;
    if (Math.abs(stick) > 0.2) {
      // Se escala alrededor de la mano que agarra.
      const f = THREE.MathUtils.clamp(Math.exp(-stick * dt * 1.5), 0.05 / model.scale.x, 8 / model.scale.x);
      grabOffset.premultiply(tmpM.makeScale(f, f, f));
    }
    tmpM.multiplyMatrices(c.matrixWorld, grabOffset).decompose(model.position, model.quaternion, model.scale);
  } else if (mode === 'scale') {
    vA.setFromMatrixPosition(left.matrixWorld);
    vB.setFromMatrixPosition(right.matrixWorld);
    const s = THREE.MathUtils.clamp((scale0.s * vA.distanceTo(vB)) / scale0.d, 0.05, 8);
    model.scale.setScalar(s);
    model.position.copy(scale0.pos).sub(scale0.mid).multiplyScalar(s / scale0.s).add(scale0.mid);
  }
  model.updateMatrixWorld();

  // Mando izquierdo: clic stick = panel · stick ←/→ = deshacer/rehacer · stick ↑/↓ = fuerza
  //                  gatillo = invertir · X / Y = deshacer / rehacer
  if (gpL) {
    const inv = (gpL.buttons[0]?.value || 0) > 0.5;
    if (inv !== state.invert) { state.invert = inv; updateHud(); }
    const X = !!gpL.buttons[4]?.pressed, Y = !!gpL.buttons[5]?.pressed;
    if (X && !xr.xPrev) undo();
    if (Y && !xr.yPrev) redo();
    xr.xPrev = X; xr.yPrev = Y;
    const lStick = !!gpL.buttons[3]?.pressed;
    if (lStick && !xr.lStickPrev) {
      panel3d.visible = !panel3d.visible;
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
      updateHud();
    }
  }

  cursor.visible = cursorMirror.visible = false;
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
    const hit = panelRay.intersectObject(panel3d, false)[0];
    if (hit) {
      ray.visible = true;
      ray.scale.z = hit.distance;
      if (panel.pointer(hit.uv.x * PW, (1 - hit.uv.y) * PH, trigDown)) drawPanel();
      xr.trigPrev = trigDown;
      return;
    }
    if (panel.pointer(null, null, trigDown)) drawPanel();
  }

  // Menú radial: clic en el stick derecho (o mantener A/B). Eliges con el stick o moviendo la mano.
  const rStick = !!gpR.buttons[3]?.pressed;
  const ab = !!(gpR.buttons[4]?.pressed || gpR.buttons[5]?.pressed);
  if (!xr.menuOpen) {
    if (rStick && !xr.rStickPrev) openRadial3D(tipW, 'toggle');
    else if (ab && !xr.menuPrev) openRadial3D(tipW, 'hold');
  }
  if (xr.menuOpen) {
    let h = null;
    const p = menu3d.worldToLocal(tipW.clone());
    const k = radial.size / 0.26, cx = p.x * k, cy = -p.y * k;
    if (!trigDown) xr.radialDrag = -1;
    const si = xr.radialDrag >= 0 ? xr.radialDrag : Math.hypot(ax, ay) > 0.5 ? -1 : radial.sliderAt(cx, cy);
    if (si >= 0) {
      // Arcos de Tamaño / Estabilizar: apunta con la punta del mando y arrastra con el gatillo.
      h = 'slider:' + radial.sliders[si].id;
      if (trigDown) {
        xr.radialDrag = si;
        const before = radial.sliders[si].text();
        radial.sliders[si].set(radial.sliderValue(cx, cy));
        if (radial.sliders[si].text() !== before) gpR.hapticActuators?.[0]?.pulse?.(0.15, 8);
        updateHud();
        radialTex.needsUpdate = true;
      }
    } else if (Math.hypot(ax, ay) > 0.5) h = radial.itemAt(ax, ay);
    else if (radial.inside(cx * 0.8, cy * 0.8)) h = radial.itemAt(p.x, -p.y); // en VR, algo más de margen
    if (radial.setHighlight(h) | radial.tick()) {
      radial.draw(state, infoText());
      radialTex.needsUpdate = true;
    }
    updatePreview3D();
    if (xr.menuMode === 'hold' && !ab) closeRadial3D(true);
    else if (xr.menuMode === 'toggle' && ((rStick && !xr.rStickPrev && xr.menuOpenedFrame !== true) || (trigDown && !xr.trigPrev && !radial.highlight?.startsWith('slider:')))) {
      closeRadial3D(true);
    }
    xr.menuOpenedFrame = false;
    xr.rStickPrev = rStick;
    xr.menuPrev = ab;
    xr.trigPrev = trigDown;
    return;
  }
  xr.rStickPrev = rStick;
  xr.menuPrev = ab;
  xr.trigPrev = trigDown;

  // Stick derecho ↑/↓ = tamaño del pincel (o de la capa agarrada con Mover).
  if (Math.abs(ay) > 0.2 && moveOp.L) scaleMove(Math.exp(-ay * dt * 1.2));
  else if (Math.abs(ay) > 0.2 && !gR) {
    state.radius = clampRadius(state.radius * (1 - ay * dt * 1.5));
    drawHud3D();
  }
  cursor.position.fromArray(tipL);
  cursor.scale.setScalar(state.radius);
  updateCursorShape();
  cursor.visible = true;
  if (state.sym) {
    cursorMirror.position.set(-tipL[0], tipL[1], tipL[2]);
    cursorMirror.scale.setScalar(state.radius);
    cursorMirror.visible = true;
  }
  if (trig > 0.08) xr.follow = false;
  if (state.tool === 'move') {
    xrMove(right, gpR, tipL, trigDown);
    return;
  }
  if (trig > 0.08) {
    if (!xr.stroking) {
      beginStroke();
      xr.stroking = true;
      if (Math.max(Math.abs(tipL[0]), Math.abs(tipL[1]), Math.abs(tipL[2])) > 0.5) {
        toast('Estás fuera del espacio de trabajo: acércate al cubo');
        gpR.hapticActuators?.[0]?.pulse?.(0.8, 120);
      }
    }
    const q = stabilize(tipL);
    cursor.position.fromArray(q);
    if (state.sym) cursorMirror.position.set(-q[0], q[1], q[2]);
    applyAt(q, dt, 0.3 + 0.7 * trig);
    gpR.hapticActuators?.[0]?.pulse?.(0.05 * trig, 16);
  } else {
    xr.stroking = false;
    rope.visible = false;
  }
}

// Gatillo con Mover: agarra la capa que toca el cursor y la lleva con la mano (posición y giro).
const ctrlLocal = new THREE.Matrix4();
function xrMove(right, gp, tipL, down) {
  ctrlLocal.copy(model.matrixWorld).invert().multiply(right.matrixWorld);
  if (down && !moveOp.L && !xr.moveHeld) {
    xr.moveHeld = true;
    let best = null, bestD = state.radius;
    for (const L of layers) {
      if (!L.visible) continue;
      const d = L.grid.sample(tipL[0], tipL[1], tipL[2]);
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
  // Cambios de estructura (capas, resolución, remesh...): estado completo, agrupado.
  structure() {
    if (!this.emitting) return;
    clearTimeout(this.structTimer);
    this.structTimer = setTimeout(() => this.snapshot(), 250);
  },
  async snapshot() {
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
      bg: scene.background === null ? 'ar' : 'vr',
    });
  },
};

// Lado espectador: aplica los mensajes en orden (los binarios se descargan antes de seguir).
const inbox = [];
let inboxBusy = false;
async function onLiveMessage(m) {
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
    const res = L.grid.applyBrush(m.tool, m.a, m.b, m.r, m.s, m.inv, m.dt, null, m.paint, m.o);
    if (res) L.markDirty(res.lo, res.hi);
  } else if (m.t === 'blob') {
    const buf = await fetchBlob(m.id);
    if (m.kind === 'snap') applySnapshot(buf);
    else if (m.kind === 'patch' && synced) applyPatch(buf);
  }
}

// Escena completa (todas las capas) en un binario: espejo y autoguardado.
function packScene() {
  const meta = { active: active.id, layers: [] };
  const parts = [];
  for (const L of layers) {
    const s = L.grid.serialize();
    const lm = { id: L.id, name: L.name, color: L.color, visible: L.visible, grid: s.meta };
    parts.push(...s.parts);
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
    const { grid, off: o2 } = SDFGrid.deserialize(lm.grid, buf, off);
    off = o2;
    const L = new Layer(grid.n, 'empty', { id: lm.id, name: lm.name, color: lm.color, visible: lm.visible, grid });
    L.flush();
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
  bounds.visible = false;
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
  const dt = Math.min(clock.getDelta(), 0.05);
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
    cursorMirror.visible = !!hit && state.sym;
    if (hit && sculpting) hit = stabilize(hit);
    else rope.visible = false;
    if (hit) {
      cursor.position.set(hit[0], hit[1], hit[2]);
      cursor.scale.setScalar(state.radius);
      cursorMirror.position.set(-hit[0], hit[1], hit[2]);
      cursorMirror.scale.setScalar(state.radius);
      if (sculpting) applyAt(hit, dt);
    }
  }
  poseT += dt;
  if (poseT > 1 / 30) { poseT = 0; live.pose(); }
  // Re-mallado con presupuesto de tiempo: la capa activa primero, el resto después.
  if (active.dirty.size) active.flush(30);
  for (const L of layers) if (L !== active && L.dirty.size) L.flush(8);
  renderer.render(scene, camera);
});

// ---------- Autoguardado en las gafas (sin Wi-Fi no se pierde nada) ----------
let savedSig = '';
const sceneSig = () => active.id + '|' + layers.map((L) => [L.id, L.version, L.name, L.color, L.visible, !!L.remesh].join(':')).join('|');
async function autosave() {
  if (sculpting || layers.some((L) => L.busy)) return;
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
    if (!quiet) toast(t('Guardado: {0} (en las gafas)', o.name));
  } catch (e) {
    console.error(e);
    toast(t('No se pudo guardar: {0}', e.message));
  }
  updateHud();
}

function resetHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
}

async function openObra(id) {
  if (id === obraId) return;
  if (obraDirty()) await saveObra(false, true);
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

window.__miMedium = { state, choose, get layers() { return layers; }, active: () => active, remeshLayer, live, panel, drawPanel,
  glb: () => buildGLB(exportObjects()), webcam, changeLang, xrFrame, xr, ctrls, model, radial, renderer, setSpecView: SPECTATOR ? setSpecView : null, setFormat: SPECTATOR ? setFormat : null, camera, spectatorPose: SPECTATOR ? spectatorPose : null };
