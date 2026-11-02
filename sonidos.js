// Sonidos de juguete: clics de fidget, burbujas que explotan, barro que se aprieta, arena que cruje.
// Nada de archivos: cada sonido se genera aquí con varias versiones al azar, y al sonar cambia un
// poco de tono y de fuerza. Así no se repite, no pesa y no hay licencias de por medio.
// Todo es corto y sin agudos que pinchen; si insistes en el mismo, se va suavizando.
// Los altavoces de unas gafas casi no dan graves: cada golpe lleva también medios para oírse ahí.
import { Continuo, OPCIONES } from './anadir.js';

// Tono que se apaga, con un deslizamiento de frecuencia (f0 → f1): el corazón de clics y burbujas.
function tone(o, sr, { at = 0, f0, f1 = f0, amp = 1, decay = 0.03, glide = 0.03, attack = 0.0008 }) {
  const start = Math.floor(at * sr), end = Math.min(o.length, start + Math.floor((decay * 7 + attack) * sr));
  let ph = 0;
  for (let i = start; i < end; i++) {
    const t = (i - start) / sr;
    ph += (2 * Math.PI * (f1 + (f0 - f1) * Math.exp(-t / glide))) / sr;
    o[i] += amp * Math.sin(ph) * (1 - Math.exp(-t / attack)) * Math.exp(-t / decay);
  }
}
// Soplo de ruido por un filtro: 'bp' da el cuerpo del barro y la arena, 'lp' el aire y la seda.
function noise(o, sr, { at = 0, fc, fc1 = fc, q = 1, mode = 'bp', amp = 1, attack = 0.001, decay = 0.02 }) {
  const start = Math.floor(at * sr), end = Math.min(o.length, start + Math.floor((decay * 7 + attack) * sr));
  const damp = 1 / q;
  let low = 0, band = 0;
  for (let i = start; i < end; i++) {
    const t = (i - start) / sr, k = Math.min(1, (t / (decay * 3)));
    const f = Math.min(0.9, 2 * Math.sin((Math.PI * (fc + (fc1 - fc) * k)) / sr));
    const x = Math.random() * 2 - 1;
    low += f * band;
    const high = x - low - damp * band;
    band += f * high;
    o[i] += amp * (mode === 'bp' ? band : low) * (1 - Math.exp(-t / attack)) * Math.exp(-t / decay);
  }
}
// Sin golpes al acabar y siempre a la misma altura de volumen.
function finish(o, sr, peak) {
  let mean = 0;
  for (let i = 0; i < o.length; i++) mean += o[i];
  mean /= o.length;
  let max = 1e-6;
  for (let i = 0; i < o.length; i++) { o[i] -= mean; max = Math.max(max, Math.abs(o[i])); }
  const fade = Math.min(o.length, Math.floor(0.004 * sr));
  for (let i = 0; i < o.length; i++) {
    const left = o.length - 1 - i;
    o[i] *= (peak / max) * (left < fade ? left / fade : 1);
  }
  return o;
}
const rnd = (a, b) => a + Math.random() * (b - a);

