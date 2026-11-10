// Rejilla de vóxeles con distancia con signo (SDF), como el "barro" de Medium.
// Espacio local: empieza siendo el cubo [-0.5, 0.5]^3 y crece solo si te acercas al borde (grow),
// sin cambiar el tamaño del vóxel. Una muestra (x,y,z) está en o + x*h. Negativo = dentro del material.
//
// Es DISPERSA: se guarda en bloques de 8x8x8 y solo existen los bloques cerca de la
// superficie. Los bloques vacíos guardan un único signo (todo dentro / todo fuera).
// Así se puede subir a 512^3 sin gastar gigas de memoria.
//
// Cada bloque puede llevar además color (RGBA, A=0 = "sin pintar": usa el color base de la capa).

const B = 8, B3 = 512;
const smooth = (t) => (t >= 1 ? 0 : (1 - t) * (1 - t) * (1 + 2 * t));
// Inflar: meseta plana en el centro y borde suave → bulto redondo en vez de pico.
const plateau = (t) => (t >= 1 ? 0 : t <= 0.45 ? 1 : smooth((t - 0.45) / 0.55));

// Borde del pincel: cómo cae su fuerza del centro (t = 0) hacia fuera (t = 1). Sin nada, `smooth`.
const EDGE = {
  soft: (t) => { const w = smooth(t); return w * w; },
  hard: (t) => (t >= 1 ? 0 : t <= 0.72 ? 1 : smooth((t - 0.72) / 0.28)),
};

// Textura del pincel: un dibujo fijo en el espacio, de -1 (hundido) a 1 (saliente). Se mide en
// "periodos": como no depende del trazo, repetir una pasada no lo emborrona.
const hash3 = (x, y, z) => {
  const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return v - Math.floor(v);
};
function noise3(x, y, z) {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const fade = (t) => t * t * (3 - 2 * t);
  const u = fade(x - x0), v = fade(y - y0), w = fade(z - z0);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (i, j, k) => hash3(x0 + i, y0 + j, z0 + k);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
export const TEXTURES = {
  rough: (x, y, z) => (noise3(x, y, z) * 0.65 + noise3(x * 2.3, y * 2.3, z * 2.3) * 0.35) * 2 - 1,
  dots: (x, y, z) => {
    const d = Math.hypot(x - Math.round(x), y - Math.round(y), z - Math.round(z));
    return d <= 0.2 ? 1 : d >= 0.38 ? -1 : 1 - 2 * ((d - 0.2) / 0.18);
  },
  stripes: (x, y, z) => Math.sin(y * Math.PI * 2),
  // Bolitas en dos redes intercaladas: cada una es una escama redonda, con surco entre ellas.
  scales: (x, y, z) => {
    const fx = x - Math.floor(x), fy = y - Math.floor(y), fz = z - Math.floor(z);
    let d2 = (fx - 0.5) ** 2 + (fy - 0.5) ** 2 + (fz - 0.5) ** 2;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
      d2 = Math.min(d2, (fx - i) ** 2 + (fy - j) ** 2 + (fz - k) ** 2);
    }
    return 1 - 2 * Math.min(1, d2 / 0.31);
  },
};

// Pirámide de base cuadrada (lado 1, base en y = 0, altura h). De Inigo Quilez.
function sdPyramid(px, py, pz, h) {
  const m2 = h * h + 0.25;
  px = Math.abs(px); pz = Math.abs(pz);
  if (pz > px) { const t = px; px = pz; pz = t; }
  px -= 0.5; pz -= 0.5;
  const qx = pz, qy = h * py - 0.5 * px, qz = h * px + 0.5 * py;
  const s = Math.max(-qx, 0);
  const t = Math.min(1, Math.max(0, (qy - 0.5 * pz) / (m2 + 0.25)));
  const a = m2 * (qx + s) * (qx + s) + qy * qy;
  const b = m2 * (qx + 0.5 * t) * (qx + 0.5 * t) + (qy - m2 * t) * (qy - m2 * t);
  const d2 = Math.min(qy, -qx * m2 - qy * 0.5) > 0 ? 0 : Math.min(a, b);
  return Math.sqrt((d2 + qz * qz) / m2) * Math.sign(Math.max(qz, -py));
}

// Cuánto sobresale cada forma respecto a r (para no saltarse bloques que toca).
export const SHAPE_REACH = { sphere: 1, cube: 1.32, pyramid: 1.62, stamp: 1.8, blade: 1.6 };
// La hoja del cúter, en unidades del pincel: de canto hacia los lados, larga hacia delante.
export const BLADE = { thin: 0.1, tall: 0.9, long: 1.2 };

