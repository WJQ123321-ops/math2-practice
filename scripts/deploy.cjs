#!/usr/bin/env node
// Cloud deployment orchestrator for YOUR OWN Tencent CloudBase environment.
//
//   node scripts/deploy.cjs [--dry-run] [--yes] [--skip-build]
//
// What it does (in order):
//   1. Validates required config from .env (lists every missing value at once).
//   2. Asks for explicit authorization (resources are created/updated and the site
//      becomes publicly reachable; CloudBase usage may incur charges).
//   3. Builds artifacts (demo-bank if needed -> setup -> build).
//   4. Initializes the database schema (idempotent; never overwrites existing records).
//   5. Deploys the cloud function (with runtime identity env vars) and static hosting.
//   6. Runs a health check and prints honest verification status + next steps.
//
// It never hardcodes anyone's environment, never prints secret values, and restores
// cloudbaserc.json after injecting function env vars so credentials are not committed.
const {spawnSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline');
const env=require('./env.cjs');
const root=path.resolve(__dirname,'..');
const args=process.argv.slice(2);
const dry=args.includes('--dry-run'),yes=args.includes('--yes'),skipBuild=args.includes('--skip-build');

env.load(root);
const need=['CLOUDBASE_ENV','MATH2_ENV_ID','MATH2_ALLOWED_UID','MATH2_ALLOWED_EMAIL'];
const missing=need.filter(k=>!env.get(k));
if(missing.length){
  console.error('[deploy] 缺少必填配置（.env）：\n  - '+missing.join('\n  - '));
  console.error('\n请复制 .env.example 为 .env 并填写。各值含义与获取位置见 docs/DEPLOYMENT.md 的配置表。');
  process.exit(1);
}
const cloudEnv=env.get('CLOUDBASE_ENV'),fnEnv=env.get('MATH2_ENV_ID');
const region=env.get('CLOUDBASE_REGION')||env.get('MATH2_REGION')||'ap-shanghai';
if(cloudEnv!==fnEnv)console.warn('[deploy] 警告：CLOUDBASE_ENV('+cloudEnv+') 与 MATH2_ENV_ID('+fnEnv+') 不一致；通常应相同。');

const cliRoot=path.join(root,'node_modules/@cloudbase/cli');
if(!fs.existsSync(cliRoot)){console.error('[deploy] 未找到 @cloudbase/cli，请先运行 npm ci。');process.exit(1);}
const cliPkg=JSON.parse(fs.readFileSync(path.join(cliRoot,'package.json'),'utf8'));
const cliEntry=path.resolve(cliRoot,typeof cliPkg.bin==='string'?cliPkg.bin:cliPkg.bin.tcb);
function tcb(tcbArgs,{allowFail=false}={}){
  const full=[cliEntry,'-e',cloudEnv,'-r',region,...tcbArgs];
  if(dry){console.log('  [dry-run] tcb -e '+cloudEnv+' -r '+region+' '+tcbArgs.join(' '));return {status:0,stdout:'',dry:true};}
  console.log('  $ tcb -e <env> -r '+region+' '+tcbArgs.join(' '));
  const r=spawnSync(process.execPath,full,{cwd:root,stdio:'inherit',encoding:'utf8'});
  if(r.status!==0&&!allowFail){console.error('[deploy] 命令失败：tcb '+tcbArgs.join(' '));process.exit(1);}
  return r;
}
function node(script,scriptArgs=[]){
  if(dry){console.log('  [dry-run] node scripts/'+script+' '+scriptArgs.join(' '));return {status:0,dry:true};}
  console.log('  $ node scripts/'+script+' '+scriptArgs.join(' '));
  const r=spawnSync(process.execPath,[path.join(__dirname,script),...scriptArgs],{cwd:root,stdio:'inherit'});
  if(r.status!==0){console.error('[deploy] 步骤失败：'+script);process.exit(1);}
  return r;
}

function ask(q){const rl=readline.createInterface({input:process.stdin,output:process.stdout});return new Promise(res=>rl.question(q,a=>{rl.close();res(a.trim());}));}

(async()=>{
 console.log('\n==================== 部署确认 ====================');
 console.log('目标 CloudBase 环境 ID : '+cloudEnv);
 console.log('地域                  : '+region);
 console.log('将执行的操作：');
 console.log('  • 初始化数据库 schema（幂等；已存在的记录不会被覆盖）');
 console.log('  • 创建/更新云函数 math2-api，并写入运行时身份环境变量（UID/邮箱，仅服务端）');
 console.log('  • 上传 public/ 到静态网站托管（站点将可被公网访问）');
 console.log('注意：以上会在你的腾讯云账号中创建/更新资源并产生公网访问，CloudBase 可能按用量计费。');
 console.log('本脚本不会购买套餐、不会修改你其它环境、不会删除任何数据。');
 console.log('==================================================');
 if(!yes&&!dry){
  const a=await ask('确认部署请输入环境 ID（'+cloudEnv+'），或输入 n 取消：');
  if(a!==cloudEnv){console.log('[deploy] 已取消。');process.exit(0);}
 }

 // 3) Build artifacts --------------------------------------------------------
 if(!skipBuild){
  console.log('\n[deploy] 1/4 准备构建产物');
  const bankPath=path.join(root,'private/data/bank.json');
  if(!fs.existsSync(bankPath)){console.log('  未发现题库，生成示例题库（部署正式内容前请导入你自己的题库）。');node('make-demo-bank.cjs');}
  node('setup.cjs');
  node('build.cjs');
 } else console.log('\n[deploy] 1/4 跳过构建（--skip-build）');

 // 4) Database init (idempotent) --------------------------------------------
 console.log('\n[deploy] 2/4 初始化数据库 schema（幂等）');
 if(!fs.existsSync(path.join(root,'schema.sql'))){console.error('[deploy] 缺少 schema.sql，请先运行构建步骤。');process.exit(1);}
 node('sql.cjs',['schema.sql']);

 // 5) Deploy function (inject env vars into cloudbaserc, then restore) -------
 console.log('\n[deploy] 3/4 部署云函数与静态托管');
 const rcPath=path.join(root,'cloudbaserc.json');
 const rcOriginal=fs.readFileSync(rcPath,'utf8');
 try{
  if(!dry){
   const rc=JSON.parse(rcOriginal);
   rc.envId=cloudEnv;
   rc.functions=rc.functions||[];
   const fn=rc.functions.find(f=>f.name==='math2-api')||{name:'math2-api'};
   fn.envVariables={MATH2_ENV_ID:fnEnv,MATH2_ALLOWED_UID:env.get('MATH2_ALLOWED_UID'),MATH2_ALLOWED_EMAIL:env.get('MATH2_ALLOWED_EMAIL'),MATH2_REGION:region};
   if(!rc.functions.includes(fn))rc.functions.push(fn);
   fs.writeFileSync(rcPath,JSON.stringify(rc,null,2));
  } else {
   console.log('  [dry-run] 将临时向 cloudbaserc.json 注入 envId 与函数环境变量（MATH2_ENV_ID/UID/EMAIL/REGION），部署后自动还原，不写入版本库');
  }
  tcb(['fn','deploy','math2-api','--force','--install-dependency','false']);
 } finally {
  if(!dry){fs.writeFileSync(rcPath,rcOriginal);console.log('  已还原 cloudbaserc.json（未写入任何凭据）');}
 }
 tcb(['hosting','deploy','public']);

 // 6) Health check -----------------------------------------------------------
 console.log('\n[deploy] 4/4 健康检查');
 let health=null;
 if(!dry){
  const r=spawnSync(process.execPath,[cliEntry,'-e',cloudEnv,'-r',region,'fn','invoke','math2-api','-d',JSON.stringify({action:'health'}),'--json'],{cwd:root,encoding:'utf8'});
  try{const out=JSON.parse(r.stdout||'{}');health=JSON.stringify(out).includes('"ok":true')||/\"ok\"\s*:\s*true/.test(r.stdout||'');}catch{health=/ok"\s*:\s*true/.test(r.stdout||'');}
 } else console.log('  [dry-run] tcb -e <env> fn invoke math2-api -d {"action":"health"}');

 console.log('\n==================== 部署结果 ====================');
 if(dry){console.log('dry-run 完成：未对云端做任何更改。去掉 --dry-run 即可实际部署。');}
 else{
  console.log('云函数进程存活（health）：'+(health?'是 ✓':'未确认（请在控制台查看函数日志）'));
  console.log('数据库可用 / 完整功能  ：未由本脚本验证');
  console.log('');
  console.log('请手动完成最终验证（health 只证明函数进程能响应，不代表数据库或登录可用）：');
  console.log('  1. 打开静态托管默认域名（控制台 → 静态网站 → 访问地址）。');
  console.log('  2. 用 .env 中登记的邮箱（MATH2_ALLOWED_EMAIL）登录，收验证码。');
  console.log('  3. 进入任意题目，写一条笔记，等待“已存本机/已同步”。');
  console.log('  4. 刷新页面，确认笔记仍在（云端读取成功）。');
  console.log('  5. 若提示 ACCESS_DENIED，核对函数环境变量 MATH2_ALLOWED_UID / MATH2_ALLOWED_EMAIL 是否为该账号。');
 }
 console.log('==================================================');
})().catch(e=>{console.error('[deploy] 未预期的错误：',e.message);process.exit(1);});
