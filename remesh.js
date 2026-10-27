// Remesh y horneado dentro del casco, sin Blender.
//
// 1. remeshSDF: malla nueva de quads uniformes. Surface Nets sobre una rejilla gruesa (tamaño de
//    celda según los quads pedidos), cada vértice se pega a la superficie de alta resolución y se
//    relaja (suavizado tangencial + reproyección) para que los quads queden regulares.
// 2. bakeMesh: UVs por "cartas" (zonas que miran al mismo eje, proyectadas en plano) empaquetadas
//    en un atlas, y para cada píxel se busca la superficie de alta resolución a lo largo de la
//    normal de la malla baja: mapa de normales (espacio tangente, convención OpenGL/glTF/Blender)
//    y mapa de color.
//
// Todo trabaja por tramos y cede el hilo cada pocos ms (`tick`), así la escena sigue pintándose.

const B = 8;

// Acceso rápido a la rejilla dispersa (sin el registro de deshacer de get()).
function field(grid) {
  const { n, h, nb, bricks, colors, fill, band } = grid;
  const s = n - 1;
  const val = (x, y, z) => {
    const bi = (x >> 3) + nb * ((y >> 3) + nb * (z >> 3));
    const b = bricks[bi];
    return b ? b[(x & 7) | ((y & 7) << 3) | ((z & 7) << 6)] : fill[bi] * band;
  };
  const sample = (px, py, pz) => {
    const fx = (px + 0.5) * s, fy = (py + 0.5) * s, fz = (pz + 0.5) * s;
    if (!(fx >= 0 && fy >= 0 && fz >= 0 && fx <= s && fy <= s && fz <= s)) return band;
    const x = Math.min(fx | 0, n - 2), y = Math.min(fy | 0, n - 2), z = Math.min(fz | 0, n - 2);
    const tx = fx - x, ty = fy - y, tz = fz - z;
    const c000 = val(x, y, z), c100 = val(x + 1, y, z), c010 = val(x, y + 1, z), c110 = val(x + 1, y + 1, z);
    const c001 = val(x, y, z + 1), c101 = val(x + 1, y, z + 1), c011 = val(x, y + 1, z + 1), c111 = val(x + 1, y + 1, z + 1);
    const c00 = c000 + (c100 - c000) * tx, c10 = c010 + (c110 - c010) * tx;
    const c01 = c001 + (c101 - c001) * tx, c11 = c011 + (c111 - c011) * tx;
    const c0 = c00 + (c10 - c00) * ty, c1 = c01 + (c11 - c01) * ty;
    return c0 + (c1 - c0) * tz;
  };
  const g = [0, 0, 0];
  const grad = (px, py, pz) => {
    const e = h;
    const gx = sample(px + e, py, pz) - sample(px - e, py, pz);
    const gy = sample(px, py + e, pz) - sample(px, py - e, pz);
    const gz = sample(px, py, pz + e) - sample(px, py, pz - e);
    const l = Math.sqrt(gx * gx + gy * gy + gz * gz);
    if (l < 1e-12) { g[0] = 0; g[1] = 0; g[2] = 0; return g; }
    g[0] = gx / l; g[1] = gy / l; g[2] = gz / l;
    return g;
  };
  // Color (sRGB 0-255) mezclando las 8 muestras vecinas; lo no pintado usa el color base.
  const col = [0, 0, 0];
  const color = (px, py, pz, base) => {
    const fx = Math.max(0, Math.min(s, (px + 0.5) * s)), fy = Math.max(0, Math.min(s, (py + 0.5) * s));
    const fz = Math.max(0, Math.min(s, (pz + 0.5) * s));
    const x = Math.min(fx | 0, n - 2), y = Math.min(fy | 0, n - 2), z = Math.min(fz | 0, n - 2);
    const tx = fx - x, ty = fy - y, tz = fz - z;
    let r = 0, gg = 0, b = 0;
    for (let k = 0; k < 8; k++) {
      const X = x + (k & 1), Y = y + ((k >> 1) & 1), Z = z + (k >> 2);
      const w = ((k & 1) ? tx : 1 - tx) * (((k >> 1) & 1) ? ty : 1 - ty) * ((k >> 2) ? tz : 1 - tz);
      const c = colors[(X >> 3) + nb * ((Y >> 3) + nb * (Z >> 3))];
      const j = ((X & 7) | ((Y & 7) << 3) | ((Z & 7) << 6)) * 4;
      if (c && c[j + 3]) { r += c[j] * w; gg += c[j + 1] * w; b += c[j + 2] * w; }
      else { r += base[0] * w; gg += base[1] * w; b += base[2] * w; }
    }
    col[0] = r; col[1] = gg; col[2] = b;
    return col;
  };
  return { n, h, band, sample, grad, color };
}

