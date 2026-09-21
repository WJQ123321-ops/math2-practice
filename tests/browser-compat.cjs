const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../public'),manifest=require('../functions/math2-api/assets-manifest.json');
const files=manifest.files.map(f=>({...f,base64:fs.readFileSync(path.resolve(__dirname,'../private',f.path)).toString('base64')}));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const base='http://127.0.0.1:8799';let servedRoot=root,corrupt=false;
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,base).pathname;
 if(pathname==='/probe.html'){res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><title>Worker test</title><p>Worker test</p>');return;}
 const file=path.resolve(servedRoot,'.'+(pathname==='/'?'/index.html':pathname));
 if(!file.startsWith(servedRoot+path.sep)){res.writeHead(403).end();return;}
 try{let bytes=fs.readFileSync(file);if(corrupt&&pathname==='/index.html')bytes=Buffer.from('<html>Unexpected platform interstitial</html>');
 const headers={'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'};
 if(req.headers['sec-fetch-mode']!=='navigate')headers['Content-Disposition']='attachment';
 res.writeHead(200,headers).end(bytes);
 }catch{res.writeHead(404).end();}
});
async function cachedFixture(page){await page.evaluate(async({manifest,files})=>{
 const c=await caches.open('math2-protected');for(const f of files)await c.put('/__private/'+manifest.version+'/'+f.path,new Response(Uint8Array.from(atob(f.base64),c=>c.charCodeAt(0)),{headers:{'Content-Type':f.type}}));
 await c.put('/__private/manifest.json',new Response(JSON.stringify(manifest)));
 const st=await import('/storage.js'),db=await st.openDB();await st.acceptSync(db,{epoch:'compat-test',seq:0,records:[]});db.close();
 },{manifest,files});}
