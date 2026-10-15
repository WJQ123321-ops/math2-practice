const iso=date=>date.toISOString().slice(0,10);
const parse=date=>new Date(`${date}T12:00:00Z`);
const addDays=(date,n)=>iso(new Date(parse(date).getTime()+n*86400000));

// Shared with the history dialog: pending local records and revisions use the
// same precedence, and question-bank membership never removes old activity.
export function activeCompletions(rows){
 const latest=new Map();
 for(const row of rows instanceof Map?rows.values():rows||[]){
  if(!row?.date||!row.questionId)continue;
  const key=`${row.date}|${row.questionId}`,previous=latest.get(key);
  if(!previous||Number(row.revision||0)>Number(previous.revision||0)||row._base&&!previous._base)latest.set(key,row);
 }
 return [...latest.values()].filter(row=>row.completed!==false);
}

export function heatmapModel(data,today){
 const [year,month,day]=today.split('-').map(Number);
 const priorDay=Math.min(day,new Date(Date.UTC(year-1,month,0)).getUTCDate());
 const start=addDays(iso(new Date(Date.UTC(year-1,month-1,priorDay,12))),1);
 const offset=(parse(start).getUTCDay()+6)%7,counts=new Map();
 for(const row of activeCompletions(data.dailyCompletions)){
  if(row.date>=start&&row.date<=today&&(!data.featureEnabledFrom||row.date>=data.featureEnabledFrom))counts.set(row.date,(counts.get(row.date)||0)+1);
 }
 const days=[];let total=0,activeDays=0;
 for(let date=start;date<=today;date=addDays(date,1)){
  const count=counts.get(date)||0,unrecorded=!!data.featureEnabledFrom&&date<data.featureEnabledFrom;
  days.push({date,count,unrecorded,level:unrecorded?'unknown':count===0?'0':count<=5?'1':count<=10?'2':count<=20?'3':'4'});
  total+=count;if(count)activeDays++;
 }
 return {start,today,offset,days,total,activeDays,weeks:Math.ceil((offset+days.length)/7)};
}

export function createHeatmap(root,onOpen){
 const scroll=root.querySelector('.heatmap-scroll'),grid=root.querySelector('.heatmap-grid'),months=root.querySelector('.heatmap-months');
 const detail=root.querySelector('.heatmap-detail'),summary=root.querySelector('.heatmap-summary'),range=root.querySelector('.heatmap-range');
 let initialized=false,selected=null,focusDate=null;
 const label=day=>`${day.date}：${day.unrecorded?'未记录':`已做 ${day.count} 题`}`;
 function select(button){
  for(const cell of grid.querySelectorAll('button')){cell.tabIndex=cell===button?0:-1;cell.setAttribute('aria-pressed',String(cell===button))}
  selected=button.dataset.date;focusDate=selected;detail.textContent=button.getAttribute('aria-label');
 }
 grid.addEventListener('click',event=>{const button=event.target.closest('button');if(button){select(button);onOpen(button.dataset.date)}});
 grid.addEventListener('focusin',event=>{if(event.target.matches('button')){focusDate=event.target.dataset.date;detail.textContent=event.target.getAttribute('aria-label')}});
 grid.addEventListener('pointerover',event=>{if(event.target.matches('button'))detail.textContent=event.target.getAttribute('aria-label')});
 grid.addEventListener('keydown',event=>{
  const steps={ArrowLeft:-7,ArrowRight:7,ArrowUp:-1,ArrowDown:1};
  if(!(event.key in steps)&&!['Home','End'].includes(event.key))return;
  const cells=[...grid.querySelectorAll('button')],current=cells.indexOf(event.target);if(current<0)return;
  event.preventDefault();const i=event.key==='Home'?0:event.key==='End'?cells.length-1:Math.max(0,Math.min(cells.length-1,current+steps[event.key]));
  select(cells[i]);cells[i].focus({preventScroll:true});cells[i].scrollIntoView({block:'nearest',inline:'nearest'});
 });
 return {update(data,today){
  root.hidden=false;
  if(data.featureReady===false){
   summary.textContent='每日记录待联网初始化';range.textContent='初始化后显示每日做题活动';scroll.hidden=true;root.querySelector('.heatmap-legend').hidden=true;detail.textContent='请先联网启用每日记录，历史掌握状态不会换算为做题数量。';return;
  }
  const model=heatmapModel(data,today),left=scroll.scrollLeft,hadFocus=grid.contains(document.activeElement),fragment=document.createDocumentFragment();
  scroll.hidden=false;root.querySelector('.heatmap-legend').hidden=false;
  summary.textContent=`近一年累计 ${model.total} 题 · 做题 ${model.activeDays} 天`;
  range.textContent=`${model.start} — ${today} · 全部题库 · 北京时间`;
  grid.style.setProperty('--weeks',model.weeks);months.style.setProperty('--weeks',model.weeks);
  const dates=new Set(model.days.map(day=>day.date));if(!dates.has(focusDate))focusDate=today;if(!dates.has(selected))selected=null;
  for(let i=0;i<model.weeks*7;i++){
   const day=model.days[i-model.offset];
   if(!day){const blank=document.createElement('span');blank.className='heatmap-blank';blank.setAttribute('aria-hidden','true');fragment.append(blank);continue}
   const cell=document.createElement('button');cell.type='button';cell.className=`heatmap-cell heatmap-level-${day.level}`;cell.dataset.date=day.date;
   cell.setAttribute('aria-label',label(day));cell.setAttribute('aria-pressed',String(day.date===selected));cell.tabIndex=day.date===focusDate?0:-1;
   if(day.date===today){cell.classList.add('heatmap-today');cell.setAttribute('aria-current','date')}
   fragment.append(cell);
  }
  grid.replaceChildren(fragment);months.replaceChildren();
  model.days.forEach((day,i)=>{
   if(day.date.slice(8)!=='01'&&i!==0)return;
   // A partial first month may share a week with the next month: label the latter.
   if(i===0&&day.date.slice(8)!=='01'&&model.days.slice(1,7-model.offset).some(d=>d.date.slice(8)==='01'))return;
   const month=document.createElement('span');month.style.gridColumn=String(Math.floor((i+model.offset)/7)+1);
   month.textContent=day.date.slice(5,7)==='01'?`${day.date.slice(0,4)}年1月`:`${Number(day.date.slice(5,7))}月`;months.append(month);
  });
  detail.textContent=label(model.days.find(day=>day.date===(selected||focusDate)));
  if(hadFocus)grid.querySelector(`[data-date="${focusDate}"]`)?.focus({preventScroll:true});
  scroll.scrollLeft=initialized?left:scroll.scrollWidth;initialized=true;
 }};
}
