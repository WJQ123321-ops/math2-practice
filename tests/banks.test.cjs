const {test}=require('node:test'),assert=require('node:assert/strict');
const {initial,apply}=require('../functions/math2-api/engine.cjs');
const bank=require('../private/data/bank.json');
const part2=bank.questions.filter(q=>q.bankId==='lilin880');
const exam=bank.questions.filter(q=>(q.bankId||'exam')==='exam');
const q=part2[0];

test('both partitions index independently; demo counts and ids remain intact',async()=>{
 const {indexBank,filterQuestions}=await import('../public/core.js');const index=indexBank(bank);
 assert.equal(filterQuestions(index,new Map(),{bankId:'exam'}).length,exam.length);
 assert.equal(filterQuestions(index,new Map(),{bankId:'lilin880'}).length,part2.length);
 assert.equal(index.byId.size,bank.questions.length);
 const record=new Map([[q.id,{status:'mastered',favorite:true}]]);
 assert.equal(filterQuestions(index,record,{bankId:'exam',view:'favorite'}).length,0);
 assert.equal(filterQuestions(index,record,{bankId:'lilin880',view:'favorite'}).length,1);
});

test('demo bank is clearly fictional and ships no real book content',()=>{
 assert.equal(bank.mode,'demo');
 assert.ok(exam.length>0&&part2.length>0);
 for(const qq of bank.questions)assert.ok(/示例|虚构/.test(qq.source),'demo question must be labelled fictional: '+qq.id);
});

test('sync retains distinct notes and separate resume positions, restores both partitions',()=>{
 let s=initial();const ops=[['cxyonly:2001','真题笔记'],[q.id,'分册笔记']].map(([questionId,value],i)=>({id:'banks-test-op-'+i,epoch:s.epoch,questionId,changes:{note:{value,base:0}}}));
 s=apply(s,{ops,position:{current:'cxyonly:2001'}}).state;
 s=apply(s,{ops:[],position:{current:q.id}}).state;
 assert.equal(s.records['cxyonly:2001'].note,'真题笔记');assert.equal(s.records[q.id].note,'分册笔记');
 assert.equal(s.positions.exam.current,'cxyonly:2001');assert.equal(s.positions.lilin880.current,q.id);
 const r=apply(s,{action:'restore',epoch:s.epoch,expectedSeq:s.seq,records:Object.values(s.records),position:{current:q.id},bankPositions:s.positions});
 assert.equal(r.state.records[q.id].note,'分册笔记');assert.equal(r.response.positions.exam.current,'cxyonly:2001');assert.equal(r.response.position.current,q.id);
});

test('backup validates both namespaces and rejects malformed IDs',async()=>{
 const {blank,validateBackup}=await import('../public/core.js');const pos={bankId:'lilin880',view:'all',category:'',year:'',type:'',status:'',current:q.id,expanded:[]};
 const d={app:'math2-practice',schemaVersion:2,bankVersion:'test',records:[blank(q.id),blank('cxyonly:2001')],position:pos,bankPositions:{lilin880:pos}};
 assert.equal(validateBackup(d).records.length,2);assert.equal(validateBackup(d).bankPositions.lilin880.current,q.id);
 assert.throws(()=>validateBackup({...d,records:[blank('lilin880:../../bad')]}));
});

test('demo image assets exist, are private, and are never exposed publicly',()=>{
 const fs=require('node:fs'),path=require('node:path');let withImages=0;
 for(const qq of bank.questions){
  for(const p of qq.document.asset_refs||[]){withImages++;
   assert.ok(fs.statSync(path.resolve(__dirname,'../private',p)).size>100,'asset missing: '+p);
   assert.ok(!fs.existsSync(path.resolve(__dirname,'../public',p)),'asset must not be public: '+p);}
 }
 assert.ok(withImages>0,'demo bank should exercise at least one image asset');
});

test('first part2 position preserves the previous exam position',()=>{const s=initial();s.position={current:'cxyonly:2001',device:'old',seq:0};const r=apply(s,{position:{current:q.id}});assert.equal(r.state.positions.exam.current,'cxyonly:2001');assert.equal(r.state.positions.lilin880.current,q.id);});