function ticker(onProgress) {
  let t = performance.now();
  return async (frac) => {
    if (performance.now() - t < 14) return;
    if (onProgress) onProgress(frac);
    await new Promise((r) => setTimeout(r, 0));
    t = performance.now();
  };
}

// Busca la superficie (distancia 0) desde p a lo largo de la dirección d (unitaria), hasta maxT.
// Devuelve t o NaN.
function hitAlong(F, px, py, pz, dx, dy, dz, maxT) {
  const f = (t) => F.sample(px + dx * t, py + dy * t, pz + dz * t);
  let f0 = f(0);
  if (Math.abs(f0) < F.h * 0.02) return 0;
  // Tramo con cambio de signo: probando hacia los dos lados, cada vez más lejos.
  const step = Math.min(F.band * 0.7, maxT / 2);
  let a = 0, fa = f0, b = NaN, fb = NaN;
  // Primero el paso "de Newton" (la distancia ya dice cuánto falta), si cabe.
  const guesses = [];
  if (Math.abs(f0) < F.band * 0.9) guesses.push(-f0 * 1.2);
  for (let t = step; t <= maxT + 1e-9; t += step) guesses.push(t, -t);
  for (const t of guesses) {
    const ft = f(t);
    if ((ft < 0) !== (f0 < 0)) { b = t; fb = ft; break; }
  }
  if (Number.isNaN(b)) return NaN;
  // Si el primer intento fue lejos, acercar el otro extremo al que está más cerca de 0.
  if (Math.abs(b) > step) {
    const s = Math.sign(b);
    for (let t = s * step; Math.abs(t) < Math.abs(b); t += s * step) {
      const ft = f(t);
      if ((ft < 0) !== (f0 < 0)) { b = t; fb = ft; break; }
      a = t; fa = ft;
    }
  }
  // Secante con salvaguarda (regula falsi de Illinois).
  let side = 0;
  for (let i = 0; i < 24; i++) {
    const t = (a * fb - b * fa) / (fb - fa);
    const ft = f(t);
    if (Math.abs(ft) < F.h * 0.01 || Math.abs(b - a) < F.h * 0.01) return t;
    if ((ft < 0) === (fb < 0)) { b = t; fb = ft; if (side === -1) fa /= 2; side = -1; }
    else { a = t; fa = ft; if (side === 1) fb /= 2; side = 1; }
  }
  return (a + b) / 2;
}

// Pega p a la superficie por el camino más corto (si ya está cerca).
function snap(F, p, iters = 2) {
  for (let i = 0; i < iters; i++) {
    const d = F.sample(p[0], p[1], p[2]);
    if (Math.abs(d) > F.band * 0.9 || Math.abs(d) < F.h * 0.01) return;
    const g = F.grad(p[0], p[1], p[2]);
    p[0] -= d * g[0]; p[1] -= d * g[1]; p[2] -= d * g[2];
  }
}