// nombre: [duración en s, volumen máximo, separación mínima en ms, cómo se fabrica]
const SOUNDS = {
  // Apuntar a algo: un tic de madera pequeñito.
  tick: [0.04, 0.16, 35, (o, s) => {
    tone(o, s, { f0: rnd(1050, 1450), amp: 0.5, decay: 0.005 });
    tone(o, s, { f0: rnd(390, 470), amp: 0.7, decay: 0.008 });
    noise(o, s, { fc: 2800, mode: 'lp', amp: 0.2, decay: 0.002 });
  }],
  // Rueda con muescas: tamaño, fuerza, deslizadores.
  dial: [0.03, 0.11, 40, (o, s) => {
    tone(o, s, { f0: rnd(700, 900), amp: 0.6, decay: 0.004 });
    tone(o, s, { f0: rnd(280, 340), amp: 0.5, decay: 0.006 });
  }],
  // Botón de fidget: golpe grave y el plástico que salta.
  clic: [0.09, 0.3, 45, (o, s) => {
    tone(o, s, { f0: rnd(300, 360), amp: 1, decay: 0.015 });
    tone(o, s, { f0: rnd(780, 960), amp: 0.5, decay: 0.008 });
    tone(o, s, { f0: rnd(1450, 1900), amp: 0.3, decay: 0.005 });
    noise(o, s, { fc: 3200, mode: 'lp', amp: 0.28, decay: 0.002 });
    const up = rnd(0.032, 0.046); // al volver el muelle: un segundo clic, flojito
    tone(o, s, { at: up, f0: rnd(1100, 1500), amp: 0.09, decay: 0.004 });
    tone(o, s, { at: up, f0: rnd(320, 380), amp: 0.2, decay: 0.008 });
  }],
  // Elegir algo: tecla mecánica gorda.
  thock: [0.13, 0.42, 60, (o, s) => {
    tone(o, s, { f0: rnd(300, 340), f1: rnd(215, 245), amp: 1, decay: 0.028, glide: 0.018 });
    tone(o, s, { f0: rnd(620, 760), amp: 0.62, decay: 0.012 });
    noise(o, s, { fc: 1900, mode: 'lp', amp: 0.34, decay: 0.003 });
  }],
  // Burbuja de pop-it: sube de tono al reventar.
  pop: [0.1, 0.34, 40, (o, s) => {
    tone(o, s, { f0: rnd(300, 380), f1: rnd(760, 900), amp: 1, decay: 0.027, glide: 0.022, attack: 0.002 });
    noise(o, s, { fc: 1600, mode: 'lp', amp: 0.12, decay: 0.002 });
  }],
  popDown: [0.11, 0.3, 60, (o, s) => {
    tone(o, s, { f0: rnd(590, 660), f1: rnd(250, 300), amp: 1, decay: 0.03, glide: 0.024, attack: 0.002 });
  }],
  popUp: [0.1, 0.3, 60, (o, s) => {
    tone(o, s, { f0: rnd(400, 450), f1: rnd(960, 1120), amp: 1, decay: 0.026, glide: 0.02, attack: 0.002 });
  }],
  dup: [0.2, 0.34, 80, (o, s) => {
    tone(o, s, { f0: 330, f1: rnd(760, 840), amp: 1, decay: 0.024, glide: 0.02, attack: 0.002 });
    tone(o, s, { at: rnd(0.08, 0.1), f0: 440, f1: rnd(1000, 1120), amp: 0.85, decay: 0.024, glide: 0.018, attack: 0.002 });
  }],
  // Gota: elegir un color.
  plip: [0.11, 0.2, 90, (o, s) => {
    tone(o, s, { f0: rnd(640, 760), f1: rnd(1300, 1600), amp: 1, decay: 0.028, glide: 0.018, attack: 0.002 });
  }],
  // Abrir y cerrar menús: un soplo suave que acaba en nada.
  open: [0.15, 0.15, 90, (o, s) => {
    noise(o, s, { fc: 320, fc1: 1100, q: 0.9, amp: 1, attack: 0.03, decay: 0.03 });
    tone(o, s, { at: 0.03, f0: 220, f1: 370, amp: 0.3, decay: 0.03, attack: 0.01, glide: 0.04 });
  }],
  close: [0.13, 0.13, 90, (o, s) => {
    noise(o, s, { fc: 950, fc1: 280, q: 0.9, amp: 1, attack: 0.012, decay: 0.026 });
    tone(o, s, { f0: 330, f1: 170, amp: 0.3, decay: 0.03, attack: 0.006, glide: 0.03 });
  }],
  // Empezar y acabar de apretar el barro.
  press: [0.2, 0.22, 70, (o, s) => {
    tone(o, s, { f0: rnd(190, 225), f1: rnd(270, 320), amp: 1, decay: 0.036, attack: 0.006, glide: 0.04 });
    tone(o, s, { f0: rnd(560, 680), amp: 0.3, decay: 0.014, attack: 0.004 });
    noise(o, s, { fc: rnd(700, 1100), mode: 'lp', amp: 0.45, attack: 0.004, decay: 0.018 });
  }],
  release: [0.12, 0.13, 70, (o, s) => {
    tone(o, s, { f0: rnd(220, 260), f1: rnd(390, 470), amp: 1, decay: 0.023, attack: 0.003, glide: 0.02 });
  }],
  // Coger y soltar una pieza.
  grab: [0.15, 0.27, 80, (o, s) => {
    noise(o, s, { fc: 300, fc1: 780, q: 2, amp: 1.4, attack: 0.008, decay: 0.022 });
    tone(o, s, { f0: rnd(220, 260), amp: 0.8, decay: 0.026, attack: 0.002 });
  }],
  drop: [0.17, 0.3, 80, (o, s) => {
    tone(o, s, { f0: rnd(280, 320), f1: rnd(180, 215), amp: 1, decay: 0.032, glide: 0.03, attack: 0.001 });
    tone(o, s, { f0: rnd(560, 680), amp: 0.35, decay: 0.01 });
    noise(o, s, { fc: 1300, mode: 'lp', amp: 0.3, decay: 0.003 });
  }],
  poof: [0.26, 0.19, 120, (o, s) => {
    noise(o, s, { fc: 1200, fc1: 300, mode: 'lp', amp: 1, attack: 0.012, decay: 0.05 });
  }],
  // Granos que forman el sonido continuo mientras esculpes.
  squish: [0.16, 0.13, 0, (o, s) => {
    noise(o, s, { fc: rnd(380, 760), fc1: rnd(280, 560), q: rnd(1.6, 2.8), amp: 1, attack: rnd(0.003, 0.008), decay: rnd(0.012, 0.024) });
  }],
  knead: [0.18, 0.14, 0, (o, s) => {
    noise(o, s, { fc: rnd(260, 360), fc1: rnd(420, 620), q: 2.4, amp: 1, attack: rnd(0.005, 0.012), decay: rnd(0.016, 0.026) });
  }],
  bubble: [0.08, 0.12, 0, (o, s) => {
    const f = rnd(420, 1050);
    tone(o, s, { f0: f, f1: f * rnd(1.5, 2.3), amp: 1, decay: rnd(0.009, 0.018), glide: 0.012, attack: 0.0015 });
  }],
  scrape: [0.05, 0.055, 0, (o, s) => {
    noise(o, s, { fc: rnd(1250, 2300), q: rnd(0.9, 1.6), amp: 1, attack: 0.0008, decay: rnd(0.002, 0.005) });
  }],
  silk: [0.22, 0.065, 0, (o, s) => {
    noise(o, s, { fc: rnd(620, 1000), mode: 'lp', amp: 1, attack: rnd(0.012, 0.024), decay: rnd(0.016, 0.03) });
  }],
  // La bolita del bote de spray, al empezar a pintar.
  rattle: [0.17, 0.13, 90, (o, s) => {
    for (let i = 0, at = 0; i < 3; i++, at += rnd(0.04, 0.065)) {
      tone(o, s, { at, f0: rnd(1050, 1450), amp: 0.5 - i * 0.1, decay: 0.004 });
      tone(o, s, { at, f0: rnd(460, 620), amp: 0.8 - i * 0.18, decay: 0.007 });
    }
  }],
  // Una lengüeta de kalimba, para premiar: terminar un paso, guardar.
  note: [1.1, 0.25, 0, (o, s) => {
    tone(o, s, { f0: 523.25, amp: 1, decay: rnd(0.2, 0.26), attack: 0.002 });
    tone(o, s, { f0: 523.25 * 2, amp: 0.1, decay: 0.09, attack: 0.002 });
    tone(o, s, { f0: 523.25 * 5.43, amp: 0.05, decay: 0.012 });
    noise(o, s, { fc: 800, mode: 'lp', amp: 0.2, decay: 0.002 });
  }],
};

