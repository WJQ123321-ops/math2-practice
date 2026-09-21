import {openContentCache,persistentContent} from './content-cache.js';
import {randomId} from './compat.js';
import {app,auth} from './vendor/cloudbase.js';
import {openDB,snapshot,getMeta,putMeta,acceptSync,adoptRestoredCloud} from './storage.js';
const $=s=>document.querySelector(s);let active=false,resync=false,db,reg,updateAvailable=false;
export async function api(action,body={}){const session=await auth.getSession();if(session.error||!session.data?.session)throw Error('登录已过期，请重新登录；本地记录仍保留');const s=session.data.session,token=s.access_token||s.accessToken;if(!token)throw Error('无法取得登录会话');const result=await app.callFunction({name:'math2-api',data:{...body,action,clientVersion:2,accessToken:token}});let out=result.result;if(typeof out==='string')out=JSON.parse(out);if(!out?.ok)throw Error(({AUTH_REQUIRED:'登录已过期，请重新登录',ACCESS_DENIED:'此账号未获准访问',PREVIEW_CHANGED:'预览后云端已变化，请重新预览',SERVICE_UNAVAILABLE:'云端暂时不可用，本地记录仍保留',NOT_FOUND:'请求的资料不存在',INVALID_ACTION:'操作不受支持，请刷新页面',BUSY_RETRY:'云端正在处理其他修改，请稍后重试',INVALID_BACKUP:'备份格式无效，请检查文件',INVALID_RECORD:'备份中有无效题目记录',INVALID_FIELD:'记录字段格式不正确',DUPLICATE_RECORD:'备份中包含重复题号',TOO_MANY_OPS:'待同步修改过多，将分批重试'})[out?.error]||out?.error||'请求失败');return out;}
export async function syncNow(){if(!db||document.hidden)return;if(active){resync=true;return;}active=true;try{const run=async()=>{if((await getMeta(db,'maintenance'))?.expires>Date.now())return;let snap=await snapshot(db);if(snap.sync.stale){$('#sync-status').textContent='云端已恢复备份，需要处理旧修改';return;}if(!navigator.onLine){$('#sync-status').textContent=snap.ops.length?'已存本机，待同步（离线）':'离线练习';return;}$('#sync-status').textContent='同步中';const response=await api('sync',{epoch:snap.sync.epoch,cursor:snap.sync.cursor||0,ops:snap.ops.filter(o=>!o.blocked).slice(0,100).map(({order,blocked,...op})=>op),position:snap.pendingPosition?{current:snap.pendingPosition.current}:null,device:await deviceId()});response.positionAck=snap.pendingPosition?.nonce;await acceptSync(db,response);snap=await snapshot(db);$('#sync-status').textContent=snap.sync.stale?'云端已恢复备份，需要处理旧修改':snap.sync.errors?.length?'部分修改需处理，请导出备份':[...snap.records.values()].some(r=>Object.values(r.conflicts||{}).some(v=>v.length))?'需要处理冲突':snap.ops.length?'已存本机，待同步':'已同步';window.dispatchEvent(new Event('math2-cloud-change'));if(snap.ops.some(o=>!o.blocked)&&!snap.sync.stale)setTimeout(syncNow,500);};if(navigator.locks)await navigator.locks.request('math2-sync',run);else await run();}catch(e){$('#sync-status').textContent='已存本机，待同步 · '+e.message;}finally{active=false;if(resync){resync=false;setTimeout(syncNow,500);}}}
async function deviceId(){let id=await getMeta(db,'device');if(!id){id=randomId();await putMeta(db,'device',id);}return id;}
async function hash(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function cachedManifest(){const c=await openContentCache();return (await c.match('/__private/manifest.json'))?.json();}

async function pruneContent(manifest){
 const c=await openContentCache();const previous=await (await c.match('/__private/previous-manifest.json'))?.json();
 const keep=new Set([manifest?.version,previous?.version].filter(Boolean));
 for(const key of await c.keys()){const path=new URL(key.url).pathname;const match=path.match(/^\/__private\/([^/]+)\//);if(match&&!keep.has(match[1]))await c.delete(key);}
}
async function activateManifest(manifest){
 const c=await openContentCache(),old=await cachedManifest();
 if(old&&old.version!==manifest.version)await c.put('/__private/previous-manifest.json',new Response(JSON.stringify(old)));
 await c.put('/__private/manifest.json',new Response(JSON.stringify(manifest)));await pruneContent(manifest);
}
async function complete(manifest){if(!manifest)return false;const c=await openContentCache();for(const f of manifest.files){const r=await c.match('/__private/'+manifest.version+'/'+f.path);if(!r)return false;const bytes=await r.arrayBuffer();if(bytes.byteLength!==f.bytes||await hash(bytes)!==f.sha256)return false;}return true;}
async function prepareContent(activate=true){
 const {manifest}=await api('manifest'),c=await openContentCache();let n=0;
 const batches=[];let batch=[],bytes=0;
 for(const f of manifest.files){const r=await c.match('/__private/'+manifest.version+'/'+f.path);if(r&&await hash(await r.arrayBuffer())===f.sha256){n++;continue;}
  if(batch.length&&(batch.length>=16||bytes+f.bytes>2000000)){batches.push(batch);batch=[];bytes=0;}batch.push(f);bytes+=f.bytes;
 }if(batch.length)batches.push(batch);
 let cursor=0;const worker=async()=>{while(cursor<batches.length){const items=batches[cursor++],result=await api('assetBatch',{paths:items.map(f=>f.path)});
  for(const f of items){const data=result.files?.find(a=>a.path===f.path)?.data;if(typeof data!=='string')throw Error('题库资源缺失，请重试');const bytes=Uint8Array.from(atob(data),x=>x.charCodeAt(0));if(bytes.length!==f.bytes||await hash(bytes)!==f.sha256)throw Error('资源校验失败，可重试');await c.put('/__private/'+manifest.version+'/'+f.path,new Response(bytes,{headers:{'Content-Type':f.type}}));$('#offline-status').textContent=`正在下载题库 ${++n}/${manifest.files.length}`;}
 }};const results=await Promise.allSettled(Array.from({length:4},worker)),failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
 if(!await complete(manifest))throw Error('题库未下载完整');if(activate)await activateManifest(manifest);return manifest;
}

function workerMessage(type){if(!navigator.serviceWorker?.controller)return Promise.reject(Error('离线服务尚未接管页面'));return new Promise((resolve,reject)=>{const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(Error('离线缓存检查超时'))},15000);channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data)};navigator.serviceWorker.controller?.postMessage({type},[channel.port2]);});}
let workerSetup,offlineFailure='',contentReady=false;
function noticeUpdate(){if(reg?.waiting){updateAvailable=true;$('#update-app').hidden=false;}}
async function setupOffline(){
 if(workerSetup)return workerSetup;
 workerSetup=(async()=>{
  if(typeof navigator.serviceWorker?.register!=='function'||!persistentContent())throw Error('此浏览器的离线存储不可用');
  reg=await navigator.serviceWorker.register('/sw.js');if(!reg)throw Error('浏览器未启用离线服务');noticeUpdate();
  reg.addEventListener('updatefound',()=>reg.installing?.addEventListener('statechange',noticeUpdate));
  await new Promise((resolve,reject)=>{let timer;const done=()=>{if(navigator.serviceWorker.controller){clearTimeout(timer);navigator.serviceWorker.removeEventListener('controllerchange',done);resolve();}};
   timer=setTimeout(()=>{navigator.serviceWorker.removeEventListener('controllerchange',done);reject(Error('离线页面准备超时'));},30000);navigator.serviceWorker.addEventListener('controllerchange',done);done();});
  offlineFailure='';
 })().catch(e=>{offlineFailure=e.message||'离线准备失败';workerSetup=null;}).finally(()=>{if(contentReady)void offlineStatus();});return workerSetup;
}
async function offlineStatus(){try{
 if(!persistentContent()||!navigator.serviceWorker?.controller){$('#offline-status').textContent='在线模式 · '+(offlineFailure||'离线准备中')+'，点击重试';return;}
 const manifest=await cachedManifest(),ready=await complete(manifest),shell=await workerMessage('CHECK');
 $('#offline-status').textContent=ready&&shell.ready&&!!(await getMeta(db,'sync'))?.epoch?'可离线使用':'在线模式 · 离线准备未完成，点击重试';
 }catch(e){$('#offline-status').textContent='在线模式 · 离线准备未完成，点击重试';}}
