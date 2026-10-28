// Modo sin internet: guarda la app en las gafas la primera vez y luego la sirve desde ahí.
// Se usa la copia guardada al instante y se actualiza por detrás cuando hay conexión.
const CACHE = 'mi-medium-v13';
const FILES = [
  './', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png',
  './main.js', './sdf.js', './mesher.js', './radial.js', './panel.js', './live.js', './store.js', './remesh.js', './camara.js',
  './vendor/three.module.js', './vendor/addons/controls/OrbitControls.js',
  './vendor/addons/exporters/GLTFExporter.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Solo los archivos de la app; el servidor del Mac (/api) siempre en directo.
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const key = url.pathname.endsWith('/') ? './' : e.request;
      const cached = await cache.match(key, { ignoreSearch: true });
      const fresh = fetch(e.request)
        .then((r) => {
          if (r.ok) cache.put(key, r.clone());
          return r;
        })
        .catch(() => cached);
      return cached || fresh;
    }),
  );
});
