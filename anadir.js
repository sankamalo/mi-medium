// Los sonidos continuos de Añadir, a elegir en Técnico: suenan desde que aprietas hasta que sueltas.
// Cada opción son dos bucles de distinta duración (nunca coinciden igual), un filtro y un volumen
// que se mueven solos y al ritmo de la mano, y detalles sueltos al azar por encima.

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Curva lenta al azar, de 0 a 1: hz cambios por segundo.
function wander(seconds, hz) {
  const n = Math.ceil(seconds * hz) + 2, p = Float32Array.from({ length: n }, () => Math.random());
  return (t) => {
    const x = clamp(t * hz, 0, n - 1.001), i = Math.floor(x), k = x - i, s = k * k * (3 - 2 * k);
    return p[i] + (p[i + 1] - p[i]) * s;
  };
}
// Tono que se apaga, con deslizamiento de f0 a f1.
function blip(o, sr, at, { f0, f1 = f0, amp = 1, decay = 0.01, attack = 0.001, glide = 0.015 }) {
  const start = Math.floor(at * sr), end = Math.min(o.length, start + Math.floor((decay * 7 + attack) * sr));
  let ph = 0;
  for (let i = Math.max(0, start); i < end; i++) {
    const t = (i - start) / sr;
    ph += (2 * Math.PI * (f1 + (f0 - f1) * Math.exp(-t / glide))) / sr;
    o[i] += amp * Math.sin(ph) * (1 - Math.exp(-t / attack)) * Math.exp(-t / decay);
  }
}
// Ruido continuo con filtro y volumen que cambian en el tiempo.
function hiss(o, sr, { fc, q = 1, mode = 'bp', env = () => 1 }) {
  const damp = 1 / q;
  let low = 0, band = 0, f = 0, a = 0;
  for (let i = 0; i < o.length; i++) {
    if (i % 64 === 0) {
      const t = i / sr;
      f = Math.min(0.9, 2 * Math.sin((Math.PI * fc(t)) / sr));
      a = env(t);
    }
    low += f * band;
    const high = Math.random() * 2 - 1 - low - damp * band;
    band += f * high;
    o[i] += a * (mode === 'bp' ? band : low);
  }
}
// Golpecitos irregulares durante todo el bucle: rate(t) por segundo.
function scatter(o, sr, rate, fn) {
  const seconds = o.length / sr;
  for (let t = 0; t < seconds;) {
    fn(t);
    t += -Math.log(1 - Math.random() * 0.98) / Math.max(1, rate(t));
  }
}
const FADE = 0.25, BED_RMS = 0.075, BED_PEAK = 0.34;

// Empalma el final con el principio y deja todas las opciones a un volumen parecido.
function closeLoop(o, sr) {
  const x = Math.floor(FADE * sr), n = o.length - x, out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (i < x) out[i] = o[i] * Math.sqrt(i / x) + o[n + i] * Math.sqrt(1 - i / x);
    else out[i] = o[i];
  }
  let mean = 0, power = 0;
  for (let i = 0; i < n; i++) mean += out[i];
  mean /= n;
  for (let i = 0; i < n; i++) { out[i] -= mean; power += out[i] * out[i]; }
  const k = BED_RMS / Math.max(1e-6, Math.sqrt(power / n));
  for (let i = 0; i < n; i++) {
    const v = out[i] * k, m = Math.abs(v);
    out[i] = m < BED_PEAK ? v : Math.sign(v) * (BED_PEAK + (1 - BED_PEAK) * Math.tanh((m - BED_PEAK) / (1 - BED_PEAK)) * 0.4);
  }
  return out;
}

