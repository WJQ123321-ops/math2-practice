// Applies a SQL file to your CloudBase PostgreSQL database via the tcb CLI.
// Usage: node scripts/sql.cjs <file.sql> [-e <envId>]
// The environment id is read from -e, or CLOUDBASE_ENV / MATH2_ENV_ID in .env.
const {spawnSync}=require('node:child_process');const path=require('node:path'),fs=require('node:fs');
const env=require('./env.cjs');env.load();
const args=process.argv.slice(2);
const eIdx=args.indexOf('-e');const cliEnv=eIdx>=0?args[eIdx+1]:undefined;
const file=args.find((a,i)=>!a.startsWith('-')&&!(eIdx>=0&&i===eIdx+1));
const envId=cliEnv||env.get('CLOUDBASE_ENV')||env.get('MATH2_ENV_ID');
if(!envId){console.error('缺少 CloudBase 环境 ID：请在 .env 设置 CLOUDBASE_ENV，或用 -e <envId> 传入。');process.exit(1);}
if(!file){console.error('用法：node scripts/sql.cjs <schema.sql> [-e <envId>]');process.exit(1);}
const cliRoot=path.resolve(__dirname,'../node_modules/@cloudbase/cli');
if(!fs.existsSync(cliRoot)){console.error('未找到 @cloudbase/cli，请先运行 npm install。');process.exit(1);}
const pkg=JSON.parse(fs.readFileSync(path.join(cliRoot,'package.json')));
const entry=path.resolve(cliRoot,typeof pkg.bin==='string'?pkg.bin:pkg.bin.tcb);
const sql=fs.readFileSync(path.resolve(file),'utf8');
const r=spawnSync(process.execPath,[entry,'db','execute','-e',envId,'--sql',sql,'--json'],{encoding:'utf8',maxBuffer:10e6});
process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exit(r.status||0);
