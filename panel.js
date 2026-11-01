// Mini interfaz dibujada en un canvas, para usarla dentro de las gafas
// (se apunta con el rayo del mando derecho y se pulsa con el gatillo).
//
import { t } from './i18n.js';

// Widgets: { type: 'block' | 'label' | 'button' | 'slider' | 'swatch', x, y, w, h, ... }
//   block: color (lo que va después se dibuja encima y toma de él el color del texto)
//   button: label, active(), onClick(), group (misma letra en toda la fila), plain (sin mayúsculas)
//   thumb: img (lienzo), active(), onClick()
//   slider: label, get() 0..1, set(t), text()     swatch: color, active(), onClick()
//   label: text, size, head (letra de botón), max (encoge para caber), wrap (ancho: corta en líneas)

// La caja de ceras: los bloques van en azul, rojo, papel y negro; el amarillo es siempre «esto está puesto».
export const CERA = { soft: '#3a352e', red: '#E3242B', blue: '#1B4FD8', yellow: '#FFD21F', ink: '#141210', paper: '#FFF8E3', white: '#FFFFFF' };

export class CanvasPanel {
  constructor(w, h, build) {
    this.w = w;
    this.h = h;
    this.build = build;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d');
    this.widgets = [];
    this.hover = -1;
    this.drag = null;
    this.wasDown = false;
  }

  hit(px, py) {
    for (let i = this.widgets.length - 1; i >= 0; i--) {
      const w = this.widgets[i];
      if (w.type === 'label' || w.type === 'block') continue;
      if (px >= w.x && px <= w.x + w.w && py >= w.y && py <= w.y + w.h) return i;
    }
    return -1;
  }

  // (px, py) en píxeles del canvas o null si el rayo no toca el panel. Devuelve true si redibujar.
  pointer(px, py, down) {
    const prevHover = this.hover;
    this.hover = px === null ? -1 : this.hit(px, py);
    let changed = prevHover !== this.hover;
    if (down && !this.wasDown && this.hover >= 0) {
      const w = this.widgets[this.hover];
      if (w.type === 'slider') this.drag = w;
      else w.onClick?.();
      changed = true;
    }
    if (this.drag && px !== null) {
      const d = this.drag;
      d.set(Math.max(0, Math.min(1, (px - d.x) / d.w)));
      changed = true;
    }
    if (!down) this.drag = null;
    this.wasDown = down;
    return changed;
  }

