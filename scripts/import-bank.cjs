// Complete bank snapshot import. Default validates; --apply writes after validation.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {validateBank}=require('./validate-bank.cjs');
try{
 const args=process.argv.slice(2),file=args.find(a=>!a.startsWith('--'));
 if(!file)throw Error('用法：npm run import:bank -- /path/to/private/data/bank.json [--apply]');
 const input=path.resolve(file),source=path.resolve(path.dirname(input),'..');
 const bank=JSON.parse(fs.readFileSync(input,'utf8'));validateBank(bank,source);
 const root=path.resolve(__dirname,'../private'),target=path.join(root,'data/bank.json');
 const old=fs.existsSync(target)?JSON.parse(fs.readFileSync(target,'utf8')):null;
 const incoming=new Set([...bank.questions,...(bank.archivedQuestions||[])].map(q=>q.id));
 if(old&&old.mode!=='demo'){
  const removed=[...old.questions,...(old.archivedQuestions||[])].filter(q=>!incoming.has(q.id));
  if(removed.length)throw Error(`新快照缺少 ${removed.length} 道旧题；请把退役题放入 archivedQuestions，并保留分类与图片。不会自动删除。`);
 }
 for(const q of [...bank.questions,...(bank.archivedQuestions||[])]){q.displayOptions=q.document.options;if(q.type==='fill_blank')q.type='fill';q.contentHash=crypto.createHash('sha256').update(JSON.stringify(q.document)).digest('hex');}
 bank.version=crypto.createHash('sha256').update(JSON.stringify({...bank,version:''})).digest('hex').slice(0,16);
 const refs=[...new Set([...bank.questions,...(bank.archivedQuestions||[])].flatMap(q=>Object.values(q.resources)))];
 for(const rel of refs){const out=path.join(root,rel);if(fs.existsSync(out)&&!fs.readFileSync(out).equals(fs.readFileSync(path.join(source,rel))))throw Error('图片文件名已存在且内容不同，请用新文件名：'+rel);}
 console.log(JSON.stringify({mode:args.includes('--apply')?'apply':'check',...validateBank(bank,source),images:refs.length,version:bank.version}));
 if(args.includes('--apply')){
  fs.mkdirSync(path.join(root,'data'),{recursive:true});fs.mkdirSync(path.join(root,'images'),{recursive:true});
  if(old){const backup=path.join(root,'backups',new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(backup,{recursive:true});fs.copyFileSync(target,path.join(backup,'bank.json'));}
  for(const rel of refs)if(path.resolve(source,rel)!==path.resolve(root,rel))fs.copyFileSync(path.join(source,rel),path.join(root,rel));
  fs.writeFileSync(target+'.tmp',JSON.stringify(bank));fs.renameSync(target+'.tmp',target);
  console.log('已导入；下一步 npm run setup 和 npm run build。旧图片保留，学习记录未修改。');
 }
}catch(e){console.error(e.message);process.exitCode=1;}