// Cómo suena cada herramienta mientras la usas: qué grano, cuántos por segundo (quieto → rápido),
// y un segundo grano que aparece de vez en cuando.
const TOOL_FEEL = {
  add: { hold: 'add' }, // estos dos no son granos: suenan seguido hasta soltar (anadir.js)
  paint: { hold: 'spray' },
  inflate: { g: 'bubble', still: 7, fast: 13, vol: 0.85, extra: 'squish', every: 0.2 },
  remove: { g: 'scrape', still: 3, fast: 28, extra: 'squish', every: 0.06 }, // arena cinética
  crease: { g: 'scrape', still: 2, fast: 24, vol: 0.85 },
  smooth: { g: 'silk', still: 3, fast: 11 },
  flatten: { g: 'silk', still: 2, fast: 12, extra: 'knead', every: 0.1 },
  grab: { g: 'knead', still: 0, fast: 13, extra: 'bubble', every: 0.1 },
  pinch: { g: 'knead', still: 3, fast: 12, extra: 'bubble', every: 0.16 },
};
const VARIANTS = 7, MAX_VOICES = 14;
// Pentatónica: cualquier orden de notas suena bien, así la flor es casi un instrumento.
export const PENTATONIC = [0, 2, 4, 7, 9];

class Sonidos {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.bank = {};
    this.last = {};     // nombre → { variante, cuándo sonó, racha }
    this.voices = 0;
    this.volume = 0.7;
    this.muted = false; // el espejo del Mac no suena
    this.grainAt = 0;
    this.addSound = 'slime';
    try {
      const v = parseFloat(localStorage.getItem('plastilinaSonido'));
      if (v >= 0 && v <= 1) this.volume = v;
      const a = localStorage.getItem('plastilinaAnadir');
      if (OPCIONES[a]) this.addSound = a;
    } catch {}
  }

  // El navegador no deja sonar hasta que tocas algo: se llama en el primer clic y al entrar en las gafas.
  unlock() {
    if (this.muted) return;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      // Se recortan un poco los agudos y los picos: nada pincha, aunque suenen varios a la vez.
      const air = this.ctx.createBiquadFilter();
      air.type = 'highshelf';
      air.frequency.value = 5500;
      air.gain.value = -5;
      const limit = this.ctx.createDynamicsCompressor();
      limit.threshold.value = -16;
      limit.ratio.value = 4;
      limit.attack.value = 0.002;
      limit.release.value = 0.12;
      this.master.connect(air).connect(limit).connect(this.ctx.destination);
      this.held = new Continuo(this.ctx, this.master);
      // Listos antes de apretar, sin tirones.
      setTimeout(() => this.held.prepare(this.addSound), 300);
      setTimeout(() => this.held.prepare('spray'), 700);
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    try { localStorage.setItem('plastilinaSonido', String(v)); } catch {}
  }

  // Elegir el sonido de Añadir: se oye un momento para saber cuál es.
  setAddSound(id) {
    this.addSound = id;
    try { localStorage.setItem('plastilinaAnadir', id); } catch {}
    if (this.muted || !this.volume) return;
    this.unlock();
    if (!this.held) return;
    this.held.start(id);
    this.holding = id;
    this.watchHold(800);
  }
  // Si dejan de llegar fotogramas (te quitas las gafas, cambias de herramienta) se apaga solo.
  watchHold(ms) {
    clearTimeout(this.holdTimer);
    this.holdTimer = setTimeout(() => this.strokeEnd(), ms);
  }
  strokeEnd() {
    clearTimeout(this.holdTimer);
    this.holding = null;
    this.held?.stop();
  }

  // Elige una versión distinta de la última; se fabrica la primera vez que hace falta.
  variant(name, prev) {
    const def = SOUNDS[name], list = this.bank[name] || (this.bank[name] = []);
    let i = Math.floor(Math.random() * VARIANTS);
    if (i === prev) i = (i + 1) % VARIANTS;
    if (!list[i]) {
      const sr = this.ctx.sampleRate, o = new Float32Array(Math.floor(def[0] * sr));
      def[3](o, sr);
      finish(o, sr, def[1]);
      const b = this.ctx.createBuffer(1, o.length, sr);
      b.copyToChannel(o, 0);
      list[i] = b;
    }
    return i;
  }

  // semi: subir o bajar semitonos · vol: fuerza · pan: -1 izquierda … 1 derecha ·
  // tuned: sin desafinar (notas) · delay: segundos de espera
  play(name, { semi = 0, vol = 1, pan = 0, tuned = false, delay = 0 } = {}) {
    if (this.muted || !this.volume || !SOUNDS[name]) return;
    this.unlock();
    if (!this.ctx || this.voices >= MAX_VOICES) return;
    // Aún dormido: se despierta y suena este, sin acumular nada que luego salga de golpe.
    if (this.ctx.state !== 'running') {
      if (!this.waking) {
        this.waking = true;
        this.ctx.resume().then(() => { this.waking = false; this.play(name, { semi, vol, pan, tuned, delay }); }, () => { this.waking = false; });
      }
      return;
    }
    const now = this.ctx.currentTime, def = SOUNDS[name], st = this.last[name] || (this.last[name] = { v: -1, at: -9, run: 0 });
    const since = (now - st.at) * 1000;
    if (!delay && since < def[2]) return;
    // Si insistes con el mismo sonido, se va apagando: nunca llega a cansar.
    st.run = since < 350 ? Math.min(st.run + 1, 6) : 0;
    st.at = now;
    st.v = this.variant(name, st.v);
    const src = this.ctx.createBufferSource();
    src.buffer = this.bank[name][st.v];
    const wobble = tuned ? 0 : rnd(-0.55, 0.55);
    src.playbackRate.value = 2 ** ((semi + wobble) / 12);
    const g = this.ctx.createGain();
    g.gain.value = vol * rnd(0.84, 1.08) * (1 / (1 + 0.1 * st.run));
    let tail = g;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan + rnd(-0.07, 0.07)));
      g.connect(p);
      tail = p;
    }
    tail.connect(this.master);
    src.connect(g);
    this.voices++;
    src.onended = () => { this.voices--; g.disconnect(); if (tail !== g) tail.disconnect(); };
    src.start(now + delay + rnd(0, 0.004));
  }

  // Unas notas seguidas de kalimba.
  chime(semis, gap = 0.1, vol = 1) {
    semis.forEach((s, i) => this.play('note', { semi: s, tuned: true, vol: vol * (1 - i * 0.04), delay: i * gap + 0.001 }));
  }
  step(n) { // terminar un paso del tutorial: la melodía sube contigo
    const base = PENTATONIC[n % 5] + 12 * Math.floor(n / 5) - 5;
    this.chime([base, base + 7], 0.09, 0.8);
  }
  saved() { this.chime([0, 7], 0.11, 0.7); }
  party() {
    this.chime([-5, 0, 4, 7, 12], 0.11);
    for (let i = 0; i < 7; i++) this.play('bubble', { semi: rnd(-4, 7), vol: 1.4, delay: 0.5 + i * rnd(0.05, 0.09) });
  }

  // Cada fotograma mientras esculpes. speed: 0 quieto … 1 rápido · pressure: 0…1 · touching: toca barro.
  // Son granitos sueltos al azar y no un bucle: nunca dos pasadas suenan igual, y en el aire no suena.
  stroke(tool, speed, pressure, dt, touching, semi = 0) {
    if (this.muted || !this.ctx || !touching) return;
    const f = TOOL_FEEL[tool] || TOOL_FEEL.smooth;
    if (f.hold) {
      if (!this.volume) return;
      const id = f.hold === 'add' ? this.addSound : f.hold;
      if (this.holding !== id) {
        this.held.start(id, semi);
        this.holding = id;
      }
      this.held.update(dt, speed, pressure, semi);
      this.watchHold(250); // al salirse del barro dejan de llegar avisos y se apaga
      return;
    }
    const rate = f.still + (f.fast - f.still) * Math.sqrt(Math.min(1, speed));
    if (rate <= 0) return;
    this.grainAt -= dt;
    let n = 0;
    while (this.grainAt <= 0 && n < 2) {
      this.grainAt += -Math.log(1 - Math.random() * 0.98) / rate;
      n++;
      const extra = f.extra && Math.random() < f.every;
      this.play(extra ? f.extra : f.g, { vol: (f.vol || 1) * (0.55 + 0.45 * pressure), delay: Math.random() * dt, semi: semi + rnd(-1.5, 1.5) });
    }
    if (this.grainAt < 0) this.grainAt = 0;
  }
}

export const NAMES = Object.keys(SOUNDS);
export const TOOLS = Object.keys(TOOL_FEEL);
export const sfx = new Sonidos();
