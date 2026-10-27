// Remesh y horneado dentro del casco, sin Blender.
//
// 1. remeshSDF: malla nueva de quads que siguen la forma (campos de orientación y posición, como
//    Instant Meshes), pegada a la superficie de alta resolución y relajada. Si la forma es muy rara,
//    vuelve a la rejilla de antes: Surface Nets grueso + relajado.
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
  // Si la caja [a, b] solo toca bloques vacíos de la rejilla, su valor (±band); si no, null.
  const empty = (ax, ay, az, bx, by, bz) => {
    const lo = (p) => Math.floor((p + 0.5) * s) >> 3, hi = (p) => Math.min(nb - 1, (Math.floor((p + 0.5) * s) + 1) >> 3);
    if (ax < -0.5 || ay < -0.5 || az < -0.5 || bx > 0.5 || by > 0.5 || bz > 0.5) return null;
    let sign = 0;
    for (let z = lo(az); z <= hi(bz); z++)
      for (let y = lo(ay); y <= hi(by); y++)
        for (let x = lo(ax); x <= hi(bx); x++) {
          const bi = x + nb * (y + nb * z);
          if (bricks[bi] || (sign && fill[bi] !== sign)) return null;
          sign = fill[bi];
        }
    return sign * band;
  };
  return { n, h, band, sample, grad, color, empty };
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

// Vecinos de cada vértice (por las aristas de las caras): los de i son nbr[deg[i]] … nbr[deg[i+1]-1].
// Los triángulos van como quads con el último vértice repetido.
function adjacency(nv, Q) {
  const deg = new Uint32Array(nv + 1);
  const each = (fn) => {
    for (let i = 0; i < Q.length; i += 4)
      for (let k = 0; k < 4; k++) {
        const a = Q[i + k], b = Q[i + ((k + 1) & 3)];
        if (a !== b) fn(a, b);
      }
  };
  each((a, b) => { deg[a + 1]++; deg[b + 1]++; });
  for (let i = 0; i < nv; i++) deg[i + 1] += deg[i];
  const nbr = new Uint32Array(deg[nv]);
  const fp = deg.slice(0, nv);
  each((a, b) => { nbr[fp[a]++] = b; nbr[fp[b]++] = a; });
  return { deg, nbr };
}

// Surface Nets sobre una rejilla de celda hc; cada vértice queda pegado a la superficie fina.
// precise: pegar cada vértice a la superficie fina (si no, se queda donde lo pone Surface Nets).
async function netsMesh(F, hc, tick, f0, f1, precise = true) {
  const M = Math.ceil(1 / hc) + 1;
  const o = -0.5 - (M * hc - 1) / 2; // rejilla centrada en la caja
  const MM = M * M;
  const vals = new Float32Array(M * MM);
  // Por bloques de 8³ muestras: los que caen en zonas vacías de la rejilla dispersa no se muestrean.
  const K = 8;
  for (let bz = 0; bz < M; bz += K) {
    for (let by = 0; by < M; by += K)
      for (let bx = 0; bx < M; bx += K) {
        const ex = Math.min(bx + K, M), ey = Math.min(by + K, M), ez = Math.min(bz + K, M);
        const e = F.empty(o + bx * hc, o + by * hc, o + bz * hc, o + (ex - 1) * hc, o + (ey - 1) * hc, o + (ez - 1) * hc);
        for (let z = bz; z < ez; z++)
          for (let y = by; y < ey; y++)
            for (let x = bx; x < ex; x++)
              vals[x + M * y + MM * z] = e ?? F.sample(o + x * hc, o + y * hc, o + z * hc);
      }
    await tick(f0 + (f1 - f0) * 0.4 * bz / M);
  }
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
    await tick(f0 + (f1 - f0) * (0.4 + 0.2 * z / C));
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
  const nv = P.length / 3;
  const p = [0, 0, 0];
  for (let i = 0; i < nv && precise; i++) {
    const j = i * 3;
    const t = hitAlong(F, P[j], P[j + 1], P[j + 2], dirs[j], dirs[j + 1], dirs[j + 2], hc * 1.5);
    if (!Number.isNaN(t)) { P[j] += dirs[j] * t; P[j + 1] += dirs[j + 1] * t; P[j + 2] += dirs[j + 2] * t; }
    p[0] = P[j]; p[1] = P[j + 1]; p[2] = P[j + 2];
    snap(F, p);
    P[j] = p[0]; P[j + 1] = p[1]; P[j + 2] = p[2];
    if ((i & 1023) === 0) await tick(f0 + (f1 - f0) * (0.6 + 0.4 * i / nv));
  }
  return { P, Q: new Uint32Array(quads) };
}

