// Sellos: piezas ya modeladas que se ponen de un golpe, como un sello de caucho sobre la plastilina.
// Cada sello es un campo de distancias en un espacio de -1 a 1 (1 = el tamaño del pincel), mirando
// hacia +z. Sus partes llevan color propio; las que no, usan el color del pincel. Los que haces tú
// son una rejilla pequeña sacada de una capa, y se guardan en las gafas.

const hyp = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
const sph = (cx, cy, cz, r) => (x, y, z) => hyp(x - cx, y - cy, z - cz) - r;
const ell = (cx, cy, cz, rx, ry, rz) => {
  const m = Math.min(rx, ry, rz);
  return (x, y, z) => (hyp((x - cx) / rx, (y - cy) / ry, (z - cz) / rz) - 1) * m;
};
const cap = (a, b, r) => {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2], l2 = bx * bx + by * by + bz * bz || 1;
  return (x, y, z) => {
    const px = x - a[0], py = y - a[1], pz = z - a[2];
    const t = Math.max(0, Math.min(1, (px * bx + py * by + pz * bz) / l2));
    return hyp(px - bx * t, py - by * t, pz - bz * t) - r;
  };
};
const box = (cx, cy, cz, ex, ey, ez, r) => (x, y, z) => {
  const qx = Math.abs(x - cx) - ex + r, qy = Math.abs(y - cy) - ey + r, qz = Math.abs(z - cz) - ez + r;
  return hyp(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
};
const both = (a, b) => (x, y, z) => Math.max(a(x, y, z), b(x, y, z));
const flatZ = (f, k) => (x, y, z) => f(x, y, z * k) / k;
const arc = (cx, cy, R, from, to, r, z = 0, n = 8) => {
  const parts = [];
  const at = (i) => { const a = (from + ((to - from) * i) / n) * (Math.PI / 180); return [cx + Math.cos(a) * R, cy + Math.sin(a) * R, z]; };
  for (let i = 0; i < n; i++) parts.push(cap(at(i), at(i + 1), r));
  return (x, y, z2) => { let d = 9; for (const p of parts) d = Math.min(d, p(x, y, z2)); return d; };
};

const WHITE = [246, 243, 234], BLACK = [24, 22, 20], PINK = [240, 130, 160], MOUTH = [88, 22, 34], DARK = [60, 40, 34];
const YELLOW = [245, 196, 40], STONE = [146, 140, 132], CREAM = [238, 224, 196], RED = [214, 44, 44];
// part(campo, color, suavidad con lo anterior). Sin color = el del pincel.
const part = (f, c = null, k = 0) => ({ f, c, k });
const eyes = (x, y, z, r) => [part(sph(-x, y, z, r), BLACK), part(sph(x, y, z, r), BLACK)];

// Corazón: su silueta plana con grosor y cantos redondos.
function heart(x, y, z) {
  const k = 0.72, px = Math.abs(x) * k, py = (y + 0.8) * k;
  let d;
  if (py + px > 1) d = Math.sqrt((px - 0.25) ** 2 + (py - 0.75) ** 2) - Math.SQRT2 / 4;
  else {
    const m = 0.5 * Math.max(px + py, 0);
    d = Math.sqrt(Math.min(px * px + (py - 1) ** 2, (px - m) ** 2 + (py - m) ** 2)) * Math.sign(px - py);
  }
  d /= k;
  const qz = Math.abs(z) - 0.2;
  return Math.min(Math.max(d, qz), 0) + Math.sqrt(Math.max(d, 0) ** 2 + Math.max(qz, 0) ** 2) - 0.12;
}

const BUILT = {
  ojo: ['Ojo', [part(sph(0, 0, 0, 0.84), WHITE), part(sph(0, 0, 0.5, 0.46), BLACK), part(sph(0.18, 0.2, 0.86, 0.12), WHITE)]],
  dormido: ['Ojo dormido', [part(sph(0, 0, 0, 0.8), WHITE), part(sph(0, -0.2, 0.46, 0.38), BLACK),
    part(both(sph(0, 0, 0, 0.88), (x, y) => 0.08 - y))]],
  sonrisa: ['Sonrisa', [part(arc(0, 0.5, 0.95, 205, 335, 0.17), MOUTH)]],
  boca: ['Boca abierta', [part(ell(0, 0, 0, 0.82, 0.62, 0.34), MOUTH), part(ell(0, -0.28, 0.24, 0.46, 0.26, 0.17), PINK),
    part(box(0, 0.42, 0.22, 0.42, 0.11, 0.12, 0.04), WHITE)]],
  gato: ['Gato', [part(ell(0, -0.12, 0, 0.78, 0.66, 0.62)),
    part(cap([-0.5, 0.25, 0], [-0.62, 0.86, 0], 0.15), null, 0.18), part(cap([0.5, 0.25, 0], [0.62, 0.86, 0], 0.15), null, 0.18),
    ...eyes(0.29, 0, 0.5, 0.12), part(sph(0, -0.2, 0.6, 0.09), PINK),
    part(cap([-0.34, -0.26, 0.52], [-0.92, -0.16, 0.42], 0.03), DARK), part(cap([0.34, -0.26, 0.52], [0.92, -0.16, 0.42], 0.03), DARK)]],
  conejo: ['Conejo', [part(ell(0, -0.34, 0, 0.62, 0.56, 0.54)),
    part(ell(-0.28, 0.48, 0, 0.17, 0.5, 0.15), null, 0.14), part(ell(0.28, 0.48, 0, 0.17, 0.5, 0.15), null, 0.14),
    ...eyes(0.24, -0.22, 0.44, 0.1), part(sph(0, -0.42, 0.52, 0.08), PINK)]],
  pez: ['Pez', [part(ell(-0.14, 0, 0, 0.74, 0.5, 0.34)),
    part(cap([0.5, 0, 0], [0.92, 0.4, 0], 0.15), null, 0.14), part(cap([0.5, 0, 0], [0.92, -0.4, 0], 0.15), null, 0.14),
    part(sph(-0.5, 0.14, 0.24, 0.15), WHITE), part(sph(-0.53, 0.15, 0.33, 0.08), BLACK)]],
  pajaro: ['Pájaro', [part(sph(0, -0.2, 0, 0.62)), part(sph(0, 0.44, 0.08, 0.42), null, 0.22),
    part(cap([0, 0.42, 0.44], [0, 0.36, 0.74], 0.09), YELLOW), ...eyes(0.18, 0.54, 0.4, 0.08),
    part(ell(-0.6, -0.2, 0, 0.14, 0.38, 0.3), null, 0.08), part(ell(0.6, -0.2, 0, 0.14, 0.38, 0.3), null, 0.08)]],
  piedra: ['Piedra', [part((x, y, z) => hyp(x, y * 1.2, z) - 0.8
    + 0.09 * Math.sin(x * 5 + y * 2) * Math.sin(y * 4 + z * 3) + 0.05 * Math.sin(z * 9 - x * 6) + 0.03 * Math.sin(y * 13 + x * 11), STONE)]],
  seta: ['Seta', [part(cap([0, -0.9, 0], [0, -0.1, 0], 0.27), CREAM),
    part(both(ell(0, 0, 0, 0.92, 0.72, 0.92), (x, y) => -0.06 - y), RED),
    part(sph(0, 0.66, 0.2, 0.14), WHITE), part(sph(-0.46, 0.34, 0.54, 0.13), WHITE), part(sph(0.5, 0.3, 0.5, 0.13), WHITE), part(sph(0.2, 0.38, 0.72, 0.1), WHITE)]],
  flor: ['Flor', [...[90, 162, 234, 306, 18].map((a) => {
    const r = (a * Math.PI) / 180;
    return part(flatZ(sph(Math.cos(r) * 0.56, Math.sin(r) * 0.56, 0, 0.38), 2));
  }), part(flatZ(sph(0, 0, 0.06, 0.3), 1.5), YELLOW)]],
  corazon: ['Corazón', [part(heart)]],
};

function partsEval(parts) {
  return (x, y, z, out) => {
    let d = 9, best = 9, c = null;
    for (const p of parts) {
      const v = p.f(x, y, z);
      if (p.k) { const h = Math.max(p.k - Math.abs(d - v), 0) / p.k; d = Math.min(d, v) - h * h * p.k * 0.25; } else d = Math.min(d, v);
      if (v < best) { best = v; c = p.c; }
    }
    out.d = d; out.c = c;
  };
}

// Registro compartido con el motor (sdf.js lo recibe por opts.stampEval al esculpir).
export const STAMPS = new Map(Object.entries(BUILT).map(([key, [name, parts]]) => ['stamp:' + key, { id: 'stamp:' + key, name, eval: partsEval(parts) }]));
export const STAMP_REACH = 1.8;

// Un sello hecho por ti: { n, d: Int8Array (distancia × 127, en -1..1 de la caja), c: Uint8Array RGBA }.
function gridEval(s) {
  const { n, d, c } = s, k = (n - 1) / 2;
  const at = (i, j, l) => d[i + n * (j + n * l)] / 127;
  return (x, y, z, out) => {
    // Fuera de la caja: la distancia al borde, más lo que diga el borde.
    const cx = Math.max(-1, Math.min(1, x)), cy = Math.max(-1, Math.min(1, y)), cz = Math.max(-1, Math.min(1, z));
    const extra = hyp(x - cx, y - cy, z - cz);
    const fx = Math.min((cx + 1) * k, n - 1.001), fy = Math.min((cy + 1) * k, n - 1.001), fz = Math.min((cz + 1) * k, n - 1.001);
    const i = fx | 0, j = fy | 0, l = fz | 0, tx = fx - i, ty = fy - j, tz = fz - l;
    const lerp = (a, b, t) => a + (b - a) * t;
    const v = lerp(
      lerp(lerp(at(i, j, l), at(i + 1, j, l), tx), lerp(at(i, j + 1, l), at(i + 1, j + 1, l), tx), ty),
      lerp(lerp(at(i, j, l + 1), at(i + 1, j, l + 1), tx), lerp(at(i, j + 1, l + 1), at(i + 1, j + 1, l + 1), tx), ty), tz);
    out.d = v + extra;
    const q = (Math.round(fx) + n * (Math.round(fy) + n * Math.round(fz))) * 4;
    out.c = c[q + 3] ? [c[q], c[q + 1], c[q + 2]] : null;
  };
}

// Añade (o cambia) un sello tuyo en el registro.
export function addOwnStamp(saved) {
  const st = { id: saved.id, name: saved.name, own: true, data: saved, eval: gridEval(saved) };
  STAMPS.set(saved.id, st);
  return st;
}
export function removeOwnStamp(id) { STAMPS.delete(id); }

// Convierte una capa en sello. grid: la rejilla de la capa. color: su color base.
export function stampFromGrid(grid, id, name, n = 40) {
  const { bricks, fill, nb, h, o, band } = grid;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let bz = 0; bz < nb; bz++) for (let by = 0; by < nb; by++) for (let bx = 0; bx < nb; bx++) {
    const bi = bx + nb * (by + nb * bz), bk = bricks[bi];
    if (!(fill[bi] < 0) && !(bk && bk.some((v) => v < 0))) continue;
    [bx, by, bz].forEach((b, a) => { lo[a] = Math.min(lo[a], o + b * 8 * h); hi[a] = Math.max(hi[a], o + (b + 1) * 8 * h); });
  }
  if (!(hi[0] > lo[0])) return null; // capa vacía
  const c0 = lo.map((v, a) => (v + hi[a]) / 2);
  const half = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 * 1.08;
  const N = n * n * n, dist = new Float32Array(N), col = new Uint8Array(N * 4);
  const step = 2 / (n - 1);
  const far = 8;
  for (let l = 0; l < n; l++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const wx = c0[0] + (-1 + i * step) * half, wy = c0[1] + (-1 + j * step) * half, wz = c0[2] + (-1 + l * step) * half;
    const v = grid.sample(wx, wy, wz), q = i + n * (j + n * l);
    dist[q] = Math.abs(v) >= band * 0.98 ? Math.sign(v) * far : v / half;
    if (Math.abs(v) < band) {
      const c = grid.sampleColor(wx, wy, wz);
      if (c) { col[q * 4] = c[0]; col[q * 4 + 1] = c[1]; col[q * 4 + 2] = c[2]; col[q * 4 + 3] = 255; }
    }
  }
  // La capa solo guarda la distancia cerca de la superficie: el resto se calcula hacia fuera.
  const relax = (q, p) => {
    if (dist[q] > 0 && dist[p] > -far) { if (dist[p] + step < dist[q] && dist[p] > 0) dist[q] = dist[p] + step; else if (dist[p] <= 0 && step < dist[q]) dist[q] = Math.min(dist[q], step); }
    if (dist[q] < 0 && dist[p] < far) { if (dist[p] - step > dist[q] && dist[p] < 0) dist[q] = dist[p] - step; else if (dist[p] >= 0 && -step > dist[q]) dist[q] = Math.max(dist[q], -step); }
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let l = 0; l < n; l++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const q = i + n * (j + n * l);
      if (i) relax(q, q - 1);
      if (j) relax(q, q - n);
      if (l) relax(q, q - n * n);
    }
    for (let l = n - 1; l >= 0; l--) for (let j = n - 1; j >= 0; j--) for (let i = n - 1; i >= 0; i--) {
      const q = i + n * (j + n * l);
      if (i < n - 1) relax(q, q + 1);
      if (j < n - 1) relax(q, q + n);
      if (l < n - 1) relax(q, q + n * n);
    }
  }
  const d = new Int8Array(N);
  for (let q = 0; q < N; q++) d[q] = Math.max(-127, Math.min(127, Math.round(dist[q] * 127)));
  return { id, name, n, d, c: col };
}

