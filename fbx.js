// Escribe FBX binario (versión 7.4) sin Blender: así se puede exportar también desde las gafas.
// Blender solo lee FBX binario. Cada capa va como una pieza, con quads, normales y color por vértice.
const enc = new TextEncoder();
const HEAD = [...enc.encode('Kaydara FBX Binary  '), 0, 0x1a, 0];
const VERSION = 7400;
const FOOT_ID = [0xfa, 0xbc, 0xab, 0x09, 0xd0, 0xc8, 0xd4, 0x66, 0xb1, 0x76, 0xfb, 0x83, 0x1c, 0xf7, 0x26, 0x7e];
const FOOT_END = [0xf8, 0x5a, 0x8c, 0x6a, 0xde, 0xf5, 0xd9, 0x7e, 0xec, 0xe9, 0x0c, 0xe3, 0x75, 0x8f, 0x29, 0x0b];

// Propiedades: { t: tipo, v: valor }. 'd' e 'i' son listas (sin comprimir).
const I = (v) => ({ t: 'I', v }), L = (v) => ({ t: 'L', v }), D = (v) => ({ t: 'D', v }), S = (v) => ({ t: 'S', v: enc.encode(v) });
const DA = (v) => ({ t: 'd', v }), IA = (v) => ({ t: 'i', v });
const N = (name, props = [], kids = []) => ({ name, props, kids });
const propSize = (p) => ({ I: 5, L: 9, D: 9, C: 2 }[p.t] ?? (p.t === 'S' ? 5 + p.v.length : 13 + p.v.byteLength));
function nodeSize(n) {
  const own = 13 + n.name.length + n.props.reduce((a, p) => a + propSize(p), 0);
  return n.kids.length ? own + n.kids.reduce((a, k) => a + nodeSize(k), 0) + 13 : own;
}
function writeNode(w, n) {
  const start = w.off, plen = n.props.reduce((a, p) => a + propSize(p), 0);
  w.u32(start + nodeSize(n));
  w.u32(n.props.length);
  w.u32(plen);
  w.u8(n.name.length);
  w.bytes(enc.encode(n.name));
  for (const p of n.props) {
    w.u8(p.t.charCodeAt(0));
    if (p.t === 'I') w.i32(p.v);
    else if (p.t === 'L') w.i64(p.v);
    else if (p.t === 'D') w.f64(p.v);
    else if (p.t === 'C') w.u8(p.v ? 1 : 0);
    else if (p.t === 'S') { w.u32(p.v.length); w.bytes(p.v); }
    else {
      w.u32(p.v.length);
      w.u32(0);
      w.u32(p.v.byteLength);
      w.bytes(new Uint8Array(p.v.buffer, p.v.byteOffset, p.v.byteLength));
    }
  }
  if (n.kids.length) {
    n.kids.forEach((k) => writeNode(w, k));
    w.bytes(new Uint8Array(13));
  }
}
class Writer {
  constructor(size) {
    this.a = new Uint8Array(size);
    this.dv = new DataView(this.a.buffer);
    this.off = 0;
  }
  u8(v) { this.a[this.off++] = v; }
  u32(v) { this.dv.setUint32(this.off, v, true); this.off += 4; }
  i32(v) { this.dv.setInt32(this.off, v, true); this.off += 4; }
  i64(v) { this.dv.setBigInt64(this.off, BigInt(v), true); this.off += 8; }
  f64(v) { this.dv.setFloat64(this.off, v, true); this.off += 8; }
  bytes(b) { this.a.set(b, this.off); this.off += b.length; }
}

const P = (name, type, kind, flags, ...vals) => N('P', [S(name), S(type), S(kind), S(flags), ...vals]);
const SEP = '\u0000\u0001';

