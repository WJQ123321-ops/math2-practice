import {randomId} from './compat.js';
import {blank,mergeRecord,validatePracticeBackup} from './core.js';
export const DB_NAME='math2-cloud-v2';
const fields=['note','status','favorite','wrong','noteConflicts','contentHash','conflicts'];
export const req=r=>new Promise((ok,no)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});
const completion=tx=>new Promise((ok,no)=>{tx.oncomplete=ok;tx.onabort=()=>no(tx.error||Error('本地事务未完成'));tx.onerror=()=>{}});
export function openDB(){return new Promise((ok,no)=>{const r=indexedDB.open(DB_NAME,2);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains('records'))db.createObjectStore('records',{keyPath:'id'});if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta');if(!db.objectStoreNames.contains('ops'))db.createObjectStore('ops',{keyPath:'id'});if(!db.objectStoreNames.contains('dailyCompletions'))db.createObjectStore('dailyCompletions',{keyPath:'key'});if(!db.objectStoreNames.contains('goalTemplates'))db.createObjectStore('goalTemplates',{keyPath:'id'});if(!db.objectStoreNames.contains('goalOverrides'))db.createObjectStore('goalOverrides',{keyPath:'date'});if(!db.objectStoreNames.contains('practiceOps'))db.createObjectStore('practiceOps',{keyPath:'id'})};r.onsuccess=()=>{r.result.onversionchange=()=>r.result.close();ok(r.result)};r.onerror=()=>no(r.error);r.onblocked=()=>no(Error('请关闭其他旧页面再试'))})}
export async function transact(db,stores,fn){const tx=db.transaction(stores,'readwrite'),done=completion(tx);try{const result=await fn(tx);await done;return result}catch(e){try{tx.abort()}catch{}await done.catch(()=>{});throw e}}
export async function snapshot(db){return transact(db,['records','meta','ops','dailyCompletions','goalTemplates','goalOverrides','practiceOps'],async tx=>{const rs=await req(tx.objectStore('records').getAll()),ms=tx.objectStore('meta');return {records:new Map(rs.map(r=>[r.id,r])),position:await req(ms.get('position')),bankPositions:await req(ms.get('bankPositions'))||{},lastExport:await req(ms.get('lastExport')),pendingPosition:await req(ms.get('pendingPosition')),sync:await req(ms.get('sync'))||{},ops:(await req(tx.objectStore('ops').getAll())).sort((a,b)=>a.order-b.order),dailyCompletions:await req(tx.objectStore('dailyCompletions').getAll()),goalTemplates:await req(tx.objectStore('goalTemplates').getAll()),goalOverrides:await req(tx.objectStore('goalOverrides').getAll()),practiceOps:(await req(tx.objectStore('practiceOps').getAll())).sort((a,b)=>a.order-b.order)}})}
export async function getMeta(db,key){return transact(db,['meta'],tx=>req(tx.objectStore('meta').get(key)))}
export async function putMeta(db,key,value){return transact(db,['meta'],tx=>{tx.objectStore('meta').put(value,key)})}
export async function retryCompatibleGoals(db){
 return transact(db,['practiceOps','meta'],async tx=>{
  const ps=tx.objectStore('practiceOps'),ms=tx.objectStore('meta'),sync=await req(ms.get('sync'))||{};
  if(sync.stale||(await req(ms.get('maintenance')))?.expires>Date.now())return 0;
  const ops=await req(ps.getAll()),retried=new Set(),attempted=new Set(await req(ms.get('goalBankCompatibilityRetries'))||[]),isGoal=op=>op.kind==='setGoalTemplate'||op.kind==='setGoalOverride';
  const retry=op=>{delete op.blocked;delete op.remote;ps.put(op);retried.add(op.id)};
  for(const op of ops)if(isGoal(op)&&op.epoch===sync.epoch&&op.blocked==='BANK_VERSION_MISMATCH'&&!attempted.has(op.id))retry(op);
  let changed;
  do{changed=false;for(const op of ops)if(isGoal(op)&&op.epoch===sync.epoch&&['DEPENDENCY_BLOCKED','DEPENDENCY_MISSING'].includes(op.blocked)&&retried.has(op.baseRevision)){retry(op);changed=true}}while(changed);
  if(retried.size){
   ms.put(ops.filter(op=>attempted.has(op.id)||retried.has(op.id)).map(op=>op.id),'goalBankCompatibilityRetries');
   ms.put({...sync,errors:(sync.errors||[]).filter(error=>!retried.has(error.id))},'sync');
  }
  return retried.size;
 });
}
function enqueue(tx,old,value,sync,order,resolveField){const id=randomId(),changes={};for(const f of fields)if(JSON.stringify(old[f])!==JSON.stringify(value[f])||resolveField===f)changes[f]={base:old._bases?.[f]??old.fieldVersions?.[f]??0,value:value[f]??{},...(resolveField===f?{resolve:true}:{})};const next={...value,_bases:{...old._bases},revision:(old.revision||0)+1,updatedAt:new Date().toISOString()};if(Object.keys(changes).length){tx.objectStore('ops').put({id,epoch:sync.epoch,questionId:value.id,changes,order});for(const f of Object.keys(changes))next._bases[f]=id;}tx.objectStore('records').put(next);return next;}
export async function saveRecord(db,value,expected,resolveField){const result=await transact(db,['records','ops','meta'],async tx=>{const m=tx.objectStore('meta');if((await req(m.get('maintenance')))?.expires>Date.now())throw Error('正在恢复备份，请稍后保存');const sync=await req(m.get('sync'))||{};if(!sync.epoch)throw Error('请先联网完成首次初始化');const old=await req(tx.objectStore('records').get(value.id))||blank(value.id);if(old.revision!==expected)throw Error('此题已更新，草稿仍保留，请载入最新记录');const order=(await req(m.get('order'))||0)+1;m.put(order,'order');return enqueue(tx,old,value,sync,order,resolveField)});globalThis.dispatchEvent?.(new Event('math2-local-save'));return result;}
export async function acceptSync(db,response){
 return transact(db,['records','ops','meta','dailyCompletions','goalTemplates','goalOverrides','practiceOps'],async tx=>{
  const rs=tx.objectStore('records'),os=tx.objectStore('ops'),ms=tx.objectStore('meta');
  const ds=tx.objectStore('dailyCompletions'),ts=tx.objectStore('goalTemplates'),gs=tx.objectStore('goalOverrides'),ps=tx.objectStore('practiceOps');
  const oldSync=await req(ms.get('sync'))||{},all=await req(os.getAll()),allPractice=await req(ps.getAll());
  if(response.stale){ms.put({...oldSync,stale:true,remoteEpoch:response.epoch},'sync');return;}
  for(const error of response.errors||[]){const op=all.find(o=>o.id===error.id);if(op){op.blocked=error.error;os.put(op);}}
  let changed;
  do{changed=false;for(const op of all)if(!op.blocked&&Object.values(op.changes||{}).some(c=>all.some(parent=>parent.id===c.base&&parent.blocked))){op.blocked='DEPENDENCY_BLOCKED';os.put(op);changed=true;}}while(changed);
  for(const error of response.practiceErrors||[]){const op=allPractice.find(o=>o.id===error.id);if(op){op.blocked=error.error;op.remote=error.current;ps.put(op);}}
  do{changed=false;for(const op of allPractice)if(!op.blocked&&allPractice.some(parent=>parent.id===op.baseRevision&&parent.blocked)){op.blocked='DEPENDENCY_BLOCKED';ps.put(op);changed=true;}}while(changed);
  for(const id of response.ack||[])os.delete(id);
  for(const id of response.practiceAck||[])ps.delete(id);
  const pending=all.filter(o=>!(response.ack||[]).includes(o.id)).sort((a,b)=>a.order-b.order);
  const practicePending=allPractice.filter(o=>!(response.practiceAck||[]).includes(o.id)).sort((a,b)=>a.order-b.order);
  const reset=oldSync.epoch&&oldSync.epoch!==response.epoch;
  if(reset&&(pending.length||practicePending.length)){ms.put({...oldSync,stale:true,remoteEpoch:response.epoch},'sync');return;}
  if(reset){
   if(response.restored!==true&&response.full!==true)throw Error('云端完整快照缺失，本机记录已保留');
   await req(rs.clear());await req(ds.clear());await req(ts.clear());await req(gs.clear());
  }else if(response.practiceFull===true){await req(ds.clear());await req(ts.clear());await req(gs.clear());}
  for(const cloud of response.records||[]){
   const old=await req(rs.get(cloud.id))||blank(cloud.id),next={...blank(cloud.id),...cloud,_bases:{},revision:(old.revision||0)+1};
   for(const op of pending.filter(o=>o.questionId===cloud.id))for(const [f,c]of Object.entries(op.changes)){next[f]=c.value;next._bases[f]=op.id;}
   rs.put(next);
  }
  for(const item of response.dailyCompletions||[])ds.put({...item,key:`${item.date}|${item.questionId}`,_base:null});
  for(const item of response.goalTemplates||[])ts.put({...item,_base:null});
  for(const item of response.goalOverrides||[])gs.put({...item,_base:null});
  for(const op of practicePending){
   if(op.blocked)continue;
   const p=op.payload;
   if(op.kind==='complete'||op.kind==='undo'){
    const key=`${p.date}|${p.questionId}`,old=await req(ds.get(key));
    ds.put({...old,...p,key,completed:op.kind==='complete',revision:old?.revision||0,_base:op.id});
   }else if(op.kind==='setGoalTemplate')ts.put({...p,createdAt:op.createdAt||new Date().toISOString(),revision:0,_base:op.id});
   else if(op.kind==='setGoalOverride')gs.put({...p,revision:(await req(gs.get(p.date)))?.revision||0,updatedAt:op.createdAt||new Date().toISOString(),_base:op.id});
  }
  if(response.positionAck&&(await req(ms.get('pendingPosition')))?.nonce===response.positionAck)ms.delete('pendingPosition');
  ms.put({epoch:response.epoch,cursor:response.seq,practiceCursor:response.practiceCursor??oldSync.practiceCursor??0,practiceEnabledFrom:response.practiceEnabledFrom??oldSync.practiceEnabledFrom,practiceCapability:response.capabilities?.practice??oldSync.practiceCapability??0,goalProtocol:response.capabilities?.goalProtocol??oldSync.goalProtocol??0,backupRecovery:response.capabilities?.backupRecovery??oldSync.backupRecovery??0,stale:false,position:response.position,positions:response.positions||oldSync.positions||{},lastSync:Date.now(),errors:[...pending,...practicePending].filter(o=>o.blocked).map(o=>({id:o.id,error:o.blocked}))},'sync');
 });
}
export async function importRecords(db,data,mode,expected){
 if(mode==='replace')throw Error('整库替换需要联网恢复');
 await transact(db,['records','ops','meta','dailyCompletions','goalTemplates','goalOverrides','practiceOps'],async tx=>{
  const rs=tx.objectStore('records'),ms=tx.objectStore('meta'),ds=tx.objectStore('dailyCompletions'),ts=tx.objectStore('goalTemplates'),gs=tx.objectStore('goalOverrides'),ps=tx.objectStore('practiceOps');
  const current=new Map((await req(rs.getAll())).map(r=>[r.id,r])),expectedRecords=expected?.records||expected;
  if(!expectedRecords||current.size!==expectedRecords.size||[...current].some(([id,r])=>r.revision!==expectedRecords.get(id)?.revision))throw Error('预览后记录已变化，请重新预览');
  if((await req(ms.get('maintenance')))?.expires>Date.now())throw Error('正在恢复');
  const sync=await req(ms.get('sync'))||{};if(!sync.epoch)throw Error('请先联网完成首次初始化，再导入备份');
  if(data.schemaVersion===3){
   if(!expected?.dailyCompletions||JSON.stringify(await req(ds.getAll()))!==JSON.stringify(expected.dailyCompletions)||JSON.stringify(await req(ts.getAll()))!==JSON.stringify(expected.goalTemplates)||JSON.stringify(await req(gs.getAll()))!==JSON.stringify(expected.goalOverrides)||JSON.stringify((await req(ps.getAll())).sort((a,b)=>a.order-b.order))!==JSON.stringify(expected.practiceOps))throw Error('预览后每日记录已变化，请重新预览');
   if(data.pendingPracticeOperations.length)throw Error('备份含待同步的每日操作，请先在原设备同步或解决冲突，然后重新导出备份');
   const localTemplates=await req(ts.getAll()),localOverrides=await req(gs.getAll());
   const sameGoal=(a,b)=>JSON.stringify([a.mode,a.planMode,a.effectiveFrom,a.tasks])===JSON.stringify([b.mode,b.planMode,b.effectiveFrom,b.tasks]);
   if(data.goalTemplates.some(t=>!localTemplates.some(x=>x.id===t.id&&sameGoal(x,t)))||data.goalOverrides.some(g=>!localOverrides.some(x=>x.date===g.date&&sameGoal(x,g))))throw Error('备份目标版本与本机不同；为避免改写历史，请先导出当前备份，再使用完整恢复');
   const localDaily=new Map((await req(ds.getAll())).map(x=>[x.key,x]));
   if(data.dailyCompletions.some(x=>localDaily.has(`${x.date}|${x.questionId}`)&&localDaily.get(`${x.date}|${x.questionId}`).completed!==x.completed))throw Error('同日同题的完成与撤销状态冲突；请在明细中核对后恢复');
  }
  let order=await req(ms.get('order'))||0;
  for(const r of data.records){const old=current.get(r.id)||blank(r.id),next=mergeRecord(current.get(r.id),r);enqueue(tx,old,next,sync,++order);}ms.put(order,'order');
  if(data.schemaVersion===3){
   let practiceOrder=await req(ms.get('practiceOrder'))||0;
   for(const item of data.dailyCompletions){
    const key=`${item.date}|${item.questionId}`;if(await req(ds.get(key))||!item.completed)continue;
    const id=randomId();ps.put({id,epoch:sync.epoch,kind:'complete',payload:{date:item.date,questionId:item.questionId,bankId:item.bankId,occurredAt:item.occurredAt,bankVersion:item.bankVersion,categoryIdsSnapshot:item.categoryIdsSnapshot},baseRevision:0,order:++practiceOrder});
    ds.put({...item,key,revision:0,_base:id});
   }
   ms.put(practiceOrder,'practiceOrder');
  }
 });
 globalThis.dispatchEvent?.(new Event('math2-local-save'));globalThis.dispatchEvent?.(new Event('math2-practice-change'));
}
export async function adoptRestoredCloud(db,response,expected){
 if(response?.full!==true||response.practiceFull!==true||typeof response.epoch!=='string'||!response.epoch||!Number.isSafeInteger(response.seq)||!Array.isArray(response.records)||!Array.isArray(response.dailyCompletions)||!Array.isArray(response.goalTemplates)||!Array.isArray(response.goalOverrides)||!expected)throw Error('云端完整快照或本机备份校验缺失，原记录已保留');
 const ids=new Set();for(const r of response.records){if(!r||!/^(?:cxyonly:\d+|lilin880:edition-[a-zA-Z0-9-]+:vol\d+:ch\d+:group\d+:(?:single_choice|fill_blank|essay):q\d+)$/.test(r.id)||ids.has(r.id))throw Error('云端快照无效，原记录已保留');ids.add(r.id);}
 validatePracticeBackup({...response,pendingPracticeOperations:[]});
 await transact(db,['records','ops','meta','dailyCompletions','goalTemplates','goalOverrides','practiceOps'],async tx=>{
  const rs=tx.objectStore('records'),os=tx.objectStore('ops'),ms=tx.objectStore('meta'),ds=tx.objectStore('dailyCompletions'),ts=tx.objectStore('goalTemplates'),gs=tx.objectStore('goalOverrides'),ps=tx.objectStore('practiceOps');
  const records=await req(rs.getAll()),ops=(await req(os.getAll())).sort((a,b)=>a.order-b.order),practiceOps=(await req(ps.getAll())).sort((a,b)=>a.order-b.order);
  if(records.length!==expected.records.size||records.some(r=>JSON.stringify(r)!==JSON.stringify(expected.records.get(r.id)))||JSON.stringify(ops)!==JSON.stringify(expected.ops)||JSON.stringify(practiceOps)!==JSON.stringify(expected.practiceOps)||JSON.stringify(await req(ds.getAll()))!==JSON.stringify(expected.dailyCompletions)||JSON.stringify(await req(ts.getAll()))!==JSON.stringify(expected.goalTemplates)||JSON.stringify(await req(gs.getAll()))!==JSON.stringify(expected.goalOverrides)||JSON.stringify(await req(ms.get('pendingPosition')))!==JSON.stringify(expected.pendingPosition)||JSON.stringify(await req(ms.get('sync'))||{})!==JSON.stringify(expected.sync))throw Error('备份后本机记录已变化，请重新导出并确认');
  await req(rs.clear());await req(os.clear());await req(ds.clear());await req(ts.clear());await req(gs.clear());await req(ps.clear());
  for(const r of response.records)await req(rs.put({...blank(r.id),...r,_bases:{},revision:(expected.records.get(r.id)?.revision||0)+1}));
  for(const x of response.dailyCompletions)await req(ds.put({...x,key:`${x.date}|${x.questionId}`,_base:null}));
  for(const x of response.goalTemplates)await req(ts.put({...x,_base:null}));
  for(const x of response.goalOverrides)await req(gs.put({...x,_base:null}));
  ms.delete('pendingPosition');ms.put({epoch:response.epoch,cursor:response.seq,practiceCursor:response.practiceCursor??response.seq,practiceCapability:response.capabilities?.practice??1,goalProtocol:response.capabilities?.goalProtocol??0,backupRecovery:response.capabilities?.backupRecovery??0,practiceEnabledFrom:response.practiceEnabledFrom,stale:false,position:response.position,positions:response.positions||{},lastSync:Date.now(),errors:[]},'sync');
 });
}

export function restoreGuard(snap){
 return JSON.stringify({records:[...snap.records.values()],ops:snap.ops,daily:snap.dailyCompletions,templates:snap.goalTemplates,overrides:snap.goalOverrides,practiceOps:snap.practiceOps,epoch:snap.sync.epoch,cursor:snap.sync.cursor,practiceCursor:snap.sync.practiceCursor,stale:snap.sync.stale});
}


