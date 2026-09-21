#!/usr/bin/env node
// Local, offline install/verify pipeline. Creates NO cloud resources and touches NO
// remote environment. Idempotent and safe to re-run.
//
//   node scripts/install.cjs [--skip-test] [--skip-demo] [--force-demo]
//
// Steps: check Node -> generate demo bank (if needed) -> setup assets/manifests/schema
//        -> build front-end + function bundles -> run the Node test suites.
const {spawnSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');
const env=require('./env.cjs');
const root=path.resolve(__dirname,'..');
const args=process.argv.slice(2);
const has=f=>args.includes(f);

function fail(msg){console.error('\n[install] '+msg);process.exit(1);}
function run(label,script,extraEnv={}){
  console.log('\n[install] '+label);
  const r=spawnSync(process.execPath,[path.join(__dirname,script)],{cwd:root,stdio:'inherit',env:{...process.env,...extraEnv}});
  if(r.status!==0)fail(label+' 失败（退出码 '+r.status+'）。请查看上面的输出。');
}

// 1) Node version ------------------------------------------------------------
const [maj,min]=process.versions.node.split('.').map(Number);
if(maj<20||(maj===20&&min<19))fail('需要 Node.js >= 20.19（当前 '+process.versions.node+'）。请升级后重试：https://nodejs.org');
console.log('[install] Node '+process.versions.node+' ✓');

// 2) Dependencies ------------------------------------------------------------
if(!fs.existsSync(path.join(root,'node_modules')))fail('未找到 node_modules。请先运行 npm ci（或 npm install）。');
env.load(root);

// 3) Demo bank ---------------------------------------------------------------
const bankPath=path.join(root,'private/data/bank.json');
let bankMode=null;
if(fs.existsSync(bankPath)){try{bankMode=JSON.parse(fs.readFileSync(bankPath,'utf8')).mode;}catch{bankMode=null;}}
if(has('--force-demo')){run('生成示例题库（--force-demo）','make-demo-bank.cjs');}
else if(!fs.existsSync(bankPath)){run('生成示例题库（首次安装）','make-demo-bank.cjs');}
else if(bankMode==='demo'&&!has('--skip-demo')){run('刷新示例题库','make-demo-bank.cjs');}
else if(bankMode!=='demo'){console.log('\n[install] 检测到已导入的题库（mode='+bankMode+'），跳过示例题库生成以保护你的数据。如需重建示例题库请加 --force-demo。');}
else {console.log('\n[install] 跳过示例题库生成（--skip-demo）。');}

// 4) Setup + build -----------------------------------------------------------
run('生成受保护资源、清单与空数据库 schema','setup.cjs');
const cloudEnv=env.get('CLOUDBASE_ENV');
if(!cloudEnv)console.warn('\n[install] 警告：.env 未配置 CLOUDBASE_ENV。将用占位环境 ID 构建，仅供本地预览/测试；云同步功能需在 .env 填入真实环境 ID 后重新构建并部署（见 docs/DEPLOYMENT.md）。');
run('构建前端与云函数产物','build.cjs',{CLOUDBASE_ENV:cloudEnv||'local-placeholder'});

// 5) Tests -------------------------------------------------------------------
if(has('--skip-test')){console.log('\n[install] 跳过测试（--skip-test）。');}
else{
  console.log('\n[install] 运行 Node 测试套件');
  const t=spawnSync(process.execPath,['--test','tests/engine.test.cjs','tests/storage.test.cjs','tests/auth.test.cjs','tests/healthcheck.test.cjs','tests/banks.test.cjs'],{cwd:root,stdio:'inherit'});
  if(t.status!==0)fail('测试未通过（退出码 '+t.status+'）。');
}

console.log('\n[install] 本地安装与验证完成 ✓');
console.log('下一步：');
console.log('  1. 复制 .env.example 为 .env，填入你自己的 CloudBase 环境 ID、UID 和邮箱。');
console.log('  2. npx tcb login');
console.log('  3. node scripts/deploy.cjs --dry-run   # 先预览将执行的云端命令');
console.log('  4. node scripts/deploy.cjs             # 确认后部署（会创建/更新云资源并公开站点）');
console.log('  本地静态预览（不含云同步）：npm run serve  → http://127.0.0.1:8787');
