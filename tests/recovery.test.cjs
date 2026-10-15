require('./bank-fixture.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {initial,apply}=require('../functions/math2-api/engine.cjs');
const practice=require('../functions/math2-api/practice.cjs');
const task=count=>({taskId:'recovery-task-001',bankId:'all',categoryIds:[],targetCount:count,scopeQuestionIds:practice.idsForScope('all',[]),bankVersion:practice.BANK_VERSION,scopeLabels:['全部题库']});
const goal=(id,revision,count,date='2026-09-29')=>({id,effectiveFrom:date,mode:'simple',tasks:[task(count)],revision});
const backup=()=>({app:'math2-practice',schemaVersion:3,bankVersion:practice.BANK_VERSION,records:[],dailyCompletions:[],goalTemplates:[],goalOverrides:[],pendingPracticeOperations:[],sync:{epoch:'source'}});
const preview=()=>({full:true,practiceFull:true,epoch:'cloud',seq:0,practiceCursor:0,records:[],dailyCompletions:[],goalTemplates:[],goalOverrides:[]});
async function at(instant,fn){const old=Date.now;Date.now=()=>Date.parse(instant);try{return await fn()}finally{Date.now=old}}
test('R2: restore preserves revision priority regardless of ID or array ordering',()=>{
 for(const goals of [[goal('aaa-new-goal',2,20),goal('zzz-old-goal',1,10)],[goal('zzz-old-goal',1,10),goal('aaa-new-goal',2,20)]]){
  const state=initial();const result=apply(state,{action:'restore',practiceVersion:1,epoch:state.epoch,expectedSeq:0,records:[],practiceBackup:{dailyCompletions:[],goalTemplates:goals,goalOverrides:[]}});
  assert.equal(result.state.goalTemplates.reduce((a,b)=>a.revision>b.revision?a:b).tasks[0].targetCount,20);
 }
});
test('R3: offline goals upload across days, remain idempotent, and retain conflict checks',()=>at('2026-09-30T04:00:00.000Z',()=>{
 let state=initial();const op={id:'offline-goal-0001',epoch:state.epoch,kind:'setGoalOverride',baseRevision:0,goalProtocol:2,createdAt:'2026-09-29T04:00:00.000Z',payload:{date:'2026-09-29',mode:'custom',planMode:'simple',tasks:[task(20)]}};
 let result=apply(state,{practiceVersion:1,practiceOps:[op]});assert.deepEqual(result.response.practiceAck,[op.id]);state=result.state;
 result=apply(state,{practiceVersion:1,practiceOps:[op]});assert.deepEqual(result.response.practiceAck,[op.id]);assert.equal(result.state.seq,state.seq);
 const stale={...op,id:'offline-stale-001'};assert.equal(apply(state,{practiceVersion:1,practiceOps:[stale]}).response.practiceErrors[0].error,'PRACTICE_CONFLICT');
 const future={...op,id:'offline-future-01',createdAt:'2026-10-01T04:00:00.000Z'};assert.equal(apply(state,{practiceVersion:1,practiceOps:[future]}).response.practiceErrors[0].error,'INVALID_GOAL_TIME');
}));
test('R1: new-device recovery collapses optimistic complete/undo/redo without replaying an old queue',async()=>{
 const recovery=await import('../public/backup-recovery.js');const b=backup(),date='2026-09-29',q=practice.idsForScope('all',[])[0];
 const payload={date,questionId:q,bankId:q.startsWith('cxyonly:')?'exam':'lilin880',occurredAt:'2026-09-29T04:00:00.000Z',bankVersion:practice.BANK_VERSION,categoryIdsSnapshot:[]};
 b.dailyCompletions=[{...payload,completed:true,revision:0}];
 b.pendingPracticeOperations=['complete','undo','complete'].map((kind,i)=>({id:'old-operation-'+i,epoch:'source',kind,payload:kind==='undo'?{date,questionId:q}:payload,baseRevision:i?'old-operation-'+(i-1):0,order:i+1}));
 const plan=recovery.previewRecovery(b,preview(),'merge');assert.equal(plan.conflicts.length,0);
 const final=recovery.finishRecovery(plan,{});assert.equal(final.dailyCompletions.length,1);assert.equal(final.dailyCompletions[0].completed,true);assert.deepEqual(final.pendingPracticeOperations,[]);assert.equal(final.recoveryVersion,1);
});
test('R1: explicit choices protect cloud tombstones and blocked old goals; malformed operations preserve notes',async()=>{
 const r=await import('../public/backup-recovery.js'),core=await import('../public/core.js');const b=backup(),c=preview(),date='2026-09-29',q=practice.idsForScope('all',[])[0];
 const row={date,questionId:q,bankId:q.startsWith('cxyonly:')?'exam':'lilin880',occurredAt:'2026-09-29T04:00:00.000Z',bankVersion:practice.BANK_VERSION,categoryIdsSnapshot:[],completed:true,revision:0};
 b.records=[{...core.blank(q),note:'原备份中的笔记'}];b.dailyCompletions=[row];c.dailyCompletions=[{...row,completed:false,revision:3}];
 b.pendingPracticeOperations=[{id:'invalid-operation',epoch:'source',kind:'bad',payload:{},order:1,baseRevision:0}];
 const plan=r.previewRecovery(b,c);assert.equal(plan.issues.length,1);assert.equal(plan.conflicts.length,1);assert.equal(plan.records[0].note,'原备份中的笔记');
 assert.throws(()=>r.finishRecovery(plan,{},true),/逐项选择/);assert.throws(()=>r.finishRecovery(plan,{[plan.conflicts[0].id]:'backup'}),/无法处理/);
 const safe=r.finishRecovery(plan,{[plan.conflicts[0].id]:'cloud'},true);assert.equal(safe.dailyCompletions[0].completed,false);
 const chosen=r.finishRecovery(plan,{[plan.conflicts[0].id]:'backup'},true);assert.equal(chosen.dailyCompletions[0].completed,true);
 b.pendingPracticeOperations=[{id:'old-goal-blocked',epoch:'source',kind:'setGoalOverride',payload:{date,mode:'rest'},order:1,baseRevision:0,blocked:'INVALID_GOAL'}];b.dailyCompletions=[];c.dailyCompletions=[];
 const oldPlan=r.previewRecovery(b,c);assert.equal(oldPlan.conflicts.length,1);const goalRestore=r.finishRecovery(oldPlan,{[oldPlan.conflicts[0].id]:'backup'});assert.equal(goalRestore.goalOverrides[0].mode,'rest');assert.equal(b.pendingPracticeOperations[0].createdAt,undefined);
});
test('R2: cross-epoch same-day goals require a decision and every restored date keeps its winner',async()=>{
 const r=await import('../public/backup-recovery.js');const b=backup(),c=preview();b.goalTemplates=[goal('zzz-old-goal',1,10),goal('aaa-new-goal',2,20),goal('future-goal-01',3,30,'2026-09-30')];c.goalTemplates=[goal('cloud-day-goal',99,15)];
 const plan=r.previewRecovery(b,c);assert.equal(plan.conflicts.length,1);assert.throws(()=>r.finishRecovery(plan,{}),/逐项选择/);
 const data=r.finishRecovery(plan,{[plan.conflicts[0].id]:'backup'});const state=initial();const restored=apply(state,{action:'restore',practiceVersion:1,recoveryVersion:1,epoch:state.epoch,expectedSeq:0,records:[],practiceBackup:data});
 for(const [day,count]of [['2026-09-29',20],['2026-09-30',30]])assert.equal(restored.state.goalTemplates.filter(x=>x.effectiveFrom<=day).sort((a,b)=>a.effectiveFrom.localeCompare(b.effectiveFrom)||a.revision-b.revision).at(-1).tasks[0].targetCount,count);
 r.verifyRestoredSnapshot(data,{...restored.response,full:true});
 assert.throws(()=>r.verifyRestoredSnapshot(data,{...restored.response,full:true,goalTemplates:[]}),/不一致/);
 assert.throws(()=>practice.restorePractice({...data,pendingPracticeOperations:[{id:'old'}]},initial(),true),/INVALID_PRACTICE_BACKUP/);
 assert.throws(()=>practice.restorePractice({...data,goalTemplates:[goal('unsynced-goal',0,10)]},initial()),/INVALID_PRACTICE_BACKUP/);
});
test('R3: default goals may upload after their effective day; illegal creation dates and legacy past requests fail',()=>at('2026-10-02T04:00:00.000Z',()=>{
 const state=initial(),op={id:'offline-template-001',epoch:state.epoch,kind:'setGoalTemplate',baseRevision:0,goalProtocol:2,createdAt:'2026-09-29T04:00:00.000Z',payload:{id:'offline-plan-0001',effectiveFrom:'2026-09-30',mode:'simple',tasks:[task(20)]}};
 assert.deepEqual(apply(state,{practiceVersion:1,practiceOps:[op]}).response.practiceAck,[op.id]);
 for(const createdAt of ['bad','2026-09-29T04:00:00+00:00','2026-09-25T04:00:00.000Z','2026-10-02T04:06:00.000Z'])assert.equal(apply(state,{practiceVersion:1,practiceOps:[{...op,createdAt}]}).response.practiceErrors[0].error,'INVALID_GOAL_TIME');
 assert.equal(apply(state,{practiceVersion:1,practiceOps:[{...op,payload:{...op.payload,effectiveFrom:'2026-09-28'}}]}).response.practiceErrors[0].error,'INVALID_GOAL_TIME');
 const {createdAt,goalProtocol,...legacy}=op;assert.equal(apply(state,{practiceVersion:1,practiceOps:[legacy]}).response.practiceErrors[0].error,'PAST_GOAL_DATE');
}));
test('R1: local restore guard covers daily state, goals and both operation queues',async()=>{
 const {restoreGuard}=await import('../public/storage.js');const s={records:new Map(),ops:[],dailyCompletions:[],goalTemplates:[],goalOverrides:[],practiceOps:[],sync:{epoch:'a',cursor:0,practiceCursor:0}};
 for(const key of ['ops','dailyCompletions','goalTemplates','goalOverrides','practiceOps'])assert.notEqual(restoreGuard(s),restoreGuard({...s,[key]:[{id:'new'}]}));
});
