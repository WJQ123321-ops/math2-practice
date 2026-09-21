// Server identity gating. The allowed account comes from environment variables, so the
// test sets throwaway values before loading the handler. No real account is referenced.
process.env.MATH2_ENV_ID=process.env.MATH2_ENV_ID||'env-test-only';
process.env.MATH2_ALLOWED_UID=process.env.MATH2_ALLOWED_UID||'1000000000000000001';
process.env.MATH2_ALLOWED_EMAIL=process.env.MATH2_ALLOWED_EMAIL||'deployer@example.com';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const UID=process.env.MATH2_ALLOWED_UID,EMAIL=process.env.MATH2_ALLOWED_EMAIL;
const manifest=require('../functions/math2-api/assets-manifest.json');
const bank=require('../private/data/bank.json');
const legacyBank=require('../private/data/legacy-bank.json');
const part2Count=bank.questions.filter(q=>q.bankId==='lilin880').length;
const legacyCount=legacyBank.questions.length;
const okUser=()=>new Response(JSON.stringify({sub:UID,email:EMAIL,status:'ACTIVE'}));

test('server validates verified provider response and denies other accounts',async()=>{const handler=require('../functions/math2-api/handler.cjs');const old=global.fetch;try{
 assert.equal((await handler.main({action:'manifest'})).error,'AUTH_REQUIRED');
 global.fetch=async()=>new Response(JSON.stringify({sub:'another-account',email:EMAIL,status:'ACTIVE'}));
 assert.equal((await handler.main({action:'manifest',accessToken:'test-token-not-real'})).error,'ACCESS_DENIED');
 global.fetch=async()=>new Response(JSON.stringify({sub:UID,email:'someone@example.com',status:'ACTIVE'}));
 assert.equal((await handler.main({action:'manifest',accessToken:'test-token-not-real'})).error,'ACCESS_DENIED');
 global.fetch=okUser;
 const r=await handler.main({action:'manifest',accessToken:'test-token-not-real'});
 assert.equal(r.ok,true);assert.equal(r.manifest.files.length,manifest.files.length);assert.ok(r.manifest.files.some(f=>f.path==='data/bank.json'));
 assert.equal((await handler.main({action:'asset',path:'../../deployment.private.json',accessToken:'test-token-not-real'})).error,'NOT_FOUND');
}finally{global.fetch=old}});

test('legacy clients retain their bank while v2 clients receive both partitions',async()=>{const handler=require('../functions/math2-api/handler.cjs'),old=global.fetch;try{
 global.fetch=okUser;
 const auth={accessToken:'test-token-not-real',action:'asset',path:'data/bank.json'};
 const legacy=JSON.parse(Buffer.from((await handler.main(auth)).data,'base64'));
 const next=JSON.parse(Buffer.from((await handler.main({...auth,clientVersion:2})).data,'base64'));
 assert.equal(legacy.questions.length,legacyCount);
 assert.equal(next.questions.filter(q=>q.bankId==='lilin880').length,part2Count);
 assert.equal((await handler.main({action:'manifest',clientVersion:2})).error,'AUTH_REQUIRED');
}finally{global.fetch=old}});

test('protected batches validate identity, paths, limits and return exact bytes',async()=>{const handler=require('../functions/math2-api/handler.cjs'),old=global.fetch;try{
 assert.equal((await handler.main({action:'assetBatch',clientVersion:2,paths:['data/bank.json']})).error,'AUTH_REQUIRED');
 global.fetch=okUser;
 const auth={accessToken:'test-token-not-real',clientVersion:2,action:'assetBatch'};
 assert.equal((await handler.main({...auth,paths:['../../handler.cjs']})).error,'NOT_FOUND');
 assert.equal((await handler.main({...auth,paths:Array(17).fill('data/bank.json')})).error,'NOT_FOUND');
 const r=await handler.main({...auth,paths:['data/bank.json']});
 assert.equal(r.ok,true);
 assert.deepEqual(Buffer.from(r.files[0].data,'base64'),fs.readFileSync(path.resolve(__dirname,'../functions/math2-api/assets/data/bank.json')));
}finally{global.fetch=old}});

test('missing deployment config is reported clearly and never binds a default account',async()=>{const handler=require('../functions/math2-api/handler.cjs'),old=global.fetch;const savedUid=process.env.MATH2_ALLOWED_UID;try{
 global.fetch=async()=>new Response(JSON.stringify({sub:'any',email:'any@example.com',status:'ACTIVE'}));
 delete process.env.MATH2_ALLOWED_UID;
 assert.equal((await handler.main({action:'manifest',accessToken:'test-token-not-real'})).error,'CONFIG_MISSING');
 assert.deepEqual(await handler.main({action:'health'}),{ok:true,ready:true,scope:'function'});
}finally{process.env.MATH2_ALLOWED_UID=savedUid;global.fetch=old}});
