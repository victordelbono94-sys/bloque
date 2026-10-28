// Service worker de Bloque: guarda la estructura de la app para que abra rápido
// y sin conexión. Los datos siempre vienen de Supabase, nunca de la caché.
const VERSION = 'bloque-v20';
const ARCHIVOS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/config.js',
  './js/db.js',
  './js/ui.js',
  './js/fechas.js',
  './js/eventos.js',
  './js/semaforo.js',
  './js/vistas/hoy.js',
  './js/vistas/semana.js',
  './js/vistas/cuerpo.js',
  './js/vistas/perfil.js',
  './js/vistas/entreno.js',
  './js/vistas/sesion.js',
  './js/rutinas.js',
  './js/instalar.js',
  './js/nativo.js',
  './js/ficha.js',
  './js/iconos.js',
  './js/actividades.js',
  './js/mapa.js',
  './js/nutricion.js',
  './js/alimentos.js',
  './js/escaner.js',
  './js/vistas/comida.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((claves) =>
      Promise.all(claves.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Red primero: si hay conexión, siempre la versión más nueva; si no, la guardada.
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        const copia = resp.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copia));
        return resp;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});
