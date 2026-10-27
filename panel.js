// Mini interfaz dibujada en un canvas, para usarla dentro de las gafas
// (se apunta con el rayo del mando derecho y se pulsa con el gatillo).
//
// Widgets: { type: 'label' | 'button' | 'slider' | 'swatch', x, y, w, h, ... }
//   button: label, active(), onClick()     slider: label, get() 0..1, set(t), text()
//   swatch: color, active(), onClick()     label: text, color, size

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
      if (w.type === 'label') continue;
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
    g.fillStyle = 'rgba(16,18,23,0.94)';
    round(g, 0, 0, this.w, this.h, 36);
    g.fill();
    g.textBaseline = 'middle';
    this.widgets.forEach((w, i) => {
      const hov = i === this.hover;
      if (w.type === 'label') {
        g.fillStyle = w.color || '#9aa4b5';
        g.font = `${w.weight || 700} ${w.size || 26}px system-ui, sans-serif`;
        g.textAlign = w.align || 'left';
        g.fillText(w.text, w.x, w.y);
      } else if (w.type === 'button') {
        const on = w.active?.();
        g.fillStyle = on ? '#3d8bff' : hov ? '#3a414e' : '#2a2f39';
        round(g, w.x, w.y, w.w, w.h, 14);
        g.fill();
        if (w.dot) {
          g.fillStyle = w.dot;
          g.beginPath();
          g.arc(w.x + 26, w.y + w.h / 2, 11, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = w.textColor || '#e8ecf3';
        g.font = `600 ${w.size || 26}px system-ui, sans-serif`;
        g.textAlign = w.dot ? 'left' : 'center';
        g.fillText(w.label, w.dot ? w.x + 48 : w.x + w.w / 2, w.y + w.h / 2 + 1);
      } else if (w.type === 'swatch') {
        g.fillStyle = w.color;
        round(g, w.x, w.y, w.w, w.h, 12);
        g.fill();
        if (w.active?.() || hov) {
          g.lineWidth = w.active?.() ? 6 : 3;
          g.strokeStyle = '#ffffff';
          g.stroke();
        }
      } else if (w.type === 'slider') {
        const t = w.get();
        g.fillStyle = '#9aa4b5';
        g.font = '600 24px system-ui, sans-serif';
        g.textAlign = 'left';
        g.fillText(w.label, w.x, w.y - 18);
        g.textAlign = 'right';
        g.fillText(w.text?.() ?? '', w.x + w.w, w.y - 18);
        g.fillStyle = '#2a2f39';
        round(g, w.x, w.y, w.w, w.h, w.h / 2);
        g.fill();
        g.fillStyle = hov || this.drag === w ? '#5aa0ff' : '#3d8bff';
        round(g, w.x, w.y, Math.max(w.h, w.w * t), w.h, w.h / 2);
        g.fill();
      }
    });
  }
}

function round(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}
