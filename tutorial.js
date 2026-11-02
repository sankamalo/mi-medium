// Tutorial como juego: una lista de pasos que se cumplen haciéndolos de verdad. Nunca arranca solo,
// se abre desde el menú. Aquí solo van la marcha de los pasos y la tarjeta; lo demás lo pone main.js.
import { CERA, kanit, mali, wrapLines } from './panel.js';
import { t } from './i18n.js';

const CARD_W = 760, CARD_H = 300;

export class Tutorial {
  // pasos: { text, mac?, setup?(), check?() → true al cumplirse, on?: {evento: (dato) → true} }
  constructor(steps, { isXR, onChange, onStep, onDone }) {
    this.steps = steps;
    this.isXR = isXR;
    this.onChange = onChange;
    this.onStep = onStep;
    this.onDone = onDone;
    this.index = -1;
    this.finished = false;
    this.canvas = document.createElement('canvas');
    this.canvas.width = CARD_W;
    this.canvas.height = CARD_H;
  }

  get active() { return this.index >= 0 && !this.finished; }
  get step() { return this.steps[this.index]; }

  start() {
    this.finished = false;
    this.go(0);
  }
  stop() {
    this.index = -1;
    this.finished = false;
    this.onChange();
  }
  go(i) {
    this.index = i;
    this.count = 0;
    this.step.setup?.();
    this.draw();
    this.onChange();
  }
  next() {
    if (!this.active) return;
    this.onStep(this.index);
    if (this.index + 1 < this.steps.length) return this.go(this.index + 1);
    this.finished = true;
    this.draw();
    this.onChange();
    this.onDone();
  }
  // Algo ha pasado en la app: una pincelada, deshacer…
  emit(type, data) {
    if (this.active && this.step.on?.[type]?.(data, this)) this.next();
  }
  // Cada fotograma, para lo que se comprueba mirando (la herramienta puesta, por ejemplo).
  tick() {
    if (this.active && this.step.check?.()) this.next();
  }

  draw(final = t('¡Tomate terminado! Ya sabes jugar.')) {
    const g = this.canvas.getContext('2d');
    const n = this.steps.length, done = this.finished;
    g.fillStyle = CERA.ink;
    g.fillRect(0, 0, CARD_W, CARD_H);
    g.fillStyle = done ? CERA.yellow : CERA.paper;
    g.fillRect(8, 8, CARD_W - 16, CARD_H - 16);
    g.fillStyle = CERA.red;
    g.fillRect(8, 8, CARD_W - 16, 68);
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillStyle = CERA.white;
    g.font = kanit(34);
    g.fillText(t('TU PRIMER TOMATE'), 32, 44);
    // Un puntito por paso; los hechos, amarillos.
    for (let i = 0; i < n; i++) {
      const x = CARD_W - 34 - (n - 1 - i) * 30;
      g.fillStyle = done || i < this.index ? CERA.yellow : i === this.index ? CERA.white : 'rgba(255,255,255,.3)';
      g.beginPath();
      g.arc(x, 42, i === this.index && !done ? 11 : 8, 0, Math.PI * 2);
      g.fill();
    }
    const raw = done ? final : t(!this.isXR() && this.step.mac ? this.step.mac : this.step.text);
    const lines = wrapLines(g, mali, raw, 44, CARD_W - 72);
    g.font = mali(lines.size);
    g.fillStyle = CERA.ink;
    const lh = lines.size * 1.26, top = 76 + (CARD_H - 92 - lh * lines.length) / 2 + lh / 2;
    lines.forEach((l, i) => g.fillText(l, 36, top + i * lh));
    this.onDraw?.();
  }
}
