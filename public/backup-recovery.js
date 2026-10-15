import {validateBackup,validatePracticeBackup,mergeRecord} from './core.js';
import {chinaDate} from './daily-data.js';

const emptyPractice=()=>({dailyCompletions:[],goalTemplates:[],goalOverrides:[],pendingPracticeOperations:[]});
const keyOf=x=>`${x.date}|${x.questionId}`;
const sameGoal=(a,b)=>JSON.stringify([a?.mode,a?.planMode,a?.effectiveFrom,a?.tasks])===JSON.stringify([b?.mode,b?.planMode,b?.effectiveFrom,b?.tasks]);
const sameDaily=(a,b)=>!!a?.completed===!!b?.completed;
const goalId=/^[a-zA-Z0-9_-]{6,100}$/;
const opId=/^[a-zA-Z0-9_-]{10,100}$/;
const validDate=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
function checkItem(key,item,start){
 const result=validatePracticeBackup({...emptyPractice(),[key]:[item]})[key][0];
 const date=result.date||result.effectiveFrom;
 if(date<start)throw Error('日期早于每日记录功能启用日');
 if(key==='dailyCompletions'){
  if(date>chinaDate(Date.now())||new Date(result.occurredAt).toISOString()!==result.occurredAt||chinaDate(result.occurredAt)!==date||Date.parse(result.occurredAt)>Date.now()+300000||!result.bankVersion||result.bankVersion.length>200||(result.bankId!=='lilin880')!==result.questionId.startsWith('cxyonly:')||result.categoryIdsSnapshot.length>50)throw Error('每日记录日期、题库或范围无效');
 }else{
  const mode=key==='goalTemplates'?result.mode:result.planMode;
  if(key==='goalTemplates'&&!goalId.test(result.id)||result.mode==='custom'&&!['simple','scoped'].includes(mode))throw Error('目标标识或模式无效');
  if(key==='goalTemplates'||result.mode==='custom'){
   const used=new Set(),ids=new Set();
   if(mode==='simple'&&result.tasks.length!==1)throw Error('简单目标只能有一项任务');
   for(const task of result.tasks){
    if(!goalId.test(task.taskId)||ids.has(task.taskId)||!task.bankVersion||task.bankVersion.length>200||task.scopeQuestionIds.length>10000||task.targetCount>task.scopeQuestionIds.length||task.categoryIds.length>50||task.scopeLabels.length>50||task.scopeLabels.some(s=>s.length>200)||mode==='simple'&&(task.bankId!=='all'||task.categoryIds.length)||mode==='scoped'&&(task.bankId==='all'||!task.categoryIds.length))throw Error('目标任务范围无效');
    ids.add(task.taskId);
    for(const id of task.scopeQuestionIds){if(used.has(id)||task.bankId!=='all'&&(task.bankId!=='lilin880')!==id.startsWith('cxyonly:'))throw Error('目标范围重复或题库不一致');used.add(id)}
   }
  }
 }
 return result;
}
// Retain valid independent items and explain every exclusion. Never modify the input file.
export function normalizeRecoveryBackup(raw,start='2026-09-26'){
 const base=validateBackup({...raw,schemaVersion:raw?.schemaVersion===3?2:raw?.schemaVersion});
 if(raw.schemaVersion!==3)throw Error('此恢复入口用于包含每日记录的新版备份');
 const issues=[],data={...base,schemaVersion:3,...emptyPractice()},limits={dailyCompletions:100000,goalTemplates:2000,goalOverrides:20000,pendingPracticeOperations:100000};
 for(const [key,limit]of Object.entries(limits))if(!Array.isArray(raw[key])||raw[key].length>limit)throw Error('每日记录备份结构错误或过大');
 const forced=new Set(),seen={dailyCompletions:new Set(),goalTemplates:new Set(),goalOverrides:new Set()};
 for(const key of Object.keys(seen))for(const [i,item]of raw[key].entries()){
  try{const value=checkItem(key,item,start),id=key==='dailyCompletions'?keyOf(value):key==='goalTemplates'?value.id:value.date;if(seen[key].has(id))throw Error('重复项目');seen[key].add(id);data[key].push(value)}
  catch(e){issues.push({label:`${key} 第 ${i+1} 项`,reason:e.message})}
 }
 const daily=new Map(data.dailyCompletions.map(x=>[keyOf(x),x])),templates=new Map(data.goalTemplates.map(x=>[x.id,x])),overrides=new Map(data.goalOverrides.map(x=>[x.date,x]));
 const operations=[...raw.pendingPracticeOperations].sort((a,b)=>(a?.order||0)-(b?.order||0)),processed=new Map(),orders=new Set();
 for(const [i,op]of operations.entries()){
  try{
   if(!op||!opId.test(op.id||'')||processed.has(op.id)||typeof op.epoch!=='string'||!op.epoch||!Number.isSafeInteger(op.order)||op.order<1||orders.has(op.order)||!op.payload||typeof op.payload!=='object'||Array.isArray(op.payload)||!['complete','undo','setGoalTemplate','setGoalOverride'].includes(op.kind)||!(Number.isSafeInteger(op.baseRevision)&&op.baseRevision>=0||typeof op.baseRevision==='string'))throw Error('操作标识、顺序、依赖或类型无效');
   orders.add(op.order);
   const p=op.payload,key=op.kind==='setGoalTemplate'?'template':op.kind==='setGoalOverride'?`override:${p.date}`:`daily:${keyOf(p)}`;
   const parent=typeof op.baseRevision==='string'?processed.get(op.baseRevision):null;
   if(parent&&(parent.invalid||parent.key!==key))throw Error('依赖操作无法处理或对象不一致');
   let value;
   if(op.kind==='complete')value=checkItem('dailyCompletions',{...p,completed:true,revision:0,categoryIdsSnapshot:p.categoryIdsSnapshot||[]},start);
   else if(op.kind==='undo'){
    if(!validDate(p.date)||p.date<start||p.date>chinaDate(Date.now())||typeof p.questionId!=='string')throw Error('撤销日期或题号无效');
    const prior=daily.get(keyOf(p));if(!prior)throw Error('撤销缺少可恢复的完成记录');value=checkItem('dailyCompletions',{...prior,completed:false},start);
   }else if(op.kind==='setGoalTemplate')value={...checkItem('goalTemplates',{...p,revision:0,createdAt:op.createdAt||templates.get(p.id)?.createdAt},start),_recoveryOrder:op.order};
   else value=checkItem('goalOverrides',{...p,revision:0,updatedAt:op.createdAt||overrides.get(p.date)?.updatedAt},start);
   if(op.kind==='complete'||op.kind==='undo')daily.set(keyOf(value),value);else if(op.kind==='setGoalTemplate')templates.set(value.id,value);else overrides.set(value.date,value);
   if(op.blocked||typeof op.baseRevision==='string'&&!parent||raw.sync?.epoch&&op.epoch!==raw.sync.epoch)forced.add(op.kind==='setGoalTemplate'?`template:${value.effectiveFrom}`:key);
   processed.set(op.id,{key});data.pendingPracticeOperations.push(op);
  }catch(e){if(op?.id)processed.set(op.id,{invalid:true});issues.push({label:`操作 ${op?.id||i+1}`,reason:e.message})}
 }
 data.dailyCompletions=[...daily.values()];data.goalTemplates=[...templates.values()];data.goalOverrides=[...overrides.values()];
 return {data,issues,forced,operationCount:raw.pendingPracticeOperations.length};
}
function templateGroups(items){const groups=new Map();for(const x of items){const list=groups.get(x.effectiveFrom)||[];list.push(x);groups.set(x.effectiveFrom,list)}return groups}
function orderedGoals(items){return [...items].sort((a,b)=>!!a._recoveryOrder-!!b._recoveryOrder||(a._recoveryOrder||a.revision)-(b._recoveryOrder||b.revision))}
function uncertain(items){const synced=items.filter(x=>!x._recoveryOrder),rev=new Set();return synced.some(x=>!x.revision||rev.has(x.revision)||(rev.add(x.revision),false))}
export function previewRecovery(raw,cloud,mode='merge'){
 if(!['merge','replace'].includes(mode)||!cloud?.full||!cloud.practiceFull)throw Error('请联网取得完整云端预览');
 const normalized=normalizeRecoveryBackup(raw,cloud.practiceEnabledFrom||'2026-09-26'),{data,issues,forced}=normalized,conflicts=[];
 const conflict=(id,label,options)=>{conflicts.push({id,label,options});return id};
 const entries={daily:[],overrides:[],templates:[]};
 for(const [type,source,remote,keyFn,equal,prefix]of [
  ['daily',data.dailyCompletions,cloud.dailyCompletions,keyOf,sameDaily,'daily'],
  ['overrides',data.goalOverrides,cloud.goalOverrides,x=>x.date,sameGoal,'override']
 ]){
  const local=new Map(source.map(x=>[keyFn(x),x])),online=new Map(remote.map(x=>[keyFn(x),x]));
  for(const key of new Set([...local.keys(),...online.keys()])){
   const b=local.get(key),c=online.get(key),id=`${prefix}:${key}`;
   if((b&&c&&!equal(b,c))||forced.has(id)){
    conflict(id,`${type==='daily'?'做题记录':'单日目标'} ${key}：备份与云端不同或操作已阻塞`,[{id:'cloud',label:'保留云端',value:c||null},{id:'backup',label:'采用备份',value:b||null}]);entries[type].push({conflict:id});
   }else{const value=mode==='replace'?b:(c||b);if(value)entries[type].push({value})}
  }
 }
 const bg=templateGroups(data.goalTemplates),cg=templateGroups(cloud.goalTemplates),sameEpoch=!!data.sync?.epoch&&data.sync.epoch===cloud.epoch;
 // Identity disagreements are explicit even if the effective dates also differ.
 const cloudIds=new Map(cloud.goalTemplates.map(x=>[x.id,x])),identity=new Map();
 for(const b of data.goalTemplates){const c=cloudIds.get(b.id);if(c&&!sameGoal(b,c)&&b.effectiveFrom!==c.effectiveFrom){const id=`template-id:${b.id}`;identity.set(b.id,id);conflict(id,`默认目标 ${b.id}：同一标识的内容和生效日不同`,[{id:'cloud',label:`采用云端（${c.effectiveFrom}）`,value:c},{id:'backup',label:`采用备份（${b.effectiveFrom}）`,value:b}])}}
 for(const date of new Set([...bg.keys(),...cg.keys()])){
  const b=orderedGoals((bg.get(date)||[]).filter(x=>!identity.has(x.id))),c=orderedGoals((cg.get(date)||[]).filter(x=>!identity.has(x.id))),id=`template:${date}`;
  const diff=b.some(x=>c.some(y=>x.id===y.id&&!sameGoal(x,y))),shared=b.every(x=>c.some(y=>x.id===y.id&&sameGoal(x,y)))&&c.every(x=>b.some(y=>x.id===y.id&&sameGoal(x,y)));
  const differentPriority=shared&&b.length&&c.length&&b.at(-1).id!==c.at(-1).id;
  if(uncertain(b)||forced.has(id)||diff||differentPriority||b.length&&c.length&&!sameEpoch&&!shared||b.some(x=>x._recoveryOrder)&&c.length){
   const options=[{id:'cloud',label:'保留云端该日版本',value:c}];
   if(uncertain(b))for(const x of b)options.push({id:x.id,label:`采用备份版本 ${x.id}：${describeGoal(x)}`,value:[...b.filter(y=>y!==x),x]});
   else options.push({id:'backup',label:'采用备份该日版本',value:b});
   conflict(id,`默认目标从 ${date} 生效：需确认该日优先版本`,options);entries.templates.push({conflict:id});
  }else{
   const value=mode==='replace'?b:orderedGoals([...new Map([...c,...b].map(x=>[x.id,x])).values()]);if(value.length)entries.templates.push({value});
  }
 }
 for(const id of identity.values())entries.templates.push({identity:id});
 const records=new Map((mode==='merge'?cloud.records:[]).map(x=>[x.id,x]));for(const r of data.records)records.set(r.id,mode==='merge'?mergeRecord(records.get(r.id),r):r);
 const recordConflicts=data.records.filter(r=>cloud.records.some(c=>c.id===r.id&&['note','status','favorite','wrong'].some(f=>JSON.stringify(c[f])!==JSON.stringify(r[f])))).length;
 return {data,cloud,mode,issues,conflicts,entries,records:[...records.values()],operationCount:normalized.operationCount,summary:{records:data.records.length,recordConflicts,daily:data.dailyCompletions.length,templates:data.goalTemplates.length,overrides:data.goalOverrides.length,addedDaily:data.dailyCompletions.filter(x=>!cloud.dailyCompletions.some(c=>keyOf(c)===keyOf(x))).length,removedDaily:mode==='replace'?cloud.dailyCompletions.filter(x=>!data.dailyCompletions.some(b=>keyOf(b)===keyOf(x))).length:0,removedRecords:mode==='replace'?cloud.records.filter(x=>!data.records.some(b=>b.id===x.id)).length:0,removedGoals:mode==='replace'?cloud.goalTemplates.filter(x=>!data.goalTemplates.some(b=>b.id===x.id)).length+cloud.goalOverrides.filter(x=>!data.goalOverrides.some(b=>b.date===x.date)).length:0}};
}
export function describeGoal(x){return !x?'无目标':x.mode==='rest'?'不设目标':x.mode==='default'?'使用默认计划':(x.tasks||[]).map(t=>`${t.scopeLabels?.join(' / ')||t.bankId} ${t.targetCount} 题`).join('；')}
export function finishRecovery(plan,choices,allowPartial=false){
 if(plan.issues.length&&!allowPartial)throw Error('请核对无法处理的项目并确认仅恢复可用内容');
 const selected=new Map();for(const c of plan.conflicts){const option=c.options.find(x=>x.id===choices[c.id]);if(!option)throw Error('请逐项选择冲突处理方式');selected.set(c.id,option.value)}
 const values=type=>plan.entries[type].flatMap(e=>{const v=e.conflict?selected.get(e.conflict):e.identity?selected.get(e.identity):e.value;return v==null?[]:Array.isArray(v)?v:[v]});
 const templates=values('templates').sort((a,b)=>a.effectiveFrom.localeCompare(b.effectiveFrom));
 if(new Set(templates.map(x=>x.id)).size!==templates.length)throw Error('目标标识仍有冲突，请重新预览');
 return {app:'math2-practice',schemaVersion:3,bankVersion:plan.data.bankVersion,recoveryVersion:1,records:plan.records,dailyCompletions:values('daily'),goalTemplates:templates.map((x,i)=>{const {_recoveryOrder,...value}=x;return {...value,restoreOrder:i+1}}),goalOverrides:values('overrides'),pendingPracticeOperations:[],position:plan.data.position,bankPositions:plan.data.bankPositions};
}

