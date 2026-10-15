const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {validateBank}=require('./validate-bank.cjs');
const root=path.resolve(__dirname,'..'),priv=path.join(root,'private');
const fn=path.join(root,'functions/math2-api'),dest=path.join(fn,'assets');
const bank=JSON.parse(fs.readFileSync(path.join(priv,'data/bank.json'),'utf8'));
validateBank(bank,priv);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const historyPath=path.join(fn,'goal-bank-history.json');
const history=fs.existsSync(historyPath)?JSON.parse(fs.readFileSync(historyPath,'utf8')):[];
const previous=path.join(dest,'data/bank.json');
if(fs.existsSync(previous)){
 const old=JSON.parse(fs.readFileSync(previous,'utf8'));
 if(old.version!==bank.version&&!history.some(b=>b.version===old.version))history.push({version:old.version,categories:old.categories,questions:old.questions.map(({id,bankId,categoryIds})=>({id,bankId,categoryIds}))});
}
fs.writeFileSync(historyPath,JSON.stringify(history));
// Fixed generated path, never private/. Preserve original banks and images.
fs.rmSync(dest,{recursive:true,force:true});
fs.mkdirSync(path.join(dest,'data'),{recursive:true});
fs.mkdirSync(path.join(dest,'images'),{recursive:true});
const subset=ids=>({...bank,questions:bank.questions.filter(q=>ids.includes(q.bankId||'exam')),categories:bank.categories.filter(c=>ids.includes(c.bankId||'exam')),archivedQuestions:[]});
const variants=[['bank.json','assets-manifest.json',bank],['v2-bank.json','v2-assets-manifest.json',subset(['exam','lilin880'])],['legacy-bank.json','legacy-assets-manifest.json',subset(['exam'])]];
for(const [file,manifest,content] of variants){
 const bytes=Buffer.from(JSON.stringify(content));fs.writeFileSync(path.join(dest,'data',file),bytes);
 if(file!=='bank.json')fs.writeFileSync(path.join(priv,'data',file),bytes);
 const files=[{path:'data/bank.json',bytes:bytes.length,sha256:sha(bytes),type:'application/json'}];
 const refs=new Set([...content.questions,...(content.archivedQuestions||[])].flatMap(q=>Object.values(q.resources||{})));
 for(const rel of [...refs].sort()){
  const data=fs.readFileSync(path.join(priv,rel));fs.copyFileSync(path.join(priv,rel),path.join(dest,rel));
  const type={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'}[path.extname(rel).toLowerCase()];
  files.push({path:rel,bytes:data.length,sha256:sha(data),type});
 }
 fs.writeFileSync(path.join(fn,manifest),JSON.stringify({version:sha(JSON.stringify(files)).slice(0,16),files}));
}
const initial={epoch:crypto.randomUUID(),seq:0,records:{},receipts:{},position:null};
const schema=fs.readFileSync(path.join(__dirname,'schema-template.sql'),'utf8').replace('__INITIAL_STATE__',Buffer.from(JSON.stringify(initial)).toString('base64'));
fs.writeFileSync(path.join(root,'schema.sql'),schema);
console.log(JSON.stringify({questions:bank.questions.length,archived:bank.archivedQuestions?.length||0,version:bank.version,history:history.length}));
