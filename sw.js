/* 신혼여행 지도 서비스 워커 — 화면 캐시(index는 네트워크 우선) + 안드로이드 공유 받기 */
const CACHE = 'hm-4faf9ba86aa0';
const SHELL = ['./', './index.html', './manifest.webmanifest', './vendor/maplibre-gl.mjs', './vendor/maplibre-gl-worker.mjs', './icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('hm-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if(e.request.method === 'POST' && u.origin === location.origin && u.pathname.endsWith('/share')){
    e.respondWith(takeShare(e.request));
    return;
  }
  if(e.request.method !== 'GET' || u.origin !== location.origin) return;
  if(e.request.mode === 'navigate' || u.pathname.endsWith('/') || u.pathname.endsWith('/index.html')){
    e.respondWith(fetch(e.request).then(r => {
      if(r.ok){ const c = r.clone(); caches.open(CACHE).then(x => x.put('./index.html', c)); }
      return r;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});

function idbPut(value){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('hm-share', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, 'share');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  });
}
async function takeShare(request){
  try{
    const fd = await request.formData();
    const files = fd.getAll('files').filter(f => f && typeof f === 'object' && f.size > 0).slice(0, 4);
    const data = {title:String(fd.get('title') || '').slice(0, 500), text:String(fd.get('text') || '').slice(0, 3000), url:String(fd.get('url') || '').slice(0, 1000), files:[]};
    for(const f of files){
      if(f.size > 15 * 1024 * 1024) continue;
      data.files.push({name:String(f.name || 'shared').slice(0, 100), type:String(f.type || ''), buf:await f.arrayBuffer()});
    }
    await idbPut(data);
  }catch(_){}
  return Response.redirect('./?share=1', 303);
}
