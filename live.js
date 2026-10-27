// Espejo en directo: las gafas mandan cada pincelada (y la pose de cabeza y mandos) al
// servidor del Mac, y la página "?ver" las reproduce para grabarlas en alta calidad.
//
// Mensajes pequeños (JSON) por /api/live + Server-Sent Events.
// Datos grandes (estado completo, deshacer) como binario por /api/live/blob.

export const CLIENT_ID = Math.random().toString(36).slice(2, 10);

// Dirección del servidor del Mac. Vacía = el mismo sitio que sirve la app (lo normal).
// Si la app está instalada desde otra web, se apunta al Mac con ?mac=IP:8443 (se recuerda).
const qsMac = new URLSearchParams(location.search).get('mac');
try { if (qsMac !== null) localStorage.setItem('miMediumMac', qsMac.trim()); } catch {}
let savedMac = '';
try { savedMac = localStorage.getItem('miMediumMac') || ''; } catch {}
export const API = savedMac ? (/^https?:\/\//.test(savedMac) ? savedMac : 'https://' + savedMac).replace(/\/$/, '') : '';

// ¿Está el Mac al alcance? Se comprueba al arrancar y cada 10 s (sin Wi-Fi = trabajar sin él).
export const server = { ok: false, blender: false, listeners: [] };
export async function checkServer() {
  const was = server.ok;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch(API + '/api/ping', { signal: ctl.signal, cache: 'no-store' });
    clearTimeout(t);
    server.ok = r.ok;
    if (r.ok) server.blender = !!(await r.json()).blender;
  } catch {
    server.ok = false;
  }
  if (server.ok !== was) server.listeners.forEach((f) => f(server.ok));
  return server.ok;
}
setInterval(checkServer, 10000);

export class Live {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.queue = [];
    this.pose = null;
    this.timer = setInterval(() => this.flush(), 50);
    server.listeners.push((ok) => (ok ? this.connect() : this.disconnect()));
    if (server.ok) this.connect();
  }

  disconnect() {
    if (this.es) this.es.close();
    this.es = null;
  }

  connect() {
    if (this.es) return;
    this.es = new EventSource(API + '/api/live/stream');
    // Cada evento es un lote: { from, msgs: [...] }
    this.es.onmessage = (e) => {
      const batch = JSON.parse(e.data);
      if (batch.from === CLIENT_ID) return;
      for (const m of batch.msgs) this.onMessage(m);
    };
  }

  send(msg) {
    this.queue.push(msg);
  }

  setPose(p) {
    this.pose = p;
  }

  async flush() {
    if (this.pose) {
      this.queue.push(this.pose);
      this.pose = null;
    }
    if (!server.ok) this.queue.length = 0;
    if (!this.queue.length || this.sending) return;
    const batch = this.queue;
    this.queue = [];
    this.sending = true;
    try {
      await fetch(API + '/api/live', {
        method: 'POST',
        body: JSON.stringify({ from: CLIENT_ID, msgs: batch }),
      });
    } catch {
      /* sin servidor: se pierde, no pasa nada */
    }
    this.sending = false;
  }

  // Sube un binario; el servidor avisa a los demás con {t: 'blob', id, kind}.
  async sendBlob(kind, buffer) {
    await this.flush();
    if (!server.ok) return;
    try {
      await fetch(API + `/api/live/blob?kind=${kind}&from=${CLIENT_ID}`, { method: 'POST', body: buffer });
    } catch {
      /* idem */
    }
  }
}

export async function fetchBlob(id) {
  const r = await fetch(API + '/api/live/blob?id=' + encodeURIComponent(id));
  if (!r.ok) throw new Error('blob ' + r.status);
  return r.arrayBuffer();
}

// Formato: [u32 longitud meta][meta JSON][trozos binarios, cada uno alineado a 4 bytes].
export function pack(meta, parts) {
  const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
  const pad = (n) => Math.ceil(n / 4) * 4;
  let size = 4 + pad(metaBytes.length);
  for (const p of parts) size += pad(p.byteLength);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, metaBytes.length, true);
  out.set(metaBytes, 4);
  let off = 4 + pad(metaBytes.length);
  for (const p of parts) {
    out.set(new Uint8Array(p), off);
    off += pad(p.byteLength);
  }
  return out.buffer;
}

export function unpack(buf) {
  const len = new DataView(buf).getUint32(0, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len)));
  return { meta, off: 4 + Math.ceil(len / 4) * 4 };
}
