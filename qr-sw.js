/* The service worker for qr.html only (registered with scope ./qr, so no other page is touched).
   Network first, so the page is always current when there is signal; when there is none, the last
   copy of the page and the few files it loads is served, and the code still comes up. The calendar
   (another origin) is left alone: qr.html keeps its own last answer. */
var CACHE = 'aihc-qr-v1';

self.addEventListener('install', function(e){ self.skipWaiting(); });
self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k.indexOf('aihc-qr-') === 0 && k !== CACHE; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});
self.addEventListener('fetch', function(e){
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then(function(res){
      if (res && res.ok){
        var copy = res.clone();
        caches.open(CACHE).then(function(c){ c.put(req, copy); });
      }
      return res;
    }).catch(function(){
      return caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(function(hit){
        return hit || Response.error();
      });
    })
  );
});