// Bloques que comparten varios fotogramas: nadie los escribe, se copian justo antes de tocarlos.
const SHARED = new WeakSet();

export class SDFGrid {
  constructor(n = 192, shape = 'sphere') {
    this.setResolution(n);
    if (shape === 'sphere') this.reset();
  }

  setResolution(n) {
    this.view = null;
    this.n = n;
    this.h = 1 / (n - 1);
    this.o = -0.5;
    this.band = 4 * this.h;
    this.alloc();
  }

  // Vacía la rejilla con el tamaño que tiene.
  alloc() {
    this.nb = Math.ceil(this.n / B);
    this.bricks = new Array(this.nb ** 3).fill(null);
    this.colors = new Array(this.nb ** 3).fill(null);
    this.fill = new Int8Array(this.nb ** 3).fill(1);
  }

  // La resolución que elige el usuario: lo que define el tamaño del vóxel, no cuánto espacio ocupa.
  get res() { return Math.round(1 / this.h) + 1; }

  // Añade S muestras (múltiplo de 8) por cada lado sin tocar lo que hay. Devuelve cómo se traduce
  // el número de un bloque antiguo al nuevo (para el historial de deshacer).
  grow(S) {
    const k = S / B, onb = this.nb, { bricks, colors, fill } = this;
    this.n += 2 * S;
    this.o -= S * this.h;
    this.alloc();
    const nb = this.nb;
    const remap = (bi) => (bi % onb) + k + nb * ((Math.floor(bi / onb) % onb) + k + nb * (Math.floor(bi / (onb * onb)) + k));
    for (let bi = 0; bi < onb ** 3; bi++) {
      if (!bricks[bi] && !colors[bi] && fill[bi] === 1) continue;
      const ni = remap(bi);
      this.bricks[ni] = bricks[bi];
      this.colors[ni] = colors[bi];
      this.fill[ni] = fill[bi];
    }
    return remap;
  }

  // Caja que ocupa la plastilina, en espacio local (null si la capa está vacía).
  occupied() {
    const { nb, bricks, fill, h, o } = this;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    let i = 0;
    for (let z = 0; z < nb; z++) for (let y = 0; y < nb; y++) for (let x = 0; x < nb; x++, i++) {
      if (!bricks[i] && fill[i] > 0) continue;
      [x, y, z].forEach((v, a) => {
        lo[a] = Math.min(lo[a], o + v * B * h);
        hi[a] = Math.max(hi[a], o + (v * B + B) * h);
      });
    }
    return lo[0] === Infinity ? null : { lo, hi };
  }

