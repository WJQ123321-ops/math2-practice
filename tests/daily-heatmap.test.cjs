require('./bank-fixture.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');

test('calendar spans the prior anniversary exclusively, including leap days and week padding',async()=>{
 const {heatmapModel}=await import('../public/daily-heatmap.js');
 for(const [today,start,length] of [['2026-09-29','2025-09-30',365],['2024-02-29','2023-03-01',366],['2025-02-28','2024-02-29',366],['2025-03-01','2024-03-02',365],['2026-01-01','2025-01-02',365]]){
  const m=heatmapModel({},today);assert.equal(m.start,start);assert.equal(m.days.length,length);
  assert.equal(m.days.at(-1).date,today);assert.ok(m.weeks*7-m.offset-length<7);
  assert.equal(m.offset,(new Date(start+'T12:00:00Z').getUTCDay()+6)%7);
 }
});

test('effective records count across banks and days, deduplicate, undo and respect the visible recorded range',async()=>{
 const {heatmapModel,activeCompletions}=await import('../public/daily-heatmap.js');
 const row=(date,id,extra={})=>({date,questionId:id,completed:true,revision:1,...extra});
 const rows=[row('2026-09-28','missing-from-current-bank'),row('2026-09-29','missing-from-current-bank'),row('2026-09-29','missing-from-current-bank'),row('2026-09-29','lilin880:other-bank'),row('2026-09-29','undone'),row('2026-09-29','undone',{completed:false,_base:'pending'}),row('2026-09-27','superseded'),row('2026-09-27','superseded',{revision:2,completed:false}),row('2026-09-25','before-enabled'),row('2025-09-29','before-range'),row('2026-09-30','future')];
 let m=heatmapModel({dailyCompletions:rows,featureEnabledFrom:'2026-09-26'},'2026-09-29');
 assert.equal(m.total,3);assert.equal(m.activeDays,2);assert.equal(m.days.at(-1).count,2);
 assert.equal(m.days.at(-4).level,'0');assert.equal(m.days.at(-5).level,'unknown');
 const undone=rows.find(r=>r._base);undone.completed=true;
 m=heatmapModel({dailyCompletions:new Map(rows.map((r,i)=>[i,r])),featureEnabledFrom:'2026-09-26'},'2026-09-29');
 assert.equal(m.total,4);assert.equal(activeCompletions(rows).filter(r=>r.date==='2026-09-29').length,3);
});

test('fixed count thresholds never depend on the other days',async()=>{
 const {heatmapModel}=await import('../public/daily-heatmap.js');
 for(const [count,level] of [[0,'0'],[1,'1'],[5,'1'],[6,'2'],[10,'2'],[11,'3'],[20,'3'],[21,'4'],[60,'4']]){
  const dailyCompletions=Array.from({length:count},(_,i)=>({date:'2026-09-29',questionId:`q${i}`,completed:true}));
  assert.equal(heatmapModel({dailyCompletions},'2026-09-29').days.at(-1).level,level);
 }
});
