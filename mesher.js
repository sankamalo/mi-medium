// Surface Nets: un vértice por celda que corta la superficie y un QUAD por
// cada arista de la rejilla que cambia de signo. Resultado: malla de quads.
//
// meshRegion trabaja por trozos (chunks) para re-mallar solo lo que tocas.
// Las aristas pertenecen al chunk de su muestra inferior, así no hay caras duplicadas.
// Cada vértice lleva el id de su celda: así se pueden coser los chunks al exportar.

const CORNER_EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7], // X
  [0, 2], [1, 3], [4, 6], [5, 7], // Y
  [0, 4], [1, 5], [2, 6], [3, 7], // Z
];

let scratch = new Float32Array(0);
let cscratch = new Uint8Array(0);

// base = color base de la capa [r,g,b] 0-255. Devuelve colores por vértice en sRGB 0-1.
export function meshRegion(grid, c0x, c0y, c0z, S, base = [207, 198, 187]) {
  const { n, h } = grid;
  // Muestras necesarias: celdas [c0-1, c0+S) => muestras [c0-1, c0+S].
  const ox = Math.max(c0x - 1, 0), oy = Math.max(c0y - 1, 0), oz = Math.max(c0z - 1, 0);
  const mx = Math.min(c0x + S, n - 1), my = Math.min(c0y + S, n - 1), mz = Math.min(c0z + S, n - 1);
  if (mx <= ox || my <= oy || mz <= oz) return null;
  if (grid.regionUniform(ox, oy, oz, mx, my, mz)) return null;
  const sx = mx - ox + 1, sy = my - oy + 1, sz = mz - oz + 1;
  if (scratch.length < sx * sy * sz) {
    scratch = new Float32Array(sx * sy * sz);
    cscratch = new Uint8Array(sx * sy * sz * 4);
  }
  const data = scratch, cdata = cscratch;
  grid.copyRegion(ox, oy, oz, sx, sy, sz, data, cdata);
  const sxy = sx * sy;
  const CO = [0, 1, sx, sx + 1, sxy, sxy + 1, sxy + sx, sxy + sx + 1];

  // Celdas locales: [0, sx-1) etc.
  const cx = sx - 1, cy = sy - 1, cz = sz - 1;
  const vmap = new Int32Array(cx * cy * cz).fill(-1);
  const pos = [], nor = [], ids = [], col = [];
  const hEps = h * 0.05;
  const v = new Float32Array(8);

  for (let z = 0; z < cz; z++)
    for (let y = 0; y < cy; y++)
      for (let x = 0; x < cx; x++) {
        const i0 = x + sx * y + sxy * z;
        v[0] = data[i0]; v[1] = data[i0 + 1];
        v[2] = data[i0 + sx]; v[3] = data[i0 + sx + 1];
        v[4] = data[i0 + sxy]; v[5] = data[i0 + sxy + 1];
        v[6] = data[i0 + sxy + sx]; v[7] = data[i0 + sxy + sx + 1];
        let mask = 0;
        for (let k = 0; k < 8; k++) if (v[k] < 0) mask |= 1 << k;
        if (mask === 0 || mask === 255) continue;

        let ax = 0, ay = 0, az = 0, cnt = 0;
        for (let e = 0; e < 12; e++) {
          const a = CORNER_EDGES[e][0], b = CORNER_EDGES[e][1];
          const va = v[a], vb = v[b];
          if ((va < 0) === (vb < 0)) continue;
          const t = va / (va - vb);
          ax += (a & 1) + ((b & 1) - (a & 1)) * t;
          ay += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
          az += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
          cnt++;
        }
        const gx = x + ox, gy = y + oy, gz = z + oz;
        pos.push(-0.5 + (gx + ax / cnt) * h, -0.5 + (gy + ay / cnt) * h, -0.5 + (gz + az / cnt) * h);
        const nx = v[1] - v[0] + v[3] - v[2] + v[5] - v[4] + v[7] - v[6];
        const ny = v[2] - v[0] + v[3] - v[1] + v[6] - v[4] + v[7] - v[5];
        const nz = v[4] - v[0] + v[5] - v[1] + v[6] - v[2] + v[7] - v[3];
        const l = Math.hypot(nx, ny, nz) || 1;
        nor.push(nx / l, ny / l, nz / l);
        // Color: mezcla de las 8 esquinas, pesando más las que están pegadas a la superficie.
        let cr = 0, cg = 0, cb = 0, cw = 0;
        for (let k = 0; k < 8; k++) {
          const j = (i0 + CO[k]) * 4;
          const wgt = 1 / (Math.abs(v[k]) + hEps);
          if (cdata[j + 3]) { cr += cdata[j] * wgt; cg += cdata[j + 1] * wgt; cb += cdata[j + 2] * wgt; }
          else { cr += base[0] * wgt; cg += base[1] * wgt; cb += base[2] * wgt; }
          cw += wgt;
        }
        col.push(cr / cw / 255, cg / cw / 255, cb / cw / 255);
        ids.push(gx + n * (gy + n * gz));
        vmap[x + cx * (y + cy * z)] = ids.length - 1;
      }

  const V = (x, y, z) => vmap[x - ox + cx * (y - oy + cy * (z - oz))];
  const quads = [];
  const quad = (a, b, c, d, out) => (out ? quads.push(a, b, c, d) : quads.push(a, d, c, b));
  const D = (x, y, z) => data[x - ox + sx * (y - oy) + sxy * (z - oz)];

  const ex = Math.min(c0x + S, n - 1), ey = Math.min(c0y + S, n - 1), ez = Math.min(c0z + S, n - 1);
  for (let z = c0z; z < ez; z++)
    for (let y = c0y; y < ey; y++)
      for (let x = c0x; x < ex; x++) {
        const d0 = D(x, y, z);
        const ins = d0 < 0;
        if (y > 0 && z > 0 && ins !== D(x + 1, y, z) < 0)
          quad(V(x, y - 1, z - 1), V(x, y, z - 1), V(x, y, z), V(x, y - 1, z), ins);
        if (x > 0 && z > 0 && ins !== D(x, y + 1, z) < 0)
          quad(V(x - 1, y, z - 1), V(x - 1, y, z), V(x, y, z), V(x, y, z - 1), ins);
        if (x > 0 && y > 0 && ins !== D(x, y, z + 1) < 0)
          quad(V(x - 1, y - 1, z), V(x, y - 1, z), V(x, y, z), V(x - 1, y, z), ins);
      }

  if (!quads.length) return null;
  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nor),
    colors: new Float32Array(col),
    ids: Int32Array.from(ids),
    quads: new Uint32Array(quads),
  };
}