// Relajar: cada vértice va hacia el centro de sus vecinos sin salirse de la superficie.
async function relax(F, P, Q, iters, tick, f0, f1, step = 0.6) {
  const nv = P.length / 3;
  const { deg, nbr } = adjacency(nv, Q);
  const N = new Float32Array(P.length), next = new Float32Array(P.length);
  const p = [0, 0, 0];
  for (let it = 0; it < iters; it++) {
    quadNormals(P, Q, N);
    for (let i = 0; i < nv; i++) {
      const j = i * 3;
      const k0 = deg[i], k1 = deg[i + 1];
      if (k1 === k0) { next[j] = P[j]; next[j + 1] = P[j + 1]; next[j + 2] = P[j + 2]; continue; }
      let cx = 0, cy = 0, cz = 0;
      for (let k = k0; k < k1; k++) { const m = nbr[k] * 3; cx += P[m]; cy += P[m + 1]; cz += P[m + 2]; }
      const cnt = k1 - k0;
      let dx = cx / cnt - P[j], dy = cy / cnt - P[j + 1], dz = cz / cnt - P[j + 2];
      const dn = dx * N[j] + dy * N[j + 1] + dz * N[j + 2];
      dx -= dn * N[j]; dy -= dn * N[j + 1]; dz -= dn * N[j + 2];
      p[0] = P[j] + dx * step; p[1] = P[j + 1] + dy * step; p[2] = P[j + 2] + dz * step;
      snap(F, p, 1);
      next[j] = p[0]; next[j + 1] = p[1]; next[j + 2] = p[2];
      if ((i & 1023) === 0) await tick(f0 + (f1 - f0) * (it + i / nv) / iters);
    }
    P.set(next);
  }
  for (let i = 0; i < nv; i++) {
    const j = i * 3;
    p[0] = P[j]; p[1] = P[j + 1]; p[2] = P[j + 2];
    snap(F, p, 2);
    P[j] = p[0]; P[j + 1] = p[1]; P[j + 2] = p[2];
  }
}

// ----- Campo de orientación y de posiciones (como Instant Meshes, Jakob et al. 2015) -----
// Cada muestra de la superficie lleva una dirección tangente "en cruz" (vale igual girada 90°)
// que se suaviza con las vecinas: acaba siguiendo la forma (a lo largo de brazos, alrededor de
// curvas). Luego, una rejilla de puntos de lado s orientada con esa cruz; las muestras que caen
// en el mismo punto se funden en un vértice y las que caen en puntos vecinos se unen con una arista.

// De dos cruces (q0 en n0, q1 en n1), los brazos que mejor coinciden.
function compatOrient(q0, n0, q1, n1, outA, outB) {
  // Brazos: q y n×q de cada cruz.
  const a1x = n0[1] * q0[2] - n0[2] * q0[1], a1y = n0[2] * q0[0] - n0[0] * q0[2], a1z = n0[0] * q0[1] - n0[1] * q0[0];
  const b1x = n1[1] * q1[2] - n1[2] * q1[1], b1y = n1[2] * q1[0] - n1[0] * q1[2], b1z = n1[0] * q1[1] - n1[1] * q1[0];
  const d00 = q0[0] * q1[0] + q0[1] * q1[1] + q0[2] * q1[2], d01 = q0[0] * b1x + q0[1] * b1y + q0[2] * b1z;
  const d10 = a1x * q1[0] + a1y * q1[1] + a1z * q1[2], d11 = a1x * b1x + a1y * b1y + a1z * b1z;
  let best = Math.abs(d00), bi = 0, bj = 0, d = d00;
  if (Math.abs(d01) > best + 1e-6) { best = Math.abs(d01); bi = 0; bj = 1; d = d01; }
  if (Math.abs(d10) > best + 1e-6) { best = Math.abs(d10); bi = 1; bj = 0; d = d10; }
  if (Math.abs(d11) > best + 1e-6) { bi = 1; bj = 1; d = d11; }
  const sg = d < 0 ? -1 : 1;
  if (bi) { outA[0] = a1x; outA[1] = a1y; outA[2] = a1z; } else { outA[0] = q0[0]; outA[1] = q0[1]; outA[2] = q0[2]; }
  if (bj) { outB[0] = b1x * sg; outB[1] = b1y * sg; outB[2] = b1z * sg; }
  else { outB[0] = q1[0] * sg; outB[1] = q1[1] * sg; outB[2] = q1[2] * sg; }
}

