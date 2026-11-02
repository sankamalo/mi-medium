// Texto en 3D: una tipografía recta propia, hecha de polígonos con pocas caras, que se extruye en quads
// con las aristas duras. Y un lector de letras escritas a mano que funciona dentro de la app, sin internet:
// lo que escribes no sale de las gafas.

const arc = (cx, cy, rx, ry, a0, a1, n) => {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
};
const pts = (...v) => {
  const out = [];
  for (let i = 0; i < v.length; i += 2) out.push([v[i], v[i + 1]]);
  return out;
};
const mirror = (list, w, h) => list.map((c) => c.map(([x, y]) => [w - x, h - y]));

const O_HOLE = arc(46, 50, 20, 26, 0, 360, 8).slice(0, -1);
const P_HOLE = pts(26, 56, 48, 56, 56, 62, 56, 74, 48, 80, 26, 80);
const SIX = [pts(0, 30, 10, 8, 40, 0, 72, 8, 84, 30, 72, 54, 46, 62, 72, 100, 42, 100, 6, 50), pts(28, 30, 34, 24, 50, 24, 56, 30, 50, 38, 34, 38)];

// Cada letra: su ancho y sus contornos (el de fuera y los agujeros), en un cuadro de 100 de alto.
const GLYPHS = {
  A: [90, pts(0, 0, 28, 0, 33, 20, 57, 20, 62, 0, 90, 0, 58, 100, 32, 100), pts(39, 40, 51, 40, 45, 66)],
  B: [76, pts(0, 0, 50, 0, 68, 8, 76, 26, 70, 42, 60, 52, 68, 62, 73, 76, 66, 92, 50, 100, 0, 100), pts(26, 20, 44, 20, 50, 30, 44, 40, 26, 40), pts(26, 60, 42, 60, 47, 70, 42, 80, 26, 80)],
  C: [86, [...arc(50, 50, 50, 50, 40, 320, 9), ...arc(50, 50, 25, 25, 320, 40, 7)]],
  // La D del Premio Drago: palo recto, base plana y la curva hecha con cinco caras.
  D: [94, [[0, 0], ...arc(44, 50, 50, 50, -90, 90, 5), [0, 100]], [[26, 24], ...arc(44, 50, 26, 26, -90, 90, 4), [26, 76]]],
  E: [72, pts(0, 0, 72, 0, 72, 22, 26, 22, 26, 40, 64, 40, 64, 60, 26, 60, 26, 78, 72, 78, 72, 100, 0, 100)],
  F: [70, pts(0, 0, 26, 0, 26, 38, 62, 38, 62, 58, 26, 58, 26, 78, 70, 78, 70, 100, 0, 100)],
  G: [100, [...arc(50, 50, 50, 50, 45, 360, 10), [54, 50], [54, 30], [68, 30], ...arc(50, 50, 25, 25, 315, 45, 7)]],
  H: [84, pts(0, 0, 26, 0, 26, 38, 58, 38, 58, 0, 84, 0, 84, 100, 58, 100, 58, 60, 26, 60, 26, 100, 0, 100)],
  I: [26, pts(0, 0, 26, 0, 26, 100, 0, 100)],
  J: [66, [[66, 100], ...arc(33, 33, 33, 33, 0, -180, 5), ...pts(26, 36, 27, 28, 33, 24, 39, 28, 40, 36, 40, 100)]],
  K: [88, pts(0, 0, 26, 0, 26, 32, 34, 42, 58, 0, 88, 0, 52, 60, 86, 100, 56, 100, 26, 62, 26, 100, 0, 100)],
  L: [68, pts(0, 0, 68, 0, 68, 24, 26, 24, 26, 100, 0, 100)],
  M: [100, pts(0, 0, 24, 0, 24, 58, 44, 20, 56, 20, 76, 58, 76, 0, 100, 0, 100, 100, 74, 100, 50, 52, 26, 100, 0, 100)],
  N: [84, pts(0, 0, 24, 0, 24, 56, 60, 0, 84, 0, 84, 100, 60, 100, 60, 44, 24, 100, 0, 100)],
  Ñ: [84, pts(0, 0, 24, 0, 24, 56, 60, 0, 84, 0, 84, 100, 60, 100, 60, 44, 24, 100, 0, 100), pts(12, 110, 30, 124, 54, 114, 72, 124, 72, 138, 54, 128, 30, 138, 12, 124)],
  O: [92, arc(46, 50, 46, 50, 0, 360, 12).slice(0, -1), O_HOLE],
  P: [82, [[0, 0], [26, 0], [26, 36], ...arc(50, 68, 32, 32, -90, 90, 4), [0, 100]], P_HOLE],
  Q: [98, [...arc(46, 50, 46, 50, -30, 290, 11), [80, -10], [98, 6], [84, 18]], O_HOLE],
  R: [86, pts(0, 0, 26, 0, 26, 36, 36, 36, 56, 0, 86, 0, 62, 42, 76, 52, 82, 68, 76, 88, 50, 100, 0, 100), P_HOLE],
  S: [84, pts(4, 4, 20, 0, 58, 0, 76, 8, 84, 28, 76, 46, 56, 56, 32, 62, 30, 70, 36, 76, 74, 76, 74, 98, 62, 100, 26, 100, 8, 92, 0, 72, 8, 54, 28, 44, 52, 38, 56, 30, 50, 24, 4, 24)],
  T: [78, pts(26, 0, 52, 0, 52, 78, 78, 78, 78, 100, 0, 100, 0, 78, 26, 78)],
  U: [84, [[0, 100], ...arc(42, 34, 42, 34, 180, 360, 6), ...pts(84, 100, 58, 100, 58, 36, 54, 26, 42, 23, 30, 26, 26, 36, 26, 100)]],
  V: [86, pts(30, 0, 56, 0, 86, 100, 58, 100, 43, 42, 28, 100, 0, 100)],
  W: [112, pts(20, 0, 44, 0, 56, 46, 68, 0, 92, 0, 112, 100, 86, 100, 78, 40, 66, 90, 46, 90, 34, 40, 26, 100, 0, 100)],
  X: [88, pts(0, 0, 30, 0, 44, 30, 58, 0, 88, 0, 60, 50, 86, 100, 58, 100, 44, 70, 30, 100, 2, 100, 28, 50)],
  Y: [88, pts(30, 0, 56, 0, 56, 38, 88, 100, 58, 100, 43, 66, 28, 100, 0, 100, 30, 38)],
  Z: [76, pts(0, 0, 76, 0, 76, 22, 34, 22, 76, 80, 76, 100, 2, 100, 2, 78, 42, 78, 0, 20)],
  0: [80, arc(40, 50, 40, 50, 0, 360, 12).slice(0, -1), arc(40, 50, 15, 26, 0, 360, 8).slice(0, -1)],
  1: [48, pts(22, 0, 48, 0, 48, 100, 26, 100, 0, 78, 0, 54, 22, 70)],
  2: [78, pts(0, 0, 76, 0, 76, 22, 36, 22, 68, 50, 78, 70, 70, 90, 48, 100, 22, 100, 2, 90, 0, 66, 24, 66, 30, 76, 46, 76, 52, 68, 46, 58, 0, 18)],
  3: [84, pts(2, 8, 22, 0, 56, 0, 76, 8, 84, 28, 76, 44, 66, 52, 74, 62, 78, 76, 70, 92, 52, 100, 10, 100, 10, 78, 46, 78, 52, 72, 46, 62, 26, 62, 26, 42, 50, 42, 56, 34, 50, 24, 2, 24)],
  4: [86, pts(48, 0, 72, 0, 72, 22, 86, 22, 86, 42, 72, 42, 72, 100, 48, 100, 0, 42, 0, 22, 48, 22), pts(48, 42, 48, 68, 26, 42)],
  5: [84, pts(4, 4, 20, 0, 54, 0, 74, 8, 84, 30, 74, 52, 54, 62, 28, 62, 28, 78, 76, 78, 76, 100, 6, 100, 2, 42, 46, 42, 56, 36, 56, 26, 46, 22, 4, 22)],
  6: [84, ...SIX],
  7: [78, pts(20, 0, 46, 0, 78, 78, 78, 100, 0, 100, 0, 78, 46, 78)],
  8: [84, pts(12, 52, 2, 30, 12, 8, 42, 0, 72, 8, 82, 30, 72, 52, 78, 72, 68, 92, 42, 100, 16, 92, 6, 72), pts(28, 24, 56, 24, 58, 32, 54, 40, 30, 40, 26, 32), pts(32, 60, 52, 60, 54, 68, 52, 78, 32, 78, 30, 68)],
  9: [84, ...mirror(SIX, 84, 100)],
  '.': [26, pts(0, 0, 26, 0, 26, 24, 0, 24)],
  ',': [28, pts(0, 0, 8, -18, 28, -18, 26, 24, 0, 24)],
  '-': [50, pts(0, 38, 50, 38, 50, 60, 0, 60)],
  '!': [26, pts(2, 34, 24, 34, 26, 100, 0, 100), pts(0, 0, 26, 0, 26, 24, 0, 24)],
};
export const TEXT_KEYS = Object.keys(GLYPHS);
const SPACE = 50, GAP = 12;

