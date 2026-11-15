// Keeps the app working with no internet. Bump VERSION whenever the app files change.
const VERSION = 'dukes-v3';
const FILES = ['./', 'index.html', 'app.css', 'app.js', 'logo.js', 'manifest.json', 'icon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // records go straight to Google
  // network first (so updates arrive), fall back to the saved copy when offline
  // (gives up on the network after 4 seconds – handy where the wifi is weak)
  const cached = () => caches.match(e.request).then(r => r || (e.request.mode === 'navigate' ? caches.match('index.html') : undefined));
  const net = fetch(e.request).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r; });
  const slow = new Promise(res => setTimeout(res, 4000)).then(cached).then(r => r || net);
  e.respondWith(Promise.race([net.catch(cached), slow]));
});
