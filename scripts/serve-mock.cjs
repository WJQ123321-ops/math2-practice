// Local preview with a MOCKED cloud: serves public/ and answers the front end's cloud
// calls from the imported bank in private/, so you can practise without deploying.
//
//   node scripts/serve-mock.cjs            -> http://127.0.0.1:8788
//   MATH2_MOCK_PORT=9000 node scripts/serve-mock.cjs
//
// Differences from the real deployment (read before relying on it):
//   - No Tencent Cloud, no login: the "account" is always accepted.
//   - Sync state lives in private/.local-preview-state.json (git-ignored); your notes
//     still persist in the browser's IndexedDB, but there is no cross-device sync.
//   - Records are NOT backed up to any cloud. Export them from 备份与恢复 if needed.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {initial,apply}=require('../functions/math2-api/engine.cjs');
const root=path.resolve(__dirname,'..');
const priv=path.join(root,'private');
const port=Number(process.env.MATH2_MOCK_PORT||8788);
const stateFile=process.env.MATH2_MOCK_STATE_FILE||path.join(priv,'.local-preview-state.json');
const manifestPath=p=>JSON.parse(fs.readFileSync(path.join(root,'functions/math2-api',p),'utf8'));
const v3=manifestPath('assets-manifest.json');
const v2=manifestPath('v2-assets-manifest.json');
const practice=require('../functions/math2-api/practice.cjs');
const cap={capabilities:{practice:1,goalProtocol:2,goalBankCompatibility:1,backupRecovery:1},practiceEnabledFrom:practice.START_DATE};
const legacy=fs.existsSync(path.join(root,'functions/math2-api/legacy-assets-manifest.json'))?manifestPath('legacy-assets-manifest.json'):v2;
let state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):initial();
const saveState=()=>fs.writeFileSync(stateFile,JSON.stringify(state));
saveState();

// Stand-in for the CloudBase browser SDK: no network, always "signed in".
const sdk=`export const auth={
 getSession:async()=>({data:{session:{access_token:'local-preview-token'}}}),
 signInWithOtp:async({email})=>({data:{verifyOtp:async({otp})=>({data:{session:{access_token:'local-preview-token'}},error:null})},error:null}),
 signOut:async()=>{}};
export const app={callFunction:async({data})=>({result:await(await fetch('/__mock_api',{method:'POST',body:JSON.stringify(data)})).json()})};`;

function readAsset(p,clientVersion){
 // Old clients ask for data/bank.json but are served the legacy bank, exactly like the
 // real handler does.
 const rel=p==='data/bank.json'?(clientVersion===3?p:clientVersion===2?'data/v2-bank.json':'data/legacy-bank.json'):p;
 return fs.readFileSync(path.join(priv,rel));
}
function mockApi(event){
 if(event?.action==='health')return {ok:true,ready:true,scope:'function'};
 if(event?.action==='identity')return {ok:true,...cap,user:{id:'local-preview',email:'local@preview.invalid'}};
 const active=event?.clientVersion===3?v3:event?.clientVersion===2?v2:legacy;
 if(event?.action==='manifest')return {ok:true,manifest:active};
 if(event?.action==='asset'){
  const entry=active.files.find(f=>f.path===event.path);if(!entry)return {ok:false,error:'NOT_FOUND'};
  return {ok:true,path:entry.path,sha256:entry.sha256,data:readAsset(event.path,event.clientVersion).toString('base64')};
 }
 if(event?.action==='assetBatch'){
  if(![2,3].includes(event.clientVersion)||!Array.isArray(event.paths)||event.paths.length<1||event.paths.length>16)return {ok:false,error:'NOT_FOUND'};
  const entries=event.paths.map(p=>active.files.find(f=>f.path===p));
  if(entries.some(e=>!e)||entries.reduce((n,e)=>n+e.bytes,0)>2500000)return {ok:false,error:'NOT_FOUND'};
  return {ok:true,files:entries.map(e=>({path:e.path,data:readAsset(e.path,event.clientVersion).toString('base64')}))};
 }
 if(event?.action==='preview')return {ok:true,...cap,...practice.snapshot(state,0,true),stateRevision:state.seq,practiceRevision:state.seq,full:true,epoch:state.epoch,seq:state.seq,records:Object.values(state.records),position:state.position,positions:state.positions||{}};
 if(!['sync','restore'].includes(event?.action))return {ok:false,error:'INVALID_ACTION'};
 if(event.action==='restore'&&event.recoveryVersion===1&&(event.expectedStateRevision!==state.seq||event.expectedPracticeRevision!==state.seq))throw Error('PREVIEW_CHANGED');
 const next=apply(state,event);state=next.state;if(event.action==='restore'&&event.recoveryVersion===1)state.epoch=event.restoreId;saveState();
 return {ok:true,...cap,...next.response,epoch:state.epoch,...(event.action==='restore'?{full:true}: {})};
}
const crypto=require('node:crypto');
const sw=fs.readFileSync(path.join(root,'public/sw.js'),'utf8').replace(/("path":"\/vendor\/cloudbase.js","sha":")[a-f0-9]+/,(_,prefix)=>prefix+crypto.createHash('sha256').update(sdk).digest('hex')).replace(/const VERSION="[^"]+"/,match=>match.slice(0,-1)+'-mock"');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.woff2':'font/woff2','.woff':'font/woff'};
http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://127.0.0.1');
 if(u.pathname==='/sw.js'){res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'}).end(sw);return;}
 if(u.pathname==='/vendor/cloudbase.js'){res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'}).end(sdk);return;}
 if(u.pathname==='/__mock_api'){
  let b='';for await(const c of req)b+=c;
  try{res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(mockApi(JSON.parse(b))));}
  catch(e){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({ok:false,error:e.message}));}
  return;
 }
 const file=path.resolve(root,'public','.'+(u.pathname==='/'?'/index.html':u.pathname));
 if(!file.startsWith(path.join(root,'public')+path.sep)){res.writeHead(403).end();return;}
 try{res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'}).end(fs.readFileSync(file));}
 catch{res.writeHead(404).end('Not found')}
}).listen(port,'127.0.0.1',()=>console.log('本地模拟预览（题库来自 private/，无云端、无登录）：http://127.0.0.1:'+port));