const areaOf = (c) => c.reduce((a, [x, y], i) => { const [u, v] = c[(i + 1) % c.length]; return a + x * v - u * y; }, 0);
const insideOf = (x, y, c) => {
  let on = false;
  for (let i = 0, j = c.length - 1; i < c.length; j = i++) if ((c[i][1] > y) !== (c[j][1] > y) && x < ((c[j][0] - c[i][0]) * (y - c[i][1])) / (c[j][1] - c[i][1]) + c[i][0]) on = !on;
  return on;
};
// Contornos colocados en la frase: los de fuera en un sentido y los agujeros en el otro, para saber hacia dónde mira cada pared.
function layout(str, height) {
  const k = height / 100, out = [];
  let x = 0;
  for (const ch of str) {
    const g = GLYPHS[ch];
    if (!g) { x += SPACE; continue; }
    const contours = g.slice(1).map((c) => {
      const hole = g.slice(1).some((o) => o !== c && insideOf(c[0][0], c[0][1], o));
      const ok = areaOf(c) > 0 !== hole;
      const list = (ok ? c : [...c].reverse()).map(([u, v]) => [x + u, v - 50]);
      return list;
    });
    out.push({ contours, x0: x, x1: x + g[0] });
    x += g[0] + GAP;
  }
  const w = out.length ? out.at(-1).x1 : 0;
  for (const L of out) {
    L.contours = L.contours.map((c) => c.map(([u, v]) => [(u - w / 2) * k, v * k]));
    let lo = Infinity, hi = -Infinity, ylo = Infinity, yhi = -Infinity;
    for (const c of L.contours) for (const [u, v] of c) { lo = Math.min(lo, u); hi = Math.max(hi, u); ylo = Math.min(ylo, v); yhi = Math.max(yhi, v); }
    Object.assign(L, { lo, hi, ylo, yhi });
  }
  return { letters: out, width: w * k };
}
// La cara de una letra cortada en tiras horizontales: cada trozo entre dos cortes tiene cuatro lados.
function capQuads(contours) {
  const ys = [...new Set(contours.flat().map((p) => p[1]))].sort((a, b) => a - b), out = [];
  for (let i = 0; i + 1 < ys.length; i++) {
    const y0 = ys[i], y1 = ys[i + 1], cuts = [];
    for (const c of contours) for (let j = 0; j < c.length; j++) {
      const a = c[j], b = c[(j + 1) % c.length];
      const lo = a[1] < b[1] ? a : b, hi = a[1] < b[1] ? b : a;
      if (lo[1] > y0 || hi[1] < y1 || lo[1] === hi[1]) continue;
      const at = (y) => lo[0] + ((hi[0] - lo[0]) * (y - lo[1])) / (hi[1] - lo[1]);
      cuts.push([at(y0), at(y1)]);
    }
    cuts.sort((a, b) => a[0] + a[1] - b[0] - b[1]);
    for (let j = 0; j + 1 < cuts.length; j += 2) out.push([cuts[j][0], cuts[j + 1][0], cuts[j + 1][1], cuts[j][1], y0, y1]);
  }
  return out;
}
// La malla: cada cara con sus propios vértices, para que las aristas queden duras.
export function textMesh(str, height, depth) {
  const { letters, width } = layout(str, height);
  const pos = [], nor = [], quads = [], z = depth / 2;
  const face = (a, b, c, d, n) => {
    const i = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    for (let k = 0; k < 4; k++) nor.push(...n);
    quads.push(i, i + 1, i + 2, i + 3);
  };
  for (const L of letters) {
    for (const [x0, x1, x2, x3, y0, y1] of capQuads(L.contours)) {
      face([x0, y0, z], [x1, y0, z], [x2, y1, z], [x3, y1, z], [0, 0, 1]);
      face([x3, y1, -z], [x2, y1, -z], [x1, y0, -z], [x0, y0, -z], [0, 0, -1]);
    }
    for (const c of L.contours) for (let i = 0; i < c.length; i++) {
      const a = c[i], b = c[(i + 1) % c.length], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      face([a[0], a[1], -z], [b[0], b[1], -z], [b[0], b[1], z], [a[0], a[1], z], [dy / l, -dx / l, 0]);
    }
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nor), quads: new Uint32Array(quads), width, letters };
}
// Distancia con signo a las letras ya extruidas, para convertirlas en vóxel.
export function textField(str, height, depth) {
  const { letters, width } = layout(str, height), hz = depth / 2;
  let ylo = 0, yhi = 0;
  for (const L of letters) { ylo = Math.min(ylo, L.ylo); yhi = Math.max(yhi, L.yhi); }
  const flat = (x, y, far) => {
    let best = far, inside = false;
    for (const L of letters) {
      if (x < L.lo - far || x > L.hi + far || y < L.ylo - far || y > L.yhi + far) continue;
      for (const c of L.contours) for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
        const ax = c[j][0], ay = c[j][1], bx = c[i][0], by = c[i][1], dx = bx - ax, dy = by - ay;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
        best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
        if ((by > y) !== (ay > y) && x < bx + ((ax - bx) * (y - by)) / (ay - by)) inside = !inside;
      }
    }
    return inside ? -best : best;
  };
  return {
    lo: [-width / 2, ylo, -hz], hi: [width / 2, yhi, hz],
    at(x, y, z, far) {
      const a = flat(x, y, far), b = Math.abs(z) - hz;
      return Math.min(Math.max(a, b), 0) + Math.hypot(Math.max(a, 0), Math.max(b, 0));
    },
  };
}

