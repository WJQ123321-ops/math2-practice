import {cloneData,randomId} from './compat.js';
import {removedQuestionIds} from './question-policy.js';
export const states=['new','learning','mastered'];
export const blank=id=>({id,status:'new',favorite:false,wrong:false,note:'',noteConflicts:[],updatedAt:'1970-01-01T00:00:00.000Z',revision:0,contentHash:''});
export function indexBank(bank){
 if(bank.schemaVersion!==1||!Array.isArray(bank.questions)||!Array.isArray(bank.categories))throw Error('题库格式不兼容');
 const retired=new Set(removedQuestionIds),activeQuestions=bank.questions.filter(q=>!retired.has(q.id)),archivedQuestions=[...(bank.archivedQuestions||[]),...bank.questions.filter(q=>retired.has(q.id))],archivedIds=new Set(archivedQuestions.map(q=>q.id));
 const byId=new Map(),nodes=new Map(bank.categories.map(c=>[String(c.id),{...c,id:String(c.id),parent_id:c.parent_id==null?null:String(c.parent_id),children:[],ids:new Set()}]));
 for(const n of nodes.values()){if(n.parent_id){if(!nodes.has(n.parent_id))throw Error('缺少父分类');nodes.get(n.parent_id).children.push(n)}}
 const order=(a,b)=>(a.display_order??0)-(b.display_order??0)||a.id.localeCompare(b.id,undefined,{numeric:true});
 const roots=[...nodes.values()].filter(n=>!n.parent_id).sort(order);const ranks=new Map();
 function walk(n,anc=new Set()){if(anc.has(n.id))throw Error('分类循环');ranks.set(n.id,ranks.size);n.children.sort(order).forEach(c=>walk(c,new Set([...anc,n.id])))}roots.forEach(n=>walk(n));if(ranks.size!==nodes.size)throw Error('分类循环');
 for(const q of [...activeQuestions,...archivedQuestions]){if(!/^(?:cxyonly:\d+|lilin880:edition-[a-zA-Z0-9-]+:vol\d+:ch\d+:group\d+:(?:single_choice|fill_blank|essay):q\d+)$/.test(q.id)||byId.has(q.id)||q.id==='cxyonly:10791'||(q.id.startsWith('cxyonly:')&&(q.bankId||'exam')==='exam'&&(!Number.isInteger(q.year)||q.year>2008||q.year<1900)))throw Error('非法题号、重复题或年份超范围');if(!q.document?.stem_md||!q.categoryIds.length)throw Error('缺少题干或分类');byId.set(q.id,q);if(archivedIds.has(q.id))continue;for(const id of q.categoryIds){let n=nodes.get(String(id));if(!n)throw Error('题目分类不存在');while(n){n.ids.add(q.id);n=nodes.get(n.parent_id)}}}
 const rank=q=>Math.min(...q.categoryIds.map(id=>ranks.get(String(id))));
 const questions=[...activeQuestions].sort((a,b)=>rank(a)-rank(b)||(a.serial??Number.MAX_SAFE_INTEGER)-(b.serial??Number.MAX_SAFE_INTEGER)||a.id.localeCompare(b.id,undefined,{numeric:true}));
 return {byId,nodes,roots,questions,archivedQuestions,archivedIds};
}
export function filterQuestions(index,records,state){const historical=['favorite','wrong','history'].includes(state.view)?index.archivedQuestions||[]:[];return [...(state.view==='history'?[]:index.questions),...historical].filter(q=>{const r=records.get(q.id)||blank(q.id);return(state.view!=='history'||records.has(q.id))&&(!state.bankId||(q.bankId||'exam')===state.bankId)&&(!state.search||String(q.originalNumber||q.id.split(':')[1])===state.search.trim())&&(!state.category||index.nodes.get(String(state.category))?.ids.has(q.id)||historical.includes(q)&&q.categoryIds.some(id=>{let node=index.nodes.get(String(id));while(node){if(node.id===String(state.category))return true;node=index.nodes.get(node.parent_id)}return String(id)===String(state.category)}))&&(!state.year||q.year===Number(state.year))&&(!state.type||q.type===state.type)&&(!state.status||r.status===state.status)&&(state.view!=='favorite'||r.favorite)&&(state.view!=='wrong'||r.wrong)})}
export function validatePosition(p){if(!p||typeof p!=='object'||Array.isArray(p))throw Error('最近位置格式错误');if(!['all','favorite','wrong','history'].includes(p.view)||typeof p.category!=='string'||typeof p.year!=='string'||typeof p.type!=='string'||typeof p.status!=='string'||(p.status&&!states.includes(p.status))||typeof p.current!=='string'||!Array.isArray(p.expanded)||p.expanded.some(x=>typeof x!=='string'))throw Error('最近位置字段错误');if(p.bankId&&!['exam','lilin880','yanxuan'].includes(p.bankId))throw Error('题库分区无效');return {bankId:p.bankId||(p.current.startsWith('lilin880:')?'lilin880':'exam'),search:typeof p.search==='string'?p.search:'',view:p.view,category:p.category,year:p.year,type:p.type,status:p.status,current:p.current,expanded:p.expanded}}
export function validateBackup(data){
 if(!data||data.app!=='math2-practice'||![1,2,3].includes(data.schemaVersion))throw Error('备份来源或版本不兼容，未写入任何记录');if(typeof data.bankVersion!=='string'||!Array.isArray(data.records)||data.records.length>100000)throw Error('备份结构错误');
 const seen=new Set();const records=data.records.map(r=>{if(!r||!/^(?:cxyonly:\d+|lilin880:edition-[a-zA-Z0-9-]+:vol\d+:ch\d+:group\d+:(?:single_choice|fill_blank|essay):q\d+)$/.test(r.id)||seen.has(r.id)||!states.includes(r.status)||typeof r.favorite!=='boolean'||typeof r.wrong!=='boolean'||typeof r.note!=='string'||r.note.length>2000000||typeof r.updatedAt!=='string'||!Number.isFinite(Date.parse(r.updatedAt))||typeof r.contentHash!=='string'||!Array.isArray(r.noteConflicts)||r.noteConflicts.some(n=>typeof n!=='string')||!Number.isSafeInteger(r.revision)||r.revision<0)throw Error('记录格式错误或题号重复');if(r.conflicts&&(typeof r.conflicts!=='object'||Array.isArray(r.conflicts)||Object.entries(r.conflicts).some(([f,a])=>!['note','status','favorite','wrong'].includes(f)||!Array.isArray(a)||a.some(v=>!v||typeof v.id!=='string'||(f==='note'?typeof v.value!=='string':f==='status'?!states.includes(v.value):typeof v.value!=='boolean')))))throw Error('冲突记录格式错误');seen.add(r.id);return {...blank(r.id),id:r.id,status:r.status,favorite:r.favorite,wrong:r.wrong,note:r.note,noteConflicts:[...new Set(r.noteConflicts)],updatedAt:r.updatedAt,contentHash:r.contentHash,revision:r.revision,conflicts:r.conflicts||{}}});
 const bankPositions={};for(const [k,p] of Object.entries(data.bankPositions||{})){if(!['exam','lilin880','yanxuan'].includes(k))throw Error('备份分区无效');bankPositions[k]=validatePosition(p);}
 const practice=data.schemaVersion===3?validatePracticeBackup(data):{};
 return {...data,...practice,bankPositions,records,position:data.position==null?null:validatePosition(data.position)};
}
export function validatePracticeBackup(data){
 const id=/^(?:cxyonly:\d+|lilin880:edition-[a-zA-Z0-9-]+:vol\d+:ch\d+:group\d+:(?:single_choice|fill_blank|essay):q\d+)$/;
 const date=/^\d{4}-\d{2}-\d{2}$/;
 const validDate=x=>typeof x==='string'&&date.test(x)&&Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
 const arrays=['dailyCompletions','goalTemplates','goalOverrides','pendingPracticeOperations'];
 for(const key of arrays)if(!Array.isArray(data[key]))throw Error('每日记录备份结构错误');
 if(data.dailyCompletions.length>100000||data.goalTemplates.length>2000||data.goalOverrides.length>20000||data.pendingPracticeOperations.length>100000)throw Error('每日记录备份过大');
 const seen=new Set(),dailyCompletions=data.dailyCompletions.map(x=>{
  if(!x||!validDate(x.date)||!id.test(x.questionId||'')||!['exam','lilin880','yanxuan'].includes(x.bankId)||typeof x.completed!=='boolean'||typeof x.occurredAt!=='string'||!Number.isFinite(Date.parse(x.occurredAt))||!Number.isSafeInteger(x.revision)||x.revision<0||!Array.isArray(x.categoryIdsSnapshot)||x.categoryIdsSnapshot.some(c=>typeof c!=='string'))throw Error('每日完成项无效');
  const key=x.date+'|'+x.questionId;if(seen.has(key))throw Error('同日同题重复');seen.add(key);
  return {date:x.date,questionId:x.questionId,bankId:x.bankId,completed:x.completed,occurredAt:x.occurredAt,receivedAt:x.receivedAt||null,categoryIdsSnapshot:x.categoryIdsSnapshot,bankVersion:String(x.bankVersion||''),revision:x.revision};
 });
 const checkTasks=tasks=>{if(!Array.isArray(tasks)||tasks.length<1||tasks.length>30)throw Error('目标任务无效');return tasks.map(t=>{if(!t||typeof t.taskId!=='string'||!['all','exam','lilin880','yanxuan'].includes(t.bankId)||!Array.isArray(t.categoryIds)||t.categoryIds.some(c=>typeof c!=='string')||!Number.isInteger(t.targetCount)||t.targetCount<1||t.targetCount>999||!Array.isArray(t.scopeQuestionIds)||t.scopeQuestionIds.some(q=>!id.test(q))||!Array.isArray(t.scopeLabels))throw Error('目标任务无效');return {taskId:t.taskId,bankId:t.bankId,categoryIds:t.categoryIds,targetCount:t.targetCount,scopeQuestionIds:t.scopeQuestionIds,bankVersion:String(t.bankVersion||''),scopeLabels:t.scopeLabels.map(String)};});};
 const templateIds=new Set(),goalTemplates=data.goalTemplates.map(x=>{if(!x||typeof x.id!=='string'||templateIds.has(x.id)||!validDate(x.effectiveFrom)||!['simple','scoped'].includes(x.mode)||!Number.isSafeInteger(x.revision)||x.revision<0)throw Error('默认目标版本无效');templateIds.add(x.id);return {id:x.id,effectiveFrom:x.effectiveFrom,mode:x.mode,tasks:checkTasks(x.tasks),revision:x.revision,createdAt:x.createdAt};});
 const overrideDates=new Set(),goalOverrides=data.goalOverrides.map(x=>{if(!x||!validDate(x.date)||overrideDates.has(x.date)||!['custom','rest','default'].includes(x.mode)||!Number.isSafeInteger(x.revision)||x.revision<0)throw Error('单日目标无效');overrideDates.add(x.date);return {date:x.date,mode:x.mode,...(x.mode==='custom'?{planMode:x.planMode,tasks:checkTasks(x.tasks)}:{tasks:[]}),revision:x.revision,updatedAt:x.updatedAt};});
 const pendingPracticeOperations=data.pendingPracticeOperations.map(x=>{if(!x||typeof x.id!=='string'||typeof x.epoch!=='string'||!['complete','undo','setGoalTemplate','setGoalOverride'].includes(x.kind)||!x.payload||typeof x.payload!=='object')throw Error('待同步每日操作无效');return x;});
 return {dailyCompletions,goalTemplates,goalOverrides,pendingPracticeOperations};
}
export function mergeRecord(a,b){if(!a)return b;const conflicts=cloneData(a.conflicts||{});for(const [f,variants]of Object.entries(b.conflicts||{}))conflicts[f]=[...new Map([...(conflicts[f]||[]),...variants].map(v=>[JSON.stringify(v.value),v])).values()];for(const f of ['note','status','favorite','wrong'])if(JSON.stringify(a[f])!==JSON.stringify(b[f])){const variants=conflicts[f]||[];if(!variants.some(v=>JSON.stringify(v.value)===JSON.stringify(b[f])))variants.push({id:'import-'+randomId(),value:b[f]});conflicts[f]=variants;}return {...a,conflicts,noteConflicts:[...new Set([...(a.noteConflicts||[]),...(b.noteConflicts||[]),...(a.note!==b.note?[b.note]:[])])].filter(s=>s&&s!==a.note)}}
export function previewImport(incoming,records,index){return {matched:incoming.records.filter(r=>index.byId.has(r.id)).length,added:incoming.records.filter(r=>!records.has(r.id)).length,conflicts:incoming.records.filter(r=>records.has(r.id)&&JSON.stringify(records.get(r.id))!==JSON.stringify(r)).length,unknown:incoming.records.filter(r=>!index.byId.has(r.id)).length,notes:incoming.records.filter(r=>r.note||r.noteConflicts.length).length}}
export function orderedExportGoals(goals,ops=[]){
 const order=new Map(ops.filter(x=>x.kind==='setGoalTemplate').map(x=>[x.payload.id,x.order]));
 return [...goals].sort((a,b)=>!!order.get(a.id)-!!order.get(b.id)||(order.get(a.id)||a.revision)-(order.get(b.id)||b.revision)||a.id.localeCompare(b.id));
}
export function mergeBackupForRestore(incoming,preview){
 if(incoming?.schemaVersion!==3||!preview?.full||!preview.practiceFull||!Array.isArray(preview.records)||!Array.isArray(preview.dailyCompletions)||!Array.isArray(preview.goalTemplates)||!Array.isArray(preview.goalOverrides))throw Error('云端完整预览缺失，无法安全合并新版备份');
 if(incoming.pendingPracticeOperations.length)throw Error('备份含待同步的每日操作，请先在原设备同步或解决冲突，然后重新导出备份');
 const records=new Map(preview.records.map(r=>[r.id,r]));
 for(const item of incoming.records)records.set(item.id,mergeRecord(records.get(item.id),item));
 const daily=new Map(preview.dailyCompletions.map(x=>[x.date+'|'+x.questionId,x]));
 for(const item of incoming.dailyCompletions){
  const key=item.date+'|'+item.questionId,old=daily.get(key);
  if(old&&old.completed!==item.completed)throw Error(`每日记录 ${item.date} / ${item.questionId} 的完成与撤销状态冲突，请在明细中核对`);
  if(!old)daily.set(key,item);
 }
 const sameGoal=(a,b)=>JSON.stringify([a.mode,a.planMode,a.effectiveFrom,a.tasks])===JSON.stringify([b.mode,b.planMode,b.effectiveFrom,b.tasks]);
 const templates=new Map(preview.goalTemplates.map(x=>[x.id,x]));
 for(const item of incoming.goalTemplates){const old=templates.get(item.id);if(old&&!sameGoal(old,item))throw Error(`默认目标版本 ${item.id} 与云端冲突，请核对`);if(!old)templates.set(item.id,item);}
 const sameEpoch=!!incoming.sync?.epoch&&incoming.sync.epoch===preview.epoch;
 for(const date of new Set(incoming.goalTemplates.map(x=>x.effectiveFrom))){
  const local=incoming.goalTemplates.filter(x=>x.effectiveFrom===date),remote=preview.goalTemplates.filter(x=>x.effectiveFrom===date),versions=new Set();
  if(local.some(x=>!Number.isSafeInteger(x.revision)||x.revision<=0||versions.has(x.revision)||(versions.add(x.revision),false)))throw Error('默认目标优先级不明，请逐项预览并选择');
  if(remote.length&&!sameEpoch&&local.some(x=>!remote.some(y=>y.id===x.id&&sameGoal(x,y))))throw Error('不同备份的同日目标顺序冲突，请逐项预览并选择');
 }
 const overrides=new Map(preview.goalOverrides.map(x=>[x.date,x]));
 for(const item of incoming.goalOverrides){const old=overrides.get(item.date);if(old&&!sameGoal(old,item))throw Error(`${item.date} 的单日目标与云端冲突，请核对`);if(!old)overrides.set(item.date,item);}
 return {app:'math2-practice',schemaVersion:3,recoveryVersion:1,bankVersion:incoming.bankVersion,records:[...records.values()],dailyCompletions:[...daily.values()],goalTemplates:[...templates.values()].sort((a,b)=>a.effectiveFrom.localeCompare(b.effectiveFrom)||(a.revision||0)-(b.revision||0)).map((x,i)=>({...x,restoreOrder:i+1})),goalOverrides:[...overrides.values()],pendingPracticeOperations:[],position:incoming.position,bankPositions:incoming.bankPositions};
}

