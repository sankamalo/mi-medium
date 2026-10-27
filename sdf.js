// Rejilla de vóxeles con distancia con signo (SDF), como el "barro" de Medium.
// Espacio local: cubo [-0.5, 0.5]^3. Negativo = dentro del material.
//
// Es DISPERSA: se guarda en bloques de 8x8x8 y solo existen los bloques cerca de la
// superficie. Los bloques vacíos guardan un único signo (todo dentro / todo fuera).
// Así se puede subir a 512^3 sin gastar gigas de memoria.
//
// Cada bloque puede llevar además color (RGBA, A=0 = "sin pintar": usa el color base de la capa).

const B = 8, B3 = 512;
const smooth = (t) => (t >= 1 ? 0 : (1 - t) * (1 - t) * (1 + 2 * t));

export class SDFGrid {
  constructor(n = 192, shape = 'sphere') {
    this.setResolution(n);
    if (shape === 'sphere') this.reset();
  }

  setResolution(n) {
    this.view = null;
    this.n = n;
    this.h = 1 / (n - 1);
    this.band = 4 * this.h;
    this.nb = Math.ceil(n / B);
    this.bricks = new Array(this.nb ** 3).fill(null);
    this.colors = new Array(this.nb ** 3).fill(null);
    this.fill = new Int8Array(this.nb ** 3).fill(1);
  }

  // Estado completo por referencia (para deshacer cambios de resolución sin copiar).
  state() {
    const { n, bricks, colors, fill } = this;
    return { n, bricks, colors, fill };
  }
  setState(s) {
    this.n = s.n;
    this.h = 1 / (s.n - 1);
    this.band = 4 * this.h;
    this.nb = Math.ceil(s.n / B);
    this.bricks = s.bricks;
    this.colors = s.colors;
    this.fill = s.fill;
  }

  bytes() {
    let c = 0;
    for (const b of this.bricks) if (b) c += B3 * 4;
    for (const b of this.colors) if (b) c += B3 * 4;
    return c;
  }

  // `view` (opcional): registro de deshacer del trazo actual. Si está puesto, get() lee
  // la forma de ANTES del trazo (para que el pincel siga la superficie original).
  get(x, y, z) {
    const bi = (x >> 3) + this.nb * ((y >> 3) + this.nb * (z >> 3));
    let b = this.bricks[bi], f = this.fill[bi];
    if (this.view) {
      const s = this.view.get(bi);
      if (s) { b = s.d; f = s.f; }
    }
    return b ? b[(x & 7) | ((y & 7) << 3) | ((z & 7) << 6)] : f * this.band;
  }

  // Copia un bloque denso [ox, ox+sx) ... a `out` (y el color a `cout`, RGBA, si se pide).
  copyRegion(ox, oy, oz, sx, sy, sz, out, cout) {
    const { nb, bricks, colors, fill, band } = this;
    let i = 0;
    for (let z = oz; z < oz + sz; z++) {
      const bz = z >> 3, lz = (z & 7) << 6;
      for (let y = oy; y < oy + sy; y++) {
        const by = y >> 3, ly = (y & 7) << 3;
        const row = nb * (by + nb * bz);
        for (let x = ox; x < ox + sx; x++) {
          const bi = (x >> 3) + row;
          const li = (x & 7) | ly | lz;
          const b = bricks[bi];
          out[i] = b ? b[li] : fill[bi] * band;
          if (cout) {
            const c = colors[bi];
            const j = i * 4;
            if (c) {
              cout[j] = c[li * 4]; cout[j + 1] = c[li * 4 + 1]; cout[j + 2] = c[li * 4 + 2]; cout[j + 3] = c[li * 4 + 3];
            } else cout[j + 3] = 0;
          }
          i++;
        }
      }
    }
  }

  // ¿La región (muestras inclusivas) está entera en bloques vacíos del mismo signo?
  regionUniform(x0, y0, z0, x1, y1, z1) {
    const { nb, bricks, fill } = this;
    let sign = 0;
    for (let bz = z0 >> 3; bz <= z1 >> 3; bz++)
      for (let by = y0 >> 3; by <= y1 >> 3; by++)
        for (let bx = x0 >> 3; bx <= x1 >> 3; bx++) {
          const bi = bx + nb * (by + nb * bz);
          if (bricks[bi]) return false;
          if (sign === 0) sign = fill[bi];
          else if (sign !== fill[bi]) return false;
        }
    return true;
  }

