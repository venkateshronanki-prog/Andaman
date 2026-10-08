/* Andaman Trip service worker: cache everything, serve from cache, refresh in the background. */
const V='an-v1';
const CORE=['./','index.html','app.css','app.js','payload.js','scenes.js','config.js','pdf.min.js','pdf.worker.min.js','manifest.webmanifest','icon-180.png','icon-192.png','icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil((async()=>{const c=await caches.open(V);
 await Promise.all(CORE.map(u=>c.add(new Request(u,{cache:'reload'})).catch(()=>{})));
 try{const r=await fetch('docs.json',{cache:'reload'});if(r.ok){const l=await r.json();await Promise.all(l.map(u=>c.add(new Request(u,{cache:'reload'})).catch(()=>{})))}}catch(x){}
 self.skipWaiting()})())});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{for(const k of await caches.keys())if(k!==V)await caches.delete(k);await self.clients.claim()})())});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);if(u.origin!==location.origin)return;
 e.respondWith((async()=>{const c=await caches.open(V);const hit=await c.match(r,{ignoreSearch:true});
  const net=fetch(r).then(res=>{if(res&&res.ok)c.put(r,res.clone());return res}).catch(()=>null);
  if(hit){e.waitUntil(net);return hit}
  const res=await net;if(res)return res;
  if(r.mode==='navigate'){const i=await c.match('index.html')||await c.match('./');if(i)return i}
  return new Response('Offline',{status:503})})())});
self.addEventListener('message',e=>{if(e.data==='skip')self.skipWaiting()});