// Punto medio entre dos muestras, sobre la intersección de sus planos tangentes.
function middlePoint(p0, n0, p1, n1, out) {
  const n0p1 = n0[0] * p1[0] + n0[1] * p1[1] + n0[2] * p1[2], n0p0 = n0[0] * p0[0] + n0[1] * p0[1] + n0[2] * p0[2];
  const n1p0 = n1[0] * p0[0] + n1[1] * p0[1] + n1[2] * p0[2], n1p1 = n1[0] * p1[0] + n1[1] * p1[1] + n1[2] * p1[2];
  const n0n1 = n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2];
  const den = 1 / (1 - n0n1 * n0n1 + 1e-4);
  const l0 = 2 * (n0p1 - n0p0 - n0n1 * (n1p0 - n1p1)) * den;
  const l1 = 2 * (n1p0 - n1p1 - n0n1 * (n0p1 - n0p0)) * den;
  for (let k = 0; k < 3; k++) out[k] = 0.5 * (p0[k] + p1[k]) - 0.25 * (n0[k] * l0 + n1[k] * l1);
}

// Punto de la rejilla (origen o, ejes q y t, lado s) con f = floor o round, cerca de p.
function latticePoint(o, q, t, p, s, f, out) {
  const dx = p[0] - o[0], dy = p[1] - o[1], dz = p[2] - o[2];
  const a = f((q[0] * dx + q[1] * dy + q[2] * dz) / s) * s, b = f((t[0] * dx + t[1] * dy + t[2] * dz) / s) * s;
  for (let k = 0; k < 3; k++) out[k] = o[k] + q[k] * a + t[k] * b;
}

// De dos rejillas, los puntos que mejor coinciden (cerca del punto medio de las muestras).
const _m = [0, 0, 0], _o0 = [0, 0, 0], _o1 = [0, 0, 0], _t0 = [0, 0, 0], _t1 = [0, 0, 0];
function compatPos(p0, n0, q0, o0, p1, n1, q1, o1, s, outA, outB) {
  _t0[0] = n0[1] * q0[2] - n0[2] * q0[1]; _t0[1] = n0[2] * q0[0] - n0[0] * q0[2]; _t0[2] = n0[0] * q0[1] - n0[1] * q0[0];
  _t1[0] = n1[1] * q1[2] - n1[2] * q1[1]; _t1[1] = n1[2] * q1[0] - n1[0] * q1[2]; _t1[2] = n1[0] * q1[1] - n1[1] * q1[0];
  middlePoint(p0, n0, p1, n1, _m);
  latticePoint(o0, q0, _t0, _m, s, Math.floor, _o0);
  latticePoint(o1, q1, _t1, _m, s, Math.floor, _o1);
  let best = Infinity, bi = 0, bj = 0;
  for (let i = 0; i < 4; i++) {
    const ai = i & 1, at = i >> 1;
    for (let j = 0; j < 4; j++) {
      const bjq = j & 1, bjt = j >> 1;
      let c = 0;
      for (let k = 0; k < 3; k++) {
        const d = _o0[k] + (q0[k] * ai + _t0[k] * at) * s - _o1[k] - (q1[k] * bjq + _t1[k] * bjt) * s;
        c += d * d;
      }
      if (c < best) { best = c; bi = i; bj = j; }
    }
  }
  for (let k = 0; k < 3; k++) {
    outA[k] = _o0[k] + (q0[k] * (bi & 1) + _t0[k] * (bi >> 1)) * s;
    outB[k] = _o1[k] + (q1[k] * (bj & 1) + _t1[k] * (bj >> 1)) * s;
  }
}