async function login(){const dialog=$('#login-dialog');dialog.showModal();$('#login-message').textContent='使用已登记的邮箱登录';return new Promise(resolve=>{let verify;$('#send-code').onclick=async()=>{try{$('#send-code').disabled=true;const {data,error}=await auth.signInWithOtp({email:$('#login-email').value.trim(),options:{shouldCreateUser:false}});if(error)throw error;verify=data.verifyOtp;$('#login-message').textContent='验证码已发送，请在邮箱查收';}catch(e){$('#login-message').textContent=e.message}finally{setTimeout(()=>$('#send-code').disabled=false,60000)}};$('#login-submit').onclick=async()=>{try{if(!verify)throw Error('请先获取验证码');const {error}=await verify({token:$('#login-code').value.trim()});if(error)throw error;await api('identity');$('#login-code').value='';dialog.close();resolve();}catch(e){$('#login-message').textContent=e.message}};$('#login-cancel').onclick=()=>{dialog.close();resolve(false)};dialog.oncancel=()=>resolve(false);});}
export async function startCloud(){
 $('#startup-message').textContent='正在检查本地记录存储…';
 try{db=await openDB();await putMeta(db,'storage-check',Date.now());}catch{throw Error('无法保存本地记录，请允许此网站使用浏览器存储后重试。已有记录未被清除。');}
 await openContentCache();void setupOffline();
 let manifest=await cachedManifest();
 if(!await complete(manifest)||!(await getMeta(db,'sync'))?.epoch){
  $('#startup-message').textContent='请登录以读取题库和云端记录';
  try{await api('identity')}catch{if(await login()===false)throw Error('登录已取消，点击重新尝试即可继续；已有记录仍保留。');}
  $('#startup-message').textContent='正在读取云端记录和题库…';
  const init=await api('preview');await acceptSync(db,{...init,ack:[]});manifest=await prepareContent();
 }
 if(navigator.onLine){try{const fresh=await api('manifest');if(fresh.manifest.version!==manifest.version){$('#startup-message').textContent='正在更新题库，原有学习记录会保留…';manifest=await prepareContent();}}catch(e){$('#startup-message').textContent='题库更新暂未完成，先使用本机版本';}}
 contentReady=true;
 $('#account').onclick=()=>login().then(ok=>ok===false?undefined:syncNow());$('#offline-status').onclick=async()=>{try{void setupOffline();const fresh=await api('manifest');if(manifest.version!==fresh.manifest.version){if(!await window.math2Flush?.())return;const next=await prepareContent(false);if(confirm('新版题库已完整下载，是否现在切换？本地笔记会保留。')){const c=await openContentCache();await activateManifest(next);location.reload();}else await pruneContent(manifest);return;}await prepareContent();await offlineStatus();}catch(e){$('#offline-status').textContent=e.message;}};$('#sync-status').onclick=async()=>{const s=await snapshot(db);if(s.sync.stale){$('#stale-dialog').showModal();return;}await syncNow();};$('#adopt-cloud').onclick=async()=>{try{if(!await window.math2Flush?.())return;const snap=await snapshot(db);download({app:'math2-practice',schemaVersion:2,bankVersion:manifest.version,exportedAt:new Date().toISOString(),records:[...snap.records.values()],pendingOperations:snap.ops,position:snap.position,sync:snap.sync},'恢复前本地记录.json');if(!confirm('已发起本地备份下载。确认文件已保存后，载入云端恢复版本？旧修改将从待同步队列移除，可再导入备份合并。'))return;const fresh=await api('preview');await adoptRestoredCloud(db,fresh,snap);$('#stale-dialog').close();window.dispatchEvent(new Event('math2-cloud-change'));await syncNow();}catch(e){$('#sync-status').textContent=e.message}};
 $('#logout').onclick=async()=>{if(!await window.math2Flush?.())return;const snap=await snapshot(db);if(snap.ops.length&&!confirm('还有未同步记录。退出将保留本机题库和记录；可先取消并导出备份。继续退出？'))return;await auth.signOut();$('#sync-status').textContent='已退出，保留本机练习记录';};$('#update-app').onclick=async()=>{if(!await window.math2Flush?.())return;if(updateAvailable&&confirm('本地笔记已保存，切换到下载完整的新版本？')){reg.waiting?.postMessage({type:'ACTIVATE'});navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});}};window.addEventListener('online',syncNow);window.addEventListener('math2-local-save',()=>{clearTimeout(window.syncDelay);window.syncDelay=setTimeout(syncNow,800)});document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncNow()});window.addEventListener('math2-position-save',()=>{if(!window.positionSyncTimer)window.positionSyncTimer=setTimeout(()=>{window.positionSyncTimer=null;syncNow()},10000)});setInterval(syncNow,30000);setTimeout(offlineStatus,300);setTimeout(syncNow,1000);const cache=await openContentCache(),bank=await(await cache.match('/__private/'+manifest.version+'/data/bank.json')).json();window.math2ImageUrls={};for(const f of manifest.files.filter(f=>f.path.startsWith('images/')))window.math2ImageUrls[f.path]=URL.createObjectURL(await(await cache.match('/__private/'+manifest.version+'/'+f.path)).blob());return bank;}
export function download(data,name){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
export async function cloudRestore(data,expected){const run=async()=>{await putMeta(db,'maintenance',{expires:Date.now()+60000});try{const snap=await snapshot(db);if(snap.ops.length)throw Error('请先同步所有本地修改，再重新预览备份');const r=await api('restore',{epoch:expected.epoch,expectedSeq:expected.seq,records:data.records,position:data.position,bankPositions:data.bankPositions});await acceptSync(db,r);await putMeta(db,'bankPositions',data.bankPositions||{});if(data.position)await putMeta(db,'position',data.position);return r;}finally{await putMeta(db,'maintenance',false)}};return navigator.locks?navigator.locks.request('math2-sync',run):run();}
export {api as cloudApi};