function geometryNode(id, name, m) {
  const nv = m.positions.length / 3;
  const idx = [];
  for (let i = 0; i < m.quads.length; i += 4) {
    const [a, b, c, d] = [m.quads[i], m.quads[i + 1], m.quads[i + 2], m.quads[i + 3]];
    // El último vértice de cada cara va en negativo; los triángulos llegan con c === d.
    if (c === d) idx.push(a, b, ~c);
    else idx.push(a, b, c, ~d);
  }
  const kids = [
    N('Vertices', [DA(Float64Array.from(m.positions))]),
    N('PolygonVertexIndex', [IA(Int32Array.from(idx))]),
    N('GeometryVersion', [I(124)]),
  ];
  const layer = [N('Version', [I(100)])];
  if (m.normals?.length === m.positions.length) {
    kids.push(N('LayerElementNormal', [I(0)], [
      N('Version', [I(101)]), N('Name', [S('')]),
      N('MappingInformationType', [S('ByVertice')]), N('ReferenceInformationType', [S('Direct')]),
      N('Normals', [DA(Float64Array.from(m.normals))]),
    ]));
    layer.push(N('LayerElement', [], [N('Type', [S('LayerElementNormal')]), N('TypedIndex', [I(0)])]));
  }
  if (m.colors?.length === m.positions.length) {
    const rgba = new Float64Array(nv * 4);
    for (let v = 0; v < nv; v++) {
      rgba[v * 4] = m.colors[v * 3]; rgba[v * 4 + 1] = m.colors[v * 3 + 1]; rgba[v * 4 + 2] = m.colors[v * 3 + 2]; rgba[v * 4 + 3] = 1;
    }
    kids.push(N('LayerElementColor', [I(0)], [
      N('Version', [I(101)]), N('Name', [S('Col')]),
      N('MappingInformationType', [S('ByPolygonVertex')]), N('ReferenceInformationType', [S('IndexToDirect')]),
      N('Colors', [DA(rgba)]),
      N('ColorIndex', [IA(Int32Array.from(idx, (v) => (v < 0 ? ~v : v)))]),
    ]));
    layer.push(N('LayerElement', [], [N('Type', [S('LayerElementColor')]), N('TypedIndex', [I(0)])]));
  }
  kids.push(N('LayerElementMaterial', [I(0)], [
    N('Version', [I(101)]), N('Name', [S('')]),
    N('MappingInformationType', [S('AllSame')]), N('ReferenceInformationType', [S('IndexToDirect')]),
    N('Materials', [IA(Int32Array.of(0))]),
  ]));
  layer.push(N('LayerElement', [], [N('Type', [S('LayerElementMaterial')]), N('TypedIndex', [I(0)])]));
  kids.push(N('Layer', [I(0)], layer));
  return N('Geometry', [L(id), S(name + SEP + 'Geometry'), S('Mesh')], kids);
}

// objects: [{ name, mesh: { positions, normals, colors, quads } }]. Devuelve un ArrayBuffer.
export function toFBX(objects) {
  let nextId = 1000;
  const objs = [], links = [];
  const link = (a, b) => links.push(N('C', [S('OO'), L(a), L(b)]));
  for (const { name, mesh } of objects) {
    const g = nextId++, m = nextId++, mat = nextId++;
    objs.push(geometryNode(g, name, mesh));
    objs.push(N('Model', [L(m), S(name + SEP + 'Model'), S('Mesh')], [
      N('Version', [I(232)]),
      N('Properties70', [], [P('Lcl Scaling', 'Lcl Scaling', '', 'A', D(1), D(1), D(1))]),
      N('Shading', [{ t: 'C', v: true }]),
      N('Culling', [S('CullingOff')]),
    ]));
    objs.push(N('Material', [L(mat), S(name + SEP + 'Material'), S('')], [
      N('Version', [I(102)]), N('ShadingModel', [S('lambert')]), N('MultiLayer', [I(0)]),
      N('Properties70', [], [P('DiffuseColor', 'Color', '', 'A', D(0.8), D(0.8), D(0.8))]),
    ]));
    link(g, m);
    link(mat, m);
    link(m, 0);
  }
  const count = (type, n) => N('ObjectType', [S(type)], [N('Count', [I(n)])]);
  const k = objects.length;
  const top = [
    N('FBXHeaderExtension', [], [
      N('FBXHeaderVersion', [I(1003)]), N('FBXVersion', [I(VERSION)]), N('Creator', [S('La Plastilina')]),
    ]),
    N('GlobalSettings', [], [
      N('Version', [I(1000)]),
      N('Properties70', [], [
        P('UpAxis', 'int', 'Integer', '', I(1)), P('UpAxisSign', 'int', 'Integer', '', I(1)),
        P('FrontAxis', 'int', 'Integer', '', I(2)), P('FrontAxisSign', 'int', 'Integer', '', I(1)),
        P('CoordAxis', 'int', 'Integer', '', I(0)), P('CoordAxisSign', 'int', 'Integer', '', I(1)),
        P('UnitScaleFactor', 'double', 'Number', '', D(100)), // 1 unidad de la app = 1 metro
      ]),
    ]),
    N('Definitions', [], [N('Version', [I(100)]), N('Count', [I(3 * k + 1)]), count('GlobalSettings', 1), count('Geometry', k), count('Model', k), count('Material', k)]),
    N('Objects', [], objs),
    N('Connections', [], links),
  ];
  const body = top.reduce((a, n) => a + nodeSize(n), 0);
  const end = HEAD.length + 4 + body + 13;
  const pad = 16 - (end + 16 + 4) % 16 || 16;
  const w = new Writer(end + 16 + 4 + pad + 4 + 120 + 16);
  w.bytes(Uint8Array.from(HEAD));
  w.u32(VERSION);
  top.forEach((n) => writeNode(w, n));
  w.bytes(new Uint8Array(13));
  w.bytes(Uint8Array.from(FOOT_ID));
  w.bytes(new Uint8Array(4 + pad));
  w.u32(VERSION);
  w.bytes(new Uint8Array(120));
  w.bytes(Uint8Array.from(FOOT_END));
  return w.a.buffer;
}