  // Rellena la rejilla con fn(x,y,z) -> distancia. uniform(bx,by,bz) devuelve ±1 si el
  // bloque entero cae dentro/fuera (para saltárselo), o 0 si hay que calcularlo.
  // colorFn(x,y,z) -> [r,g,b,a] | null copia color (al cambiar de resolución).
  build(fn, uniform, colorFn) {
    const { nb, n, h, band } = this;
    for (let bz = 0; bz < nb; bz++)
      for (let by = 0; by < nb; by++)
        for (let bx = 0; bx < nb; bx++) {
          const bi = bx + nb * (by + nb * bz);
          this.colors[bi] = null;
          const u = uniform(bx, by, bz);
          if (u) { this.fill[bi] = u; this.bricks[bi] = null; continue; }
          const b = new Float32Array(B3);
          let allIn = true, allOut = true;
          for (let k = 0; k < B3; k++) {
            const x = bx * B + (k & 7), y = by * B + ((k >> 3) & 7), z = bz * B + (k >> 6);
            let d = fn(-0.5 + x * h, -0.5 + y * h, -0.5 + z * h);
            d = Math.max(-band, Math.min(band, d));
            if (x <= 0 || y <= 0 || z <= 0 || x >= n - 1 || y >= n - 1 || z >= n - 1) d = Math.max(d, h * 0.5);
            b[k] = d;
            if (d > -band * 0.999) allIn = false;
            if (d < band * 0.999) allOut = false;
          }
          if (allIn || allOut) { this.fill[bi] = allIn ? -1 : 1; this.bricks[bi] = null; continue; }
          this.bricks[bi] = b;
          if (colorFn) {
            let c = null;
            for (let k = 0; k < B3; k++) {
              const x = bx * B + (k & 7), y = by * B + ((k >> 3) & 7), z = bz * B + (k >> 6);
              const col = colorFn(-0.5 + x * h, -0.5 + y * h, -0.5 + z * h);
              if (!col) continue;
              if (!c) c = new Uint8Array(B3 * 4);
              c.set(col, k * 4);
            }
            this.colors[bi] = c;
          }
        }
  }

  reset(radius = 0.1) {
    const rb = (B * Math.sqrt(3)) / 2 * this.h + this.band;
    this.build(
      (x, y, z) => Math.sqrt(x * x + y * y + z * z) - radius,
      (bx, by, bz) => {
        const c = (i) => -0.5 + (i * B + (B - 1) / 2) * this.h;
        const d = Math.hypot(c(bx), c(by), c(bz)) - radius;
        return d > rb ? 1 : d < -rb ? -1 : 0;
      },
    );
  }

  sample(px, py, pz) {
    const n = this.n, s = n - 1;
    const fx = (px + 0.5) * s, fy = (py + 0.5) * s, fz = (pz + 0.5) * s;
    if (fx < 0 || fy < 0 || fz < 0 || fx > s || fy > s || fz > s) return this.band;
    const x = Math.min(fx | 0, n - 2), y = Math.min(fy | 0, n - 2), z = Math.min(fz | 0, n - 2);
    const tx = fx - x, ty = fy - y, tz = fz - z;
    const g = (a, b, c) => this.get(a, b, c);
    const c00 = g(x, y, z) + (g(x + 1, y, z) - g(x, y, z)) * tx;
    const c10 = g(x, y + 1, z) + (g(x + 1, y + 1, z) - g(x, y + 1, z)) * tx;
    const c01 = g(x, y, z + 1) + (g(x + 1, y, z + 1) - g(x, y, z + 1)) * tx;
    const c11 = g(x, y + 1, z + 1) + (g(x + 1, y + 1, z + 1) - g(x, y + 1, z + 1)) * tx;
    const c0 = c00 + (c10 - c00) * ty, c1 = c01 + (c11 - c01) * ty;
    return c0 + (c1 - c0) * tz;
  }

  // Color (RGBA 0-255) de la muestra más cercana; null si no está pintada.
  sampleColor(px, py, pz) {
    const s = this.n - 1;
    const cl = (v) => Math.max(0, Math.min(s, Math.round((v + 0.5) * s)));
    const x = cl(px), y = cl(py), z = cl(pz);
    const c = this.colors[(x >> 3) + this.nb * ((y >> 3) + this.nb * (z >> 3))];
    if (!c) return null;
    const j = ((x & 7) | ((y & 7) << 3) | ((z & 7) << 6)) * 4;
    return c[j + 3] ? [c[j], c[j + 1], c[j + 2], 255] : null;
  }