async function mockSdk(context,valid=true){
 await context.route('**/vendor/cloudbase.js',route=>route.fulfill({contentType:'text/javascript',body:`
 let valid=${valid};const manifest=${JSON.stringify(manifest)},files=${JSON.stringify(files)};
 export const auth={getSession:async()=>({data:{session:valid?{access_token:'synthetic-test-token'}:null}}),
 signInWithOtp:async()=>({data:{verifyOtp:async()=>{valid=true;return {};}}}),signOut:async()=>{valid=false;}};
 export const app={callFunction:async({data})=>{
 const {action}=data;let result;
 if(action==='identity')result={ok:true};
 else if(action==='preview')result={ok:true,full:true,epoch:'compat-test',seq:0,records:[]};
 else if(action==='manifest')result={ok:true,manifest};
 else if(action==='assetBatch')result={ok:true,files:data.paths.map(p=>({path:p,data:files.find(f=>f.path===p).base64}))};
 else if(action==='asset')result={ok:true,data:files.find(f=>f.path===data.path).base64};
 else if(action==='sync')result={ok:true,epoch:'compat-test',seq:0,records:[],ack:[]};
 else throw Error('Unexpected synthetic action '+action);
 return {result};}};` }));
}
async function practice(page){await page.locator('#question .meta').waitFor({timeout:20000});await page.locator('#note').fill('兼容模式保存测试');await page.waitForFunction(()=>document.querySelector('#save-status').textContent==='已存本机');}
(async()=>{
 await new Promise(ok=>server.listen(8799,'127.0.0.1',ok));const browser=await chromium.launch({channel:process.env.MATH2_BROWSER_CHANNEL||'msedge',headless:true});const results=[];results.push=function(value){console.log('PASS: '+value);return Array.prototype.push.call(this,value);};
 try{
  // Optional exact previous production build: reproduce the download, then upgrade without deleting user data.
  const before=process.env.MATH2_BEFORE_PUBLIC;
  if(before){
   servedRoot=path.resolve(before);const ctx=await browser.newContext(),page=await ctx.newPage();await page.goto(base+'/probe.html');
   await page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;});
   await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
   await page.evaluate(async()=>{const st=await import('/storage.js'),{blank}=await import('/core.js'),db=await st.openDB();await st.acceptSync(db,{epoch:'compat-test',seq:0,records:[]});await st.saveRecord(db,{...blank('upgrade-test'),note:'unsynced note before upgrade'},0);await st.putMeta(db,'compat-marker','keep-before-upgrade');db.close();});
   const download=page.waitForEvent('download',{timeout:15000});await page.goto(base+'/').catch(()=>{});await download;
   results.push('previous production worker reproduces HTML download');
   servedRoot=root;
   const upgrade=await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();return await new Promise(resolve=>{const poll=setInterval(()=>{if(r.waiting){clearInterval(poll);r.waiting.postMessage({type:'ACTIVATE'});resolve('activated waiting worker');}else if(r.installing?.state==='redundant'){clearInterval(poll);resolve('redundant');}},25);setTimeout(()=>{clearInterval(poll);resolve('timeout');},15000);});});
   assert.equal(upgrade,'activated waiting worker');
   await page.waitForFunction(async()=>{const names=await caches.keys();return names.filter(n=>n.startsWith('math2-shell-')).length===1&&(await(await caches.open(names.find(n=>n.startsWith('math2-shell-')))).match('/index.html'))?.headers.get('content-disposition')===null;});
   const r=await page.goto(base+'/');assert.ok(r);assert.equal(r.headers()['content-disposition'],undefined);
   assert.equal(await page.evaluate(async()=>{const st=await import('/storage.js'),db=await st.openDB();return st.getMeta(db,'compat-marker');}),'keep-before-upgrade');
   assert.deepEqual(await page.evaluate(async()=>{const st=await import('/storage.js'),db=await st.openDB(),snap=await st.snapshot(db);return {note:snap.records.get('upgrade-test').note,pending:snap.ops.length};}),{note:'unsynced note before upgrade',pending:1});
   results.push('existing worker upgrade clears download behavior and preserves IndexedDB');await ctx.close();
  }
  {
   const ctx=await browser.newContext(),page=await ctx.newPage();let downloads=0;page.on('download',()=>downloads++);
   await page.goto(base+'/probe.html');await page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;});await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
   const r=await page.goto(base+'/');assert.equal(r.headers()['content-disposition'],undefined);assert.match(r.headers()['content-type'],/^text\/html/);
   await cachedFixture(page);await page.reload();await practice(page);
   // A missing shell entry is fetched, validated and normalized, rather than replaying attachment headers.
   await page.evaluate(async()=>{for(const name of await caches.keys())if(name.startsWith('math2-shell-'))await(await caches.open(name)).delete('/index.html');});
   assert.equal((await page.reload()).headers()['content-disposition'],undefined);await page.locator('#question .meta').waitFor();
   await ctx.setOffline(true);await page.reload();await page.locator('#question .meta').waitFor();assert.equal(await page.locator('#note').inputValue(),'兼容模式保存测试');assert.equal(downloads,0);
   results.push('attachment headers stripped on install and cache miss; offline reload and notes preserved');await ctx.close();
  }
  for(const mode of ['registration-failure','no-cache','legacy-apis']){
   const ctx=await browser.newContext({serviceWorkers:'block'}),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await mockSdk(ctx,false);
   await ctx.addInitScript(mode=>{
    if(mode==='registration-failure')navigator.serviceWorker.register=async()=>{throw Error('test registration failure');};
    else Object.defineProperty(navigator,'serviceWorker',{value:undefined});
    if(mode==='no-cache')Object.defineProperty(window,'caches',{value:undefined});
    if(mode==='legacy-apis'){
     Object.defineProperty(crypto,'randomUUID',{value:undefined});Object.defineProperty(window,'structuredClone',{value:undefined});
     Object.defineProperty(HTMLDialogElement.prototype,'showModal',{value:undefined});Object.defineProperty(HTMLDialogElement.prototype,'close',{value:undefined});
    }
   },mode);
   await page.goto(base+'/');await page.locator('#login-dialog[open]').waitFor({timeout:10000});assert.equal(await page.locator('#note').isDisabled(),true);
   await page.locator('#login-email').fill('test@example.invalid');await page.locator('#send-code').click();await page.locator('#login-code').fill('123456');await page.locator('#login-submit').click();
   await practice(page);await page.waitForFunction(()=>document.querySelector('#offline-status').textContent.startsWith('在线模式'));
   await page.locator('#backup').click();await page.locator('#backup-dialog[open]').waitFor();
   const download=page.waitForEvent('download');await page.locator('#export').click();const exported=await download;assert.match(exported.suggestedFilename(),/\.json$/);
   const data=JSON.parse(fs.readFileSync(await exported.path(),'utf8'));assert.ok(data.records.some(r=>r.note==='兼容模式保存测试'));assert.ok(data.pendingOperations.length>0);
   await page.locator('#close-backup').click();assert.deepEqual(errors,[]);
   results.push(mode+': login succeeds, notes save, backup exports, offline not falsely promised');await ctx.close();
  }
  {
   const ctx=await browser.newContext({serviceWorkers:'block'}),page=await ctx.newPage();await mockSdk(ctx);
   await ctx.addInitScript(()=>Object.defineProperty(window,'indexedDB',{value:{open(){throw Error('denied');}}}));
   await page.goto(base+'/');await page.locator('#startup-retry').waitFor();assert.match(await page.locator('#startup-message').innerText(),/无法保存本地记录/);assert.equal(await page.locator('#note').isDisabled(),true);
   results.push('unavailable IndexedDB gives actionable error and disables editing');await ctx.close();
  }
  {
   const ctx=await browser.newContext(),page=await ctx.newPage();corrupt=true;await page.goto(base+'/probe.html');
   const state=await page.evaluate(async()=>{const r=await navigator.serviceWorker.register('/sw.js');const w=r.installing;return new Promise(resolve=>{if(!w)return resolve('missing');w.addEventListener('statechange',()=>{if(w.state==='redundant'||w.state==='activated')resolve(w.state);});});});
   assert.equal(state,'redundant');corrupt=false;results.push('unexpected interstitial HTML rejected by checksum');await ctx.close();
  }
  console.log(JSON.stringify({passed:results.length,results},null,2));
 }finally{await browser.close();await new Promise(ok=>server.close(ok));}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
