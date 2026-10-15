const fs=require('node:fs'),path=require('node:path');
const ID=/^(?:cxyonly:\d+|lilin880:edition-[a-zA-Z0-9-]+:vol\d+:ch\d+:group\d+:(?:single_choice|fill_blank|essay):q\d+)$/;
function validateBank(bank,assetRoot){
 const check=(ok,message)=>{if(!ok)throw Error(message);};
 check(bank?.schemaVersion===1&&typeof bank.version==='string'&&bank.version.length>0,'需要 schemaVersion:1 和非空 version');
 check(['accepted','demo'].includes(bank.mode),'mode 应为 accepted 或 demo');
 check(Array.isArray(bank.questions)&&Array.isArray(bank.categories),'questions/categories 必须是数组');
 check(bank.archivedQuestions===undefined||Array.isArray(bank.archivedQuestions),'archivedQuestions 必须是数组');
 const cats=new Map();
 for(const c of bank.categories){
  check(c&&['string','number'].includes(typeof c.id)&&String(c.id)&&!cats.has(String(c.id)),'分类 ID 缺失或重复');
  check(typeof c.name==='string'&&c.name.trim()&&['exam','lilin880','yanxuan'].includes(c.bankId||'exam'),'分类名称或分区无效');cats.set(String(c.id),c);
 }
 for(const c of cats.values()){
  let n=c;const seen=new Set();
  while(n){check(!seen.has(String(n.id)),'分类形成循环');seen.add(String(n.id));if(n.parent_id==null)break;
   const parent=cats.get(String(n.parent_id));check(parent,'分类缺少父节点');check((parent.bankId||'exam')===(c.bankId||'exam'),'父子分类分区不一致');n=parent;
  }
 }
 const ids=new Set(),all=[...bank.questions,...(bank.archivedQuestions||[])];
 for(const q of all){
  const label=q?.id||'(无 ID)';
  check(q&&ID.test(q.id)&&!ids.has(q.id),`题号无效或重复：${label}`);ids.add(q.id);
  const b=q.bankId||'exam';check(['exam','lilin880','yanxuan'].includes(b)&&(b==='lilin880')===q.id.startsWith('lilin880:'),`题号与分区不符：${label}`);
  check(['single_choice','fill','fill_blank','essay'].includes(q.type),`题型无效：${label}`);
  check(Array.isArray(q.papers)&&Array.isArray(q.categoryIds)&&q.categoryIds.length>0,`papers/categoryIds 缺失：${label}`);
  check(q.categoryIds.every(id=>cats.has(String(id))&&(cats.get(String(id)).bankId||'exam')===b),`分类不存在或分区不符：${label}`);
  check(typeof q.source==='string'&&q.source.trim(),`需要来源定位 source：${label}`);
  const d=q.document;check(d&&typeof d.stem_md==='string'&&d.stem_md.trim()&&Array.isArray(d.options)&&d.answer&&typeof d.explanation_md==='string',`题干/选项/答案/解析结构不完整：${label}`);
  if(q.type==='single_choice'){
   const opts=new Set(d.options.map(o=>o.id));check(opts.size===d.options.length&&opts.size>=2&&d.options.every(o=>typeof o.id==='string'&&typeof o.label==='string'&&typeof o.content_md==='string'),`选择题选项无效：${label}`);
   check(Array.isArray(d.answer.option_ids)&&d.answer.option_ids.length===1&&opts.has(d.answer.option_ids[0]),`答案必须指向一个选项 ID：${label}`);
  }else check(typeof d.answer.reference_answer_md==='string'&&d.answer.reference_answer_md.trim(),`缺少参考答案：${label}`);
  check(q.resources&&typeof q.resources==='object'&&!Array.isArray(q.resources),`resources 必须为对象：${label}`);
  for(const rel of Object.values(q.resources)){
   check(typeof rel==='string'&&/^images\/[a-zA-Z0-9_.-]+\.(png|jpg|jpeg|webp|gif)$/i.test(rel),`图片路径无效：${label}`);
   const real=fs.realpathSync(path.join(assetRoot,rel)),base=fs.realpathSync(assetRoot)+path.sep;
   check(real.startsWith(base)&&fs.statSync(real).isFile(),`图片越界或不存在：${label}`);
  }
  const text=[d.stem_md,d.explanation_md,d.answer.reference_answer_md||'',...d.options.map(o=>o.content_md)].join('\n');
  for(const m of text.matchAll(/!\[(?:\\.|[^\]\\])*\]\(([^)]+)\)/g))check(Object.hasOwn(q.resources,m[1]),`图片引用未映射：${label}`);
 }
 return {questions:bank.questions.length,archived:bank.archivedQuestions?.length||0,categories:cats.size};
}
module.exports={validateBank};
if(require.main===module){try{const file=path.resolve(process.argv[2]||path.join(__dirname,'../private/data/bank.json')),root=path.resolve(process.argv[3]||path.join(file,'../..'));console.log(JSON.stringify(validateBank(JSON.parse(fs.readFileSync(file,'utf8')),root)));}catch(e){console.error(e.message);process.exitCode=1;}}
