// CACHE_VERSION and SHELL_FILES are injected by build.cjs; this template participates in the version hash.
const VERSION=__CACHE_VERSION__,CACHE='math2-shell-'+VERSION,FILES=__SHELL_FILES__;
const hash=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(v=>v.toString(16).padStart(2,'0')).join('');
async function fetchShell(path){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);try{return await fetch(path,{cache:'reload',signal:controller.signal});}finally{clearTimeout(timer);}}
async function verifiedResponse(file,response){
 const bytes=await response.arrayBuffer();if(!response.ok||await hash(bytes)!==file.sha)throw Error('页面资源校验失败');
 const headers=new Headers(response.headers);for(const name of ['Content-Disposition','Content-Length','Content-Encoding','Transfer-Encoding'])headers.delete(name);
 headers.set('Content-Type',file.type);return new Response(bytes,{status:200,headers});
}
self.addEventListener('install',e=>e.waitUntil((async()=>{const c=await caches.open(CACHE);for(const f of FILES)await c.put(f.path,await verifiedResponse(f,await fetchShell(f.path)));if(!self.registration.active)await self.skipWaiting();})()));
self.addEventListener('activate',e=>e.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('math2-shell-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.origin!==location.origin||e.request.method!=='GET')return;
 if(u.pathname.startsWith('/__private/')){e.respondWith(new Response('Forbidden',{status:403}));return;}
 const p=e.request.mode==='navigate'?'/index.html':u.pathname,f=FILES.find(f=>f.path===p);if(!f)return;
 e.respondWith((async()=>{const c=await caches.open(CACHE),cached=await c.match(p);if(cached)return cached;const r=await verifiedResponse(f,await fetchShell(f.path));await c.put(p,r.clone());return r;})());
});
self.addEventListener('message',e=>{if(e.data.type==='ACTIVATE')self.skipWaiting();if(e.data.type==='CHECK')e.waitUntil((async()=>{let ready=true;const c=await caches.open(CACHE);for(const f of FILES){const r=await c.match(f.path);if(!r||r.headers.has('Content-Disposition')||await hash(await r.arrayBuffer())!==f.sha){ready=false;break;}}e.ports[0]?.postMessage({ready,version:VERSION});})());});