export function quadsToTris(q) {
  const t = new Uint32Array((q.length / 4) * 6);
  for (let i = 0, j = 0; i < q.length; i += 4) {
    t[j++] = q[i]; t[j++] = q[i + 1]; t[j++] = q[i + 2];
    t[j++] = q[i]; t[j++] = q[i + 2]; t[j++] = q[i + 3];
  }
  return t;
}

export function quadsToLines(q) {
  const l = new Uint32Array((q.length / 4) * 8);
  for (let i = 0, j = 0; i < q.length; i += 4) {
    l[j++] = q[i]; l[j++] = q[i + 1]; l[j++] = q[i + 1]; l[j++] = q[i + 2];
    l[j++] = q[i + 2]; l[j++] = q[i + 3]; l[j++] = q[i + 3]; l[j++] = q[i];
  }
  return l;
}

// Une los chunks en una sola malla, fusionando los vértices repetidos en las fronteras.
export function mergeChunks(parts) {
  const map = new Map();
  const pos = [], nor = [], col = [], quads = [];
  for (const m of parts) {
    const remap = new Uint32Array(m.ids.length);
    for (let i = 0; i < m.ids.length; i++) {
      let g = map.get(m.ids[i]);
      if (g === undefined) {
        g = pos.length / 3;
        map.set(m.ids[i], g);
        for (let a = 0; a < 3; a++) {
          pos.push(m.positions[i * 3 + a]);
          nor.push(m.normals[i * 3 + a]);
          col.push(m.colors[i * 3 + a]);
        }
      }
      remap[i] = g;
    }
    for (let i = 0; i < m.quads.length; i++) quads.push(remap[m.quads[i]]);
  }
  return {
    positions: new Float32Array(pos), normals: new Float32Array(nor),
    colors: new Float32Array(col), quads: new Uint32Array(quads),
  };
}

// sRGB (0-1) -> lineal, para three.js y glTF.
export function srgbToLinear(arr) {
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const c = arr[i];
    out[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return out;
}

// OBJ con caras de 4 lados (Blender las importa como quads). Varios objetos = varias capas.
export function toOBJ(objects) {
  const out = ['# La Plastilina'];
  let base = 1;
  for (const { name, mesh: m } of objects) {
    out.push(`o ${name}`);
    const p = m.positions, nr = m.normals, c = m.colors;
    // "v x y z r g b": Blender lo importa como atributo de color.
    for (let i = 0; i < p.length; i += 3) {
      const rgb = c ? ` ${c[i].toFixed(4)} ${c[i + 1].toFixed(4)} ${c[i + 2].toFixed(4)}` : '';
      out.push(`v ${p[i].toFixed(5)} ${p[i + 1].toFixed(5)} ${p[i + 2].toFixed(5)}${rgb}`);
    }
    for (let i = 0; i < nr.length; i += 3) out.push(`vn ${nr[i].toFixed(4)} ${nr[i + 1].toFixed(4)} ${nr[i + 2].toFixed(4)}`);
    const q = m.quads;
    for (let i = 0; i < q.length; i += 4) {
      const a = q[i] + base, b = q[i + 1] + base, c = q[i + 2] + base, d = q[i + 3] + base;
      out.push(`f ${a}//${a} ${b}//${b} ${c}//${c} ${d}//${d}`);
    }
    base += p.length / 3;
  }
  return out.join('\n') + '\n';
}

// Lee el OBJ que devuelve el remesh de Blender (v / vn / f con quads o triángulos).
export function parseOBJ(text) {
  const pos = [], quads = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('v ')) {
      const [, x, y, z] = line.trim().split(/\s+/);
      pos.push(+x, +y, +z);
    } else if (line.startsWith('f ')) {
      const f = line.trim().split(/\s+/).slice(1).map((t) => parseInt(t, 10) - 1);
      if (f.length === 4) quads.push(f[0], f[1], f[2], f[3]);
      else if (f.length === 3) quads.push(f[0], f[1], f[2], f[2]);
    }
  }
  return { positions: new Float32Array(pos), quads: new Uint32Array(quads) };
}
