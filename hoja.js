// Encontrar una hoja o una libreta en una foto y enderezarla. Sin librerías: se busca la mancha clara
// más grande con forma de cuadrilátero, probando varios umbrales porque la luz de cada sitio es distinta.

const WORK = 320; // la búsqueda se hace en pequeño: da de sobra y va rápido

// ¿Le falta imagen? La cámara de las gafas puede dar negro del todo o solo a trozos.
export function looksBlack(src) {
  const w = 64, h = Math.max(1, Math.round((64 * src.height) / src.width));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  let dark = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 36) dark++;
  return dark / (w * h) > 0.45;
}

function otsu(gray) {
  const hist = new Uint32Array(256);
  for (const v of gray) hist[v]++;
  let sum = 0, sumB = 0, wB = 0, best = 0, at = 128;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    const wF = gray.length - wB;
    if (!wB || !wF) continue;
    sumB += i * hist[i];
    const diff = sumB / wB - (sum - sumB) / wF, v = wB * wF * diff * diff;
    if (v > best) { best = v; at = i; }
  }
  return at;
}

// Cierra rayitas y letras: primero engorda lo claro y luego lo adelgaza.
function close(bin, w, h) {
  const pass = (from, on) => {
    const out = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = x + y * w;
      const any = from[i - 1] || from[i + 1] || from[i - w] || from[i + w] || from[i];
      const all = from[i - 1] && from[i + 1] && from[i - w] && from[i + w] && from[i];
      out[i] = on ? (any ? 1 : 0) : (all ? 1 : 0);
    }
    return out;
  };
  return pass(pass(bin, true), false);
}

