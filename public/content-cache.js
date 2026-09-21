// A session-only resource cache keeps online practice available when CacheStorage is blocked.
let opened, persistent=false;
function memoryCache(){const data=new Map(),key=x=>new URL(typeof x==='string'?x:x.url,location.href).href;return {
 async match(x){return data.get(key(x))?.clone();},async put(x,r){data.set(key(x),r.clone());},
 async delete(x){return data.delete(key(x));},async keys(){return [...data.keys()].map(x=>new Request(x));}
};}
export function openContentCache(){if(!opened)opened=(async()=>{try{
 const c=await caches.open('math2-protected');const probe='/__private/cache-probe';await c.put(probe,new Response('ok'));await c.delete(probe);persistent=true;return c;
 }catch{persistent=false;return memoryCache();}})();return opened;}
export function persistentContent(){return persistent;}
