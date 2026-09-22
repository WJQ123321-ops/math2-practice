// Browser-level test against a LOCAL mock cloud (no real account, no production writes).
// Requires a Chromium-family browser channel (defaults to msedge). Optional: not part of
// `npm test`. Run with `npm run test:banks-browser` after `npm run demo-bank && npm run setup`.
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {initial,apply}=require('../functions/math2-api/engine.cjs');
const root=path.resolve(__dirname,'..'),manifest=require('../functions/math2-api/assets-manifest.json'),bank=require('../private/data/bank.json');let state=initial();
const exam=bank.questions.filter(q=>(q.bankId||'exam')==='exam');
const part2=bank.questions.filter(q=>q.bankId==='lilin880');
const base='http://127.0.0.1:8798';
const sdk=`export const auth={getSession:async()=>({data:{session:{access_token:'isolated-test-session'}}}),signOut:async()=>{}};export const app={callFunction:async({data})=>({result:await(await fetch('/__mock_api',{method:'POST',body:JSON.stringify(data)})).json()})};`;
const server=http.createServer(async(req,res)=>{
 const u=new URL(req.url,base);
 if(u.pathname==='/__mock_api'){
  let b='';for await(const chunk of req)b+=chunk;const d=JSON.parse(b);let out;
  if(d.action==='identity')out={ok:true};
  else if(d.action==='manifest')out={ok:true,manifest};
  else if(d.action==='assetBatch')out={ok:true,files:d.paths.map(p=>({path:p,data:fs.readFileSync(path.join(root,'private',p)).toString('base64')}))};
  else if(d.action==='asset')out={ok:true,data:fs.readFileSync(path.join(root,'private',d.path)).toString('base64')};
  else if(d.action==='preview')out={ok:true,full:true,epoch:state.epoch,seq:state.seq,records:Object.values(state.records),positions:state.positions,position:state.position};
  else {const r=apply(state,d);state=r.state;out={ok:true,...r.response};}
  res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(out));return;
 }
 if(u.pathname==='/vendor/cloudbase.js'){res.writeHead(200,{'Content-Type':'text/javascript'}).end(sdk);return;}
 const f=path.resolve(root,'public','.'+(u.pathname==='/'?'/index.html':u.pathname));
 if(!f.startsWith(path.join(root,'public')+path.sep)){res.writeHead(403).end();return;}
 try{res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'})[path.extname(f)]||'application/octet-stream'}).end(fs.readFileSync(f));}catch{res.writeHead(404).end();}
});
(async()=>{
 await new Promise(ok=>server.listen(8798,'127.0.0.1',ok));const browser=await chromium.launch({channel:process.env.MATH2_BROWSER_CHANNEL||'msedge',headless:true});
 const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
 try{
 await page.goto(base);await page.locator('#question .meta').waitFor({timeout:180000});
 assert.equal(await page.locator('#question-list button').count(),exam.length);
 await page.locator('#note').fill('原真题笔记保留');await page.waitForFunction(()=>document.querySelector('#save-status').textContent==='已存本机');
 await page.locator('[data-bank="lilin880"]').click();await page.waitForFunction(n=>document.querySelectorAll('#question-list button').length===n,part2.length,{timeout:60000});assert.equal(await page.locator('#question-list button').count(),part2.length);
 await page.locator('#question img').first().waitFor();await page.locator('#question .option').first().click();assert.equal(await page.locator('#question .option.selected').count(),1);await page.locator('#note').fill('分册独立笔记');await page.locator('#favorite').click();await page.waitForFunction(()=>document.querySelector('#save-status').textContent==='已存本机');
 await page.locator('[data-bank="exam"]').click();await page.waitForFunction(()=>document.querySelector('#note').value==='原真题笔记保留');assert.equal(await page.locator('#favorite').getAttribute('aria-pressed'),'false');
 await page.locator('[data-bank="lilin880"]').click();await page.waitForFunction(()=>document.querySelector('#note').value==='分册独立笔记');
 await page.locator('#number-search').fill(part2[0].originalNumber);await page.waitForFunction(n=>{const c=document.querySelectorAll('#question-list button').length;return c>0&&c<n},part2.length,{timeout:60000});assert.ok(await page.locator('#question-list button').count()>0);
 await page.locator('#clear').click();
 // Cover every demo chapter, an essay where present, and any partial-question sample.
 const chapters=[...new Set(part2.map(q=>(q.id.match(/:ch\d+:/)||[''])[0]).filter(Boolean))];
 const chosen=[];for(const ch of chapters){const qs=part2.filter(q=>q.id.includes(ch));chosen.push(qs[0],qs.find(q=>q.type==='essay')||qs[0]);}
 const withSub=part2.find(q=>q.selectedSubquestions?.length);if(withSub)chosen.push(withSub);
 for(const q of chosen.filter(Boolean)){
  await page.evaluate(async id=>{const st=await import('/storage.js'),db=await st.openDB(),s=await st.snapshot(db);await st.putMeta(db,'position',{...s.position,bankId:'lilin880',current:id,category:'',search:'',view:'all',type:'',year:'',status:''});db.close();},q.id);
  await page.reload();await page.locator('#question .meta').waitFor({timeout:60000});await page.locator('#question details').nth(1).locator('summary').click();
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('#question img')).every(i=>i.complete&&i.naturalWidth>0));assert.equal(await page.locator('.render-error,.missing').count(),0);
 }
 await page.screenshot({path:path.join(root,'test-results/demo-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(300);await page.screenshot({path:path.join(root,'test-results/demo-mobile.png'),fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 const imgQ=part2.find(q=>(q.document.asset_refs||[]).length)||bank.questions.find(q=>(q.document.asset_refs||[]).length);
 await page.evaluate(async id=>{const st=await import('/storage.js'),db=await st.openDB(),s=await st.snapshot(db);await st.putMeta(db,'position',{...s.position,bankId:id.startsWith('lilin880:')?'lilin880':'exam',current:id,category:'',search:'',view:'all',type:'',year:'',status:''});db.close();},imgQ.id);
 await page.reload();await page.locator('#question img').first().waitFor();await page.locator('#question img').first().click();await page.locator('#image-dialog[open]').waitFor();await page.locator('#close-image').click();
 // Second device reads the same synthetic cloud, no real account or production writes.
 const ctx2=await browser.newContext({serviceWorkers:'block'}),p2=await ctx2.newPage();await p2.goto(base);await p2.locator('#question .meta').waitFor({timeout:180000});await p2.locator('[data-bank="lilin880"]').click();await p2.waitForFunction(()=>document.querySelector('#note').value==='分册独立笔记');await ctx2.close();
 assert.deepEqual(errors,[]);console.log(JSON.stringify({exam:exam.length,part2:part2.length,chapters:chapters.length,samples:chosen.filter(Boolean).length,desktop:true,mobile:true,notesIsolated:true,secondDevice:true,errors}));
 }finally{await browser.close();await new Promise(ok=>server.close(ok));}
})().catch(e=>{console.error(e);process.exitCode=1;});
