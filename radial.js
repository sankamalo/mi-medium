// Menú radial (como la paleta de Medium). Se dibuja en un canvas que sirve
// tanto para el escritorio (elemento HTML) como para las gafas (textura).
//
// Mitad de arriba: las herramientas de esculpir, grandes. Mitad de abajo: 4 acciones.
// Si te quedas un momento sobre "Añadir", la mitad de arriba cambia a las formas del pincel.

export const TOOL_COLORS = {
  add: '#5ad17a',
  remove: '#ff5d5d',
  smooth: '#6cb6ff',
  flatten: '#f2c94c',
  inflate: '#c38bff',
  grab: '#ff7ab8',
  paint: '#ff9f43',
  move: '#4fd1c5',
};

export const TOP = [
  { id: 'add', label: 'Añadir', icon: '+' },
  { id: 'remove', label: 'Quitar', icon: '−' },
  { id: 'smooth', label: 'Suavizar', icon: '≈' },
  { id: 'inflate', label: 'Inflar', icon: '◉' },
  { id: 'flatten', label: 'Aplanar', icon: '▬' },
  { id: 'grab', label: 'Arrastrar', icon: '↝' },
  { id: 'paint', label: 'Pintar', icon: '✎' },
  { id: 'move', label: 'Mover capa', short: 'Mover', icon: '✥' },
];

export const BOTTOM = [
  { id: 'resUp', label: '+ Resolución', icon: '▦' },
  { id: 'undo', label: 'Deshacer', icon: '↶' },
  { id: 'sym', label: 'Simetría X', icon: '⇋' },
  { id: 'resDown', label: '− Resolución', icon: '▢' },
];

export const SHAPES = [
  { id: 'shape:sphere', shape: 'sphere', label: 'Esfera', icon: '●' },
  { id: 'shape:cube', shape: 'cube', label: 'Cubo', icon: '■' },
  { id: 'shape:pyramid', shape: 'pyramid', label: 'Pirámide', icon: '▲' },
];
export const SHAPE_ICON = { sphere: '●', cube: '■', pyramid: '▲' };

// Nombres de todo lo que se puede elegir (también lo que solo está en el panel lateral).
export const LABELS = {
  ...Object.fromEntries([...TOP, ...BOTTOM, ...SHAPES].map((i) => [i.id, i.label])),
  wire: 'Ver malla', remesh: 'Remesh quads', export: 'A Blender', save: 'Guardar', share: 'Compartir',
  layerNew: 'Nueva capa', layerNext: 'Capa siguiente',
};

const DWELL_MS = 450;

export class RadialMenu {
  constructor(size = 768) {
    this.size = size;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d');
    this.highlight = null; // id del elemento bajo el puntero
    this.since = 0;
    this.sub = false; // mitad de arriba mostrando las formas
    this.R = size * 0.49; // arriba (grandes)
    this.Rb = size * 0.37; // abajo (pequeñas)
    this.r = size * 0.15;
  }

  get top() {
    return this.sub ? SHAPES : TOP;
  }

  reset() {
    this.highlight = null;
    this.sub = false;
  }

  // (x, y) dirección tipo pantalla (y hacia abajo) desde el centro. Devuelve el id o null.
  itemAt(x, y) {
    let a = Math.atan2(y, x) + Math.PI / 2; // 0 = arriba, sentido horario
    if (a > Math.PI) a -= Math.PI * 2;
    if (Math.abs(a) <= Math.PI / 2) {
      const list = this.top;
      const i = Math.min(list.length - 1, Math.floor(((a + Math.PI / 2) / Math.PI) * list.length));
      return list[i].id;
    }
    const b = a > 0 ? a - Math.PI / 2 : a + (Math.PI * 3) / 2; // 0..π desde la derecha hacia abajo
    return BOTTOM[Math.min(BOTTOM.length - 1, Math.floor((b / Math.PI) * BOTTOM.length))].id;
  }

  setHighlight(id) {
    if (id === this.highlight) return false;
    this.highlight = id;
    this.since = performance.now();
    // Salir de las formas: al centro o a la mitad de abajo.
    if (this.sub && (id === null || BOTTOM.some((i) => i.id === id))) this.sub = false;
    return true;
  }