// Jerarquía de muestras (agrupando por celdas cada vez más grandes) para que los campos
// converjan rápido: se resuelve en lo grueso y se afina hacia abajo.
function buildHierarchy(V, N, deg, nbr, cell0) {
  const levels = [{ V, N, deg, nbr, n: V.length / 3, parent: null }];
  let cell = cell0;
  while (levels.at(-1).n > 64 && levels.length < 16) {
    const L = levels.at(-1);
    cell *= 2;
    const K = Math.ceil(1 / cell) + 4;
    const map = new Map();
    const parent = new Int32Array(L.n);
    const sv = [], sn = [], cnt = [];
    for (let i = 0; i < L.n; i++) {
      const j = i * 3;
      const nx = L.N[j], ny = L.N[j + 1], nz = L.N[j + 2];
      let ax = 0, av = Math.abs(nx);
      if (Math.abs(ny) > av) { ax = 1; av = Math.abs(ny); }
      if (Math.abs(nz) > av) ax = 2;
      const cls = ax * 2 + (L.N[j + ax] < 0 ? 1 : 0);
      const fx = Math.floor((L.V[j] + 0.5) / cell) + 1, fy = Math.floor((L.V[j + 1] + 0.5) / cell) + 1;
      const fz = Math.floor((L.V[j + 2] + 0.5) / cell) + 1;
      const key = ((fx * K + fy) * K + fz) * 6 + cls;
      let pi = map.get(key);
      if (pi === undefined) { pi = cnt.length; map.set(key, pi); cnt.push(0); sv.push(0, 0, 0); sn.push(0, 0, 0); }
      parent[i] = pi;
      cnt[pi]++;
      for (let k = 0; k < 3; k++) { sv[pi * 3 + k] += L.V[j + k]; sn[pi * 3 + k] += L.N[j + k]; }
    }
    const n2 = cnt.length;
    if (n2 >= L.n) break;
    const V2 = new Float64Array(n2 * 3), N2 = new Float64Array(n2 * 3);
    for (let i = 0; i < n2; i++) {
      const l = Math.hypot(sn[i * 3], sn[i * 3 + 1], sn[i * 3 + 2]) || 1;
      for (let k = 0; k < 3; k++) { V2[i * 3 + k] = sv[i * 3 + k] / cnt[i]; N2[i * 3 + k] = sn[i * 3 + k] / l; }
    }
    const es = new Set();
    for (let i = 0; i < L.n; i++)
      for (let k = L.deg[i]; k < L.deg[i + 1]; k++) {
        const a = parent[i], b = parent[L.nbr[k]];
        if (a !== b) es.add(a * n2 + b);
      }
    const deg2 = new Uint32Array(n2 + 1);
    for (const e of es) deg2[Math.floor(e / n2) + 1]++;
    for (let i = 0; i < n2; i++) deg2[i + 1] += deg2[i];
    const nbr2 = new Uint32Array(deg2[n2]);
    const fp = deg2.slice(0, n2);
    for (const e of es) { const a = Math.floor(e / n2); nbr2[fp[a]++] = e - a * n2; }
    L.parent = parent;
    levels.push({ V: V2, N: N2, deg: deg2, nbr: nbr2, n: n2, parent: null });
  }
  return levels;
}

const proj = (v, n) => { // v en el plano tangente de n, unitario (o null si no se puede)
  const d = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
  const x = v[0] - n[0] * d, y = v[1] - n[1] * d, z = v[2] - n[2] * d;
  const l = Math.hypot(x, y, z);
  if (l < 1e-9) return null;
  v[0] = x / l; v[1] = y / l; v[2] = z / l;
  return v;
};
const anyTangent = (n, out) => {
  const a = Math.abs(n[0]) < 0.6 ? [1, 0, 0] : [0, 1, 0];
  out[0] = a[0]; out[1] = a[1]; out[2] = a[2];
  return proj(out, n);
};

