// Generates a FICTIONAL demo question bank into private/data (plus a demo figure in
// private/images). Every question here is an original example written for this template;
// none is taken from any published exam or question book. The demo exists so a fresh
// deployment is fully functional out of the box. Replace private/data with your own
// legally-licensed bank when you go live (see docs/DEPLOYMENT.md "导入你自己的题库").
//
// Idempotent: re-running regenerates the demo files. It refuses to overwrite an existing
// non-demo bank unless --force is passed, so an imported real bank is never clobbered.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'..');
const force=process.argv.includes('--force');

const bankPath=path.join(root,'private/data/bank.json');
if(fs.existsSync(bankPath)&&!force){
  try{const existing=JSON.parse(fs.readFileSync(bankPath,'utf8'));
    if(existing&&existing.mode!=='demo'){console.error('检测到 private/data/bank.json 不是示例题库（mode='+existing.mode+'）。为保护你已导入的题库，未覆盖。如确要重建示例题库，请加 --force。');process.exit(1);}
  }catch{/* unreadable file: fall through and regenerate */}
}

// ---- minimal PNG encoder (no dependencies) ------------------------------------
function crc32(buf){let c,crc=0xffffffff;for(let n=0;n<buf.length;n++){c=(crc^buf[n])&0xff;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;crc=(crc>>>8)^c;}return (crc^0xffffffff)>>>0;}
function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length,0);const td=Buffer.concat([Buffer.from(type,'ascii'),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(td),0);return Buffer.concat([len,td,crc]);}
function encodePng(w,h,rgb){const stride=1+w*3;const raw=Buffer.alloc(h*stride);for(let y=0;y<h;y++){raw[y*stride]=0;rgb.copy(raw,y*stride+1,y*w*3,(y+1)*w*3);}const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=2;ihdr[10]=0;ihdr[11]=0;ihdr[12]=0;return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
// A simple sine curve y = sin(x) over [0, 2π]. Original placeholder artwork.
function demoFigure(){const w=480,h=320,buf=Buffer.alloc(w*h*3);buf.fill(255);const set=(x,y,r,g,b)=>{if(x<0||y<0||x>=w||y>=h)return;const i=(y*w+x)*3;buf[i]=r;buf[i+1]=g;buf[i+2]=b;};
 const ox=56,oy=h-56;for(let x=ox;x<w-16;x++)set(x,oy,90,90,90);for(let y=16;y<=oy;y++)set(ox,y,90,90,90);
 const mid=oy-100;for(let y=16;y<=oy;y++)set(ox-4,y,150,150,150),set(ox+4,y,150,150,150);
 const plotW=w-ox-24;for(let px=0;px<=plotW;px++){const t=px/plotW*2*Math.PI;const x=ox+px;const y=Math.round(mid-Math.sin(t)*88);for(let d=-1;d<=1;d++)set(x,y+d,23,90,200);}
 return encodePng(w,h,buf);}

// ---- categories ---------------------------------------------------------------
// exam partition uses numeric ids (no bankId); the second partition uses string ids
// with bankId 'lilin880' to match the structural id scheme in core.js / engine.cjs.
const categories=[
 {id:900,parent_id:null,name:'高等数学（示例）',display_order:1024,path:['高等数学（示例）']},
 {id:901,parent_id:900,name:'极限与连续',display_order:2048,path:['高等数学（示例）','极限与连续']},
 {id:902,parent_id:900,name:'一元函数微分学',display_order:3072,path:['高等数学（示例）','一元函数微分学']},
 {id:903,parent_id:900,name:'一元函数积分学',display_order:4096,path:['高等数学（示例）','一元函数积分学']},
 {id:910,parent_id:null,name:'线性代数（示例）',display_order:5120,path:['线性代数（示例）']},
 {id:911,parent_id:910,name:'行列式与矩阵',display_order:6144,path:['线性代数（示例）','行列式与矩阵']},
 {id:'demo:vol01',parent_id:null,name:'分册题库（示例）',display_order:8192,path:['分册题库（示例）'],bankId:'lilin880'},
 {id:'demo:vol01:ch01',parent_id:'demo:vol01',name:'第1章 基础练习',display_order:8193,path:['分册题库（示例）','第1章 基础练习'],bankId:'lilin880'},
 {id:'demo:vol01:ch01:group01',parent_id:'demo:vol01:ch01',name:'示例分组一',display_order:8194,path:['分册题库（示例）','第1章 基础练习','示例分组一'],bankId:'lilin880'},
 {id:'demo:vol01:ch02',parent_id:'demo:vol01',name:'第2章 综合练习',display_order:8195,path:['分册题库（示例）','第2章 综合练习'],bankId:'lilin880'},
 {id:'demo:vol01:ch02:group01',parent_id:'demo:vol01:ch02',name:'示例分组二',display_order:8196,path:['分册题库（示例）','第2章 综合练习','示例分组二'],bankId:'lilin880'},
];
const catById=new Map(categories.map(c=>[String(c.id),c]));
const cls=catId=>{const c=catById.get(String(catId));return [{id:String(c.id),path:c.path,source:'示例分类'}];};

// ---- exam (cxyonly) questions ---------------------------------------------------
function exam(id,year,type,serial,catId,doc,extra={}){
 const categoryIds=[catId];
 return {id,year,papers:['示例卷（虚构）'],type,displayOptions:doc.options||[],serial,
  document:{format_version:1,question_id:Number(id.split(':')[1]),version_id:serial,category_id:String(catId),serial_number:serial,source:'示例卷',question_type:type,...doc},
  categoryIds,classification:cls(catId),source:'示例卷（虚构题目，非任何真题）',contentHash:'',resources:{},resourceNotes:[],...extra};
}
// ---- second-partition (lilin880) questions --------------------------------------
function part2(idSeg,type,serial,originalNumber,chapterLabel,groupLabel,catId,doc,extra={}){
 const id=`lilin880:edition-demo:vol01:ch${idSeg.ch}:group${idSeg.group}:${type==='fill'?'fill_blank':type}:q${String(serial).padStart(3,'0')}`;
 const categoryIds=[catId];
 return {id,bankId:'lilin880',year:null,papers:[],type,serial,originalNumber:String(originalNumber),chapterLabel,groupLabel,
  source:'示例分册（虚构题目，非任何出版物）',document:{stem_md:doc.stem_md,options:doc.options||[],answer:doc.answer,explanation_md:doc.explanation_md,asset_refs:doc.asset_refs||[]},
  displayOptions:doc.options||[],categoryIds,classification:[{path:catById.get(String(catId)).path,source:'示例章节'}],resources:doc.resources||{},contentHash:'',selectedSubquestions:[],resourceNotes:doc.resourceNotes||[],...extra};
}

const FIG='images/demo-figure.png';
const questions=[
 exam('cxyonly:2001',2001,'essay',1,901,{stem_md:'计算极限 $\\lim\\limits_{x \\to 0} \\dfrac{\\sin 3x}{x}$。',options:[],answer:{reference_answer_md:'$3$'},explanation_md:'利用等价无穷小 $\\sin 3x \\sim 3x\\ (x\\to 0)$：\n$$\\lim_{x\\to 0}\\frac{\\sin 3x}{x}=\\lim_{x\\to 0}\\frac{3x}{x}=3.$$'}),
 exam('cxyonly:2002',2002,'single_choice',2,902,{stem_md:"设 $f(x)=x^{2}$，则 $f'(1)=$（　）。",options:[{id:'opt-a',label:'A',content_md:'$1$'},{id:'opt-b',label:'B',content_md:'$2$'},{id:'opt-c',label:'C',content_md:'$3$'},{id:'opt-d',label:'D',content_md:'$4$'}],answer:{option_ids:['opt-b']},explanation_md:"$f'(x)=2x$，故 $f'(1)=2$，选 B。"}),
 exam('cxyonly:2003',2003,'fill',3,903,{stem_md:'$\\displaystyle\\int_{0}^{1} 2x\\,\\mathrm{d}x = $ ______。',options:[],answer:{reference_answer_md:'$1$'},explanation_md:'$\\int_{0}^{1}2x\\,\\mathrm{d}x=\\big[x^{2}\\big]_{0}^{1}=1$。'}),
 exam('cxyonly:2004',2004,'essay',4,911,{stem_md:'设 $A=\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}$，求 $\\det A$。',options:[],answer:{reference_answer_md:'$-2$'},explanation_md:'$\\det A=1\\cdot 4-2\\cdot 3=-2$。'}),
 exam('cxyonly:2005',2005,'single_choice',5,902,{stem_md:'函数 $f(x)=x^{3}-3x$ 的极大值为（　）。',options:[{id:'opt-a',label:'A',content_md:'$-2$'},{id:'opt-b',label:'B',content_md:'$0$'},{id:'opt-c',label:'C',content_md:'$2$'},{id:'opt-d',label:'D',content_md:'不存在'}],answer:{option_ids:['opt-c']},explanation_md:"$f'(x)=3x^{2}-3=0$ 得 $x=\\pm 1$。$f''(x)=6x$，$f''(-1)<0$，故 $x=-1$ 为极大值点，$f(-1)=2$，选 C。"}),
 exam('cxyonly:2006',2006,'single_choice',6,901,{stem_md:`![示例配图](${FIG})\n\n上图是模板自带的虚构示意图（正弦曲线 $y=\\sin x$ 在 $[0,2\\pi]$ 的图像）。该曲线在 $x=\\dfrac{\\pi}{2}$ 处的函数值为（　）。`,options:[{id:'opt-a',label:'A',content_md:'$0$'},{id:'opt-b',label:'B',content_md:'$1$'},{id:'opt-c',label:'C',content_md:'$-1$'},{id:'opt-d',label:'D',content_md:'$2$'}],answer:{option_ids:['opt-b']},explanation_md:'$\\sin\\dfrac{\\pi}{2}=1$，选 B。',asset_refs:[FIG],resources:{[FIG]:FIG},resourceNotes:['题面配图为模板自带的虚构示意图，可替换为你自己的图片。']},
   {resources:{[FIG]:FIG},resourceNotes:['题面配图为模板自带的虚构示意图，可替换为你自己的图片。']}),

 part2({ch:'01',group:'01'},'single_choice',1,1,'第1章 基础练习','示例分组一','demo:vol01:ch01:group01',{stem_md:`![示例配图](${FIG})\n\n上图为本模板自带的虚构示意图（正弦曲线）。图中曲线对应的函数是（　）。`,options:[{id:'opt-a',label:'A',content_md:'$y=\\sin x$'},{id:'opt-b',label:'B',content_md:'$y=\\cos x$'},{id:'opt-c',label:'C',content_md:'$y=\\tan x$'},{id:'opt-d',label:'D',content_md:'$y=\\ln x$'}],answer:{option_ids:['opt-a']},explanation_md:'图像过原点、以 $2\\pi$ 为周期，在 $x=\\frac{\\pi}{2}$ 处取最大值 $1$，故为 $y=\\sin x$，选 A。',asset_refs:[FIG],resources:{[FIG]:FIG},resourceNotes:['题面配图为模板自带的虚构示意图，可替换为你自己的图片。']}),
 part2({ch:'01',group:'01'},'fill',2,2,'第1章 基础练习','示例分组一','demo:vol01:ch01:group01',{stem_md:'$\\displaystyle\\int_{0}^{\\pi/2}\\cos x\\,\\mathrm{d}x = $ ______。',options:[],answer:{reference_answer_md:'$1$'},explanation_md:'$\\int_{0}^{\\pi/2}\\cos x\\,\\mathrm{d}x=\\big[\\sin x\\big]_{0}^{\\pi/2}=1$。'}),
 part2({ch:'02',group:'01'},'essay',1,1,'第2章 综合练习','示例分组二','demo:vol01:ch02:group01',{stem_md:'求曲线 $y=x^{2}$ 在点 $(1,1)$ 处的切线方程。',options:[],answer:{reference_answer_md:'$y=2x-1$'},explanation_md:"$y'=2x$，在 $x=1$ 处斜率为 $2$，切线为 $y-1=2(x-1)$，即 $y=2x-1$。"}),
 part2({ch:'02',group:'01'},'single_choice',2,2,'第2章 综合练习','示例分组二','demo:vol01:ch02:group01',{stem_md:'设 $A$ 为 $3$ 阶矩阵且 $\\det A=2$，则 $\\det(2A)=$（　）。',options:[{id:'opt-a',label:'A',content_md:'$4$'},{id:'opt-b',label:'B',content_md:'$8$'},{id:'opt-c',label:'C',content_md:'$16$'},{id:'opt-d',label:'D',content_md:'$2$'}],answer:{option_ids:['opt-c']},explanation_md:'$\\det(kA)=k^{n}\\det A$，$n=3$，故 $\\det(2A)=2^{3}\\cdot 2=16$，选 C。'}),
];
for(const q of questions)q.contentHash=crypto.createHash('sha256').update(JSON.stringify({id:q.id,document:q.document})).digest('hex');

const examQuestions=questions.filter(q=>(q.bankId||'exam')==='exam');
const examCategories=categories.filter(c=>!c.bankId);
const part2Categories=categories.filter(c=>c.bankId==='lilin880');

function bank(version,qs,cats){return {schemaVersion:1,version,mode:'demo',questions:qs,categories:cats,pending880:0};}

fs.mkdirSync(path.join(root,'private/data'),{recursive:true});
fs.mkdirSync(path.join(root,'private/images'),{recursive:true});
fs.writeFileSync(path.join(root,'private/images/demo-figure.png'),demoFigure());
// Full bank (v2 clients): both partitions. Legacy bank (old clients): exam partition only.
fs.writeFileSync(bankPath,JSON.stringify(bank('demo-bank-v1',questions,categories)));
fs.writeFileSync(path.join(root,'private/data/legacy-bank.json'),JSON.stringify(bank('demo-legacy-v1',examQuestions,examCategories)));
console.log(JSON.stringify({mode:'demo',total:questions.length,exam:examQuestions.length,part2:questions.length-examQuestions.length,examCategories:examCategories.length,part2Categories:part2Categories.length,images:['demo-figure.png'],ids:questions.map(q=>q.id)},null,2));