// bed: lo que suena siempre · accent: el detalle suelto · lo/hi: filtro con la mano quieta/rápida ·
// rate: detalles por segundo, quieto y rápido · accentVol: fuerza del detalle.
export const OPCIONES = {
  slime: {
    name: 'Slime', hint: 'Masa pegajosa que se estira despacio, con alguna burbuja suave', lo: 950, hi: 2100, rate: [0.3, 1.2], accentVol: 0.45,
    bed(o, sr, d) {
      const a = wander(d, 1.2), b = wander(d, 0.5), c = wander(d, 0.6);
      hiss(o, sr, { fc: (t) => 380 + 480 * a(t), q: 5, env: (t) => 0.13 + 0.2 * b(t) });
      scatter(o, sr, (t) => 1.2 + 2 * c(t), (t) => {
        const f = rnd(165, 280);
        blip(o, sr, t, { f0: f, f1: f * rnd(1.5, 2.2), amp: rnd(0.08, 0.26), decay: rnd(0.024, 0.042), attack: rnd(0.006, 0.012), glide: rnd(0.03, 0.05) });
      });
    },
    accent(o, sr) {
      const f = rnd(210, 320);
      blip(o, sr, 0, { f0: f, f1: f * rnd(1.5, 2), amp: 1, decay: rnd(0.024, 0.036), attack: 0.008, glide: 0.034 });
    },
  },
  perlitas: {
    name: 'Perlitas', hint: 'Bolitas de plástico cayendo, como un palo de lluvia', lo: 2300, hi: 4200, rate: [3, 8],
    bed(o, sr, d) {
      const clump = wander(d, 2.2), far = wander(d, 0.6);
      hiss(o, sr, { fc: (t) => 1000 + 600 * far(t), mode: 'lp', env: () => 0.018 });
      scatter(o, sr, (t) => 28 + 52 * clump(t), (t) => {
        const amp = rnd(0.12, 0.6) * (0.55 + 0.45 * far(t));
        blip(o, sr, t, { f0: rnd(1000, 2300), amp: amp * 0.55, decay: rnd(0.0015, 0.004), attack: 0.0004 });
        blip(o, sr, t, { f0: rnd(400, 780), amp, decay: rnd(0.003, 0.008), attack: 0.0006 });
      });
    },
    accent(o, sr) {
      blip(o, sr, 0, { f0: rnd(1050, 1700), amp: 0.5, decay: 0.004, attack: 0.0004 });
      blip(o, sr, 0, { f0: rnd(480, 760), amp: 1, decay: 0.008, attack: 0.0006 });
    },
  },
  ronroneo: {
    name: 'Ronroneo', hint: 'Como un gato contento: el más mullido y redondo', lo: 1200, hi: 2500, rate: [0.6, 2.5],
    bed(o, sr, d) {
      const speed = wander(d, 0.9), power = wander(d, 0.45), tone = wander(d, 0.7);
      hiss(o, sr, { fc: (t) => 380 + 200 * tone(t), mode: 'lp', env: (t) => 0.018 + 0.03 * power(t) });
      for (let t = 0; t < d;) {
        const amp = (0.4 + 0.6 * power(t)) * rnd(0.72, 1), f = 310 + 90 * tone(t);
        blip(o, sr, t, { f0: f * rnd(0.97, 1.03), amp: amp * 0.75, decay: rnd(0.011, 0.016), attack: 0.002 });
        blip(o, sr, t, { f0: f * rnd(1.9, 2.2), amp: amp * 0.75, decay: rnd(0.006, 0.009), attack: 0.002 });
        blip(o, sr, t, { f0: f * rnd(3.4, 3.9), amp: amp * 0.16, decay: 0.004, attack: 0.002 });
        t += (1 / (21 + 7 * speed(t))) * rnd(0.86, 1.14);
      }
    },
    accent(o, sr) {
      const f = rnd(360, 560);
      blip(o, sr, 0, { f0: f, f1: f * rnd(1.25, 1.6), amp: 1, decay: 0.02, attack: 0.006, glide: 0.03 });
    },
  },
  goma: {
    name: 'Goma', hint: 'Goma blanda que chirría flojito al apretarla, sin pitar', lo: 1300, hi: 2800, rate: [1, 4],
    bed(o, sr, d) {
      const grip = wander(d, 1.1), tone = wander(d, 0.8), power = wander(d, 1.7);
      hiss(o, sr, { fc: (t) => 500 + 300 * tone(t), q: 1.6, env: () => 0.05 });
      for (let t = 0; t < d;) {
        const f = (450 + 330 * tone(t)) * rnd(0.92, 1.08), amp = (0.2 + 0.5 * power(t)) * rnd(0.55, 1);
        blip(o, sr, t, { f0: f, amp, decay: rnd(0.0035, 0.0065), attack: 0.0008 });
        blip(o, sr, t, { f0: f * rnd(0.46, 0.54), amp: amp * 0.55, decay: 0.007, attack: 0.0012 });
        t += (1 / (42 + 62 * grip(t))) * rnd(0.72, 1.28);
      }
    },
    accent(o, sr) {
      const f = rnd(520, 760);
      blip(o, sr, 0, { f0: f, f1: f * rnd(1.15, 1.45), amp: 1, decay: 0.012, attack: 0.002, glide: 0.018 });
    },
  },
};

// Los datos de una opción, sin tocar el audio del navegador.
export function fabricar(id, sr) {
  const op = OPCIONES[id], make = (d) => {
    const o = new Float32Array(Math.floor((d + FADE) * sr));
    op.bed(o, sr, d + FADE);
    return closeLoop(o, sr);
  };
  const accents = Array.from({ length: 6 }, () => {
    const o = new Float32Array(Math.floor(0.2 * sr));
    op.accent(o, sr);
    let max = 1e-6;
    for (const v of o) max = Math.max(max, Math.abs(v));
    return o.map((v, i) => (v / max) * 0.16 * Math.min(1, (o.length - 1 - i) / (0.005 * sr)));
  });
  return { loops: [make(rnd(4.6, 5.2)), make(rnd(6.7, 7.4))], accents };
}