function quadNormals(pos, quads, out) {
  out.fill(0);
  for (let i = 0; i < quads.length; i += 4) {
    const a = quads[i] * 3, b = quads[i + 1] * 3, c = quads[i + 2] * 3, d = quads[i + 3] * 3;
    // Normal del quad = producto de las diagonales (pesa por área).
    const ux = pos[c] - pos[a], uy = pos[c + 1] - pos[a + 1], uz = pos[c + 2] - pos[a + 2];
    const vx = pos[d] - pos[b], vy = pos[d + 1] - pos[b + 1], vz = pos[d + 2] - pos[b + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c, d]) { out[v] += nx; out[v + 1] += ny; out[v + 2] += nz; }
  }
  for (let i = 0; i < out.length; i += 3) {
    const l = Math.hypot(out[i], out[i + 1], out[i + 2]) || 1;
    out[i] /= l; out[i + 1] /= l; out[i + 2] /= l;
  }
  return out;
}

// Área de una malla de quads (para elegir el tamaño de celda).
export function meshArea(pos, quads) {
  let A = 0;
  for (let i = 0; i < quads.length; i += 4) {
    const a = quads[i] * 3, b = quads[i + 1] * 3, c = quads[i + 2] * 3, d = quads[i + 3] * 3;
    const ux = pos[c] - pos[a], uy = pos[c + 1] - pos[a + 1], uz = pos[c + 2] - pos[a + 2];
    const vx = pos[d] - pos[b], vy = pos[d + 1] - pos[b + 1], vz = pos[d + 2] - pos[b + 2];
    A += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  return A;
}

// ---------- 1. Remesh ----------
// area: área de la superficie (de la malla de vóxeles); target: quads aproximados.
// Devuelve { positions, normals, quads } (quads con 4 índices, hacia fuera).
export async function remeshSDF(grid, area, target, onProgress, relaxIters = 10) {
  const F = field(grid);
  const tick = ticker((f) => onProgress && onProgress('Malla nueva', f));
  // Surface Nets en superficies curvas da ~1,4 quads por celda²: se corrige para acertar con el número pedido.
  const hc = Math.max(Math.sqrt((area * 1.4) / Math.max(100, target)), F.h * 1.5);
  const M = Math.ceil(1 / hc) + 1;
  const o = -0.5 - (M * hc - 1) / 2; // rejilla gruesa centrada en la caja
  const MM = M * M;
  const vals = new Float32Array(M * MM);
  for (let z = 0; z < M; z++) {
    for (let y = 0; y < M; y++)
      for (let x = 0; x < M; x++) vals[x + M * y + MM * z] = F.sample(o + x * hc, o + y * hc, o + z * hc);
    await tick(0.2 * z / M);
  }

  // Surface Nets en la rejilla gruesa.
  const C = M - 1;
  const vmap = new Int32Array(C * C * C).fill(-1);
  const pos = [], dirs = [];
  const v = new Float32Array(8);
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let z = 0; z < C; z++) {
    for (let y = 0; y < C; y++)
      for (let x = 0; x < C; x++) {
        const i0 = x + M * y + MM * z;
        v[0] = vals[i0]; v[1] = vals[i0 + 1]; v[2] = vals[i0 + M]; v[3] = vals[i0 + M + 1];
        v[4] = vals[i0 + MM]; v[5] = vals[i0 + MM + 1]; v[6] = vals[i0 + MM + M]; v[7] = vals[i0 + MM + M + 1];
        let mask = 0;
        for (let k = 0; k < 8; k++) if (v[k] < 0) mask |= 1 << k;
        if (mask === 0 || mask === 255) continue;
        let ax = 0, ay = 0, az = 0, cnt = 0;
        for (const [a, b] of E) {
          if ((v[a] < 0) === (v[b] < 0)) continue;
          const t = v[a] / (v[a] - v[b]);
          ax += (a & 1) + ((b & 1) - (a & 1)) * t;
          ay += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
          az += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
          cnt++;
        }
        vmap[x + C * (y + C * z)] = pos.length / 3;
        pos.push(o + (x + ax / cnt) * hc, o + (y + ay / cnt) * hc, o + (z + az / cnt) * hc);
        const nx = v[1] - v[0] + v[3] - v[2] + v[5] - v[4] + v[7] - v[6];
        const ny = v[2] - v[0] + v[3] - v[1] + v[6] - v[4] + v[7] - v[5];
        const nz = v[4] - v[0] + v[5] - v[1] + v[6] - v[2] + v[7] - v[3];
        const l = Math.hypot(nx, ny, nz) || 1;
        dirs.push(nx / l, ny / l, nz / l);
      }
    await tick(0.2 + 0.1 * z / C);
  }
  const V = (x, y, z) => vmap[x + C * (y + C * z)];
  const quads = [];
  for (let z = 1; z < C; z++)
    for (let y = 1; y < C; y++)
      for (let x = 1; x < C; x++) {
        const ins = vals[x + M * y + MM * z] < 0;
        if (ins !== vals[x + 1 + M * y + MM * z] < 0) {
          const q = [V(x, y - 1, z - 1), V(x, y, z - 1), V(x, y, z), V(x, y - 1, z)];
          ins ? quads.push(...q) : quads.push(q[0], q[3], q[2], q[1]);
        }
        if (ins !== vals[x + M * (y + 1) + MM * z] < 0) {
          const q = [V(x - 1, y, z - 1), V(x - 1, y, z), V(x, y, z), V(x, y, z - 1)];
          ins ? quads.push(...q) : quads.push(q[0], q[3], q[2], q[1]);
        }
        if (ins !== vals[x + M * y + MM * (z + 1)] < 0) {
          const q = [V(x - 1, y - 1, z), V(x, y - 1, z), V(x, y, z), V(x - 1, y, z)];
          ins ? quads.push(...q) : quads.push(q[0], q[3], q[2], q[1]);
        }
      }
  const P = new Float32Array(pos);
  const Q = new Uint32Array(quads);
  const nv = P.length / 3;

  // Pegar cada vértice a la superficie de alta resolución.
  const p = [0, 0, 0];
  for (let i = 0; i < nv; i++) {
    const j = i * 3;
    const t = hitAlong(F, P[j], P[j + 1], P[j + 2], dirs[j], dirs[j + 1], dirs[j + 2], hc * 1.5);
    if (!Number.isNaN(t)) { P[j] += dirs[j] * t; P[j + 1] += dirs[j + 1] * t; P[j + 2] += dirs[j + 2] * t; }
    p[0] = P[j]; p[1] = P[j + 1]; p[2] = P[j + 2];
    snap(F, p);
    P[j] = p[0]; P[j + 1] = p[1]; P[j + 2] = p[2];
    if ((i & 255) === 0) await tick(0.3 + 0.2 * i / nv);
  }

  // Vecinos de cada vértice (por las aristas de los quads).
  const deg = new Uint32Array(nv + 1);
  for (let i = 0; i < Q.length; i++) deg[Q[i] + 1] += 2;
  for (let i = 0; i < nv; i++) deg[i + 1] += deg[i];
  const nbr = new Uint32Array(deg[nv]);
  const fillPos = deg.slice(0, nv);
  for (let i = 0; i < Q.length; i += 4)
    for (let k = 0; k < 4; k++) {
      const a = Q[i + k], b = Q[i + ((k + 1) & 3)];
      nbr[fillPos[a]++] = b;
      nbr[fillPos[b]++] = a;
    }

  // Relajar: cada vértice va hacia el centro de sus vecinos sin salirse de la superficie.
  const N = new Float32Array(P.length);
  const next = new Float32Array(P.length);
  for (let it = 0; it < relaxIters; it++) {
    quadNormals(P, Q, N);
    for (let i = 0; i < nv; i++) {
      const j = i * 3;
      let cx = 0, cy = 0, cz = 0;
      const k0 = deg[i], k1 = deg[i + 1];
      for (let k = k0; k < k1; k++) { const m = nbr[k] * 3; cx += P[m]; cy += P[m + 1]; cz += P[m + 2]; }
      const cnt = k1 - k0 || 1;
      let dx = cx / cnt - P[j], dy = cy / cnt - P[j + 1], dz = cz / cnt - P[j + 2];
      const dn = dx * N[j] + dy * N[j + 1] + dz * N[j + 2];
      dx -= dn * N[j]; dy -= dn * N[j + 1]; dz -= dn * N[j + 2];
      p[0] = P[j] + dx * 0.6; p[1] = P[j + 1] + dy * 0.6; p[2] = P[j + 2] + dz * 0.6;
      snap(F, p, 1);
      next[j] = p[0]; next[j + 1] = p[1]; next[j + 2] = p[2];
      if ((i & 511) === 0) await tick(0.5 + 0.5 * (it + i / nv) / relaxIters);
    }
    P.set(next);
  }
  // Último ajuste a la superficie.
  for (let i = 0; i < nv; i++) {
    const j = i * 3;
    p[0] = P[j]; p[1] = P[j + 1]; p[2] = P[j + 2];
    snap(F, p, 2);
    P[j] = p[0]; P[j + 1] = p[1]; P[j + 2] = p[2];
  }
  return { positions: P, normals: quadNormals(P, Q, new Float32Array(P.length)), quads: Q };
}

