// Hornea un movimiento de capa fuera del hilo principal: las gafas no se traban al soltar lo que llevas.
import { SDFGrid } from './sdf.js';
import { meshRegion } from './mesher.js';

onmessage = ({ data: { id, meta, buf, inv, scale, base, chunk } }) => {
  try {
    const { grid } = SDFGrid.deserialize(meta, buf, 0);
    grid.applyTransform(inv, scale);
    const C = Math.ceil((grid.n - 1) / chunk), meshes = [], moved = [];
    for (let ci = 0; ci < C ** 3; ci++) {
      const m = meshRegion(grid, (ci % C) * chunk, (Math.floor(ci / C) % C) * chunk, Math.floor(ci / (C * C)) * chunk, chunk, base);
      if (!m) continue;
      meshes.push({ ci, m });
      moved.push(m.positions.buffer, m.normals.buffer, m.colors.buffer, m.quads.buffer);
    }
    const s = grid.serialize();
    const size = s.parts.reduce((a, p) => a + Math.ceil(p.byteLength / 4) * 4, 0);
    const out = new Uint8Array(size);
    let off = 0;
    for (const p of s.parts) {
      out.set(new Uint8Array(p), off);
      off += Math.ceil(p.byteLength / 4) * 4;
    }
    postMessage({ id, meta: s.meta, buf: out.buffer, meshes }, [out.buffer, ...moved]);
  } catch (e) {
    postMessage({ id, error: e.message });
  }
};