  // Estado completo por referencia (para deshacer cambios de resolución sin copiar).
  state() {
    const { n, h, o, bricks, colors, fill } = this;
    return { n, h, o, bricks, colors, fill };
  }
  setState(s) {
    this.n = s.n;
    this.h = s.h;
    this.o = s.o;
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
    for (const _ of this.buildSteps(fn, uniform, colorFn));
  }
  // Lo mismo poco a poco: va cediendo el paso e indica por dónde va (de 0 a 1).
  *buildSteps(fn, uniform, colorFn) {
    const { nb, n, h, o, band } = this;
    for (let bz = 0; bz < nb; bz++)
      for (let by = 0; by < nb; by++)
        for (let bx = 0; bx < nb; bx++) {
          if (!(bx & 15)) yield (bz + by / nb) / nb;
          const bi = bx + nb * (by + nb * bz);
          this.colors[bi] = null;
          const u = uniform(bx, by, bz);
          if (u) { this.fill[bi] = u; this.bricks[bi] = null; continue; }
          const b = new Float32Array(B3);
          let allIn = true, allOut = true;
          for (let k = 0; k < B3; k++) {
            const x = bx * B + (k & 7), y = by * B + ((k >> 3) & 7), z = bz * B + (k >> 6);
            let d = fn(o + x * h, o + y * h, o + z * h);
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
              const col = colorFn(o + x * h, o + y * h, o + z * h);
              if (!col) continue;
              if (!c) c = new Uint8Array(B3 * 4);
              c.set(col, k * 4);
            }
            this.colors[bi] = c;
          }
          yield (bz + by / nb) / nb;
        }
  }

  reset(radius = 0.1) {
    const rb = (B * Math.sqrt(3)) / 2 * this.h + this.band;
    this.build(
      (x, y, z) => Math.sqrt(x * x + y * y + z * z) - radius,
      (bx, by, bz) => {
        const c = (i) => this.o + (i * B + (B - 1) / 2) * this.h;
        const d = Math.hypot(c(bx), c(by), c(bz)) - radius;
        return d > rb ? 1 : d < -rb ? -1 : 0;
      },
    );
  }

  sample(px, py, pz) {
    const n = this.n, s = n - 1;
    const fx = (px - this.o) / this.h, fy = (py - this.o) / this.h, fz = (pz - this.o) / this.h;
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
    const cl = (v) => Math.max(0, Math.min(s, Math.round((v - this.o) / this.h)));
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

  // Muestras que hacen falta para cubrir el mismo espacio con otra resolución.
  samplesFor(res) {
    return Math.max(res, Math.ceil(((this.n - 1) * this.h * (res - 1) + 1) / B) * B);
  }

  // Cambia la resolución conservando la forma, el color y el espacio que cubre.
  resample(res) {
    for (const _ of this.resampleSteps(res));
  }
  *resampleSteps(res) {
    const old = new SDFGrid(2, 'empty');
    old.setState(this.state());
    this.n = this.samplesFor(res);
    this.h = 1 / (res - 1);
    this.o = -((this.n - 1) * this.h) / 2;
    this.band = 4 * this.h;
    this.view = null;
    this.alloc();
    const at = (i) => (this.o + i * B * this.h - old.o) / old.h;
    yield* this.buildSteps(
      (x, y, z) => old.sample(x, y, z),
      (bx, by, bz) => {
        const lo = (i) => Math.max(0, Math.min(old.n - 1, Math.floor(at(i)) - 1));
        const hi = (i) => Math.max(0, Math.min(old.n - 1, Math.ceil(at(i + 1)) + 1));
        if (!old.regionUniform(lo(bx), lo(by), lo(bz), hi(bx), hi(by), hi(bz))) return 0;
        return old.fill[(lo(bx) >> 3) + old.nb * ((lo(by) >> 3) + old.nb * (lo(bz) >> 3))];
      },
      (x, y, z) => old.sampleColor(x, y, z),
    );
  }

  // Mueve, gira y escala la forma (conserva el color). inv: matriz 4x4 por columnas (como three.js)
  // que lleva cada punto nuevo a donde estaba antes; scale: escala uniforme aplicada (las distancias
  // crecen igual). Lo que salga de la caja se pierde.
  applyTransform(inv, scale = 1) {
    const old = new SDFGrid(2, 'empty');
    old.setState(this.state());
    this.view = null;
    this.alloc();
    const e = inv, s = old.n - 1, h = this.h, g0 = this.o;
    const tp = (x, y, z) => [
      e[0] * x + e[4] * y + e[8] * z + e[12],
      e[1] * x + e[5] * y + e[9] * z + e[13],
      e[2] * x + e[6] * y + e[10] * z + e[14],
    ];
    this.build(
      (x, y, z) => { const p = tp(x, y, z); return old.sample(p[0], p[1], p[2]) * scale; },
      (bx, by, bz) => {
        // Caja (en vóxeles de antes) que ocupa este bloque una vez girado.
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (let c = 0; c < 8; c++) {
          const p = tp(g0 + (bx * B + (c & 1) * (B - 1)) * h, g0 + (by * B + ((c >> 1) & 1) * (B - 1)) * h,
            g0 + (bz * B + (c >> 2) * (B - 1)) * h);
          for (let a = 0; a < 3; a++) {
            const v = (p[a] - old.o) / old.h;
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

  // Hace sitio hasta la caja lo..hi, sin pasarse del tope de muestras.
  growTo(lo, hi, max) {
    const g1 = this.o + (this.n - 1) * this.h, pad = this.band * 2;
    let need = 0;
    for (let i = 0; i < 3; i++) need = Math.max(need, this.o - (lo[i] - pad), hi[i] + pad - g1);
    if (need <= 0) return;
    let S = Math.ceil(Math.max(need / this.h, this.n * 0.25) / 32) * 32;
    if (this.n + 2 * S > max) S = Math.floor((max - this.n) / 2 / 32) * 32;
    if (S > 0) this.grow(S);
  }

  // Une otra capa a esta poco a poco. Solo se calculan los bloques donde cae la otra capa; el resto sigue
  // siendo el mismo bloque, sin gastar tiempo ni memoria. e: matriz (por columnas) de esta rejilla a la otra;
  // scale: cómo pasar sus distancias a las de esta; base: su color donde no está pintada; lo..hi: la caja
  // que ocupa aquí; touched: se apuntan los bloques que cambian.
  *absorbSteps(src, e, scale, base, lo, hi, touched) {
    const { nb, n, h, o, band, bricks, colors, fill } = this;
    const s = src.n - 1, tint = [base[0], base[1], base[2], 255];
    const tp = (x, y, z, a) => e[a] * x + e[a + 4] * y + e[a + 8] * z + e[a + 12];
    const srcFill = (bx, by, bz) => {
      const L = [Infinity, Infinity, Infinity], H = [-Infinity, -Infinity, -Infinity];
      for (let c = 0; c < 8; c++) {
        const x = o + (bx * B + (c & 1) * (B - 1)) * h, y = o + (by * B + ((c >> 1) & 1) * (B - 1)) * h, z = o + (bz * B + (c >> 2) * (B - 1)) * h;
        for (let a = 0; a < 3; a++) {
          const v = (tp(x, y, z, a) - src.o) / src.h;
          L[a] = Math.min(L[a], Math.floor(v) - 1);
          H[a] = Math.max(H[a], Math.ceil(v) + 1);
        }
      }
      if (H.some((v) => v < 0) || L.some((v) => v > s)) return 1;
      const partial = L.some((v) => v < 0) || H.some((v) => v > s);
      const l = L.map((v) => Math.max(0, v)), u = H.map((v) => Math.min(s, v));
      if (!src.regionUniform(l[0], l[1], l[2], u[0], u[1], u[2])) return 0;
      const f = src.fill[(l[0] >> 3) + src.nb * ((l[1] >> 3) + src.nb * (l[2] >> 3))];
      return partial && f !== 1 ? 0 : f;
    };
    const first = (a) => Math.max(0, Math.floor((lo[a] - o) / h / B) - 1);
    const last = (a) => Math.min(nb - 1, Math.ceil((hi[a] - o) / h / B) + 1);
    const x0 = first(0), x1 = last(0), y0 = first(1), y1 = last(1), z0 = first(2), z1 = last(2);
    for (let bz = z0; bz <= z1; bz++) for (let by = y0; by <= y1; by++) for (let bx = x0; bx <= x1; bx++) {
      const at = (bz - z0 + (by - y0) / (y1 - y0 + 1)) / (z1 - z0 + 1);
      if (!(bx & 15)) yield at;
      const bi = bx + nb * (by + nb * bz), b0 = bricks[bi], f0 = fill[bi], c0 = colors[bi];
      if (!b0 && f0 === -1) continue; // ya es todo macizo
      const u = srcFill(bx, by, bz);
      if (u === 1) continue; // la otra capa no llega aquí
      if (u === -1) {
        bricks[bi] = colors[bi] = null;
        fill[bi] = -1;
        touched.push(bi);
        continue;
      }
      const b = new Float32Array(B3);
      let c = null, won = false, allIn = true, allOut = true;
      for (let k = 0; k < B3; k++) {
        const vx = bx * B + (k & 7), vy = by * B + ((k >> 3) & 7), vz = bz * B + (k >> 6);
        const x = o + vx * h, y = o + vy * h, z = o + vz * h;
        const px = tp(x, y, z, 0), py = tp(x, y, z, 1), pz = tp(x, y, z, 2);
        const had = b0 ? b0[k] : f0 * band, ds = src.sample(px, py, pz) * scale;
        let d = Math.max(-band, Math.min(band, Math.min(had, ds)));
        if (vx <= 0 || vy <= 0 || vz <= 0 || vx >= n - 1 || vy >= n - 1 || vz >= n - 1) d = Math.max(d, h * 0.5);
        b[k] = d;
        if (d > -band * 0.999) allIn = false;
        if (d < band * 0.999) allOut = false;
        if (ds < had) {
          won = true;
          if (!c) c = new Uint8Array(B3 * 4);
          c.set(src.sampleColor(px, py, pz) || tint, k * 4);
        } else if (c0 && c0[k * 4 + 3]) {
          if (!c) c = new Uint8Array(B3 * 4);
          c[k * 4] = c0[k * 4]; c[k * 4 + 1] = c0[k * 4 + 1]; c[k * 4 + 2] = c0[k * 4 + 2]; c[k * 4 + 3] = c0[k * 4 + 3];
        }
      }
      yield at;
      if (!won) continue;
      touched.push(bi);
      if (allIn || allOut) {
        bricks[bi] = colors[bi] = null;
        fill[bi] = allIn ? -1 : 1;
      } else {
        bricks[bi] = b;
        colors[bi] = c;
      }
    }
  }

  // Rayo (local) contra la superficie. Devuelve [x,y,z, t] o null.
  raymarch(o, d) {
    let t0 = -Infinity, t1 = Infinity;
    const g0 = this.o, g1 = this.o + (this.n - 1) * this.h;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-9) {
        if (o[a] < g0 || o[a] > g1) return null;
        continue;
      }
      let ta = (g0 - o[a]) / d[a], tb = (g1 - o[a]) / d[a];
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
  // opts: { shape: 'sphere' | 'cube' | 'pyramid', rot: matriz 3x3 (9 números, por columnas) } para
  // añadir/quitar con forma. 'grab' (arrastrar) lleva el barro de a hasta b con caída suave.
  // También en opts: edge ('soft' | 'hard'), texture (nombre en TEXTURES), y frame + shift (giro 3x3 y
  // desplazamiento de la copia de simetría, para que la textura salga reflejada igual que la forma).
  // Con shape 'stamp', opts.stampEval(x, y, z, out) da la distancia y el color del sello (en unidades de r).
  // 'pinch' junta el barro hacia la línea del trazo; 'crease' además hunde un surco.
  applyBrush(tool, a, b, r, strength, invert, dt, undo, paint, opts) {
    const { n, h, o, band, nb, bricks, colors, fill } = this;
    const shape = (tool === 'add' || tool === 'remove') && opts?.shape && opts.shape !== 'sphere' ? opts.shape : null;
    const tex = opts?.texture ? TEXTURES[opts.texture] : null;
    // El dibujo va con el pincel: más pequeño con un pincel pequeño (y caben más), más grande con uno grande.
    const period = Math.max(r * 0.5, 4 * h);
    const amp = tex ? Math.min(r * 0.22, band * 0.7) : 0;
    const F = opts?.frame, T = opts?.shift;
    const texAt = (px, py, pz) => {
      if (!F) return tex(px / period, py / period, pz / period);
      const x = px - T[0], y = py - T[1], z = pz - T[2];
      return tex((x * F[0] + y * F[1] + z * F[2]) / period, (x * F[3] + y * F[4] + z * F[5]) / period, (x * F[6] + y * F[7] + z * F[8]) / period);
    };
    const falloff = EDGE[opts?.edge] || smooth;
    const puff = opts?.edge === 'hard' ? EDGE.hard : opts?.edge === 'soft' ? smooth : plateau;
    const reach = (shape ? r * SHAPE_REACH[shape] : r) + amp;
    // Arrastrar mira hacia atrás (de dónde viene el barro): la caja crece en -delta.
    const back = tool === 'grab' ? [2 * a[0] - b[0], 2 * a[1] - b[1], 2 * a[2] - b[2]] : a;
    const lo = [0, 0, 0], hi = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.max(0, Math.floor((Math.min(a[i], b[i], back[i]) - reach - o) / h) - 1);
      hi[i] = Math.min(n - 1, Math.ceil((Math.max(a[i], b[i], back[i]) + reach - o) / h) + 1);
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
    // Distancia con signo a la forma del pincel (barrida a lo largo del tramo a→b).
    const R = opts?.rot || [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const stampOut = { d: 0, c: null };
    let stampRgb = null;
    const shapeDist = (px, py, pz) => {
      let t = ab2 > 0 ? ((px - a[0]) * abx + (py - a[1]) * aby + (pz - a[2]) * abz) / ab2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = px - a[0] - abx * t, dy = py - a[1] - aby * t, dz = pz - a[2] - abz * t;
      // Al sistema del pincel (ejes = columnas de R).
      const lx = dx * R[0] + dy * R[1] + dz * R[2];
      const ly = dx * R[3] + dy * R[4] + dz * R[5];
      const lz = dx * R[6] + dy * R[7] + dz * R[8];
      if (shape === 'stamp') {
        opts.stampEval(lx / r, ly / r, lz / r, stampOut);
        stampRgb = stampOut.c;
        return stampOut.d * r;
      }
      if (shape === 'blade') {
        const qx = Math.abs(lx) - Math.max(r * BLADE.thin, h * 1.6), qy = Math.abs(ly) - r * BLADE.tall, qz = Math.abs(lz) - r * BLADE.long;
        const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
        return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0);
      }
      if (shape === 'cube') {
        const e = r * 0.75;
        const qx = Math.abs(lx) - e, qy = Math.abs(ly) - e, qz = Math.abs(lz) - e;
        const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
        return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0);
      }
      const S = 2 * r; // pirámide: base 2r × 2r, altura 2r, centrada en su "peso"
      return sdPyramid(lx / S, (ly + 0.6 * r) / S, lz / S, 1) * S;
    };

    let src = null;
    const sx = hi[0] - lo[0] + 1, sy = hi[1] - lo[1] + 1, sz = hi[2] - lo[2] + 1;
    let srcC = null;
    if (op === 'smooth' || op === 'inflate' || op === 'deflate' || op === 'grab' || op === 'pinch' || op === 'crease') {
      src = new Float32Array(sx * sy * sz);
      if (op === 'grab' || op === 'inflate') srcC = new Uint8Array(sx * sy * sz * 4);
      this.copyRegion(lo[0], lo[1], lo[2], sx, sy, sz, src, srcC);
    }
    // Lectura trilineal de la copia (en vóxeles relativos a lo).
    const srcAt = (fx, fy, fz) => {
      fx = Math.max(0, Math.min(sx - 1.001, fx)); fy = Math.max(0, Math.min(sy - 1.001, fy)); fz = Math.max(0, Math.min(sz - 1.001, fz));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
      const tx = fx - x0, ty = fy - y0, tz = fz - z0;
      const j = x0 + sx * (y0 + sy * z0), X = 1, Y = sx, Z = sx * sy;
      const l = (u, v, t) => u + (v - u) * t;
      return l(l(l(src[j], src[j + X], tx), l(src[j + Y], src[j + X + Y], tx), ty),
        l(l(src[j + Z], src[j + X + Z], tx), l(src[j + Y + Z], src[j + X + Y + Z], tx), ty), tz);
    };
    const gdx = b[0] - a[0], gdy = b[1] - a[1], gdz = b[2] - a[2];
    const glen = Math.hypot(gdx, gdy, gdz);
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
            const cx = o + (bx * B + 3.5) * h, cy = o + (by * B + 3.5) * h, cz = o + (bz * B + 3.5) * h;
            const rb = B * 0.87 * h;
            if (op === 'grab') {
              if (Math.hypot(cx - a[0], cy - a[1], cz - a[2]) - rb > r + glen + band) continue;
            } else if (segDist(cx, cy, cz) - rb > reach + band) continue;
            const dist = segDist(cx, cy, cz);
            if (op === 'add' && fill[bi] < 0) continue;
            if (op === 'remove' && fill[bi] > 0 && dist - rb > reach) continue;
          }
          if (undo && !undo.has(bi)) {
            undo.set(bi, { d: bricks[bi] ? bricks[bi].slice() : null, f: fill[bi], c: colors[bi] ? colors[bi].slice() : null });
          }
          if (bricks[bi] && SHARED.has(bricks[bi])) bricks[bi] = bricks[bi].slice();
          if (colors[bi] && SHARED.has(colors[bi])) colors[bi] = colors[bi].slice();
          let bk = bricks[bi];
          if (!bk) bk = bricks[bi] = new Float32Array(B3).fill(fill[bi] * band);
          let cb = colors[bi];
          touched.push(bi);
          const x0 = Math.max(lo[0], bx * B), x1 = Math.min(hi[0], bx * B + 7);
          const y0 = Math.max(lo[1], by * B), y1 = Math.min(hi[1], by * B + 7);
          const z0 = Math.max(lo[2], bz * B), z1 = Math.min(hi[2], bz * B + 7);
          for (let z = z0; z <= z1; z++) {
            const pz = o + z * h;
            for (let y = y0; y <= y1; y++) {
              const py = o + y * h;
              for (let x = x0; x <= x1; x++) {
                const px = o + x * h;
                const dist = segDist(px, py, pz);
                const w = falloff(dist / r);
                const li = (x & 7) | ((y & 7) << 3) | ((z & 7) << 6);
                let d = bk[li];
                switch (op) {
                  case 'add': {
                    let s = shape ? shapeDist(px, py, pz) : dist - r;
                    if (tex && Math.abs(s) < band + amp) s -= amp * texAt(px, py, pz);
                    if (s < d) {
                      d = s;
                      const tint = stampRgb || rgb;
                      if (tint && s < band) {
                        if (!cb) cb = colors[bi] = new Uint8Array(B3 * 4);
                        const j = li * 4;
                        cb[j] = tint[0]; cb[j + 1] = tint[1]; cb[j + 2] = tint[2]; cb[j + 3] = 255;
                      }
                    }
                    break;
                  }
                  case 'remove': {
                    let s = shape ? shapeDist(px, py, pz) : dist - r;
                    if (tex && Math.abs(s) < band + amp) s -= amp * texAt(px, py, pz);
                    d = Math.max(d, -s);
                    break;
                  }
                  case 'inflate': case 'deflate': {
                    // Empuja la superficie hacia fuera (o dentro) y la relaja un poco: queda redonda.
                    let wp = puff(dist / r);
                    // Con textura: el dibujo manda de verdad (antes solo la mitad) y no se alisa, que lo emborronaba.
                    const textured = tex && wp > 0;
                    if (textured) wp *= 0.12 + 0.88 * texAt(px, py, pz);
                    if (wp > 0) {
                      const X = x - lo[0], Y = y - lo[1], Z = z - lo[2];
                      const j = X + sx * (Y + sy * Z);
                      const s0 = src[j];
                      const n0 = X > 0 ? src[j - 1] : s0, n1 = X < sx - 1 ? src[j + 1] : s0, n2 = Y > 0 ? src[j - sx] : s0,
                        n3 = Y < sy - 1 ? src[j + sx] : s0, n4 = Z > 0 ? src[j - sx * sy] : s0, n5 = Z < sz - 1 ? src[j + sx * sy] : s0;
                      const avg = (n0 + n1 + n2 + n3 + n4 + n5) / 6;
                      d += (op === 'inflate' ? -1 : 1) * wp * k * h * 0.35 + (textured ? 0 : (avg - d) * Math.min(1, wp * k * 0.12));
                      // La superficie crece desde la que ya hay: fuera de ella el barro no puede aparecer suelto.
                      if (op === 'inflate') {
                        if (s0 > 0) d = Math.max(d, Math.min(s0, Math.min(n0, n1, n2, n3, n4, n5) + h * 0.25));
                        // Lo que crece sale del color de lo que tiene al lado, no del color base de la capa.
                        if (d < band && !(cb && cb[li * 4 + 3])) {
                          const Zs = sx * sy;
                          const c = X > 0 && srcC[(j - 1) * 4 + 3] ? j - 1 : X < sx - 1 && srcC[(j + 1) * 4 + 3] ? j + 1
                            : Y > 0 && srcC[(j - sx) * 4 + 3] ? j - sx : Y < sy - 1 && srcC[(j + sx) * 4 + 3] ? j + sx
                            : Z > 0 && srcC[(j - Zs) * 4 + 3] ? j - Zs : Z < sz - 1 && srcC[(j + Zs) * 4 + 3] ? j + Zs : -1;
                          if (c >= 0) {
                            if (!cb) cb = colors[bi] = new Uint8Array(B3 * 4);
                            cb[li * 4] = srcC[c * 4]; cb[li * 4 + 1] = srcC[c * 4 + 1]; cb[li * 4 + 2] = srcC[c * 4 + 2]; cb[li * 4 + 3] = 255;
                          }
                        }
                      } else if (s0 < 0) d = Math.min(d, Math.max(s0, Math.max(n0, n1, n2, n3, n4, n5) - h * 0.25));
                    }
                    break;
                  }
                  case 'grab': {
                    // Cada punto toma el barro de donde venía: x - w·delta (caída alrededor de a).
                    // Con meseta: el centro del pincel viaja entero con la mano (un tentáculo grueso, no un pincho).
                    const wg = puff(Math.hypot(px - a[0], py - a[1], pz - a[2]) / r);
                    if (wg > 0) {
                      const fx = x - lo[0] - (wg * gdx) / h, fy = y - lo[1] - (wg * gdy) / h, fz = z - lo[2] - (wg * gdz) / h;
                      d = srcAt(fx, fy, fz);
                      const j0 = (Math.round(Math.max(0, Math.min(sx - 1, fx))) + sx * (Math.round(Math.max(0, Math.min(sy - 1, fy))) +
                        sy * Math.round(Math.max(0, Math.min(sz - 1, fz))))) * 4;
                      if (srcC[j0 + 3] || cb) {
                        if (!cb) cb = colors[bi] = new Uint8Array(B3 * 4);
                        const jj = li * 4;
                        cb[jj] = srcC[j0]; cb[jj + 1] = srcC[j0 + 1]; cb[jj + 2] = srcC[j0 + 2]; cb[jj + 3] = srcC[j0 + 3];
                      }
                    }
                    break;
                  }
                  case 'pinch': case 'crease':
                    if (w > 0) {
                      // Cada punto toma el barro de más lejos de la línea: la superficie se aprieta hacia ella.
                      let tl = ab2 > 0 ? ((px - a[0]) * abx + (py - a[1]) * aby + (pz - a[2]) * abz) / ab2 : 0;
                      tl = tl < 0 ? 0 : tl > 1 ? 1 : tl;
                      const dir = op === 'pinch' && invert ? -1 : 1;
                      const f = (dir * Math.min(0.5, w * k * (op === 'crease' ? 0.12 : 0.22))) / h;
                      d = srcAt(x - lo[0] + (px - a[0] - abx * tl) * f, y - lo[1] + (py - a[1] - aby * tl) * f, z - lo[2] + (pz - a[2] - abz * tl) * f);
                      // Hendidura: un surco más estrecho que el pincel (invertida, una cresta).
                      if (op === 'crease') d += (invert ? -1 : 1) * falloff(dist / (r * 0.6)) * k * h * 0.5;
                    }
                    break;
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
                    if (w > 0 && d < band && d > -band && (!tex || texAt(px, py, pz) > 0)) {
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
    return { meta: { n: this.n, h: this.h, o: this.o, idx, cidx }, parts };
  }

  // Otra rejilla igual que esta sin copiar nada: comparten los bloques hasta que uno los toca.
  share() {
    const g = new SDFGrid(2, 'empty');
    g.setState({ n: this.n, h: this.h, o: this.o, bricks: this.bricks.slice(), colors: this.colors.slice(), fill: this.fill.slice() });
    for (const b of this.bricks) if (b) SHARED.add(b);
    for (const c of this.colors) if (c) SHARED.add(c);
    return g;
  }

  // Una rejilla vacía que ocupa el mismo espacio que esta.
  blank() {
    const g = new SDFGrid(2, 'empty');
    g.setState({ n: this.n, h: this.h, o: this.o, bricks: new Array(this.nb ** 3).fill(null),
      colors: new Array(this.nb ** 3).fill(null), fill: new Int8Array(this.nb ** 3).fill(1) });
    return g;
  }

  // ¿Esta zona (en muestras) es idéntica en las dos rejillas? Se compara qué bloque hay, sin leerlo.
  sameRegion(other, x0, y0, z0, x1, y1, z1) {
    if (this.n !== other.n || this.h !== other.h || this.o !== other.o) return false;
    const nb = this.nb, c = (v) => Math.max(0, Math.min(nb - 1, v >> 3));
    for (let bz = c(z0); bz <= c(z1); bz++) for (let by = c(y0); by <= c(y1); by++) for (let bx = c(x0); bx <= c(x1); bx++) {
      const bi = bx + nb * (by + nb * bz);
      if (this.bricks[bi] !== other.bricks[bi] || this.colors[bi] !== other.colors[bi] || this.fill[bi] !== other.fill[bi]) return false;
    }
    return true;
  }

  // Varios fotogramas de una capa: cada bloque compartido se guarda una sola vez.
  static serializeFrames(grids) {
    const bp = new Map(), cp = new Map();
    const at = (pool, a) => {
      if (!pool.has(a)) pool.set(a, pool.size);
      return pool.get(a);
    };
    const frames = grids.map((g) => {
      const m = { n: g.n, h: g.h, o: g.o, idx: [], cidx: [], bp: [], cp: [] };
      g.bricks.forEach((b, i) => { if (b) { m.idx.push(i); m.bp.push(at(bp, b)); } });
      g.colors.forEach((c, i) => { if (c) { m.cidx.push(i); m.cp.push(at(cp, c)); } });
      return m;
    });
    const parts = grids.map((g) => g.fill.buffer);
    for (const b of bp.keys()) parts.push(b.buffer);
    for (const c of cp.keys()) parts.push(c.buffer);
    return { meta: { frames, nbp: bp.size, ncp: cp.size }, parts };
  }

  static deserializeFrames(meta, buf, off) {
    const grids = meta.frames.map((m) => {
      const g = new SDFGrid(m.n, 'empty');
      g.h = m.h; g.o = m.o; g.band = 4 * g.h;
      const nb3 = g.nb ** 3;
      g.fill = new Int8Array(buf.slice(off, off + nb3));
      off += Math.ceil(nb3 / 4) * 4;
      return g;
    });
    const read = (count, Type) => {
      const pool = [];
      for (let i = 0; i < count; i++) {
        const a = new Type(buf.slice(off, off + B3 * 4));
        off += B3 * 4;
        SHARED.add(a);
        pool.push(a);
      }
      return pool;
    };
    const bricks = read(meta.nbp, Float32Array), colors = read(meta.ncp, Uint8Array);
    meta.frames.forEach((m, k) => {
      m.idx.forEach((bi, j) => { grids[k].bricks[bi] = bricks[m.bp[j]]; });
      m.cidx.forEach((bi, j) => { grids[k].colors[bi] = colors[m.cp[j]]; });
    });
    return { grids, off };
  }

  static deserialize(meta, buf, off) {
    const g = new SDFGrid(meta.n, 'empty');
    // Las obras de antes no traen h ni o: son la caja de siempre.
    if (meta.h) { g.h = meta.h; g.o = meta.o; g.band = 4 * g.h; }
    const nb3 = g.nb ** 3;
    g.fill = new Int8Array(buf.slice(off, off + nb3));
    off += Math.ceil(nb3 / 4) * 4;
    for (const i of meta.idx) { g.bricks[i] = new Float32Array(buf.slice(off, off + B3 * 4)); off += B3 * 4; }
    for (const i of meta.cidx) { g.colors[i] = new Uint8Array(buf.slice(off, off + B3 * 4)); off += B3 * 4; }
    return { grid: g, off };
  }
}