async function solveFields(levels, s, tick, f0, f1) {
  const top = levels.length - 1;
  const v3 = (A, i, out) => { out[0] = A[i * 3]; out[1] = A[i * 3 + 1]; out[2] = A[i * 3 + 2]; return out; };
  const qi = [0, 0, 0], ni = [0, 0, 0], qj = [0, 0, 0], nj = [0, 0, 0], a = [0, 0, 0], b = [0, 0, 0];
  const vi = [0, 0, 0], vj = [0, 0, 0], oi = [0, 0, 0], oj = [0, 0, 0], ti = [0, 0, 0];
  // Orientación.
  for (let l = top; l >= 0; l--) {
    const L = levels[l];
    L.Q = new Float64Array(L.n * 3);
    for (let i = 0; i < L.n; i++) {
      v3(L.N, i, ni);
      if (l < top) v3(levels[l + 1].Q, levels[l].parent[i], qi);
      if (l === top || !proj(qi, ni)) anyTangent(ni, qi);
      L.Q.set(qi, i * 3);
    }
    const iters = l === 0 ? 10 : 6;
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < L.n; i++) {
        v3(L.Q, i, qi); v3(L.N, i, ni);
        let ws = 0;
        for (let k = L.deg[i]; k < L.deg[i + 1]; k++) {
          const j = L.nbr[k];
          compatOrient(qi, ni, v3(L.Q, j, qj), v3(L.N, j, nj), a, b);
          for (let c = 0; c < 3; c++) qi[c] = a[c] * ws + b[c];
          ws += 1;
          if (!proj(qi, ni)) v3(L.Q, i, qi);
        }
        L.Q.set(qi, i * 3);
      }
      await tick(f0 + (f1 - f0) * 0.5 * (top - l + it / iters) / (top + 1));
    }
  }
  // Posiciones.
  for (let l = top; l >= 0; l--) {
    const L = levels[l];
    L.O = new Float64Array(L.n * 3);
    for (let i = 0; i < L.n; i++) {
      v3(L.V, i, vi); v3(L.N, i, ni);
      if (l < top) {
        v3(levels[l + 1].O, levels[l].parent[i], oi);
        const d = (oi[0] - vi[0]) * ni[0] + (oi[1] - vi[1]) * ni[1] + (oi[2] - vi[2]) * ni[2];
        for (let c = 0; c < 3; c++) oi[c] -= ni[c] * d;
      } else { oi[0] = vi[0]; oi[1] = vi[1]; oi[2] = vi[2]; }
      L.O.set(oi, i * 3);
    }
    const iters = l === 0 ? 10 : 6;
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < L.n; i++) {
        v3(L.V, i, vi); v3(L.N, i, ni); v3(L.Q, i, qi); v3(L.O, i, oi);
        let ws = 0;
        for (let k = L.deg[i]; k < L.deg[i + 1]; k++) {
          const j = L.nbr[k];
          compatPos(vi, ni, qi, oi, v3(L.V, j, vj), v3(L.N, j, nj), v3(L.Q, j, qj), v3(L.O, j, oj), s, a, b);
          for (let c = 0; c < 3; c++) oi[c] = (a[c] * ws + b[c]) / (ws + 1);
          ws += 1;
          const d = (oi[0] - vi[0]) * ni[0] + (oi[1] - vi[1]) * ni[1] + (oi[2] - vi[2]) * ni[2];
          for (let c = 0; c < 3; c++) oi[c] -= ni[c] * d;
        }
        if (ws) {
          ti[0] = ni[1] * qi[2] - ni[2] * qi[1]; ti[1] = ni[2] * qi[0] - ni[0] * qi[2]; ti[2] = ni[0] * qi[1] - ni[1] * qi[0];
          latticePoint(oi, qi, ti, vi, s, Math.round, oi);
        }
        L.O.set(oi, i * 3);
      }
      await tick(f0 + (f1 - f0) * (0.5 + 0.5 * (top - l + it / iters) / (top + 1)));
    }
  }
}

