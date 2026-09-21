const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const CloudBase=require('@cloudbase/manager-node');const {initial,apply}=require('./engine.cjs');
// Deployment identity comes from cloud-function environment variables. No personal
// environment id, email or UID is baked into the source. Each deployer sets these on
// their own function (see .env.example and docs/DEPLOYMENT.md). Missing config raises
// CONFIG_MISSING rather than silently binding to anyone's environment.
function required(name){const v=process.env[name];if(typeof v!=='string'||!v.trim())throw Error('CONFIG_MISSING');return v.trim();}
const REGION_DEFAULT='ap-shanghai';
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'assets-manifest.json'),'utf8'));
const encoded=v=>`convert_from(decode('${Buffer.from(JSON.stringify(v)).toString('base64')}','base64'),'UTF8')::jsonb`;
function manager(){return CloudBase.init({envId:required('MATH2_ENV_ID'),region:process.env.MATH2_REGION||REGION_DEFAULT,secretId:process.env.TENCENTCLOUD_SECRETID,secretKey:process.env.TENCENTCLOUD_SECRETKEY,token:process.env.TENCENTCLOUD_SESSIONTOKEN});}
async function identity(token){
 if(typeof token!=='string'||token.length<10||token.length>20000)throw Error('AUTH_REQUIRED');
 const uid=required('MATH2_ALLOWED_UID'),email=required('MATH2_ALLOWED_EMAIL').toLowerCase(),gateway=`https://${required('MATH2_ENV_ID')}.api.tcloudbasegateway.com`;
 const r=await fetch(gateway+'/auth/v1/user/me',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('AUTH_REQUIRED');const user=await r.json();
 if(String(user.sub||user.id||user.user_id)!==uid||user.email?.toLowerCase()!==email||user.status&&user.status!=='ACTIVE')throw Error('ACCESS_DENIED');
 return {id:uid,email};
}
exports.main=async event=>{
 try{
  if(event?.action==='health')return {ok:true,ready:true,scope:'function'};
  const user=await identity(event?.accessToken);
  const activeManifest=event.clientVersion===2?manifest:JSON.parse(fs.readFileSync(path.join(__dirname,'legacy-assets-manifest.json'),'utf8'));
  if(event.action==='identity')return {ok:true,user};
  if(event.action==='manifest')return {ok:true,manifest:activeManifest};
  if(event.action==='asset'){
   const entry=activeManifest.files.find(f=>f.path===event.path);if(!entry)throw Error('NOT_FOUND');
   return {ok:true,path:entry.path,sha256:entry.sha256,data:fs.readFileSync(path.join(__dirname,'assets',event.clientVersion!==2&&entry.path==='data/bank.json'?'data/legacy-bank.json':entry.path)).toString('base64')};
  }
  if(event.action==='assetBatch'){
   if(event.clientVersion!==2||!Array.isArray(event.paths)||event.paths.length<1||event.paths.length>16||new Set(event.paths).size!==event.paths.length)throw Error('NOT_FOUND');
   const entries=event.paths.map(p=>activeManifest.files.find(f=>f.path===p));
   if(entries.some(e=>!e)||entries.reduce((n,e)=>n+e.bytes,0)>2500000)throw Error('NOT_FOUND');
   return {ok:true,files:entries.map(e=>({path:e.path,data:fs.readFileSync(path.join(__dirname,'assets',e.path)).toString('base64')}))};
  }
  if(!['sync','restore','preview'].includes(event.action))throw Error('INVALID_ACTION');
  const db=manager().database;
  for(let attempt=0;attempt<6;attempt++){
   const result=await db.executePGSql({Sql:'SELECT revision, data FROM math2_private.state WHERE id=1'});
   const row=JSON.parse(result.Rows[0]);const revision=Number(row[0]),s=typeof row[1]==='string'?JSON.parse(row[1]):row[1];
   if(event.action==='preview')return {ok:true,full:true,epoch:s.epoch,seq:s.seq,records:Object.values(s.records),position:s.position,positions:s.positions||{}};
   const next=apply(s,event);if(next.response.stale)return {ok:true,...next.response};
   if(require('node:util').isDeepStrictEqual(next.state,s))return {ok:true,...next.response};
   const update=`UPDATE math2_private.state SET data=${encoded(next.state)},revision=revision+1 WHERE id=1 AND revision=${revision} RETURNING revision`;
   const sql=next.archive?`WITH changed AS (${update}) INSERT INTO math2_private.restores (epoch,data) SELECT '${s.epoch}',${encoded(s)} FROM changed RETURNING epoch`:update;
   const saved=await db.executePGSql({Sql:sql});if(saved.Rows?.length)return {ok:true,...next.response};
  }
  throw Error('BUSY_RETRY');
 }catch(e){const known=/^(AUTH_REQUIRED|ACCESS_DENIED|CONFIG_MISSING|NOT_FOUND|INVALID_ACTION|PREVIEW_CHANGED|INVALID_BACKUP|INVALID_RECORD|INVALID_FIELD|DUPLICATE_RECORD|TOO_MANY_OPS|BUSY_RETRY)$/;if(!known.test(e.message))console.error('backend_failure',{code:e.code||e.name,requestId:e.requestId});return {ok:false,error:known.test(e.message)?e.message:'SERVICE_UNAVAILABLE'};}
};
