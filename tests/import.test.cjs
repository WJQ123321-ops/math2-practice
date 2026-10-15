const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {validateBank}=require('../scripts/validate-bank.cjs');
const fixture=require('./fixtures/bank.json');
test('import rejects duplicate IDs, category cycles, missing images and incorrect answer references',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'math2-validate-'));
 try{
  let b=structuredClone(fixture);b.questions.push(b.questions[0]);assert.throws(()=>validateBank(b,root),/重复/);
  b=structuredClone(fixture);b.categories[0].parent_id=b.categories[0].id;assert.throws(()=>validateBank(b,root),/循环/);
  b=structuredClone(fixture);b.questions[0].resources={fig:'images/missing.png'};assert.throws(()=>validateBank(b,root),/ENOENT/);
  b=structuredClone(fixture);b.questions.find(q=>q.type==='single_choice').document.answer.option_ids=['missing'];assert.throws(()=>validateBank(b,root),/答案/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('complete snapshot import defaults to dry-run, backs up apply, preserves IDs and permits explicit archives',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'math2-import-'));
 try{
  fs.mkdirSync(path.join(root,'scripts'));for(const f of ['import-bank.cjs','validate-bank.cjs'])fs.copyFileSync(path.join(__dirname,'../scripts',f),path.join(root,'scripts',f));
  const input=path.join(root,'incoming/private/data/bank.json');fs.mkdirSync(path.dirname(input),{recursive:true});
  const bank=structuredClone(fixture);bank.mode='accepted';fs.writeFileSync(input,JSON.stringify(bank));
  const run=apply=>spawnSync(process.execPath,[path.join(root,'scripts/import-bank.cjs'),input,...(apply?['--apply']:[])],{encoding:'utf8'});
  const checked=run(false);assert.equal(checked.status,0,checked.stderr);const target=path.join(root,'private/data/bank.json');assert.equal(fs.existsSync(target),false);
  const applied=run(true);assert.equal(applied.status,0,applied.stderr);const original=fs.readFileSync(target,'utf8');
  const removed=bank.questions.pop();fs.writeFileSync(input,JSON.stringify(bank));assert.notEqual(run(true).status,0);assert.equal(fs.readFileSync(target,'utf8'),original);
  bank.archivedQuestions=[removed];fs.writeFileSync(input,JSON.stringify(bank));assert.equal(run(true).status,0);
  assert.equal(JSON.parse(fs.readFileSync(target)).archivedQuestions[0].id,removed.id);
  const backups=fs.readdirSync(path.join(root,'private/backups'));assert.equal(backups.length,1);assert.equal(fs.readFileSync(path.join(root,'private/backups',backups[0],'bank.json'),'utf8'),original);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