  // Llamar cada frame mientras está abierto. true = hay que redibujar.
  tick(now = performance.now()) {
    if (!this.sub && this.highlight === 'add' && now - this.since > DWELL_MS) {
      this.sub = true;
      this.since = now;
      return true;
    }
    return false;
  }

  draw(state, info = '') {
    const { ctx, size, R, Rb, r } = this;
    const c = size / 2;
    ctx.clearRect(0, 0, size, size);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const wedge = (it, a0, a1, outer, big) => {
      const isShape = it.id.startsWith('shape:');
      const active = isShape
        ? state.tool === 'add' && (state.shape || 'sphere') === it.shape
        : it.id === state.tool || (it.id === 'sym' && state.sym);
      const hl = it.id === this.highlight;
      const color = isShape ? TOOL_COLORS.add : TOOL_COLORS[it.id];
      ctx.beginPath();
      ctx.arc(c, c, outer, a0 + 0.012, a1 - 0.012);
      ctx.arc(c, c, r, a1 - 0.012, a0 + 0.012, true);
      ctx.closePath();
      ctx.fillStyle = hl ? (color || '#3d8bff') : active ? '#3b4250' : 'rgba(24,26,32,0.92)';
      ctx.fill();
      ctx.lineWidth = active ? 6 : 2;
      ctx.strokeStyle = active ? color || '#9aa4b5' : 'rgba(255,255,255,0.15)';
      ctx.stroke();
      const mid = (a0 + a1) / 2;
      // Cuñas estrechas de arriba: icono hacia fuera y nombre hacia dentro (sin pisarse).
      const narrow = big && !this.sub;
      const at = (f) => [c + Math.cos(mid) * (r + (outer - r) * f), c + Math.sin(mid) * (r + (outer - r) * f)];
      const [ix, iy] = narrow ? at(0.72) : at(0.5);
      const [lx, ly] = narrow ? at(0.36) : at(0.5);
      let icon = it.icon;
      if (it.id === 'add' && state.shape && state.shape !== 'sphere') icon = '+' + SHAPE_ICON[state.shape];
      ctx.fillStyle = hl ? '#101215' : color || '#e8ecf3';
      ctx.font = `bold ${size * (big ? 0.07 : 0.05)}px system-ui, sans-serif`;
      ctx.fillText(icon, ix, iy - (narrow ? 0 : size * (big ? 0.035 : 0.022)));
      ctx.fillStyle = hl ? '#101215' : '#e8ecf3';
      ctx.font = `700 ${size * (narrow ? 0.024 : big ? 0.04 : 0.026)}px system-ui, sans-serif`;
      ctx.fillText(narrow ? it.short || it.label : it.label, lx, ly + (narrow ? 0 : size * (big ? 0.045 : 0.03)));
    };
    // Arriba: de izquierda (-180°) a derecha (0°) pasando por arriba.
    const top = this.top, segT = Math.PI / top.length;
    top.forEach((it, i) => wedge(it, -Math.PI + i * segT, -Math.PI + (i + 1) * segT, R, true));
    // Abajo: de derecha (0°) a izquierda (180°) pasando por abajo.
    const segB = Math.PI / BOTTOM.length;
    BOTTOM.forEach((it, i) => wedge(it, i * segB, (i + 1) * segB, Rb, false));

    ctx.beginPath();
    ctx.arc(c, c, r - 8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(14,15,19,0.95)';
    ctx.fill();
    const curId = this.highlight || state.tool;
    const cur = [...TOP, ...BOTTOM, ...SHAPES].find((i) => i.id === curId) || TOP[0];
    ctx.fillStyle = TOOL_COLORS[cur.id] || (cur.shape ? TOOL_COLORS.add : '#fff');
    ctx.font = `700 ${size * 0.034}px system-ui, sans-serif`;
    ctx.fillText(cur.label, c, c - size * 0.022);
    ctx.fillStyle = '#9aa4b5';
    ctx.font = `500 ${size * 0.02}px system-ui, sans-serif`;
    ctx.fillText(this.sub ? 'Forma del pincel' : this.highlight === 'add' ? 'Espera: formas…' : info, c, c + size * 0.035);
  }
}
