// Menú radial (como la paleta de Medium). Se dibuja en un canvas que sirve
// tanto para el escritorio (elemento HTML) como para las gafas (textura).

export const TOOL_COLORS = {
  add: '#5ad17a',
  remove: '#ff5d5d',
  smooth: '#6cb6ff',
  flatten: '#f2c94c',
  inflate: '#c38bff',
  paint: '#ff9f43',
  move: '#4fd1c5',
};

export const ITEMS = [
  { id: 'add', label: 'Añadir', icon: '+' },
  { id: 'remove', label: 'Quitar', icon: '−' },
  { id: 'smooth', label: 'Suavizar', icon: '≈' },
  { id: 'flatten', label: 'Aplanar', icon: '▬' },
  { id: 'inflate', label: 'Inflar', icon: '◉' },
  { id: 'paint', label: 'Pintar', icon: '✎' },
  { id: 'move', label: 'Mover capa', icon: '✥' },
  { id: 'resUp', label: '+ Resolución', icon: '▦' },
  { id: 'resDown', label: '− Resolución', icon: '▢' },
  { id: 'sym', label: 'Simetría X', icon: '⇋' },
  { id: 'wire', label: 'Ver malla', icon: '#' },
  { id: 'undo', label: 'Deshacer', icon: '↶' },
  { id: 'remesh', label: 'Remesh quads', icon: '⊞' },
  { id: 'export', label: 'A Blender', icon: '⇪' },
  { id: 'save', label: 'Guardar', icon: '⤓' },
  { id: 'share', label: 'Compartir', icon: '➦' },
  { id: 'layerNext', label: 'Capa siguiente', icon: '⇅' },
  { id: 'layerNew', label: 'Nueva capa', icon: '❏' },
];

export class RadialMenu {
  constructor(size = 768) {
    this.size = size;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d');
    this.highlight = -1;
    this.R = size * 0.48;
    this.r = size * 0.17;
  }

  // (x, y) en coordenadas tipo pantalla (y hacia abajo). Devuelve índice o -1.
  indexFromVector(x, y) {
    const seg = (Math.PI * 2) / ITEMS.length;
    let a = Math.atan2(y, x) + Math.PI / 2; // 0 = arriba
    a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return Math.round(a / seg) % ITEMS.length;
  }

  draw(state, info = '') {
    const { ctx, size, R, r } = this;
    const c = size / 2;
    const seg = (Math.PI * 2) / ITEMS.length;
    ctx.clearRect(0, 0, size, size);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ITEMS.forEach((it, i) => {
      const mid = -Math.PI / 2 + i * seg;
      const a0 = mid - seg / 2 + 0.012, a1 = mid + seg / 2 - 0.012;
      const active =
        it.id === state.tool || (it.id === 'sym' && state.sym) || (it.id === 'wire' && state.wire);
      ctx.beginPath();
      ctx.arc(c, c, R, a0, a1);
      ctx.arc(c, c, r, a1, a0, true);
      ctx.closePath();
      ctx.fillStyle = i === this.highlight ? '#3d8bff' : active ? '#3b4250' : 'rgba(24,26,32,0.9)';
      ctx.fill();
      ctx.lineWidth = active ? 5 : 2;
      ctx.strokeStyle = active ? TOOL_COLORS[it.id] || '#9aa4b5' : 'rgba(255,255,255,0.15)';
      ctx.stroke();
      const lr = (R + r) / 2;
      const tx = c + Math.cos(mid) * lr, ty = c + Math.sin(mid) * lr;
      ctx.fillStyle = TOOL_COLORS[it.id] || '#e8ecf3';
      ctx.font = `bold ${size * 0.065}px system-ui, sans-serif`;
      ctx.fillText(it.icon, tx, ty - size * 0.028);
      ctx.fillStyle = '#e8ecf3';
      ctx.font = `600 ${size * 0.027}px system-ui, sans-serif`;
      ctx.fillText(it.label, tx, ty + size * 0.04);
    });
    ctx.beginPath();
    ctx.arc(c, c, r - 8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(14,15,19,0.95)';
    ctx.fill();
    const cur = this.highlight >= 0 ? ITEMS[this.highlight] : ITEMS.find((i) => i.id === state.tool);
    ctx.fillStyle = TOOL_COLORS[cur.id] || '#fff';
    ctx.font = `700 ${size * 0.04}px system-ui, sans-serif`;
    ctx.fillText(cur.label, c, c - size * 0.02);
    ctx.fillStyle = '#9aa4b5';
    ctx.font = `500 ${size * 0.028}px system-ui, sans-serif`;
    ctx.fillText(info, c, c + size * 0.04);
  }
}