export function verifyRestoredSnapshot(data,response){
 if(!response?.full||!response.practiceFull||!Number.isSafeInteger(response.seq)||!Number.isSafeInteger(response.practiceCursor))throw Error('云端完整恢复快照缺失');
 validatePracticeBackup({...response,pendingPracticeOperations:[]});
 const fields=['note','status','favorite','wrong','noteConflicts','contentHash','conflicts'];
 const records=new Map(response.records.map(x=>[x.id,x]));
 if(records.size!==response.records.length||records.size!==data.records.length||data.records.some(x=>fields.some(f=>JSON.stringify(x[f]??(f==='conflicts'?{}:f==='noteConflicts'?[]:undefined))!==JSON.stringify(records.get(x.id)?.[f]??(f==='conflicts'?{}:f==='noteConflicts'?[]:undefined)))))throw Error('云端学习记录与确认结果不一致');
 if(data.schemaVersion!==3)return;
 for(const [key,id,equal]of [['dailyCompletions',keyOf,(a,b)=>!!b&&a.completed===b.completed&&a.occurredAt===b.occurredAt&&a.bankId===b.bankId&&a.bankVersion===b.bankVersion&&JSON.stringify(a.categoryIdsSnapshot)===JSON.stringify(b.categoryIdsSnapshot)],['goalTemplates',x=>x.id,sameGoal],['goalOverrides',x=>x.date,sameGoal]]){
  const received=new Map(response[key].map(x=>[id(x),x]));if(received.size!==data[key].length||data[key].some(x=>!received.has(id(x))||!equal(x,received.get(id(x)))))throw Error('云端每日记录或目标与确认结果不一致');
 }
 const byDate=templateGroups(response.goalTemplates);
 for(const [date,items]of templateGroups(data.goalTemplates)){const expected=[...items].sort((a,b)=>a.restoreOrder-b.restoreOrder).at(-1),actual=orderedGoals(byDate.get(date)||[]).at(-1);if(expected.id!==actual?.id)throw Error('云端目标优先级与确认结果不一致')}
}
