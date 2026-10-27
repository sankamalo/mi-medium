// Almacén local (IndexedDB) de las gafas: autoguardado de la escultura y
// exportaciones pendientes de mandar al Mac. Funciona sin Wi-Fi.

let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('mi-medium', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

function tx(mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction('kv', mode);
    const r = fn(t.objectStore('kv'));
    t.oncomplete = () => resolve(r && r.result);
    t.onerror = () => reject(t.error);
  }));
}

export const idbGet = (key) => tx('readonly', (s) => s.get(key));
export const idbSet = (key, value) => tx('readwrite', (s) => s.put(value, key));
export const idbDel = (key) => tx('readwrite', (s) => s.delete(key));
export const idbKeys = () => tx('readonly', (s) => s.getAllKeys());