// ---------- 2. UVs ----------
// Cartas: quads conectados que miran al mismo eje (±X, ±Y, ±Z) y caen en el mismo bloque
// del espacio (para que ninguna sea enorme); cada carta se proyecta en su plano.
function buildCharts(P, Q, chartSize) {
  const nq = Q.length / 4, nv = P.length / 3;
  const cls = new Uint8Array(nq), bin = new Int32Array(nq);
  for (let f = 0; f < nq; f++) {
    const a = Q[f * 4] * 3, b = Q[f * 4 + 1] * 3, c = Q[f * 4 + 2] * 3, d = Q[f * 4 + 3] * 3;
    const ux = P[c] - P[a], uy = P[c + 1] - P[a + 1], uz = P[c + 2] - P[a + 2];
    const vx = P[d] - P[b], vy = P[d + 1] - P[b + 1], vz = P[d + 2] - P[b + 2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    let ax = 0;
    if (Math.abs(n[1]) > Math.abs(n[ax])) ax = 1;
    if (Math.abs(n[2]) > Math.abs(n[ax])) ax = 2;
    cls[f] = ax * 2 + (n[ax] < 0 ? 1 : 0);
    const bx = Math.floor(((P[a] + P[c]) / 2 + 0.5) / chartSize);
    const by = Math.floor(((P[a + 1] + P[c + 1]) / 2 + 0.5) / chartSize);
    const bz = Math.floor(((P[a + 2] + P[c + 2]) / 2 + 0.5) / chartSize);
    bin[f] = bx + 64 * (by + 64 * bz);
  }
  // Unión de quads vecinos compatibles.
  const parent = new Int32Array(nq).map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const edges = new Map();
  for (let f = 0; f < nq; f++)
    for (let k = 0; k < 4; k++) {
      const a = Q[f * 4 + k], b = Q[f * 4 + ((k + 1) & 3)];
      const key = a < b ? a * nv + b : b * nv + a;
      const g = edges.get(key);
      if (g === undefined) { edges.set(key, f); continue; }
      if (cls[g] === cls[f] && bin[g] === bin[f]) {
        const ra = find(g), rb = find(f);
        if (ra !== rb) parent[ra] = rb;
      }
    }
  const chartOf = new Int32Array(nq);
  const ids = new Map();
  for (let f = 0; f < nq; f++) {
    const r = find(f);
    let c = ids.get(r);
    if (c === undefined) { c = ids.size; ids.set(r, c); }
    chartOf[f] = c;
  }
  return { chartOf, count: ids.size, cls };
}

// Empaqueta rectángulos (w, h en unidades del modelo) en estantes; devuelve la escala
// (píxeles por unidad) más grande que hace que todo quepa en S×S, y la posición de cada uno.
function packCharts(rects, S, pad) {
  const order = rects.map((_, i) => i).sort((a, b) => rects[b].h - rects[a].h);
  const tryScale = (s) => {
    const out = new Array(rects.length);
    let x = 0, y = 0, rowH = 0;
    for (const i of order) {
      const w = Math.ceil(rects[i].w * s) + 2 * pad, h = Math.ceil(rects[i].h * s) + 2 * pad;
      if (w > S) return null;
      if (x + w > S) { x = 0; y += rowH; rowH = 0; }
      if (y + h > S) return null;
      out[i] = [x + pad, y + pad];
      x += w;
      rowH = Math.max(rowH, h);
    }
    return out;
  };
  let lo = 1, hi = S * 4, best = tryScale(lo) && lo;
  if (!best) return null;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (tryScale(mid)) lo = mid; else hi = mid;
  }
  return { scale: lo, at: tryScale(lo) };
}