// De las muestras con su punto de rejilla, la malla: se funden las que caen en el mismo punto,
// se unen las que caen en puntos vecinos y se recorren las caras alrededor de cada vértice.
function extractMesh(L, s) {
  const { n, V, N, Q, O, deg, nbr } = L;
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const links = [];
  for (let i = 0; i < n; i++) {
    const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
    const qx = Q[i * 3], qy = Q[i * 3 + 1], qz = Q[i * 3 + 2];
    const tx = ny * qz - nz * qy, ty = nz * qx - nx * qz, tz = nx * qy - ny * qx;
    for (let k = deg[i]; k < deg[i + 1]; k++) {
      const j = nbr[k];
      if (j < i) continue;
      // Paredes opuestas de un surco fino: no se mezclan.
      const nn = nx * N[j * 3] + ny * N[j * 3 + 1] + nz * N[j * 3 + 2];
      if (nn < 0.2) continue;
      let dx = O[j * 3] - O[i * 3], dy = O[j * 3 + 1] - O[i * 3 + 1], dz = O[j * 3 + 2] - O[i * 3 + 2];
      const dn = dx * nx + dy * ny + dz * nz;
      dx -= nx * dn; dy -= ny * dn; dz -= nz * dn;
      const u = (dx * qx + dy * qy + dz * qz) / s, w = (dx * tx + dy * ty + dz * tz) / s;
      const ru = Math.round(u), rw = Math.round(w);
      if (Math.abs(u - ru) > 0.3 || Math.abs(w - rw) > 0.3) continue;
      const m = Math.abs(ru) + Math.abs(rw);
      if (m === 0) { const a = find(i), b = find(j); if (a !== b) parent[a] = b; }
      else if (m === 1) links.push(i, j);
    }
  }
  // Vértices = grupos fundidos.
  const id = new Int32Array(n).fill(-1);
  const cp = [], cn = [], cc = [];
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (id[r] < 0) { id[r] = cc.length; cc.push(0); cp.push(0, 0, 0); cn.push(0, 0, 0); }
    const c = id[r];
    id[i] = c;
    cc[c]++;
    for (let k = 0; k < 3; k++) { cp[c * 3 + k] += O[i * 3 + k]; cn[c * 3 + k] += N[i * 3 + k]; }
  }
  const nc = cc.length;
  for (let c = 0; c < nc; c++) {
    const l = Math.hypot(cn[c * 3], cn[c * 3 + 1], cn[c * 3 + 2]) || 1;
    for (let k = 0; k < 3; k++) { cp[c * 3 + k] /= cc[c]; cn[c * 3 + k] /= l; }
  }
  // Aristas entre grupos (sin repetir y sin saltos raros).
  const adj = Array.from({ length: nc }, () => []);
  const seen = new Set();
  for (let k = 0; k < links.length; k += 2) {
    const a = id[links[k]], b = id[links[k + 1]];
    if (a === b) continue;
    const key = a < b ? a * nc + b : b * nc + a;
    if (seen.has(key)) continue;
    const d = Math.hypot(cp[a * 3] - cp[b * 3], cp[a * 3 + 1] - cp[b * 3 + 1], cp[a * 3 + 2] - cp[b * 3 + 2]);
    if (d > s * 1.9 || d < s * 0.2) continue;
    seen.add(key);
    adj[a].push(b);
    adj[b].push(a);
  }
  // Vecinos de cada vértice ordenados por ángulo alrededor de su normal.
  const t = [0, 0, 0];
  for (let c = 0; c < nc; c++) {
    const n0 = [cn[c * 3], cn[c * 3 + 1], cn[c * 3 + 2]];
    anyTangent(n0, t);
    const b0 = [n0[1] * t[2] - n0[2] * t[1], n0[2] * t[0] - n0[0] * t[2], n0[0] * t[1] - n0[1] * t[0]];
    const ang = (o) => {
      const dx = cp[o * 3] - cp[c * 3], dy = cp[o * 3 + 1] - cp[c * 3 + 1], dz = cp[o * 3 + 2] - cp[c * 3 + 2];
      return Math.atan2(dx * b0[0] + dy * b0[1] + dz * b0[2], dx * t[0] + dy * t[1] + dz * t[2]);
    };
    adj[c] = adj[c].map((o) => [ang(o), o]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
  }
  // Recorrer caras: llegando a v desde u, se sigue por el vecino anterior a u (sentido antihorario).
  const used = new Set();
  const faces = [];
  for (let a0 = 0; a0 < nc; a0++)
    for (const b0 of adj[a0]) {
      if (used.has(a0 * nc + b0)) continue;
      const f = [a0];
      let u = a0, v = b0, ok = true;
      for (;;) {
        used.add(u * nc + v);
        if (v === a0) break;
        if (f.includes(v)) { ok = false; break; }
        f.push(v);
        if (f.length > 10) { ok = false; break; }
        const list = adj[v], k = list.indexOf(u);
        if (k < 0) { ok = false; break; }
        u = v;
        v = list[(k - 1 + list.length) % list.length];
      }
      if (ok && f.length >= 3) faces.push(f);
    }
  // Caras de vuelta en quads (los triángulos, con el último vértice repetido).
  const quads = [];
  for (const f of faces) {
    // Que miren hacia fuera (como la normal de sus vértices).
    let sx = 0, sy = 0, sz = 0, nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < f.length; k++) {
      const p = f[k] * 3, q = f[(k + 1) % f.length] * 3;
      sx += (cp[p + 1] - cp[q + 1]) * (cp[p + 2] + cp[q + 2]);
      sy += (cp[p + 2] - cp[q + 2]) * (cp[p] + cp[q]);
      sz += (cp[p] - cp[q]) * (cp[p + 1] + cp[q + 1]);
      nx += cn[p]; ny += cn[p + 1]; nz += cn[p + 2];
    }
    if (sx * nx + sy * ny + sz * nz < 0) f.reverse();
    if (f.length === 3) quads.push(f[0], f[1], f[2], f[2]);
    else if (f.length === 4) quads.push(f[0], f[1], f[2], f[3]);
    else {
      let k = 1;
      for (; k + 2 < f.length; k += 2) quads.push(f[0], f[k], f[k + 1], f[k + 2]);
      if (k + 1 < f.length) quads.push(f[0], f[k], f[k + 1], f[k + 1]);
    }
  }
  fixTopology(quads, nc, cp);
  // Quitar vértices sueltos.
  const used2 = new Int32Array(nc).fill(-1);
  const P = [];
  for (let i = 0; i < quads.length; i++) {
    const c = quads[i];
    if (used2[c] < 0) { used2[c] = P.length / 3; P.push(cp[c * 3], cp[c * 3 + 1], cp[c * 3 + 2]); }
    quads[i] = used2[c];
  }
  return { P: new Float32Array(P), Q: new Uint32Array(quads), faces: faces.length };
}