  gradient(px, py, pz) {
    const e = this.h;
    const gx = this.sample(px + e, py, pz) - this.sample(px - e, py, pz);
    const gy = this.sample(px, py + e, pz) - this.sample(px, py - e, pz);
    const gz = this.sample(px, py, pz + e) - this.sample(px, py, pz - e);
    const l = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    return [gx / l, gy / l, gz / l];
  }

  // Cambia la resolución conservando la forma y el color.
  resample(newN) {
    const old = new SDFGrid(2, 'empty');
    old.setState(this.state());
    this.setResolution(newN);
    const ratio = (old.n - 1) / (newN - 1);
    this.build(
      (x, y, z) => old.sample(x, y, z),
      (bx, by, bz) => {
        const lo = (i) => Math.max(0, Math.floor(i * B * ratio) - 1);
        const hi = (i) => Math.min(old.n - 1, Math.ceil((i * B + B) * ratio) + 1);
        if (!old.regionUniform(lo(bx), lo(by), lo(bz), hi(bx), hi(by), hi(bz))) return 0;
        return old.fill[(lo(bx) >> 3) + old.nb * ((lo(by) >> 3) + old.nb * (lo(bz) >> 3))];
      },
      (x, y, z) => old.sampleColor(x, y, z),
    );
  }

  // Mueve y gira la forma (movimiento rígido, conserva el color). inv: matriz 4x4 por columnas
  // (como three.js) que lleva cada punto nuevo a donde estaba antes. Lo que salga de la caja se pierde.
  applyTransform(inv) {
    const old = new SDFGrid(2, 'empty');
    old.setState(this.state());
    this.setResolution(this.n);
    const e = inv, s = old.n - 1, h = this.h;
    const tp = (x, y, z) => [
      e[0] * x + e[4] * y + e[8] * z + e[12],
      e[1] * x + e[5] * y + e[9] * z + e[13],
      e[2] * x + e[6] * y + e[10] * z + e[14],
    ];
    this.build(
      (x, y, z) => { const p = tp(x, y, z); return old.sample(p[0], p[1], p[2]); },
      (bx, by, bz) => {
        // Caja (en vóxeles de antes) que ocupa este bloque una vez girado.
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (let c = 0; c < 8; c++) {
          const p = tp(-0.5 + (bx * B + (c & 1) * (B - 1)) * h, -0.5 + (by * B + ((c >> 1) & 1) * (B - 1)) * h,
            -0.5 + (bz * B + (c >> 2) * (B - 1)) * h);
          for (let a = 0; a < 3; a++) {
            const v = (p[a] + 0.5) * s;
            lo[a] = Math.min(lo[a], Math.floor(v) - 1);
            hi[a] = Math.max(hi[a], Math.ceil(v) + 1);
          }
        }
        if (hi.some((v) => v < 0) || lo.some((v) => v > s)) return 1;
        const partial = lo.some((v) => v < 0) || hi.some((v) => v > s);
        const L = lo.map((v) => Math.max(0, v)), H = hi.map((v) => Math.min(s, v));
        if (!old.regionUniform(L[0], L[1], L[2], H[0], H[1], H[2])) return 0;
        const f = old.fill[(L[0] >> 3) + old.nb * ((L[1] >> 3) + old.nb * (L[2] >> 3))];
        return partial && f !== 1 ? 0 : f;
      },
      (x, y, z) => { const p = tp(x, y, z); return old.sampleColor(p[0], p[1], p[2]); },
    );
  }

