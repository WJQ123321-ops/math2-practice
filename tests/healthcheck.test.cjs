require('fake-indexeddb/auto');
const {test}=require('node:test'),assert=require('node:assert/strict');
test('health never initializes a database client',async()=>{
 const CloudBase=require('@cloudbase/manager-node'),old=CloudBase.init;
 CloudBase.init=()=>{throw Error('health must not access database')};
 try {assert.deepEqual(await require('../functions/math2-api/handler.cjs').main({action:'health'}),{ok:true,ready:true,scope:'function'});}finally{CloudBase.init=old;}
});
test('restore adoption is atomic, validates snapshots and rejects edits since export',async()=>{
 const st=await import('../public/storage.js'),{blank}=await import('../public/core.js');const db=await st.openDB();
 try{
  await st.acceptSync(db,{epoch:'old',seq:0,records:[]});
  const record=await st.saveRecord(db,{...blank('cxyonly:1'),note:'keep my note'},0);
  const before=await st.snapshot(db);
  await assert.rejects(st.adoptRestoredCloud(db,{epoch:'new',seq:2,records:[]},before),/完整快照/);
  assert.equal((await st.snapshot(db)).records.get(record.id).note,'keep my note');
  await st.saveRecord(db,{...record,note:'edited after export'},record.revision);
  const full={full:true,epoch:'new',seq:2,records:[{...blank('cxyonly:2'),note:'cloud note'}]};
  await assert.rejects(st.adoptRestoredCloud(db,full,before),/本机记录已变化/);
  const latest=await st.snapshot(db);
  // A value IndexedDB cannot clone forces failure after clear inside the transaction.
  await assert.rejects(st.adoptRestoredCloud(db,{...full,records:[{...full.records[0],invalid:()=>{}}]},latest));
  assert.equal((await st.snapshot(db)).records.get(record.id).note,'edited after export');
  await st.adoptRestoredCloud(db,full,latest);
  const after=await st.snapshot(db);assert.equal(after.records.size,1);assert.equal(after.records.get('cxyonly:2').note,'cloud note');assert.equal(after.ops.length,0);
 }finally{db.close();}
});
test('invalid operations and dependent edits remain exportable but are isolated',async()=>{
 const st=await import('../public/storage.js'),{blank}=await import('../public/core.js');const db=await st.openDB();
 try{
  await st.acceptSync(db,{full:true,epoch:'isolated',seq:0,records:[]});
  const a=await st.saveRecord(db,{...blank('cxyonly:3'),note:'one'},0);
  await st.saveRecord(db,{...a,note:'two'},a.revision);
  await st.saveRecord(db,{...blank('cxyonly:4'),note:'independent'},0);
  const before=await st.snapshot(db),bad=before.ops[0];
  await st.acceptSync(db,{epoch:'isolated',seq:0,records:[],errors:[{id:bad.id,error:'INVALID_OP'}]});
  const after=await st.snapshot(db);assert.equal(after.ops.length,3);assert.equal(after.ops.filter(o=>!o.blocked).length,1);
  assert.equal(after.records.get('cxyonly:3').note,'two');assert.equal(after.sync.errors.length,2);
 }finally{db.close();}
});
test('missing epoch has an actionable import error and writes nothing',async()=>{
 const st=await import('../public/storage.js'),{blank}=await import('../public/core.js');const db=await st.openDB();
 try{await st.transact(db,['records','ops','meta'],tx=>{for(const name of ['records','ops','meta'])tx.objectStore(name).clear()});
 await assert.rejects(st.importRecords(db,{records:[blank('cxyonly:5')]},'merge',new Map()),/首次初始化/);
 assert.equal((await st.snapshot(db)).records.size,0);
 }finally{db.close();}
});