// ---------- Lector de letras ----------
// Nube de puntos ($P): compara la forma sin mirar en qué orden ni dirección hiciste los trazos.
const SK = (...strokes) => strokes.map((s) => pts(...s));
const curve = (cx, cy, rx, ry, a0, a1, n = 8) => arc(cx, cy, rx, ry, a0, a1, n);
export const MODELS = {
  A: [SK([0, 0, 50, 100, 100, 0], [20, 40, 80, 40])],
  B: [[[[0, 0], [0, 100]], [[0, 100], ...curve(35, 75, 30, 25, 90, -90), [0, 50]], [[0, 50], ...curve(38, 25, 34, 25, 90, -90), [0, 0]]]],
  C: [[curve(50, 50, 50, 50, 50, 310, 12)]],
  D: [[[[0, 0], [0, 100]], [[0, 100], ...curve(20, 50, 60, 50, 90, -90, 10), [0, 0]]]],
  E: [SK([70, 100, 0, 100, 0, 0, 70, 0], [0, 50, 55, 50])],
  F: [SK([70, 100, 0, 100, 0, 0], [0, 50, 55, 50])],
  G: [[[...curve(50, 50, 50, 50, 50, 340, 12), [100, 45], [55, 45]]]],
  H: [SK([0, 0, 0, 100], [80, 0, 80, 100], [0, 50, 80, 50])],
  I: [SK([0, 0, 0, 100])],
  J: [[[[60, 100], ...curve(30, 30, 30, 30, 0, -180)]], [[[60, 100], ...curve(30, 30, 30, 30, 0, -180)], [[20, 100], [100, 100]]]],
  K: [SK([0, 0, 0, 100], [70, 100, 0, 45, 75, 0])],
  L: [SK([0, 100, 0, 0, 65, 0])],
  M: [SK([0, 0, 0, 100, 50, 25, 100, 100, 100, 0])],
  N: [SK([0, 0, 0, 100, 75, 0, 75, 100])],
  Ñ: [SK([0, 0, 0, 80, 70, 0, 70, 80], [5, 100, 25, 112, 45, 100, 65, 112])],
  O: [[curve(45, 50, 45, 50, 0, 360, 14)]],
  P: [[[[0, 0], [0, 100]], [[0, 100], ...curve(35, 72, 32, 28, 90, -90), [0, 44]]]],
  Q: [[curve(45, 50, 45, 50, 0, 360, 14), [[55, 28], [95, -8]]]],
  R: [[[[0, 0], [0, 100]], [[0, 100], ...curve(35, 72, 32, 28, 90, -90), [0, 44]], [[25, 44], [75, 0]]]],
  S: [[[...curve(40, 74, 34, 26, 40, 270, 8), ...curve(40, 26, 36, 26, 90, -140, 8)]]],
  T: [SK([0, 100, 80, 100], [40, 100, 40, 0])],
  U: [[[[0, 100], ...curve(38, 35, 38, 35, 180, 360), [76, 100]]]],
  V: [SK([0, 100, 42, 0, 84, 100])],
  W: [SK([0, 100, 25, 0, 52, 70, 78, 0, 105, 100])],
  X: [SK([0, 0, 80, 100], [80, 0, 0, 100])],
  Y: [SK([0, 100, 42, 50, 84, 100], [42, 50, 42, 0])],
  Z: [SK([0, 100, 75, 100, 0, 0, 75, 0])],
  0: [[curve(32, 50, 32, 50, 0, 360, 14)]],
  1: [SK([0, 72, 26, 100, 26, 0])],
  2: [[[...curve(36, 70, 36, 30, 160, -40, 8), [0, 0], [75, 0]]]],
  3: [[[...curve(34, 74, 32, 26, 150, -90, 7), ...curve(34, 26, 38, 26, 90, -150, 7)]]],
  4: [SK([55, 100, 0, 30, 80, 30], [55, 100, 55, 0]), SK([50, 100, 0, 35, 70, 35], [55, 60, 55, 0])],
  5: [[[[70, 100], [10, 100], [5, 58], ...curve(32, 32, 38, 30, 60, -150, 8)]]],
  6: [[[[60, 100], ...curve(36, 32, 36, 32, 150, 500, 12)]]],
  7: [SK([0, 100, 75, 100, 28, 0])],
  8: [[[...curve(36, 74, 28, 26, -90, 270, 10), ...curve(36, 25, 34, 25, 90, 450, 10)]]],
  9: [[[...curve(36, 68, 34, 32, -30, 330, 12), [70, 68], [52, 0]]]],
};
const N = 40;
function cloud(strokes) {
  const list = strokes.filter((s) => s.length);
  let len = 0;
  for (const s of list) for (let i = 1; i < s.length; i++) len += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
  const out = [], step = len / (N - 1) || 1;
  let left = 0;
  for (const s of list) {
    let p = s[0];
    if (!out.length) out.push(p);
    for (let i = 1; i < s.length; i++) {
      let q = s[i], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      while (left + d >= step && d > 0) {
        const t = (step - left) / d;
        p = [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
        out.push(p);
        d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        left = 0;
      }
      left += d;
      p = q;
    }
  }
  while (out.length < N) out.push(list.length ? list.at(-1).at(-1) : [0, 0]);
  out.length = N;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, cx = 0, cy = 0;
  for (const [x, y] of out) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); cx += x; cy += y; }
  const k = Math.max(x1 - x0, y1 - y0) || 1;
  cx /= N; cy /= N;
  return out.map(([x, y]) => [(x - cx) / k, (y - cy) / k]);
}
function pass(a, b, start) {
  const used = new Uint8Array(N);
  let sum = 0, i = start;
  do {
    let best = Infinity, at = -1;
    for (let j = 0; j < N; j++) {
      if (used[j]) continue;
      const dx = a[i][0] - b[j][0], dy = a[i][1] - b[j][1], d = dx * dx + dy * dy;
      if (d < best) { best = d; at = j; }
    }
    used[at] = 1;
    sum += (1 - ((i - start + N) % N) / N) * Math.sqrt(best);
    i = (i + 1) % N;
  } while (i !== start);
  return sum;
}
function distance(a, b) {
  let best = Infinity;
  for (let s = 0; s < N; s += 6) best = Math.min(best, pass(a, b, s), pass(b, a, s));
  return best;
}
let models = null;
const allModels = () => (models ||= Object.entries(MODELS).flatMap(([ch, vs]) => vs.map((v) => ({ ch, c: cloud(v) }))));
// Las letras parecidas, de más a menos: la primera es la que se escribe y las otras se ofrecen para corregir.
export function readLetter(strokes) {
  const c = cloud(strokes), best = new Map();
  for (const m of allModels()) {
    const d = distance(c, m.c);
    if (!best.has(m.ch) || d < best.get(m.ch)) best.set(m.ch, d);
  }
  return [...best].sort((a, b) => a[1] - b[1]).slice(0, 4).map(([ch]) => ch);
}
// Separa los trazos en letras: van juntos los que se solapan de lado a lado.
export function splitLetters(strokes) {
  const list = strokes.filter((s) => s.length).map((s) => ({ s, lo: Math.min(...s.map((p) => p[0])), hi: Math.max(...s.map((p) => p[0])), yl: Math.min(...s.map((p) => p[1])), yh: Math.max(...s.map((p) => p[1])) }));
  list.sort((a, b) => a.lo - b.lo);
  const groups = [];
  for (const t of list) {
    const g = groups.at(-1);
    const overlap = g ? Math.min(g.hi, t.hi) - t.lo : -1;
    if (g && overlap > Math.min(g.hi - g.lo, t.hi - t.lo) * 0.25) {
      g.strokes.push(t.s);
      g.hi = Math.max(g.hi, t.hi);
      g.yl = Math.min(g.yl, t.yl);
      g.yh = Math.max(g.yh, t.yh);
    } else groups.push({ strokes: [t.s], lo: t.lo, hi: t.hi, yl: t.yl, yh: t.yh });
  }
  return groups;
}