// Dibujito del sello: se mira de frente, con luz de plastilina y contorno de cera.
const CLAY = [232, 190, 150];
export function stampThumb(st, size = 72) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d'), img = g.createImageData(size, size), hit = new Uint8Array(size * size);
  const out = { d: 0, c: null };
  const ev = (x, y, z) => { st.eval(x, y, z, out); return out.d; };
  const K = 1.22; // margen alrededor
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const x = ((px + 0.5) / size * 2 - 1) * K, y = -((py + 0.5) / size * 2 - 1) * K;
    let z = 1.5, on = false;
    for (let s = 0; s < 22 && z > -1.5; s++) {
      const d = ev(x, y, z);
      if (d < 0.012) { on = true; break; }
      z -= Math.max(d, 0.02);
    }
    if (!on) continue;
    hit[px + size * py] = 1;
    st.eval(x, y, z, out);
    const c = out.c || CLAY;
    const e = 0.03;
    const nx = ev(x + e, y, z) - ev(x - e, y, z), ny = ev(x, y + e, z) - ev(x, y - e, z), nz = ev(x, y, z + e) - ev(x, y, z - e);
    const l = hyp(nx, ny, nz) || 1;
    const light = Math.max(0, (nx * -0.4 + ny * 0.55 + nz * 0.73) / l);
    const shade = 0.62 + 0.46 * light;
    const j = (px + size * py) * 4;
    img.data[j] = Math.min(255, c[0] * shade); img.data[j + 1] = Math.min(255, c[1] * shade); img.data[j + 2] = Math.min(255, c[2] * shade); img.data[j + 3] = 255;
  }
  // Contorno negro: lo que no es sello pero toca al sello.
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    if (hit[px + size * py]) continue;
    let near = false;
    for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) {
      const q = px + dx, w = py + dy;
      if (q >= 0 && w >= 0 && q < size && w < size && hit[q + size * w]) { near = true; break; }
    }
    if (!near) continue;
    const j = (px + size * py) * 4;
    img.data[j] = 20; img.data[j + 1] = 18; img.data[j + 2] = 16; img.data[j + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return canvas;
}
