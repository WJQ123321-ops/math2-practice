require('./bank-fixture.cjs');
require('fake-indexeddb/auto');
const {test}=require('node:test'),assert=require('node:assert/strict');

test('daily queue survives offline repetition and merges server acknowledgements without counting twice',async()=>{
 const storage=await import('../public/storage.js'),daily=await import('../public/daily-data.js');
 const db=await storage.openDB();
 try{
  await storage.transact(db,['records','ops','meta','dailyCompletions','goalTemplates','goalOverrides','practiceOps'],tx=>{for(const name of ['records','ops','meta','dailyCompletions','goalTemplates','goalOverrides','practiceOps'])tx.objectStore(name).clear()});
  const date='2026-09-26',questionId='cxyonly:1',occurredAt='2026-09-26T04:00:00.000Z';
  await assert.rejects(daily.saveCompletion(db,{date,questionId,bankId:'exam',occurredAt,bankVersion:'v'}),/首次初始化/);
  assert.equal((await storage.snapshot(db)).practiceOps.length,0);
  await storage.acceptSync(db,{full:true,practiceFull:true,epoch:'practice-test',seq:0,records:[],dailyCompletions:[],goalTemplates:[],goalOverrides:[],capabilities:{practice:1},practiceEnabledFrom:date});
  await daily.saveCompletion(db,{date,questionId,bankId:'exam',occurredAt,bankVersion:'v'});
  await daily.saveCompletion(db,{date,questionId,bankId:'exam',occurredAt,bankVersion:'v'});
  assert.equal((await daily.loadPractice(db)).pendingPracticeOps.length,1);
  await daily.undoCompletion(db,{date,questionId});
  await daily.saveCompletion(db,{date,questionId,bankId:'exam',occurredAt,bankVersion:'v'});
  let data=await daily.loadPractice(db);
  assert.equal(data.dailyCompletions.filter(x=>x.completed).length,1);
  assert.equal(data.pendingPracticeOps.length,3);
  assert.equal(data.pendingPracticeOps[1].baseRevision,data.pendingPracticeOps[0].id);
  assert.equal(data.pendingPracticeOps[2].baseRevision,data.pendingPracticeOps[1].id);
  await storage.acceptSync(db,{epoch:'practice-test',seq:3,records:[],practiceAck:data.pendingPracticeOps.map(x=>x.id),practiceCursor:3,dailyCompletions:[{date,questionId,bankId:'exam',completed:true,occurredAt,revision:3}],goalTemplates:[],goalOverrides:[],capabilities:{practice:1}});
  data=await daily.loadPractice(db);
  assert.equal(data.pendingPracticeOps.length,0);
  assert.equal(data.dailyCompletions.filter(x=>x.completed).length,1);
  assert.equal(data.dailyCompletions[0].revision,3);
  assert.equal(daily.chinaDate('2026-09-25T16:00:00.000Z'),date);
 }finally{db.close()}
});
test('conflict rebase unblocks an offline undo and its dependent redo',async()=>{
 const storage=await import('../public/storage.js'),daily=await import('../public/daily-data.js');
 const db=await storage.openDB();
 try{
  await storage.transact(db,['records','ops','meta','dailyCompletions','goalTemplates','goalOverrides','practiceOps'],tx=>{for(const name of ['records','ops','meta','dailyCompletions','goalTemplates','goalOverrides','practiceOps'])tx.objectStore(name).clear()});
  const date='2026-09-26',questionId='cxyonly:1',occurredAt='2026-09-26T04:00:00.000Z',cloud={date,questionId,bankId:'exam',completed:true,occurredAt,revision:1};
  await storage.acceptSync(db,{full:true,practiceFull:true,epoch:'conflict-test',seq:0,practiceCursor:1,records:[],dailyCompletions:[cloud],goalTemplates:[],goalOverrides:[],capabilities:{practice:1},practiceEnabledFrom:date});
  await daily.undoCompletion(db,{date,questionId});
  await daily.saveCompletion(db,{date,questionId,bankId:'exam',occurredAt,bankVersion:'v'});
  let ops=(await daily.loadPractice(db)).pendingPracticeOps;
  await storage.acceptSync(db,{full:true,practiceFull:true,epoch:'conflict-test',seq:0,practiceCursor:2,records:[],dailyCompletions:[{...cloud,revision:2}],goalTemplates:[],goalOverrides:[],practiceErrors:[{id:ops[0].id,error:'PRACTICE_CONFLICT',current:{...cloud,revision:2}},{id:ops[1].id,error:'DEPENDENCY_MISSING'}],capabilities:{practice:1}});
  ops=(await daily.loadPractice(db)).pendingPracticeOps;
  assert.equal(ops[0].blocked,'PRACTICE_CONFLICT');assert.equal(ops[1].blocked,'DEPENDENCY_MISSING');
  await daily.resolvePracticeConflict(db,ops[0].id,'local');
  ops=(await daily.loadPractice(db)).pendingPracticeOps;
  assert.equal(ops[0].blocked,undefined);assert.equal(ops[0].baseRevision,2);
  assert.equal(ops[1].blocked,undefined);assert.equal(ops[1].baseRevision,ops[0].id);
 }finally{db.close()}
});
test('v3 backup merge retains unique tombstones and goal versions but rejects unresolved operations',async()=>{
 const core=await import('../public/core.js'),date='2026-09-26',base={app:'math2-practice',schemaVersion:3,bankVersion:'v',records:[],dailyCompletions:[{date,questionId:'cxyonly:1',bankId:'exam',completed:false,occurredAt:'2026-09-26T04:00:00.000Z',categoryIdsSnapshot:[],bankVersion:'v',revision:1}],goalTemplates:[{id:'template-123456789',effectiveFrom:date,mode:'simple',tasks:[],revision:1}],goalOverrides:[],pendingPracticeOperations:[]};
 const preview={full:true,practiceFull:true,records:[],dailyCompletions:[],goalTemplates:[],goalOverrides:[]};
 const merged=core.mergeBackupForRestore(base,preview);
 assert.equal(merged.dailyCompletions.length,1);assert.equal(merged.dailyCompletions[0].completed,false);assert.equal(merged.goalTemplates.length,1);
 assert.throws(()=>core.mergeBackupForRestore({...base,pendingPracticeOperations:[{id:'pending'}]},preview),/待同步/);
 assert.throws(()=>core.mergeBackupForRestore(base,{...preview,dailyCompletions:[{...base.dailyCompletions[0],completed:true}]}),/冲突/);
});