// ---------- 3. Horneado ----------
// low: { positions, normals, quads }. base: color base [r,g,b] 0-255. S: tamaño de las texturas.
// Devuelve la malla con UVs (vértices repetidos en los bordes de carta) y dos texturas RGBA:
// normalMap (espacio tangente: X = +U, Y = arriba en la imagen, como glTF/Blender) y colorMap (sRGB).
export async function bakeMesh(grid, low, base, S, onProgress) {
  const F = field(grid);
  const tick = ticker((f) => onProgress && onProgress('Horneando detalle', f));
  const P = low.positions, Nv = low.normals, Q = low.quads;
  const nq = Q.length / 4;
  // Tamaño medio de un quad: las cartas abarcan como mucho ~24 quads de lado.
  const edge = Math.sqrt(meshArea(P, Q) / Math.max(1, nq));
  const { chartOf, count, cls } = buildCharts(P, Q, Math.min(0.25, edge * 24));

  // Coordenadas de proyección y caja de cada carta.
  const AX = [[1, 2], [2, 1], [2, 0], [0, 2], [0, 1], [1, 0]]; // (u, v) por clase; el sentido evita espejos
  const box = Array.from({ length: count }, () => ({ u0: Infinity, v0: Infinity, u1: -Infinity, v1: -Infinity, cls: 0 }));
  for (let f = 0; f < nq; f++) {
    const b = box[chartOf[f]];
    b.cls = cls[f];
    const [iu, iv] = AX[cls[f]];
    for (let k = 0; k < 4; k++) {
      const j = Q[f * 4 + k] * 3;
      const u = P[j + iu], v = P[j + iv];
      if (u < b.u0) b.u0 = u; if (u > b.u1) b.u1 = u;
      if (v < b.v0) b.v0 = v; if (v > b.v1) b.v1 = v;
    }
  }
  const pad = 3;
  const packed = packCharts(box.map((b) => ({ w: b.u1 - b.u0, h: b.v1 - b.v0 })), S, pad);
  if (!packed) throw new Error('No caben las UVs: baja los quads o sube la textura');
  const { scale, at } = packed;

  // Vértices de salida: uno por (vértice, carta).
  const vkey = new Map();
  const outP = [], outN = [], outUV = [], index = [];
  const vtx = (vi, c) => {
    const key = vi * count + c;
    let k = vkey.get(key);
    if (k !== undefined) return k;
    k = outP.length / 3;
    vkey.set(key, k);
    const j = vi * 3, b = box[c], [iu, iv] = AX[b.cls];
    outP.push(P[j], P[j + 1], P[j + 2]);
    outN.push(Nv[j], Nv[j + 1], Nv[j + 2]);
    outUV.push((at[c][0] + (P[j + iu] - b.u0) * scale) / S, (at[c][1] + (P[j + iv] - b.v0) * scale) / S);
    return k;
  };
  for (let f = 0; f < nq; f++) {
    const c = chartOf[f];
    const a = vtx(Q[f * 4], c), b = vtx(Q[f * 4 + 1], c), cc = vtx(Q[f * 4 + 2], c), d = vtx(Q[f * 4 + 3], c);
    index.push(a, b, cc, a, cc, d);
  }
  const pos = new Float32Array(outP), nor = new Float32Array(outN), uv = new Float32Array(outUV);
  const idx = new Uint32Array(index);

  // Rasterizar cada triángulo en el atlas y buscar la superficie de alta resolución.
  const nmap = new Uint8Array(S * S * 4), cmap = new Uint8Array(S * S * 4);
  const filled = new Uint8Array(S * S);
  const maxT = Math.max(edge * 0.75, F.band * 2);
  const ntri = idx.length / 3;
  for (let t = 0; t < ntri; t++) {
    const i0 = idx[t * 3], i1 = idx[t * 3 + 1], i2 = idx[t * 3 + 2];
    const x0 = uv[i0 * 2] * S, y0 = uv[i0 * 2 + 1] * S, x1 = uv[i1 * 2] * S, y1 = uv[i1 * 2 + 1] * S;
    const x2 = uv[i2 * 2] * S, y2 = uv[i2 * 2 + 1] * S;
    const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(den) < 1e-12) continue;
    // Marco tangente del triángulo: dP/du y dP/dv (v hacia abajo en la imagen).
    const e1 = [pos[i1 * 3] - pos[i0 * 3], pos[i1 * 3 + 1] - pos[i0 * 3 + 1], pos[i1 * 3 + 2] - pos[i0 * 3 + 2]];
    const e2 = [pos[i2 * 3] - pos[i0 * 3], pos[i2 * 3 + 1] - pos[i0 * 3 + 1], pos[i2 * 3 + 2] - pos[i0 * 3 + 2]];
    const du1 = x1 - x0, dv1 = y1 - y0, du2 = x2 - x0, dv2 = y2 - y0;
    const r = 1 / (du1 * dv2 - du2 * dv1);
    const T = [(e1[0] * dv2 - e2[0] * dv1) * r, (e1[1] * dv2 - e2[1] * dv1) * r, (e1[2] * dv2 - e2[2] * dv1) * r];
    const Bv = [(e2[0] * du1 - e1[0] * du2) * r, (e2[1] * du1 - e1[1] * du2) * r, (e2[2] * du1 - e1[2] * du2) * r];
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(S - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(S - 1, Math.ceil(Math.max(y0, y1, y2)));
    for (let py = minY; py <= maxY; py++)
      for (let px = minX; px <= maxX; px++) {
        const cx = px + 0.5, cy = py + 0.5;
        const w0 = ((y1 - y2) * (cx - x2) + (x2 - x1) * (cy - y2)) / den;
        const w1 = ((y2 - y0) * (cx - x2) + (x0 - x2) * (cy - y2)) / den;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
        const pi = py * S + px;
        if (filled[pi]) continue;
        filled[pi] = 1;
        const P0 = w0 * pos[i0 * 3] + w1 * pos[i1 * 3] + w2 * pos[i2 * 3];
        const P1 = w0 * pos[i0 * 3 + 1] + w1 * pos[i1 * 3 + 1] + w2 * pos[i2 * 3 + 1];
        const P2 = w0 * pos[i0 * 3 + 2] + w1 * pos[i1 * 3 + 2] + w2 * pos[i2 * 3 + 2];
        let nx = w0 * nor[i0 * 3] + w1 * nor[i1 * 3] + w2 * nor[i2 * 3];
        let ny = w0 * nor[i0 * 3 + 1] + w1 * nor[i1 * 3 + 1] + w2 * nor[i2 * 3 + 1];
        let nz = w0 * nor[i0 * 3 + 2] + w1 * nor[i1 * 3 + 2] + w2 * nor[i2 * 3 + 2];
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        // Superficie de alta resolución a lo largo de la normal de la malla baja.
        let hx = P0, hy = P1, hz = P2;
        const tt = hitAlong(F, P0, P1, P2, nx, ny, nz, maxT);
        if (!Number.isNaN(tt)) { hx += nx * tt; hy += ny * tt; hz += nz * tt; }
        const g = F.grad(hx, hy, hz);
        let gx = g[0], gy = g[1], gz = g[2];
        if (gx === 0 && gy === 0 && gz === 0) { gx = nx; gy = ny; gz = nz; }
        // Base ortonormal (T, B, N) y normal alta en ella.
        let tx = T[0], ty = T[1], tz = T[2];
        const tn = tx * nx + ty * ny + tz * nz;
        tx -= nx * tn; ty -= ny * tn; tz -= nz * tn;
        const tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl; ty /= tl; tz /= tl;
        let bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
        // "Arriba" en la imagen = -dP/dv; misma orientación que B si el triángulo no está espejado.
        if (bx * -Bv[0] + by * -Bv[1] + bz * -Bv[2] < 0) { bx = -bx; by = -by; bz = -bz; }
        const o = pi * 4;
        nmap[o] = Math.round(127.5 + 127.5 * (gx * tx + gy * ty + gz * tz));
        nmap[o + 1] = Math.round(127.5 + 127.5 * (gx * bx + gy * by + gz * bz));
        nmap[o + 2] = Math.round(127.5 + 127.5 * Math.max(0, gx * nx + gy * ny + gz * nz));
        nmap[o + 3] = 255;
        const c = F.color(hx, hy, hz, base);
        cmap[o] = c[0]; cmap[o + 1] = c[1]; cmap[o + 2] = c[2]; cmap[o + 3] = 255;
      }
    if ((t & 63) === 0) await tick(t / ntri);
  }

  // Rellenar el margen alrededor de cada carta (evita costuras al alejar la vista).
  for (let pass = 0; pass < pad + 1; pass++) {
    const add = [];
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        if (filled[i]) continue;
        // Primero el vecino rellenado (casi siempre no hay ninguno: sale rápido).
        const l = x > 0 && filled[i - 1] === 1, r = x < S - 1 && filled[i + 1] === 1;
        const u = y > 0 && filled[i - S] === 1, d = y < S - 1 && filled[i + S] === 1;
        if (l || r || u || d) add.push(i, (l ? 1 : 0) | (r ? 2 : 0) | (u ? 4 : 0) | (d ? 8 : 0));
      }
    for (let k = 0; k < add.length; k += 2) {
      const i = add[k], m = add[k + 1];
      let n = 0, n0 = 0, n1 = 0, n2 = 0, c0 = 0, c1 = 0, c2 = 0;
      for (const [bit, j] of [[1, i - 1], [2, i + 1], [4, i - S], [8, i + S]]) {
        if (!(m & bit)) continue;
        n0 += nmap[j * 4]; n1 += nmap[j * 4 + 1]; n2 += nmap[j * 4 + 2];
        c0 += cmap[j * 4]; c1 += cmap[j * 4 + 1]; c2 += cmap[j * 4 + 2];
        n++;
      }
      const o = i * 4;
      nmap[o] = n0 / n; nmap[o + 1] = n1 / n; nmap[o + 2] = n2 / n; nmap[o + 3] = 255;
      cmap[o] = c0 / n; cmap[o + 1] = c1 / n; cmap[o + 2] = c2 / n; cmap[o + 3] = 255;
    }
    for (let k = 0; k < add.length; k += 2) filled[add[k]] = 1;
    await tick(1);
  }
  // Fondo neutro (normal plana) donde no hay nada.
  for (let i = 0; i < S * S; i++)
    if (!filled[i]) { nmap[i * 4] = 128; nmap[i * 4 + 1] = 128; nmap[i * 4 + 2] = 255; nmap[i * 4 + 3] = 255; cmap[i * 4 + 3] = 255; }

  return { positions: pos, normals: nor, uvs: uv, index: idx, normalMap: nmap, colorMap: cmap, size: S, charts: count };
}
