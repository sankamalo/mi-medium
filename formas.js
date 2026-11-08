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

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
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

// Distancia con signo a la forma, para pasarla a vóxel. Se llama millones de veces: todo va en números
// sueltos, sin crear listas, que es lo que la hacía lentísima.
// Forma convexa (una caja, una pirámide...): la distancia es la del plano de cara más alejado, directa.
// Si no (tras extruir hacia un lado), distancia a los triángulos y dentro/fuera por número de vueltas.
export function shapeField(s) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of s.v) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a]); }
  const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
  // Planos de las caras: normal (hacia fuera) y desplazamiento.
  const P = new Float64Array(s.f.length * 4);
  s.f.forEach((f, i) => {
    const n = faceNormal(s, f);
    let d = 0;
    for (const k of f) d += dot(n, s.v[k]) / f.length;
    P.set([n[0], n[1], n[2], d], i * 4);
  });
  const planar = s.f.every((f, i) => f.every((k) => Math.abs(dot(P.subarray(i * 4, i * 4 + 3), s.v[k]) - P[i * 4 + 3]) < size * 1e-4));
  const convex = planar && s.f.every((_, i) => s.v.every((v) => dot(P.subarray(i * 4, i * 4 + 3), v) - P[i * 4 + 3] < size * 1e-4));
  const far = (x, y, z, f) => x < lo[0] - f || y < lo[1] - f || z < lo[2] - f || x > hi[0] + f || y > hi[1] + f || z > hi[2] + f;
  if (convex) {
    const nf = s.f.length;
    return {
      lo, hi, convex,
      at(x, y, z, f) {
        if (far(x, y, z, f)) return f;
        let d = -Infinity;
        for (let i = 0; i < nf * 4; i += 4) {
          const e = P[i] * x + P[i + 1] * y + P[i + 2] * z - P[i + 3];
          if (e > d) d = e;
        }
        return d;
      },
    };
  }
  const list = [];
  for (const f of s.f) for (let i = 1; i + 1 < f.length; i++) list.push(...s.v[f[0]], ...s.v[f[i]], ...s.v[f[i + 1]]);
  const T = new Float64Array(list), nt = T.length / 9;
  const tri = (px, py, pz, o) => {
    // Distancia al triángulo (Ericson, «Real-Time Collision Detection»), en escalares.
    const ax = T[o], ay = T[o + 1], az = T[o + 2], bx = T[o + 3], by = T[o + 4], bz = T[o + 5], cx = T[o + 6], cy = T[o + 7], cz = T[o + 8];
    const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    let qx, qy, qz;
    if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; } else {
      const bpx = px - bx, bpy = py - by, bpz = pz - bz;
      const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
      const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
      const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
      const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
      if (d3 >= 0 && d4 <= d3) { qx = bx; qy = by; qz = bz; }
      else if (d6 >= 0 && d5 <= d6) { qx = cx; qy = cy; qz = cz; }
      else if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); qx = ax + abx * v; qy = ay + aby * v; qz = az + abz * v; }
      else if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); qx = ax + acx * w; qy = ay + acy * w; qz = az + acz * w; }
      else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
        const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
        qx = bx + (cx - bx) * w; qy = by + (cy - by) * w; qz = bz + (cz - bz) * w;
      } else {
        const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
        qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w;
      }
    }
    return Math.hypot(px - qx, py - qy, pz - qz);
  };
  const solid = (px, py, pz, o) => {
    const xx = T[o] - px, xy = T[o + 1] - py, xz = T[o + 2] - pz;
    const yx = T[o + 3] - px, yy = T[o + 4] - py, yz = T[o + 5] - pz;
    const zx = T[o + 6] - px, zy = T[o + 7] - py, zz = T[o + 8] - pz;
    const lx = Math.hypot(xx, xy, xz), ly = Math.hypot(yx, yy, yz), lz = Math.hypot(zx, zy, zz);
    const det = xx * (yy * zz - yz * zy) + xy * (yz * zx - yx * zz) + xz * (yx * zy - yy * zx);
    const div = lx * ly * lz + (xx * yx + xy * yy + xz * yz) * lz + (yx * zx + yy * zy + yz * zz) * lx + (zx * xx + zy * xy + zz * xz) * ly;
    return 2 * Math.atan2(det, div);
  };
  return {
    lo, hi, convex,
    at(x, y, z, f) {
      if (far(x, y, z, f)) return f;
      let d = Infinity, w = 0;
      for (let t = 0; t < nt; t++) {
        const e = tri(x, y, z, t * 9);
        if (e < d) d = e;
        w += solid(x, y, z, t * 9);
      }
      return Math.abs(w) > 2 * Math.PI ? -d : d;
    },
  };
}

// Extruir: la cara sale con sus propias esquinas (pegadas al principio a las de antes) y una pared por
// cada lado. Cada pared recorre su arista en el mismo sentido que la cara que se va, para mirar hacia fuera.
export function extrudeFace(s, fi) {
  const f = s.f[fi], top = f.map((i) => (s.v.push([...s.v[i]]), s.v.length - 1));
  for (let k = 0; k < f.length; k++) {
    const a = f[k], b = f[(k + 1) % f.length];
    s.f.push([a, b, top[(k + 1) % f.length], top[k]]);
  }
  s.f[fi] = top;
  return top;
}
export const faceDir = (s, fi) => faceNormal(s, s.f[fi]);
