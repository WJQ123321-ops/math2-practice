const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
(async()=>{
 const port=18788,base='http://127.0.0.1:'+port;
 const output=path.resolve(__dirname,'../test-results/opensource');fs.mkdirSync(output,{recursive:true});
 const state=path.join(output,'preview-state-'+Date.now()+'.json');
 const server=spawn(process.execPath,[path.resolve(__dirname,'../scripts/serve-mock.cjs')],{env:{...process.env,MATH2_MOCK_PORT:String(port),MATH2_MOCK_STATE_FILE:state},windowsHide:true,stdio:['ignore','pipe','pipe']});
 let browser;
 try{
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(Error('Preview server exited '+code)));});
  browser=await chromium.launch({channel:process.env.MATH2_BROWSER_CHANNEL||'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1365,height:1000}}),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.locator('#question .meta').waitFor({timeout:30000});
  await page.waitForFunction(()=>document.querySelector('#offline-status').textContent==='可离线使用',{timeout:45000});
  assert.equal(await page.locator('.render-error,.missing').count(),0);
  await page.locator('#note').fill('开源版验收笔记');await page.waitForFunction(()=>document.querySelector('#save-status').textContent==='已存本机');
  await page.locator('#daily-complete').click();await page.waitForFunction(()=>document.querySelector('#daily-total').textContent.includes('1'));
  await page.locator('#daily-adjust').click();await page.locator('#daily-simple-count').fill('2');await page.locator('#daily-save-day').click();await page.locator('#daily-goal-dialog').waitFor({state:'hidden'});
  await page.locator('.scratchpad-toggle').click();const canvas=page.locator('.scratchpad canvas');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();
  await page.mouse.move(box.x+30,box.y+30);await page.mouse.down();await page.mouse.move(box.x+160,box.y+90,{steps:8});await page.mouse.up();assert.equal(await page.locator('[data-action="undo"]').isEnabled(),true);
  await page.locator('[data-action="undo"]').click();assert.equal(await page.locator('[data-action="undo"]').isEnabled(),false);
  await page.locator('#next').click();assert.equal(await page.locator('[data-action="undo"]').isEnabled(),false);
  for(const bank of ['lilin880','yanxuan','exam']){await page.locator('[data-bank="'+bank+'"]').click();await page.locator('#question .meta').waitFor();assert.equal(await page.locator('.render-error,.missing').count(),0);}
  await page.locator('#prev').click();await page.waitForFunction(()=>document.querySelector('#note').value==='开源版验收笔记');
  await page.waitForFunction(()=>document.querySelector('#sync-status').textContent==='已同步');
  await page.screenshot({path:path.join(output,'desktop.png'),fullPage:true});
  await context.setOffline(true);await page.reload();await page.locator('#question .meta').waitFor();assert.equal(await page.locator('#note').inputValue(),'开源版验收笔记');await context.setOffline(false);
  await page.locator('#backup').click();const download=page.waitForEvent('download');await page.locator('#export').click();const file=await download;await file.saveAs(path.join(output,'backup.json'));
  const backup=JSON.parse(fs.readFileSync(path.join(output,'backup.json')));assert.equal(backup.schemaVersion,3);assert.equal(backup.records[0].note,'开源版验收笔记');assert.equal(backup.dailyCompletions.filter(r=>r.completed).length,1);
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.querySelector('aside').getBoundingClientRect().right<=1);await page.screenshot({path:path.join(output,'mobile.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.locator('#menu-toggle').click();await page.locator('[data-bank="yanxuan"]').click();await page.locator('#question .meta').waitFor();
  assert.equal(await page.locator('#global-error').innerText(),'');assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,partitions:3,notes:true,completion:true,goal:true,scratchpad:true,offlineReload:true,backup:true,mobile:true,errors}));
 }finally{if(browser)await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1});
