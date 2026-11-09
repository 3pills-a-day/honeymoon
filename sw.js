/* 신혼여행 지도 서비스 워커 — 화면 캐시(index는 네트워크 우선) + 안드로이드 공유 받기 + 지도 오프라인(3단계 설계 §2-5) */
const CACHE = 'hm-4bfee826572f';
/* 지도 캐시는 빌드가 바뀌어도 지우지 않는다: hmmap-<도시>(내려받기), hmmap-common, hmofm(지도에서 본 곳) */
const OFM = 'https://tiles.openfreemap.org';
const TILE_RE = /^\/planet\/[^/]+\/(\d+)\/(\d+)\/(\d+)\.pbf$/;
const SEEN = 'hmofm', SEEN_MAX = 4000;
const tileKey = (z, x, y) => `${OFM}/__t/${z}/${x}/${y}.pbf`;
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
  if(e.request.method === 'GET' && u.origin === OFM){
    const m = u.pathname.match(TILE_RE);
    e.respondWith(m ? tileFetch(e.request, tileKey(m[1], m[2], m[3])) : netFirst(e.request));
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

/* 타일 주소에는 판 날짜가 들어 있어 날짜를 뺀 열쇠로 찾는다 — 내려받은 타일이 판이 바뀌어도 쓰인다 */
async function tileFetch(req, key){
  const hit = await caches.match(key);
  if(hit) return hit;
  const r = await fetch(req);
  if(r.ok){ const c = r.clone(); caches.open(SEEN).then(x => x.put(key, c)).then(trim).catch(() => {}); }
  return r;
}
async function netFirst(req){
  const net = fetch(req).then(r => { if(r.ok){ const c = r.clone(); caches.open(SEEN).then(x => x.put(req.url, c)).catch(() => {}); } return r; });
  try{ return await Promise.race([net, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))]); }
  catch(_){ const hit = await caches.match(req.url); return hit || net; }
}
let puts = 0;
async function trim(){
  if(++puts % 50) return;
  const c = await caches.open(SEEN), ks = await c.keys();
  for(const k of ks.slice(0, Math.max(0, ks.length - SEEN_MAX))) await c.delete(k);
}

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
