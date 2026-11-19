/* Offline support: keeps a copy of the app files on the phone. Guest data is never cached here.
   Version 2.0.1: when online, the app files always come fresh from the internet (so the page and the code never
   come from two different versions); the saved copy is used only when offline. */
var CACHE = 'athulyam-v2.0.7';
var FILES = ['./', './index.html', './app.js', './logic.js', './xlsx.js', './lib/qr.js', './lib/fflate.js', './guest.html', './manifest.json', './fonts/inter-latin-wght-normal.woff2', './fonts/playfair-display-latin-600-normal.woff2',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES.map(function (f) { return new Request(f, { cache: 'reload' }); })); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // sync calls to Google go straight to the network
  var fonts = /\/fonts\/|\/icons\//.test(url.pathname);
  if (fonts) { // fonts and icons never change within a version: saved copy first
    e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || fetch(req); }));
    return;
  }
  e.respondWith(
    fetch(req, { cache: 'no-cache' }).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || caches.match('./index.html'); });
    })
  );
});