export class Continuo {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.out = out;
    this.bank = {};
    this.voice = null;
  }
  // Se fabrica la primera vez; conviene hacerlo antes de que apriete nadie.
  prepare(id) {
    if (this.bank[id]) return this.bank[id];
    const sr = this.ctx.sampleRate, raw = fabricar(id, sr), buffer = (o) => {
      const b = this.ctx.createBuffer(1, o.length, sr);
      b.copyToChannel(o, 0);
      return b;
    };
    return (this.bank[id] = { loops: raw.loops.map(buffer), accents: raw.accents.map(buffer) });
  }
  start(id, semi = 0) {
    this.stop();
    const ctx = this.ctx, now = ctx.currentTime, bank = this.prepare(id), op = OPCIONES[id];
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = op.lo;
    filter.Q.value = 0.4;
    const env = ctx.createGain();
    env.gain.value = 0;
    env.gain.setTargetAtTime(0.75, now, 0.022);
    const pan = ctx.createStereoPanner();
    filter.connect(env).connect(pan).connect(this.out);
    const sources = bank.loops.map((buffer, i) => {
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = buffer;
      src.loop = true;
      src.playbackRate.value = 2 ** (semi / 12);
      g.gain.value = 0.72;
      src.connect(g).connect(filter);
      src.start(now, Math.random() * buffer.duration); // cada pasada empieza por otro sitio
      return { src, g };
    });
    this.voice = { id, op, bank, filter, env, pan, sources, walk: [0, 0, 0, 0], next: rnd(0.1, 0.4), lastAccent: -1 };
  }
  // Cada fotograma. speed: 0 quieto … 1 rápido · pressure: 0 … 1 · semi: tono según el tamaño.
  update(dt, speed, pressure, semi = 0) {
    const v = this.voice;
    if (!v) return;
    const now = this.ctx.currentTime, move = Math.sqrt(clamp(speed, 0, 1));
    for (let i = 0; i < 4; i++) v.walk[i] = clamp(v.walk[i] + (rnd(-1, 1) * 2.4 - v.walk[i] * 0.8) * dt, -1, 1);
    const open = clamp(0.65 * move + 0.35 * pressure, 0, 1);
    v.filter.frequency.setTargetAtTime((v.op.lo + (v.op.hi - v.op.lo) * open) * (1 + v.walk[0] * 0.18), now, 0.05);
    v.env.gain.setTargetAtTime((0.55 + 0.2 * pressure + 0.25 * move) * (1 + v.walk[1] * 0.12), now, 0.05);
    v.pan.pan.setTargetAtTime(v.walk[2] * 0.14, now, 0.1);
    const rate = 2 ** ((semi + v.walk[3] * 0.45 + move * 0.3) / 12);
    v.sources.forEach(({ src, g }, i) => {
      src.playbackRate.setTargetAtTime(rate * (i ? 1.006 : 1), now, 0.08);
      g.gain.setTargetAtTime(0.72 + (i ? -1 : 1) * v.walk[0] * 0.14, now, 0.15);
    });
    v.next -= dt;
    if (v.next <= 0) {
      v.next = -Math.log(1 - Math.random() * 0.98) / (v.op.rate[0] + (v.op.rate[1] - v.op.rate[0]) * move);
      this.accent(v, semi, 0.55 + 0.45 * pressure);
    }
  }
  accent(v, semi, vol) {
    let i = Math.floor(Math.random() * v.bank.accents.length);
    if (i === v.lastAccent) i = (i + 1) % v.bank.accents.length;
    v.lastAccent = i;
    const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
    src.buffer = v.bank.accents[i];
    src.playbackRate.value = 2 ** ((semi + rnd(-2, 2)) / 12);
    g.gain.value = vol * rnd(0.55, 1) * (v.op.accentVol ?? 1);
    src.connect(g).connect(v.filter);
    src.onended = () => g.disconnect();
    src.start();
  }
  stop() {
    const v = this.voice;
    if (!v) return;
    this.voice = null;
    const now = this.ctx.currentTime;
    v.env.gain.cancelScheduledValues(now);
    v.env.gain.setTargetAtTime(0, now, 0.035);
    for (const { src } of v.sources) src.stop(now + 0.3);
    v.sources[0].src.onended = () => v.pan.disconnect();
  }
}