// Deja la malla cerrada y limpia: quita las caras que se montan (aristas con más de dos caras o
// caras dadas la vuelta) y tapa los agujeros que queden con quads (y algún triángulo).
function fixTopology(quads, nv, P) {
  const faces = [];
  for (let i = 0; i < quads.length; i += 4)
    faces.push(quads[i + 2] === quads[i + 3] ? [quads[i], quads[i + 1], quads[i + 2]] : quads.slice(i, i + 4));
  faces.sort((a, b) => b.length - a.length); // los quads mandan
  const half = new Set(), cnt = new Map();
  const ukey = (a, b) => (a < b ? a * nv + b : b * nv + a);
  const keep = [];
  const fits = (f) => {
    for (let k = 0; k < f.length; k++) {
      const a = f[k], b = f[(k + 1) % f.length];
      if (a === b || half.has(a * nv + b) || (cnt.get(ukey(a, b)) || 0) >= 2) return false;
    }
    return true;
  };
  const add = (f) => {
    if (!fits(f)) return;
    keep.push(f);
    for (let k = 0; k < f.length; k++) {
      const a = f[k], b = f[(k + 1) % f.length];
      half.add(a * nv + b);
      cnt.set(ukey(a, b), (cnt.get(ukey(a, b)) || 0) + 1);
    }
  };
  for (const f of faces) add(f);
  // Tapa un agujero con una tira de quads uniendo sus dos lados, empezando por su punta (el vértice
  // más lejos del centro): en los agujeros alargados de los surcos sale una tira limpia.
  const strip = (L) => {
    const out = [];
    let i = 0, j = L.length - 1;
    if (L.length & 1) { out.push([L[j], L[i], L[i + 1]]); i++; }
    while (j - i >= 3) { out.push([L[i], L[i + 1], L[j - 1], L[j]]); i++; j--; }
    if (j - i === 2) out.push([L[i], L[i + 1], L[j]]);
    return out;
  };
  const fillLoop = (loop) => {
    if (loop.length < 3) return;
    let cx = 0, cy = 0, cz = 0;
    for (const a of loop) { cx += P[a * 3]; cy += P[a * 3 + 1]; cz += P[a * 3 + 2]; }
    cx /= loop.length; cy /= loop.length; cz /= loop.length;
    let far = 0, fd = -1;
    loop.forEach((a, k) => {
      const d = (P[a * 3] - cx) ** 2 + (P[a * 3 + 1] - cy) ** 2 + (P[a * 3 + 2] - cz) ** 2;
      if (d > fd) { fd = d; far = k; }
    });
    const from = (k) => strip(loop.slice(k).concat(loop.slice(0, k)));
    // Si alguna cara chocaría con la malla (agujero con cintura), se prueba otro punto de partida.
    let best = null;
    for (let r = 0; r < loop.length && !best; r++) {
      const fs = from((far + r) % loop.length);
      if (fs.every(fits)) best = fs;
    }
    for (const f of best || from(far)) add(f);
  };
  // Agujeros: cada arista de borde a→b pide una cara de relleno con b→a.
  for (let pass = 0; pass < 3; pass++) {
    const fillNext = new Map();
    for (const h of half) {
      const a = Math.floor(h / nv), b = h - a * nv;
      if (half.has(b * nv + a)) continue;
      if (!fillNext.has(b)) fillNext.set(b, []);
      fillNext.get(b).push(a);
    }
    for (const start of fillNext.keys())
      while (fillNext.get(start).length) {
        // Se recorre el borde; si pasa dos veces por un vértice (agujeros que se tocan), cada
        // vuelta se tapa por separado.
        const loops = [];
        let loop = [start];
        let v = fillNext.get(start).pop(), ok = true;
        while (v !== start) {
          if (loop.length > 64 || !fillNext.has(v) || !fillNext.get(v).length) { ok = false; break; }
          const k = loop.indexOf(v);
          if (k >= 0) { loops.push(loop.slice(k)); loop = loop.slice(0, k); }
          loop.push(v);
          v = fillNext.get(v).pop();
        }
        if (ok) loops.push(loop);
        loops.forEach(fillLoop);
      }
  }
  // Dos triángulos vecinos = un quad.
  const triAt = new Map();
  keep.forEach((f, i) => { if (f.length === 3) for (let k = 0; k < 3; k++) triAt.set(f[k] * nv + f[(k + 1) % 3], i); });
  for (let i = 0; i < keep.length; i++) {
    const f = keep[i];
    if (f.length !== 3) continue;
    for (let k = 0; k < 3; k++) {
      const a = f[k], b = f[(k + 1) % 3], c = f[(k + 2) % 3];
      const j = triAt.get(c * nv + b);
      if (j === undefined || j === i || keep[j].length !== 3) continue;
      const g = keep[j], x = g[0] !== c && g[0] !== b ? g[0] : g[1] !== c && g[1] !== b ? g[1] : g[2];
      if (x === a) continue;
      keep[i] = [a, b, x, c];
      keep[j] = [];
      break;
    }
  }
  quads.length = 0;
  for (const f of keep) if (f.length) quads.push(f[0], f[1], f[2], f[3] ?? f[2]);
}