// Manchas de mayor a menor: { pixels } con el índice de cada píxel.
function blobs(bin, w, h, min) {
  const seen = new Uint8Array(w * h), stack = new Int32Array(w * h), found = [];
  for (let s = 0; s < bin.length; s++) {
    if (!bin[s] || seen[s]) continue;
    let top = 0, n = 0;
    const pixels = [];
    stack[top++] = s;
    seen[s] = 1;
    while (top) {
      const i = stack[--top];
      pixels.push(i);
      n++;
      const x = i % w;
      if (x > 0 && bin[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[top++] = i - 1; }
      if (x < w - 1 && bin[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[top++] = i + 1; }
      if (i >= w && bin[i - w] && !seen[i - w]) { seen[i - w] = 1; stack[top++] = i - w; }
      if (i < w * (h - 1) && bin[i + w] && !seen[i + w]) { seen[i + w] = 1; stack[top++] = i + w; }
    }
    if (n >= min) found.push(pixels);
  }
  return found.sort((a, b) => b.length - a.length).slice(0, 3);
}

// Área de la mancha contando sus agujeros (letras, dibujos): todo lo que no se alcanza desde fuera.
function filledArea(pixels, w, h) {
  const inBlob = new Uint8Array(w * h), out = new Uint8Array(w * h), stack = new Int32Array(w * h);
  for (const i of pixels) inBlob[i] = 1;
  let top = 0, reached = 0;
  const push = (i) => { if (!inBlob[i] && !out[i]) { out[i] = 1; stack[top++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push(x + (h - 1) * w); }
  for (let y = 0; y < h; y++) { push(y * w); push(w - 1 + y * w); }
  while (top) {
    const i = stack[--top], x = i % w;
    reached++;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < w * (h - 1)) push(i + w);
  }
  return w * h - reached;
}

function hull(pixels, w, h) {
  const lo = new Int32Array(h).fill(-1), hi = new Int32Array(h).fill(-1);
  for (const i of pixels) {
    const x = i % w, y = (i - x) / w;
    if (lo[y] < 0 || x < lo[y]) lo[y] = x;
    if (x > hi[y]) hi[y] = x;
  }
  const pts = [];
  for (let y = 0; y < h; y++) if (lo[y] >= 0) { pts.push([lo[y], y]); if (hi[y] !== lo[y]) pts.push([hi[y], y]); }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length > 1 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half(pts.slice().reverse())];
}

const triArea = (a, b, c) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
// Se quitan los vértices que menos aportan hasta que quedan las cuatro esquinas.
function toQuad(poly) {
  const p = poly.slice();
  while (p.length > 4) {
    let at = 0, least = Infinity;
    p.forEach((v, i) => {
      const a = triArea(p[(i + p.length - 1) % p.length], v, p[(i + 1) % p.length]);
      if (a < least) { least = a; at = i; }
    });
    p.splice(at, 1);
  }
  return p.length === 4 ? p : null;
}
const polyArea = (q) => triArea(q[0], q[1], q[2]) + triArea(q[0], q[2], q[3]);
const side = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Empieza arriba a la izquierda y sigue el sentido de las agujas del reloj.
function ordered(q) {
  const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
  const round = q.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  let first = 0;
  round.forEach((p, i) => { if (p[0] + p[1] < round[first][0] + round[first][1]) first = i; });
  return [0, 1, 2, 3].map((i) => round[(first + i) % 4]);
}

// Una hoja se corta de golpe contra el fondo: casi todo su contorno pasa de claro a oscuro.
function sharpEdge(q, gray, w, h) {
  const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
  const at = (x, y, k) => gray[Math.round(cx + (x - cx) * k) + Math.round(cy + (y - cy) * k) * w];
  let seen = 0, sharp = 0;
  for (let e = 0; e < 4; e++) {
    const a = q[e], b = q[(e + 1) % 4];
    for (let i = 1; i < 20; i++) {
      const x = a[0] + ((b[0] - a[0]) * i) / 20, y = a[1] + ((b[1] - a[1]) * i) / 20;
      const ox = cx + (x - cx) * 1.1, oy = cy + (y - cy) * 1.1;
      if (ox < 0 || oy < 0 || ox >= w - 1 || oy >= h - 1) continue;
      seen++;
      if (at(x, y, 0.9) - at(x, y, 1.1) >= 25) sharp++;
    }
  }
  return seen > 20 && sharp / seen >= 0.6;
}

// Las cuatro esquinas en píxeles de src, o null si no se ve nada con forma de hoja.
export function findSheet(src) {
  const w = WORK, h = Math.round((WORK * src.height) / src.width);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.filter = 'blur(1px)';
  g.drawImage(src, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, gray = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) gray[i] = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8;
  const t0 = otsu(gray), total = w * h;
  let best = null, bestScore = 0;
  for (const t of new Set([t0, t0 + 25, t0 + 50, t0 - 20].map((v) => Math.max(10, Math.min(245, v))))) {
    const bin = new Uint8Array(total);
    for (let i = 0; i < total; i++) bin[i] = gray[i] > t ? 1 : 0;
    for (const pixels of blobs(close(bin, w, h), w, h, total * 0.03)) {
      // Si toca mucho el borde de la foto es la pared o la mesa, no una hoja.
      let edge = 0;
      for (const i of pixels) {
        const x = i % w, y = (i - x) / w;
        if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) edge++;
      }
      if (edge > (w + h) * 0.07) continue;
      const q = toQuad(hull(pixels, w, h));
      if (!q) continue;
      const area = polyArea(q);
      if (area < total * 0.03 || area > total * 0.8) continue;
      const o = ordered(q), a = side(o[0], o[1]), b = side(o[1], o[2]), e = side(o[2], o[3]), f = side(o[3], o[0]);
      const small = Math.min(a, b, e, f), big = Math.max(a, b, e, f);
      if (small < w * 0.1 || big / small > 4) continue;
      const fill = filledArea(pixels, w, h) / area;
      if (fill < 0.88 || !sharpEdge(o, gray, w, h)) continue;
      const score = area * Math.min(1, fill) ** 6;
      if (score > bestScore) { bestScore = score; best = o; }
    }
  }
  if (!best) return null;
  const k = src.width / w;
  return best.map((p) => [(p[0] + 0.5) * k, (p[1] + 0.5) * k]);
}

// La hoja de frente, como si estuviera escaneada. MAX es el lado largo en píxeles.
export function flattenSheet(src, q, MAX = 1600) {
  const [p0, p1, p2, p3] = q;
  const W = (side(p0, p1) + side(p3, p2)) / 2, H = (side(p1, p2) + side(p0, p3)) / 2;
  const k = Math.min(1, MAX / Math.max(W, H)), w = Math.round(W * k), h = Math.round(H * k);
  // Cuadrado unidad → cuadrilátero.
  const dx1 = p1[0] - p2[0], dx2 = p3[0] - p2[0], sx = p0[0] - p1[0] + p2[0] - p3[0];
  const dy1 = p1[1] - p2[1], dy2 = p3[1] - p2[1], sy = p0[1] - p1[1] + p2[1] - p3[1];
  const det = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / det, m = (dx1 * sy - sx * dy1) / det;
  const a = p1[0] - p0[0] + g * p1[0], b = p3[0] - p0[0] + m * p3[0], c = p0[0];
  const d = p1[1] - p0[1] + g * p1[1], e = p3[1] - p0[1] + m * p3[1], f = p0[1];
  const from = document.createElement('canvas');
  from.width = src.width;
  from.height = src.height;
  const fg = from.getContext('2d', { willReadFrequently: true });
  fg.drawImage(src, 0, 0);
  const S = fg.getImageData(0, 0, from.width, from.height), sd = S.data, sw = S.width, sh = S.height;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const og = out.getContext('2d'), O = og.createImageData(w, h), od = O.data;
  const inset = 0.012; // un pelín hacia dentro, para que no asome el fondo
  for (let y = 0, o = 0; y < h; y++) {
    const v = inset + ((1 - 2 * inset) * (y + 0.5)) / h;
    for (let x = 0; x < w; x++, o += 4) {
      const u = inset + ((1 - 2 * inset) * (x + 0.5)) / w, z = g * u + m * v + 1;
      const fx = Math.max(0, Math.min(sw - 1.001, (a * u + b * v + c) / z)), fy = Math.max(0, Math.min(sh - 1.001, (d * u + e * v + f) / z));
      const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy, i = (ix + iy * sw) * 4;
      for (let ch = 0; ch < 3; ch++) {
        od[o + ch] = (sd[i + ch] * (1 - tx) + sd[i + 4 + ch] * tx) * (1 - ty) + (sd[i + sw * 4 + ch] * (1 - tx) + sd[i + sw * 4 + 4 + ch] * tx) * ty;
      }
      od[o + 3] = 255;
    }
  }
  og.putImageData(O, 0, 0);
  return out;
}