  // Rayo (local) contra la superficie. Devuelve [x,y,z, t] o null.
  raymarch(o, d) {
    let t0 = -Infinity, t1 = Infinity;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-9) {
        if (o[a] < -0.5 || o[a] > 0.5) return null;
        continue;
      }
      let ta = (-0.5 - o[a]) / d[a], tb = (0.5 - o[a]) / d[a];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
    }
    if (t0 > t1 || t1 < 0) return null;
    let t = Math.max(t0, 0) + 1e-5;
    const h = this.h;
    for (let k = 0; k < 4096 && t <= t1; k++) {
      const px = o[0] + d[0] * t, py = o[1] + d[1] * t, pz = o[2] + d[2] * t;
      const v = this.sample(px, py, pz);
      if (v < h * 0.05) return [px, py, pz, t];
      t += Math.max(v * 0.9, h * 0.3);
    }
    return null;
  }

  // Aplica una herramienta a lo largo del tramo a→b (local) con radio r: así el trazo es
  // continuo aunque muevas la mano rápido (una "cápsula", no bolas sueltas).
  // `undo` (Map) recibe la copia original de cada bloque antes de tocarlo.
  // `paint` = { rgb: [r,g,b], base: [r,g,b] }: color con el que añade/pinta.
  // Devuelve la caja de muestras modificadas {lo, hi} o null.
  applyBrush(tool, a, b, r, strength, invert, dt, undo, paint) {
    const { n, h, band, nb, bricks, colors, fill } = this;
    const lo = [0, 0, 0], hi = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.max(0, Math.floor((Math.min(a[i], b[i]) - r + 0.5) / h) - 1);
      hi[i] = Math.min(n - 1, Math.ceil((Math.max(a[i], b[i]) + r + 0.5) / h) + 1);
      if (lo[i] > hi[i]) return null;
    }
    let op = tool;
    if (invert) op = { add: 'remove', remove: 'add', inflate: 'deflate' }[tool] || tool;
    const k = strength * Math.min(dt * 60, 3);
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    const ab2 = abx * abx + aby * aby + abz * abz;
    const segDist = (px, py, pz) => {
      let t = ab2 > 0 ? ((px - a[0]) * abx + (py - a[1]) * aby + (pz - a[2]) * abz) / ab2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = px - a[0] - abx * t, qy = py - a[1] - aby * t, qz = pz - a[2] - abz * t;
      return Math.sqrt(qx * qx + qy * qy + qz * qz);
    };

    let src = null;
    const sx = hi[0] - lo[0] + 1, sy = hi[1] - lo[1] + 1, sz = hi[2] - lo[2] + 1;
    if (op === 'smooth') {
      src = new Float32Array(sx * sy * sz);
      this.copyRegion(lo[0], lo[1], lo[2], sx, sy, sz, src);
    }
    const pn = op === 'flatten' ? this.gradient(b[0], b[1], b[2]) : null;
    const rgb = paint ? (op === 'paint' && invert ? paint.base : paint.rgb) : null;
    const base = paint ? paint.base : null;
    const touched = [];

    for (let bz = lo[2] >> 3; bz <= hi[2] >> 3; bz++)
      for (let by = lo[1] >> 3; by <= hi[1] >> 3; by++)
        for (let bx = lo[0] >> 3; bx <= hi[0] >> 3; bx++) {
          const bi = bx + nb * (by + nb * bz);
          if (!bricks[bi]) {
            // Saltar bloques vacíos que la herramienta no puede cambiar.
            if (op === 'paint') continue;
            const dist = segDist(-0.5 + (bx * B + 3.5) * h, -0.5 + (by * B + 3.5) * h, -0.5 + (bz * B + 3.5) * h);
            const rb = B * 0.87 * h;
            if (dist - rb > r + band) continue;
            if (op === 'add' && fill[bi] < 0) continue;
            if (op === 'remove' && fill[bi] > 0 && dist - rb > r) continue;
          }
          if (undo && !undo.has(bi)) {
            undo.set(bi, { d: bricks[bi] ? bricks[bi].slice() : null, f: fill[bi], c: colors[bi] ? colors[bi].slice() : null });
          }
          let bk = bricks[bi];
          if (!bk) bk = bricks[bi] = new Float32Array(B3).fill(fill[bi] * band);
          let cb = colors[bi];
          touched.push(bi);
          const x0 = Math.max(lo[0], bx * B), x1 = Math.min(hi[0], bx * B + 7);
          const y0 = Math.max(lo[1], by * B), y1 = Math.min(hi[1], by * B + 7);
          const z0 = Math.max(lo[2], bz * B), z1 = Math.min(hi[2], bz * B + 7);
          for (let z = z0; z <= z1; z++) {
            const pz = -0.5 + z * h;
            for (let y = y0; y <= y1; y++) {
              const py = -0.5 + y * h;
              for (let x = x0; x <= x1; x++) {
                const px = -0.5 + x * h;
                const dist = segDist(px, py, pz);
                const w = smooth(dist / r);
                const li = (x & 7) | ((y & 7) << 3) | ((z & 7) << 6);
                let d = bk[li];
                switch (op) {
                  case 'add': {
                    const s = dist - r;
                    if (s < d) {
                      d = s;
                      if (rgb && s < band) {
                        if (!cb) cb = colors[bi] = new Uint8Array(B3 * 4);
                        const j = li * 4;
                        cb[j] = rgb[0]; cb[j + 1] = rgb[1]; cb[j + 2] = rgb[2]; cb[j + 3] = 255;
                      }
                    }
                    break;
                  }
                  case 'remove': d = Math.max(d, r - dist); break;
                  case 'inflate': d -= w * k * h * 0.35; break;
                  case 'deflate': d += w * k * h * 0.35; break;
                  case 'flatten':
                    if (w > 0) {
                      const target = (px - b[0]) * pn[0] + (py - b[1]) * pn[1] + (pz - b[2]) * pn[2];
                      d += (target - d) * Math.min(1, w * k * 0.25);
                    }
                    break;
                  case 'smooth':
                    if (w > 0) {
                      const X = x - lo[0], Y = y - lo[1], Z = z - lo[2];
                      const j = X + sx * (Y + sy * Z);
                      const s0 = src[j];
                      const avg = ((X > 0 ? src[j - 1] : s0) + (X < sx - 1 ? src[j + 1] : s0) +
                        (Y > 0 ? src[j - sx] : s0) + (Y < sy - 1 ? src[j + sx] : s0) +
                        (Z > 0 ? src[j - sx * sy] : s0) + (Z < sz - 1 ? src[j + sx * sy] : s0)) / 6;
                      d += (avg - d) * Math.min(1, w * k * 0.6);
                    }
                    break;
                  case 'paint':
                    if (w > 0 && d < band && d > -band) {
                      if (!cb) cb = colors[bi] = new Uint8Array(B3 * 4);
                      const j = li * 4;
                      const f = Math.min(1, w * k * 0.5);
                      const from = cb[j + 3] ? cb : null;
                      for (let c = 0; c < 3; c++) {
                        const v0 = from ? cb[j + c] : base[c];
                        cb[j + c] = Math.round(v0 + (rgb[c] - v0) * f);
                      }
                      cb[j + 3] = 255;
                    }
                    break;
                }
                d = Math.max(-band, Math.min(band, d));
                // El borde de la caja siempre fuera: la malla queda cerrada.
                if (x === 0 || y === 0 || z === 0 || x === n - 1 || y === n - 1 || z === n - 1) d = Math.max(d, h * 0.5);
                bk[li] = d;
              }
            }
          }
        }
    // Liberar bloques que han quedado enteros dentro o fuera.
    for (const bi of touched) this.compact(bi);
    return { lo, hi };
  }

  compact(bi) {
    const b = this.bricks[bi];
    if (!b) return;
    const lim = this.band * 0.999;
    const s = b[0] >= lim ? 1 : b[0] <= -lim ? -1 : 0;
    if (!s) return;
    for (let k = 1; k < B3; k++) if (s > 0 ? b[k] < lim : b[k] > -lim) return;
    this.bricks[bi] = null;
    this.colors[bi] = null;
    this.fill[bi] = s;
  }

  // Deshacer: restaura los bloques guardados y devuelve el registro inverso (para rehacer).
  restoreBricks(rec) {
    const inv = new Map();
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const [bi, s] of rec) {
      inv.set(bi, { d: this.bricks[bi], f: this.fill[bi], c: this.colors[bi] });
      this.bricks[bi] = s.d;
      this.fill[bi] = s.f;
      this.colors[bi] = s.c;
      const bx = bi % this.nb, by = Math.floor(bi / this.nb) % this.nb, bz = Math.floor(bi / this.nb ** 2);
      [bx, by, bz].forEach((v, a) => {
        lo[a] = Math.min(lo[a], v * B);
        hi[a] = Math.max(hi[a], v * B + 7);
      });
    }
    return { inv, lo, hi };
  }

  // ---- Serialización (para el espejo en directo en el Mac) ----
  serialize() {
    const idx = [], cidx = [];
    this.bricks.forEach((b, i) => b && idx.push(i));
    this.colors.forEach((c, i) => c && cidx.push(i));
    const parts = [this.fill.slice().buffer];
    for (const i of idx) parts.push(this.bricks[i].slice().buffer);
    for (const i of cidx) parts.push(this.colors[i].slice().buffer);
    return { meta: { n: this.n, idx, cidx }, parts };
  }

  static deserialize(meta, buf, off) {
    const g = new SDFGrid(meta.n, 'empty');
    const nb3 = g.nb ** 3;
    g.fill = new Int8Array(buf.slice(off, off + nb3));
    off += Math.ceil(nb3 / 4) * 4;
    for (const i of meta.idx) { g.bricks[i] = new Float32Array(buf.slice(off, off + B3 * 4)); off += B3 * 4; }
    for (const i of meta.cidx) { g.colors[i] = new Uint8Array(buf.slice(off, off + B3 * 4)); off += B3 * 4; }
    return { grid: g, off };
  }
}