// Remesh que sigue la forma. s = lado de los quads.
async function flowMesh(F, s, tick) {
  const base = await netsMesh(F, s / 2.4, tick, 0, 0.2, false);
  const nv = base.P.length / 3;
  if (nv < 32) return null;
  const V = Float64Array.from(base.P), N = new Float64Array(nv * 3);
  const qn = quadNormals(base.P, base.Q, new Float32Array(base.P.length));
  for (let i = 0; i < nv; i++) {
    const g = F.grad(V[i * 3], V[i * 3 + 1], V[i * 3 + 2]);
    const ok = g[0] || g[1] || g[2];
    for (let k = 0; k < 3; k++) N[i * 3 + k] = ok ? g[k] : qn[i * 3 + k];
  }
  const { deg, nbr } = adjacency(nv, base.Q);
  const levels = buildHierarchy(V, N, deg, nbr, s / 2.4);
  await tick(0.25);
  await solveFields(levels, s, tick, 0.25, 0.75);
  const out = extractMesh(levels[0], s);
  await tick(0.8);
  // Pegar a la superficie y relajar un poco (sin perder la dirección de los quads).
  const nv2 = out.P.length / 3;
  const p = [0, 0, 0];
  for (let i = 0; i < nv2; i++) {
    p[0] = out.P[i * 3]; p[1] = out.P[i * 3 + 1]; p[2] = out.P[i * 3 + 2];
    snap(F, p, 3);
    out.P.set(p, i * 3);
  }
  await relax(F, out.P, out.Q, 3, tick, 0.8, 1, 0.4);
  return out;
}

// Remesh de la capa. area: área de la superficie (de la malla de vóxeles); target: quads aproximados.
// mode 'flow' sigue la forma; 'grid' es la rejilla relajada (más simple, siempre cerrada).
// Devuelve { positions, normals, quads } (quads con 4 índices, hacia fuera; triángulos con el último repetido).
export async function remeshSDF(grid, area, target, onProgress, mode = 'flow') {
  const F = field(grid);
  const tick = ticker((f) => onProgress && onProgress('Malla nueva', f));
  let P = null, Q = null;
  if (mode === 'flow') {
    const s = Math.max(Math.sqrt(area / Math.max(100, target)), F.h * 2);
    const m = await flowMesh(F, s, tick);
    // Si sale muy incompleta (formas raras), mejor la rejilla.
    if (m && m.Q.length / 4 > (area / (s * s)) * 0.5) { P = m.P; Q = m.Q; }
  }
  if (!P) {
    // Surface Nets en superficies curvas da ~1,4 quads por celda²: se corrige para acertar con el número pedido.
    const hc = Math.max(Math.sqrt((area * 1.4) / Math.max(100, target)), F.h * 1.5);
    const m = await netsMesh(F, hc, tick, 0, 0.5);
    P = m.P; Q = m.Q;
    await relax(F, P, Q, 10, tick, 0.5, 1);
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
