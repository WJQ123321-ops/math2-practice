const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),esbuild=require('esbuild');
const env=require('./env.cjs');
async function build(){const root=path.resolve(__dirname,'..'),pub=root+'/public';
 env.load(root);
 const cloudEnv=env.get('CLOUDBASE_ENV');
 if(!cloudEnv){console.error('构建失败：缺少 CLOUDBASE_ENV。请复制 .env.example 为 .env，填入你自己的 CloudBase 环境 ID（获取方式见 docs/DEPLOYMENT.md），再重新运行 npm run build。');process.exit(1);}
 const cloudRegion=env.get('CLOUDBASE_REGION')||'ap-shanghai';
 await esbuild.build({entryPoints:[root+'/cloud-entry.js'],bundle:true,minify:true,format:'esm',outfile:pub+'/vendor/cloudbase.js',platform:'browser',define:{__MATH2_ENV__:JSON.stringify(cloudEnv),__MATH2_REGION__:JSON.stringify(cloudRegion)}});
 await esbuild.build({entryPoints:[root+'/functions/math2-api/handler.cjs'],bundle:true,platform:'node',format:'cjs',target:'node20',external:['@aws-sdk/client-s3'],outfile:root+'/functions/math2-api/index.js'});
 const list=[];function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())walk(file);else if(!['sw.js'].includes(item.name)&&/\.(html|js|css|woff2|png|webmanifest|svg)$/.test(item.name)){const data=fs.readFileSync(file);list.push({path:'/'+path.relative(pub,file).replaceAll('\\','/'),sha:crypto.createHash('sha256').update(data).digest('hex'),type:({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'})[path.extname(file)]});}}}walk(pub);const template=fs.readFileSync(root+'/scripts/sw-template.js','utf8');const version=crypto.createHash('sha256').update(JSON.stringify(list)).update(template).digest('hex').slice(0,16);
 fs.writeFileSync(pub+'/sw.js',template.replace('__CACHE_VERSION__',JSON.stringify(version)).replace('__SHELL_FILES__',JSON.stringify(list)));console.log(JSON.stringify({env:cloudEnv,region:cloudRegion,version,shellFiles:list.length}));}
build().catch(e=>{console.error(e);process.exitCode=1});
