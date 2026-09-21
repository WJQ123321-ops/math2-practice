// Builds the protected cloud-function assets from private/, regenerates the asset
// manifests (v2 + legacy) and rewrites schema.sql with a fresh EMPTY state document.
// Idempotent: safe to re-run. Never touches any cloud environment.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const fnDir=path.join(root,'functions/math2-api');
const dest=path.join(fnDir,'assets');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const mime=name=>name.endsWith('.json')?'application/json':name.endsWith('.png')?'image/png':'image/jpeg';

const privData=path.join(root,'private/data'),privImages=path.join(root,'private/images');
if(!fs.existsSync(privData)||!fs.readdirSync(privData).length){console.error('缺少 private/data 题库。请先运行 npm run demo-bank 生成示例题库，或导入你自己的题库到 private/data。');process.exit(1);}
fs.mkdirSync(path.join(dest,'data'),{recursive:true});
fs.cpSync(privData,path.join(dest,'data'),{recursive:true});
if(fs.existsSync(privImages)){fs.mkdirSync(path.join(dest,'images'),{recursive:true});fs.cpSync(privImages,path.join(dest,'images'),{recursive:true});}

function listDir(dir){return fs.existsSync(dir)?fs.readdirSync(dir):[];}
const images=listDir(path.join(dest,'images')).map(name=>({name,data:fs.readFileSync(path.join(dest,'images',name))}));

// v2 manifest: full bank + every image. legacy-bank.json is served via a path alias, not listed.
const files=[];
const bankData=fs.readFileSync(path.join(dest,'data/bank.json'));
files.push({path:'data/bank.json',bytes:bankData.length,sha256:sha(bankData),type:'application/json'});
for(const img of images)files.push({path:'images/'+img.name,bytes:img.data.length,sha256:sha(img.data),type:mime(img.name)});
const version=sha(JSON.stringify(files)).slice(0,16);
fs.writeFileSync(path.join(fnDir,'assets-manifest.json'),JSON.stringify({version,files}));

// legacy manifest: old clients (clientVersion!==2) request path 'data/bank.json' but the
// handler serves data/legacy-bank.json, so the entry's size/hash must match that file.
const legacyPath=path.join(dest,'data/legacy-bank.json');
let legacyInfo=null;
if(fs.existsSync(legacyPath)){
 const legacyData=fs.readFileSync(legacyPath);
 const legacyFiles=[{path:'data/bank.json',bytes:legacyData.length,sha256:sha(legacyData),type:'application/json'}];
 let refs=new Set();
 try{const lb=JSON.parse(legacyData);for(const q of lb.questions||[])for(const v of Object.values(q.resources||{}))if(typeof v==='string'&&/^images\//.test(v))refs.add(v);}catch{}
 for(const rel of refs){const p=path.join(dest,rel);if(fs.existsSync(p)){const d=fs.readFileSync(p);legacyFiles.push({path:rel,bytes:d.length,sha256:sha(d),type:mime(rel)});}}
 const legacyVersion=sha(JSON.stringify(legacyFiles)).slice(0,16);
 fs.writeFileSync(path.join(fnDir,'legacy-assets-manifest.json'),JSON.stringify({version:legacyVersion,files:legacyFiles}));
 legacyInfo={version:legacyVersion,files:legacyFiles.length};
}

// Fresh empty state document (new random epoch, no records) so a deployer never inherits
// anyone else's data. engine.initial() guarantees an empty records/receipts structure.
const {initial}=require('../functions/math2-api/engine.cjs');
const data=Buffer.from(JSON.stringify(initial())).toString('base64');
fs.writeFileSync(path.join(root,'schema.sql'),`CREATE SCHEMA IF NOT EXISTS math2_private;
REVOKE ALL ON SCHEMA math2_private FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS math2_private.state(id integer PRIMARY KEY CHECK(id=1), revision bigint NOT NULL DEFAULT 0,data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS math2_private.restores(epoch text PRIMARY KEY,data jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE math2_private.state ENABLE ROW LEVEL SECURITY;
ALTER TABLE math2_private.restores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA math2_private FROM PUBLIC,anon,authenticated;
INSERT INTO math2_private.state(id,data) VALUES(1,convert_from(decode('${data}','base64'),'UTF8')::jsonb) ON CONFLICT(id) DO NOTHING;`);
console.log(JSON.stringify({version,files:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0),legacy:legacyInfo}));
