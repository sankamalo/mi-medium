// Formas paramétricas: cajas, pirámides y cuñas con la geometría mínima (una caja son 6 caras).
// Se editan moviendo sus esquinas, aristas o caras, y se pueden pasar a vóxel partiendo siempre de aquí.

// Caras en sentido antihorario vistas desde fuera.
const KINDS = {
  box: (s) => ({
    v: [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]].map((p) => p.map((x) => (x * s) / 2)),
    f: [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]],
  }),
  pyramid: (s) => ({
    v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1], [0, 1, 0]].map((p) => p.map((x) => (x * s) / 2)),
    f: [[0, 1, 2, 3], [0, 4, 1], [1, 4, 2], [2, 4, 3], [3, 4, 0]],
  }),
  wedge: (s) => ({
    v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1], [-1, 1, -1], [1, 1, -1]].map((p) => p.map((x) => (x * s) / 2)),
    f: [[0, 1, 2, 3], [0, 4, 5, 1], [3, 2, 5, 4], [0, 3, 4], [1, 5, 2]],
  }),
};
export const SHAPE_KINDS = Object.keys(KINDS);
export const newShape = (kind, size) => ({ kind, ...KINDS[kind](size) });
export const copyShape = (s) => ({ kind: s.kind, v: s.v.map((p) => [...p]), f: s.f.map((f) => [...f]) });

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

// Normal de una cara aunque no sea plana (método de Newell).
function faceNormal(s, f) {
  const n = [0, 0, 0];
  for (let i = 0; i < f.length; i++) {
    const a = s.v[f[i]], b = s.v[f[(i + 1) % f.length]];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = len(n) || 1;
  return n.map((x) => x / l);
}
// Cada cara con sus propios vértices, para las aristas duras. Los triángulos van como quads con el
// último vértice repetido (así los exporta el OBJ).
export function shapeMesh(s) {
  const pos = [], nor = [], quads = [];
  for (const f of s.f) {
    const n = faceNormal(s, f), i = pos.length / 3, ids = f.length === 3 ? [...f, f[2]] : f;
    for (const k of ids) {
      pos.push(...s.v[k]);
      nor.push(...n);
    }
    quads.push(i, i + 1, i + 2, i + 3);
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nor), quads: new Uint32Array(quads) };
}
// Lo que se puede coger: cada esquina, cada arista y cada cara, con los vértices que mueve.
export function shapeHandles(s) {
  const out = s.v.map((_, i) => ({ type: 'vertex', ids: [i] })), seen = new Set();
  for (const f of s.f) for (let i = 0; i < f.length; i++) {
    const a = f[i], b = f[(i + 1) % f.length], key = Math.min(a, b) + ':' + Math.max(a, b);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: 'edge', ids: [a, b] });
  }
  for (const f of s.f) out.push({ type: 'face', ids: [...f] });
  return out;
}
export const handlePos = (s, h) => {
  const c = [0, 0, 0];
  for (const i of h.ids) for (let a = 0; a < 3; a++) c[a] += s.v[i][a] / h.ids.length;
  return c;
};

// Distancia con signo a la forma, para pasarla a vóxel. El dentro/fuera se saca sumando cuánto
// "ve" el punto de cada triángulo (número de vueltas), que aguanta formas no convexas.
export function shapeField(s) {
  const tris = [];
  for (const f of s.f) for (let i = 1; i + 1 < f.length; i++) tris.push([s.v[f[0]], s.v[f[i]], s.v[f[i + 1]]]);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of s.v) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a]); }
  const triDist = (p, [a, b, c]) => {
    const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
    const d1 = dot(ab, ap), d2 = dot(ac, ap);
    if (d1 <= 0 && d2 <= 0) return len(ap);
    const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) return len(bp);
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return len(sub(ap, ab.map((x) => x * v))); }
    const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
    if (d6 >= 0 && d5 <= d6) return len(cp);
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return len(sub(ap, ac.map((x) => x * w))); }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); return len(sub(bp, sub(c, b).map((x) => x * w))); }
    const n = cross(ab, ac);
    return Math.abs(dot(ap, n)) / (len(n) || 1);
  };
  const solid = (p, [a, b, c]) => {
    const x = sub(a, p), y = sub(b, p), z = sub(c, p), lx = len(x), ly = len(y), lz = len(z);
    return 2 * Math.atan2(dot(x, cross(y, z)), lx * ly * lz + dot(x, y) * lz + dot(y, z) * lx + dot(z, x) * ly);
  };
  return {
    lo, hi,
    at(x, y, z, far) {
      const p = [x, y, z];
      if (x < lo[0] - far || y < lo[1] - far || z < lo[2] - far || x > hi[0] + far || y > hi[1] + far || z > hi[2] + far) return far;
      let d = Infinity, w = 0;
      for (const t of tris) {
        d = Math.min(d, triDist(p, t));
        w += solid(p, t);
      }
      return Math.abs(w) > 2 * Math.PI ? -d : d;
    },
  };
}

// Extruir: la cara sale con sus propias esquinas (pegadas al principio a las de antes) y una pared por
// cada lado. Las paredes recorren su arista al revés que la cara, para que todo mire hacia fuera.
export function extrudeFace(s, fi) {
  const f = s.f[fi], top = f.map((i) => (s.v.push([...s.v[i]]), s.v.length - 1));
  for (let k = 0; k < f.length; k++) {
    const a = f[k], b = f[(k + 1) % f.length];
    s.f.push([b, a, top[k], top[(k + 1) % f.length]]);
  }
  s.f[fi] = top;
  return top;
}
export const faceDir = (s, fi) => faceNormal(s, s.f[fi]);
