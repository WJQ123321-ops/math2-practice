import {randomId} from './compat.js';
import {req,transact,snapshot} from './storage.js';

const questionPattern=/^(?:cxyonly:\d+|lilin880:edition-[a-zA-Z0-9-]+:vol\d+:ch\d+:group\d+:(?:single_choice|fill_blank|essay):q\d+)$/;
const datePattern=/^\d{4}-\d{2}-\d{2}$/;
export const completionKey=(date,questionId)=>`${date}|${questionId}`;
export function chinaDate(value=new Date()){
 const date=value instanceof Date?value:new Date(value);
 if(!Number.isFinite(date.getTime()))throw Error('完成时间无效');
 return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
}
function checkDate(date){if(!datePattern.test(date)||chinaDate(`${date}T12:00:00+08:00`)!==date)throw Error('日期无效')}
function notify(){globalThis.dispatchEvent?.(new Event('math2-local-save'));globalThis.dispatchEvent?.(new Event('math2-practice-change'))}
async function ready(tx){
 const meta=tx.objectStore('meta');
 if((await req(meta.get('maintenance')))?.expires>Date.now())throw Error('正在恢复备份，请稍后保存');
 const sync=await req(meta.get('sync'))||{};
 if(!sync.epoch)throw Error('请先联网完成首次初始化');
 if(sync.practiceCapability!==1)throw Error('请先联网启用每日记录；现有学习记录仍可使用');
 if(sync.stale)throw Error('云端已恢复备份，请先处理旧修改');
 const order=(await req(meta.get('practiceOrder'))||0)+1;
 meta.put(order,'practiceOrder');
 return {meta,sync,order};
}
function putOp(tx,sync,order,kind,payload,baseRevision){
 const id=randomId();
 const goal=kind==='setGoalTemplate'||kind==='setGoalOverride';
 tx.objectStore('practiceOps').put({id,epoch:sync.epoch,kind,payload,baseRevision,order,...(goal?{goalProtocol:2,createdAt:new Date().toISOString()}:{})});
 return id;
}
export async function loadPractice(db){
 const data=await snapshot(db);
 return {dailyCompletions:data.dailyCompletions,goalTemplates:data.goalTemplates,goalOverrides:data.goalOverrides,pendingPracticeOps:data.practiceOps,featureEnabledFrom:data.sync.practiceEnabledFrom||'2026-09-26',featureReady:data.sync.practiceCapability===1};
}
export async function saveCompletion(db,{date,questionId,bankId,occurredAt,bankVersion,categoryIdsSnapshot=[]}){
 checkDate(date);
 if(!questionPattern.test(questionId)||!['exam','lilin880','yanxuan'].includes(bankId)||(bankId!=='lilin880')!==questionId.startsWith('cxyonly:'))throw Error('题号或题库无效');
 if(chinaDate(occurredAt)!==date)throw Error('完成日期和时间不一致');
 const value=await transact(db,['meta','dailyCompletions','practiceOps'],async tx=>{
  const {sync,order}=await ready(tx),store=tx.objectStore('dailyCompletions'),key=completionKey(date,questionId);
  const old=await req(store.get(key));
  if(old?.completed)return old;
  const payload={date,questionId,bankId,occurredAt,bankVersion,categoryIdsSnapshot:categoryIdsSnapshot.map(String)};
  const id=putOp(tx,sync,order,'complete',payload,old?._base??old?.revision??0);
  const next={...old,...payload,key,completed:true,_base:id,revision:old?.revision||0};store.put(next);return next;
 });
 notify();return value;
}
export async function undoCompletion(db,{date,questionId}){
 checkDate(date);if(!questionPattern.test(questionId))throw Error('题号无效');
 const value=await transact(db,['meta','dailyCompletions','practiceOps'],async tx=>{
  const {sync,order}=await ready(tx),store=tx.objectStore('dailyCompletions'),key=completionKey(date,questionId);
  const old=await req(store.get(key));if(!old?.completed)return old||null;
  const id=putOp(tx,sync,order,'undo',{date,questionId},old._base??old.revision??0);
  const next={...old,completed:false,_base:id};store.put(next);return next;
 });
 notify();return value;
}
export async function saveGoalTemplate(db,{effectiveFrom,mode,tasks}){
 checkDate(effectiveFrom);if(!['simple','scoped'].includes(mode)||!Array.isArray(tasks))throw Error('目标格式无效');
 const value=await transact(db,['meta','goalTemplates','practiceOps'],async tx=>{
  const {sync,order}=await ready(tx),store=tx.objectStore('goalTemplates'),all=await req(store.getAll());
  const prior=(await req(tx.objectStore('practiceOps').getAll())).filter(op=>op.kind==='setGoalTemplate'&&!op.blocked).sort((a,b)=>b.order-a.order)[0];
  const baseRevision=prior?.id??Math.max(0,...all.map(x=>x.revision||0)),id=randomId();
  const payload={id,effectiveFrom,mode,tasks};const opId=putOp(tx,sync,order,'setGoalTemplate',payload,baseRevision);
  const next={...payload,createdAt:new Date().toISOString(),revision:0,_base:opId};store.put(next);return next;
 });notify();return value;
}
export async function saveGoalOverride(db,{date,mode,planMode,tasks}){
 checkDate(date);if(!['custom','rest','default'].includes(mode)||mode==='custom'&&(!['simple','scoped'].includes(planMode)||!Array.isArray(tasks)))throw Error('当天目标格式无效');
 const value=await transact(db,['meta','goalOverrides','practiceOps'],async tx=>{
  const {sync,order}=await ready(tx),store=tx.objectStore('goalOverrides'),old=await req(store.get(date));
  const payload={date,mode,...(mode==='custom'?{planMode,tasks}:{} )};
  const id=putOp(tx,sync,order,'setGoalOverride',payload,old?._base??old?.revision??0);
  const next={...payload,revision:old?.revision||0,updatedAt:new Date().toISOString(),_base:id};store.put(next);return next;
 });notify();return value;
}
export async function resolvePracticeConflict(db,id,choice){
 if(!['cloud','local'].includes(choice))throw Error('冲突处理方式无效');
 await transact(db,['meta','dailyCompletions','goalTemplates','goalOverrides','practiceOps'],async tx=>{
  const sync=await req(tx.objectStore('meta').get('sync'))||{};
  if(sync.stale)throw Error('云端已恢复备份，请先处理旧修改');
  const ops=tx.objectStore('practiceOps'),all=(await req(ops.getAll())).sort((a,b)=>a.order-b.order),root=all.find(op=>op.id===id);
  if(!root?.blocked)throw Error('待处理冲突已变化，请刷新后重试');
  const affected=new Set([id]);let more;
  do{more=false;for(const op of all)if(!affected.has(op.id)&&affected.has(op.baseRevision)){affected.add(op.id);more=true;}}while(more);
  if(choice==='cloud'){
   for(const op of all)if(affected.has(op.id))ops.delete(op.id);
   return;
  }
  if(root.blocked!=='PRACTICE_CONFLICT')throw Error('这条操作无法直接重试；请导出备份并核对错误原因');
  root.baseRevision=root.remote?.revision||0;
  for(const op of all)if(affected.has(op.id)){
   if(op.id===root.id||['DEPENDENCY_BLOCKED','DEPENDENCY_MISSING'].includes(op.blocked)){delete op.blocked;delete op.remote;ops.put(op);}
  }
  const ds=tx.objectStore('dailyCompletions'),ts=tx.objectStore('goalTemplates'),gs=tx.objectStore('goalOverrides');
  for(const op of all)if(affected.has(op.id)){
   const p=op.payload;
   if(op.kind==='complete'||op.kind==='undo'){
    const key=completionKey(p.date,p.questionId),old=await req(ds.get(key));
    ds.put({...old,...p,key,completed:op.kind==='complete',revision:old?.revision||0,_base:op.id});
   }else if(op.kind==='setGoalTemplate')ts.put({...p,createdAt:new Date().toISOString(),revision:0,_base:op.id});
   else if(op.kind==='setGoalOverride')gs.put({...p,revision:(await req(gs.get(p.date)))?.revision||0,updatedAt:new Date().toISOString(),_base:op.id});
  }
 });notify();
}