  draw() {
    this.widgets = this.build();
    const g = this.ctx;
    g.clearRect(0, 0, this.w, this.h);
    g.textBaseline = 'middle';
    // Los bloques van sobre un fondo negro que solo llega hasta donde acaban: esa es la línea gruesa.
    const blocks = this.widgets.filter((w) => w.type === 'block');
    const bottom = blocks.reduce((b, w) => Math.max(b, w.y + w.h), 0);
    g.fillStyle = CERA.ink;
    g.fillRect(0, 0, this.w, bottom + 8);
    // Los botones de una misma fila llevan todos la misma letra: la que le quepa al texto más largo.
    const sizes = {};
    this.widgets.forEach((w) => {
      if (w.type !== 'button' || !w.group) return;
      sizes[w.group] = Math.min(sizes[w.group] ?? 99, fitSize(g, kanit, w.plain ? t(w.label) : t(w.label).toUpperCase(), w.size || 26, w.w - 12 - (w.dot ? 50 : 0)));
    });
    let text = CERA.ink, onInk = false;
    this.widgets.forEach((w, i) => {
      const hov = i === this.hover;
      if (w.type === 'block') {
        g.fillStyle = w.color;
        g.fillRect(w.x, w.y, w.w, w.h);
        text = w.color === CERA.paper ? CERA.ink : CERA.white;
        onInk = w.color === CERA.ink;
      } else if (w.type === 'label') {
        const font = w.head ? kanitHead : mali;
        const str = t(w.text);
        g.fillStyle = text;
        g.textAlign = w.align || 'left';
        const size = w.size || 26;
        if (w.wrap) {
          const lines = wrapLines(g, font, str, size, w.wrap);
          g.font = font(lines.size);
          lines.forEach((l, n) => g.fillText(l, w.x, w.y + n * lines.size * 1.22));
        } else {
          g.font = font(w.max ? fitSize(g, font, str, size, w.max) : size);
          g.fillText(str, w.x, w.y);
        }
      } else if (w.type === 'button') {
        const on = w.active?.();
        const str = w.plain ? t(w.label) : t(w.label).toUpperCase();
        // Sin apretar lleva sombra dura; apretado se hunde sobre ella y se pone amarillo.
        const d = on ? 4 : 0;
        if (!on && !onInk) { g.fillStyle = CERA.ink; g.fillRect(w.x + 5, w.y + 5, w.w, w.h); }
        g.fillStyle = on ? CERA.yellow : hov ? '#ffe98a' : CERA.white;
        g.fillRect(w.x + d, w.y + d, w.w, w.h);
        g.lineWidth = 4;
        g.strokeStyle = onInk && on ? CERA.white : CERA.ink;
        g.strokeRect(w.x + d + 2, w.y + d + 2, w.w - 4, w.h - 4);
        if (w.dot) {
          g.fillStyle = w.dot;
          g.beginPath();
          g.arc(w.x + d + 28, w.y + d + w.h / 2, 12, 0, Math.PI * 2);
          g.fill();
          g.lineWidth = 3;
          g.stroke();
        }
        g.fillStyle = CERA.soft;
        const room = w.w - 12 - (w.dot ? 50 : 0);
        g.font = kanit(w.group ? sizes[w.group] : fitSize(g, kanit, str, w.size || 26, room));
        g.textAlign = w.dot ? 'left' : 'center';
        g.fillText(str, (w.dot ? w.x + 50 : w.x + w.w / 2) + d, w.y + d + w.h / 2 + 1);
      } else if (w.type === 'thumb') {
        const on = w.active?.();
        g.fillStyle = on ? CERA.yellow : hov ? '#ffe98a' : CERA.white;
        g.fillRect(w.x, w.y, w.w, w.h);
        g.lineWidth = 4;
        g.strokeStyle = CERA.ink;
        g.strokeRect(w.x + 2, w.y + 2, w.w - 4, w.h - 4);
        if (w.img) g.drawImage(w.img, w.x + 8, w.y + 8, w.w - 16, w.h - 16);
      } else if (w.type === 'swatch') {
        const on = w.active?.();
        const cx = w.x + w.w / 2, cy = w.y + w.h / 2, r = Math.min(w.w, w.h) / 2;
        const disc = (rad, color) => { g.fillStyle = color; g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2); g.fill(); };
        disc(r, CERA.ink);
        if (on) { disc(r - 5, CERA.yellow); disc(r - 13, CERA.ink); disc(r - 17, w.color); }
        else disc(r - (hov ? 8 : 5), w.color);
        // Círculo con un +: abre la rueda de color.
        if (w.plus) {
          g.fillStyle = CERA.ink;
          g.fillRect(cx - r * 0.5, cy - 3, r, 6);
          g.fillRect(cx - 3, cy - r * 0.5, 6, r);
        }
      } else if (w.type === 'slider') {
        const v = w.get();
        g.fillStyle = text;
        g.font = mali(25);
        g.textAlign = 'left';
        g.fillText(t(w.label), w.x, w.y - 20);
        g.textAlign = 'right';
        g.fillText(t(w.text?.() ?? ''), w.x + w.w, w.y - 20);
        const inner = w.w - 26;
        g.fillStyle = CERA.white;
        g.fillRect(w.x, w.y, w.w, w.h);
        g.fillStyle = onInk ? CERA.yellow : CERA.ink;
        g.fillRect(w.x, w.y, 13 + inner * v, w.h);
        g.lineWidth = 4;
        g.strokeStyle = CERA.ink;
        g.strokeRect(w.x + 2, w.y + 2, w.w - 4, w.h - 4);
        g.fillStyle = hov || this.drag === w ? '#ffe98a' : CERA.yellow;
        g.fillRect(w.x + inner * v, w.y - 7, 26, w.h + 14);
        g.strokeRect(w.x + inner * v + 2, w.y - 5, 22, w.h + 10);
      }
    });
  }
}

const FALLBACK = '"Noto Sans Thai", system-ui, sans-serif';
const kanit = (s) => `500 ${s}px Kanit, ${FALLBACK}`;
const kanitHead = (s) => `600 ${s}px Kanit, ${FALLBACK}`;
const mali = (s) => `700 ${s}px Mali, ${FALLBACK}`;

// La letra más grande (hasta size) con la que el texto cabe en room.
function fitSize(g, font, str, size, room) {
  g.font = font(size);
  const w = g.measureText(str).width;
  return w <= room ? size : Math.max(12, Math.floor((size * room) / w));
}

// Corta en líneas por los espacios. El tailandés apenas lleva espacios: si una palabra no cabe, encoge.
function wrapLines(g, font, str, size, room) {
  const words = str.split(' ');
  const widest = words.reduce((b, x) => Math.max(b, (g.font = font(size), g.measureText(x).width)), 0);
  const fit = widest > room ? Math.max(12, Math.floor((size * room) / widest)) : size;
  g.font = font(fit);
  const lines = [];
  let cur = '';
  for (const x of words) {
    const next = cur ? cur + ' ' + x : x;
    if (cur && g.measureText(next).width > room) { lines.push(cur); cur = x; } else cur = next;
  }
  lines.push(cur);
  lines.size = fit;
  return lines;
}
