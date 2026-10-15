import {chinaDate} from './daily-data.js';
import {activeCompletions,createHeatmap} from './daily-heatmap.js';

const $=selector=>document.querySelector(selector);
const bankNames={exam:'分类练习',lilin880:'分册练习',yanxuan:'精选练习',all:'全部题库'};
const number=n=>Number.isFinite(Number(n))?Number(n):0;
const nextDate=(date,days)=>new Date(Date.parse(`${date}T12:00:00Z`)+days*86400000).toISOString().slice(0,10);
const shortDate=date=>`${Number(date.slice(5,7))}月${Number(date.slice(8,10))}日`;
const timeText=value=>value?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit'}).format(new Date(value)):'';
const makeId=()=>globalThis.crypto?.randomUUID?.()||`task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const asArray=value=>value instanceof Map?[...value.values()]:Array.isArray(value)?value:[];

export function createDailyUI({index,bank,load,complete,undo,saveTemplate,saveOverride,resolveConflict,onRecoverBackup,exportBackup,prepareNavigation,getCurrentQuestion,isGoalMode,onCompletedNext,onOpenQuestion,onEnterGoal,onLeaveGoal,onLocalWrite}){
 let data={dailyCompletions:[],goalTemplates:[],goalOverrides:[],pendingPracticeOps:[]};
 let today=chinaDate(),editing=[],editorDate=today,historyDate=today,refreshing=Promise.resolve(),midnightTimer,simpleSavedScope=null;
 const allIds=index.questions.map(q=>q.id);
 const bankQuestions=id=>index.questions.filter(q=>(q.bankId||'exam')===id);
 const activeRows=date=>activeCompletions(asArray(data.dailyCompletions).filter(row=>row?.date===date));
 const heatmap=createHeatmap($('#daily-heatmap'),date=>openHistory(date));
 const completedIds=date=>new Set(activeRows(date).map(row=>row.questionId));
 const defaultTemplate=date=>{
  const order=new Map(asArray(data.pendingPracticeOps).map(op=>[op.id,number(op.order)]));
  return asArray(data.goalTemplates).filter(t=>t.effectiveFrom<=date).sort((a,b)=>
   b.effectiveFrom.localeCompare(a.effectiveFrom)||
   Number(!!b._base)-Number(!!a._base)||
   number(order.get(b._base))-number(order.get(a._base))||
   number(b.revision)-number(a.revision)||
   String(b.createdAt||'').localeCompare(String(a.createdAt||''))
  )[0]||null;
 };
 function planFor(date){
  const override=asArray(data.goalOverrides).filter(o=>o.date===date).sort((a,b)=>number(b.revision)-number(a.revision)||String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')))[0];
  const template=defaultTemplate(date);
  if(override?.mode==='rest')return {kind:'rest',mode:null,tasks:[],source:'当天不设目标'};
  if(override?.mode==='custom')return {kind:'plan',mode:override.planMode||'scoped',tasks:override.tasks||[],source:'单日目标'};
  return template?{kind:'plan',mode:template.mode||'scoped',tasks:template.tasks||[],source:'默认目标'}:{kind:'none',mode:null,tasks:[],source:'尚未设置目标'};
 }
 const taskLabel=task=>task.bankId==='all'?'全部题库':[bankNames[task.bankId],...(task.scopeLabels||[])].filter(Boolean).join(' · ');
 function progress(date,plan=planFor(date)){
  const completed=completedIds(date),tasks=(plan.tasks||[]).map(task=>{
   const scope=new Set(task.scopeQuestionIds||[]),actual=[...completed].filter(id=>scope.has(id)).length;
   return {task,actual,target:number(task.targetCount),remaining:Math.max(0,number(task.targetCount)-actual),scope};
  });
  const covered=new Set(tasks.flatMap(t=>[...t.scope]));
  return {completed,total:completed.size,tasks,target:tasks.reduce((s,t)=>s+t.target,0),credited:tasks.reduce((s,t)=>s+Math.min(t.actual,t.target),0),outside:[...completed].filter(id=>!covered.has(id)).length,met:tasks.length>0&&tasks.every(t=>t.actual>=t.target)};
 }
 const pendingCount=()=>asArray(data.pendingPracticeOps).length;
 const blockedOps=()=>asArray(data.pendingPracticeOps).filter(op=>op.blocked);
 const pendingFor=(date,questionId)=>asArray(data.pendingPracticeOps).some(op=>['complete','undo'].includes(op.kind)&&op.payload?.date===date&&op.payload?.questionId===questionId);
 function displaySummary(){
  const box=$('#daily-dashboard'),plan=planFor(today),p=progress(today,plan);
  box.hidden=false;$('#daily-total').textContent=`今日已做 ${p.total} 题`;
  $('#daily-sync').textContent=data.featureReady===false?'每日记录待联网初始化':blockedOps().length?`${blockedOps().length} 条同步冲突需处理`:(pendingCount()?`已存本机，${pendingCount()} 条变更待同步`:'已存本机 · 已同步');
  $('#daily-conflicts-open').hidden=!blockedOps().length;
  const main=$('#daily-progress');main.replaceChildren();
  if(plan.kind!=='plan'){
   main.textContent=plan.kind==='rest'?'当天不设目标 · 做题仍会记入今日统计':'尚未设置目标 · 可以先记题，再设置每日目标';
  }else{
   const strong=document.createElement('strong');strong.textContent=`目标进度 ${p.credited} / ${p.target}`;
   const meter=document.createElement('progress');meter.max=Math.max(1,p.target);meter.value=p.credited;
   const note=document.createElement('div');note.className='daily-progress-note';
   note.textContent=`${p.met?'全部达标':`已完成 ${p.tasks.filter(t=>t.remaining===0).length} / ${p.tasks.length} 项，仍需 ${p.tasks.reduce((s,t)=>s+t.remaining,0)} 题`} · 目标外练习 ${p.outside} 题 · ${plan.source}`;
   main.append(strong,meter,note);
  }
  const tasks=$('#daily-tasks');tasks.replaceChildren();
  for(const item of p.tasks){
   const row=document.createElement('div');row.className='daily-task';
   const info=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('span');
   title.textContent=taskLabel(item.task);detail.textContent=`${item.actual} / ${item.target} 题${item.remaining?` · 还差 ${item.remaining} 题`:' · 已达标'}`;info.append(title,detail);
   const action=document.createElement('button');action.type='button';action.textContent='继续练习';
   action.disabled=!index.questions.some(q=>(item.task.scopeQuestionIds||[]).includes(q.id));
   action.onclick=()=>onEnterGoal(item.task,completedIds(today)).catch(showError);
   if(action.disabled){action.title='该目标范围已没有可练习题目；原目标与历史进度保留，请调整目标';detail.textContent+=' · 当前范围没有可练习题目';}row.append(info,action);tasks.append(row);
  }
 }
 function displayQuestion(q=getCurrentQuestion()){
  const actions=$('#daily-completion-actions');actions.hidden=!q||index.archivedIds?.has(q.id);if(actions.hidden)return;
  const done=completedIds(today).has(q.id);
  $('#daily-complete').hidden=done;$('#daily-complete-next').textContent=done?(isGoalMode()?'下一道未做题':'下一题'):'记为已做并下一题';
  $('#daily-undo').hidden=!done;
  for(const id of ['daily-complete','daily-complete-next','daily-undo'])$('#'+id).disabled=data.featureReady===false;
  $('#daily-completion-status').textContent=data.featureReady===false?'请先联网启用每日记录':done?`今日已做 ✓${pendingFor(today,q.id)?' · 待同步':''}`:'';
 }
 function statusFor(date){
  if(data.featureEnabledFrom&&date<data.featureEnabledFrom)return '未记录';
  const plan=planFor(date),p=progress(date,plan);
  if(plan.kind==='rest')return '当天不设目标';
  if(plan.kind==='none')return '未设目标';
  return p.met?'已达标':'未达标';
 }
 function displayHistory(){
  const p=progress(historyDate),plan=planFor(historyDate),old=data.featureEnabledFrom&&historyDate<data.featureEnabledFrom;
  $('#daily-history-summary').textContent=old?`${historyDate}：功能启用前，未记录每日完成情况。`:`${historyDate}：已做 ${p.total} 题 · ${statusFor(historyDate)}${plan.kind==='plan'?` · 目标进度 ${p.credited} / ${p.target} · ${plan.source}`:''}`;
  const goals=$('#daily-history-goals');goals.replaceChildren();
  for(const item of p.tasks){const row=document.createElement('div'),name=document.createElement('span'),count=document.createElement('strong');row.className='daily-history-goal';name.textContent=taskLabel(item.task);count.textContent=`${item.actual} / ${item.target} 题`;row.append(name,count);goals.append(row)}
  displayConflicts();
  const dates=Array.from({length:7},(_,i)=>nextDate(today,i-6));
  $('#daily-history-seven').textContent=`近 7 天累计 ${dates.reduce((sum,date)=>sum+progress(date).total,0)} 题；同一道题跨日完成按每天各计 1 题。`;
  const max=Math.max(1,...dates.map(date=>progress(date).total));
  const chart=$('#daily-trend-chart'),body=$('#daily-trend-body');chart.replaceChildren();body.replaceChildren();
  for(const date of dates){
   const n=progress(date).total,state=statusFor(date),barWrap=document.createElement('div'),bar=document.createElement('span'),label=document.createElement('span');
   barWrap.className='daily-bar-wrap';bar.className='daily-bar'+(state==='当天不设目标'?' rest':'');bar.style.height=`${Math.max(2,Math.round(n/max*82))}px`;bar.title=`${date}：${state==='未记录'?'未记录':`${n} 题`}，${state}`;
   label.textContent=shortDate(date);barWrap.append(bar,label);chart.append(barWrap);
   const tr=document.createElement('tr');if(date===historyDate)tr.className='current';
   for(const value of [date,state==='未记录'?'未记录':`${n} 题`,state]){const td=document.createElement('td');td.textContent=value;tr.append(td)}
   tr.onclick=()=>{historyDate=date;$('#daily-history-date').value=date;displayHistory()};body.append(tr);
  }
  chart.setAttribute('aria-label',`近 7 天做题趋势：${dates.map(date=>`${shortDate(date)}${statusFor(date)==='未记录'?'未记录':`${progress(date).total}题`}`).join('，')}`);
  const list=$('#daily-history-list');list.replaceChildren();
  const rows=activeRows(historyDate).sort((a,b)=>String(a.occurredAt||'').localeCompare(String(b.occurredAt||'')));
  if(!rows.length){const empty=document.createElement('p');empty.className='daily-history-empty';empty.textContent=old?'当时尚未记录每日完成情况':'这一天没有已记录的题目';list.append(empty);return}
  for(const row of rows){
   const q=index.byId.get(row.questionId),line=document.createElement('div'),info=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('small'),actions=document.createElement('div');
   line.className='daily-history-row';actions.className='daily-history-row-actions';
   title.textContent=q?(q.bankId==='lilin880'?`分册 · ${q.chapterLabel||''} · 第${q.originalNumber}题`:`${bankNames[q.bankId||'exam']} · ${q.year||'例题'} · ${row.questionId}`):`${bankNames[row.bankId]||'原题库'} · ${row.questionId}`;
   if(index.archivedIds?.has(row.questionId))title.textContent+=' · 历史题';
   detail.textContent=[timeText(row.occurredAt),pendingFor(historyDate,row.questionId)?'待同步':'已同步',q?.classification?.[0]?.path?.join(' / ')||row.categoryIdsSnapshot?.join(' / ')].filter(Boolean).join(' · ');
   info.append(title,detail);
   if(q){const open=document.createElement('button');open.type='button';open.textContent='回到题目';open.onclick=async()=>{try{await onOpenQuestion(row.questionId);$('#daily-history-dialog').close()}catch(e){showHistoryError(e)}};actions.append(open)}
   const remove=document.createElement('button');remove.type='button';remove.textContent='撤销误记';remove.onclick=async()=>{try{if(!await prepareNavigation())return;await undo({date:historyDate,questionId:row.questionId});await refresh();onLocalWrite?.();displayHistory()}catch(e){showHistoryError(e)}};actions.append(remove);
   line.append(info,actions);list.append(line);
  }
 }
 function displayConflicts(){
  const panel=$('#daily-conflict-panel'),list=$('#daily-conflict-list'),ops=blockedOps();panel.hidden=!ops.length;list.replaceChildren();
  for(const op of ops){
   const item=document.createElement('div');item.className='daily-conflict-item';
   const title=document.createElement('strong');title.textContent=({complete:'完成记录',undo:'撤销记录',setGoalTemplate:'默认目标',setGoalOverride:'单日目标'})[op.kind]||'练习变更';
   const local=document.createElement('small');local.textContent=`本机待处理：${op.payload?.date||op.payload?.effectiveFrom||''} ${op.payload?.questionId||''} · ${op.blocked}${op.blocked==='BANK_VERSION_MISMATCH'?'：请更新题库后重新设置目标；原目标和待同步内容保留':op.blocked==='QUESTION_RETIRED'?'：此题已移除，请在历史明细核对；原操作可导出恢复':''}${['PAST_GOAL_DATE','INVALID_GOAL','INVALID_GOAL_TIME'].includes(op.blocked)?'：跨日旧目标请核对后恢复，不会补造创建时间':''}`;
   const remote=document.createElement('small');remote.textContent=`云端当前：${op.remote?JSON.stringify(op.remote):'请联网取得最新状态'}`;
   item.append(title,local,remote);
   const retry=document.createElement('button');retry.type='button';retry.textContent='导出备份并保留本机重试';retry.disabled=op.blocked!=='PRACTICE_CONFLICT'||!op.remote;
   retry.onclick=()=>settleConflict(op.id,'local');
   const cloud=document.createElement('button');cloud.type='button';cloud.textContent='导出备份并采用云端';cloud.onclick=()=>settleConflict(op.id,'cloud');
   const recover=document.createElement('button');recover.type='button';recover.textContent='核对并恢复这条目标及待处理记录';recover.onclick=()=>onRecoverBackup?.();item.append(retry,cloud);if(onRecoverBackup) item.append(recover);list.append(item);
  }
 }
 async function settleConflict(id,choice){
  try{
   if(!await prepareNavigation())return;
   await exportBackup('数二冲突处理前备份');
   if(!confirm(`已发起完整备份下载。确认文件已保存后，${choice==='cloud'?'采用云端状态并移除本机冲突操作':'让本机操作按云端最新版本重试'}？`))return;
   await resolveConflict(id,choice);await refresh();onLocalWrite?.();displayHistory();
  }catch(e){showHistoryError(e)}
 }
 const showError=error=>{$('#global-error').textContent=error?.message||String(error)};
 const showHistoryError=error=>{$('#daily-history-error').textContent=error?.message||String(error)};
 async function mark(next=false){
  const q=getCurrentQuestion();if(!q||index.archivedIds?.has(q.id))return;
  const result=$('#daily-completion-status');result.textContent='正在保存…';
  try{
   if(!await prepareNavigation()){result.textContent='请先处理未保存的笔记';return}
   const occurredAt=new Date().toISOString(),date=chinaDate(occurredAt);
   await complete({date,questionId:q.id,bankId:q.bankId||'exam',occurredAt,bankVersion:bank.version,categoryIdsSnapshot:q.categoryIds.map(String)});
   await refresh();onLocalWrite?.();if(date!==today){await onLeaveGoal();return}if(next)await onCompletedNext(completedIds(date));
  }catch(e){result.textContent='保存失败：'+(e?.message||String(e));showError(e)}
 }
 async function retract(date=today,id=getCurrentQuestion()?.id){
  if(!id)return;
  try{if(!await prepareNavigation())return;await undo({date,questionId:id});await refresh();onLocalWrite?.()}catch(e){showError(e);$('#daily-completion-status').textContent='撤销失败：'+(e?.message||String(e))}
 }
 function openHistory(date=today){historyDate=date>today?today:date;$('#daily-history-date').max=today;$('#daily-history-date').value=historyDate;$('#daily-history-error').textContent='';displayHistory();$('#daily-history-dialog').showModal()}

 function firstRoot(id){let n=index.nodes.get(String(id));while(n?.parent_id)n=index.nodes.get(n.parent_id);return n}
 const roots=bankId=>index.roots.filter(n=>(n.bankId||'exam')===bankId&&n.ids.size);
 function desc(root){const out=[];const walk=(n,depth)=>{for(const child of n.children){if(!child.ids.size)continue;out.push({node:child,depth});walk(child,depth+1)}};if(root)walk(root,0);return out}
 function taskDraft(task={}){
  const first=task.categoryIds?.[0],root=firstRoot(first),bankId=task.bankId==='all'?'lilin880':task.bankId||root?.bankId||'lilin880';
  return {taskId:task.taskId||makeId(),bankId,rootId:root?.id||roots(bankId)[0]?.id||'',categoryIds:task.categoryIds?.map(String)||[],targetCount:task.targetCount||5,savedScope:task.scopeQuestionIds||null,savedBankVersion:task.bankVersion||null};
 }
 function buildTask(draft,i){
  const wrap=document.createElement('div');wrap.className='daily-task-editor';
  const head=document.createElement('div');head.className='daily-task-editor-head';const title=document.createElement('strong');title.textContent=`任务 ${i+1}`;
  const remove=document.createElement('button');remove.type='button';remove.textContent='移除';remove.onclick=()=>{editing.splice(i,1);displayEditors();previewGoal()};head.append(title,remove);wrap.append(head);
  const fields=document.createElement('div');fields.className='daily-task-fields';
  const bankLabel=document.createElement('label');bankLabel.textContent='题库';const bankSelect=document.createElement('select');for(const id of ['exam','lilin880','yanxuan']){const option=document.createElement('option');option.value=id;option.textContent=bankNames[id];bankSelect.append(option)}bankSelect.value=draft.bankId;
  bankSelect.onchange=()=>{draft.bankId=bankSelect.value;draft.rootId=roots(draft.bankId)[0]?.id||'';draft.categoryIds=[];displayEditors();previewGoal()};bankLabel.append(bankSelect);
  const rootLabel=document.createElement('label');rootLabel.textContent='板块';const rootSelect=document.createElement('select');for(const root of roots(draft.bankId)){const option=document.createElement('option');option.value=root.id;option.textContent=root.name;rootSelect.append(option)}rootSelect.value=draft.rootId;
  rootSelect.onchange=()=>{draft.rootId=rootSelect.value;draft.categoryIds=[];displayEditors();previewGoal()};rootLabel.append(rootSelect);
  const countLabel=document.createElement('label');countLabel.textContent='每日数量';const count=document.createElement('input');count.type='number';count.min='1';count.max='999';count.step='1';count.value=draft.targetCount;count.oninput=()=>{draft.targetCount=count.value;previewGoal()};countLabel.append(count);
  fields.append(bankLabel,rootLabel,countLabel);wrap.append(fields);
  const hint=document.createElement('p');hint.className='daily-help';hint.textContent='不选章节时覆盖整个板块；选择父级会包含其下题目。';wrap.append(hint);
  const search=document.createElement('input');search.type='search';search.placeholder='查找章节或子类';search.setAttribute('aria-label',`查找任务 ${i+1} 的章节`);wrap.append(search);
  const choices=document.createElement('div');choices.className='daily-chapter-choices';
  const root=index.nodes.get(draft.rootId);
  for(const {node,depth} of desc(root)){
   const label=document.createElement('label');label.style.paddingLeft=`${Math.min(depth,4)*10}px`;label.dataset.search=node.path.join(' / ').toLowerCase();
   const check=document.createElement('input');check.type='checkbox';check.value=node.id;check.checked=draft.categoryIds.includes(node.id);check.onchange=()=>{draft.categoryIds=check.checked?[...draft.categoryIds,node.id]:draft.categoryIds.filter(id=>id!==node.id);previewGoal()};
   const text=document.createElement('span');text.textContent=node.name;label.append(check,text);choices.append(label);
  }
  search.oninput=()=>{const query=search.value.trim().toLowerCase();for(const label of choices.children)label.hidden=!!query&&!label.dataset.search.includes(query)};
  wrap.append(choices);const available=document.createElement('p');available.className='daily-task-available';available.id=`daily-available-${i}`;wrap.append(available);return wrap;
 }
 function displayEditors(){const box=$('#daily-task-editors');box.replaceChildren(...editing.map(buildTask));previewGoal()}
 function taskFromDraft(d){
  const root=index.nodes.get(d.rootId),ids=d.categoryIds.length?d.categoryIds:[d.rootId],scope=new Set();
  for(const id of ids)for(const qid of index.nodes.get(id)?.ids||[])scope.add(qid);
  const names=d.categoryIds.length?d.categoryIds.map(id=>index.nodes.get(id)?.path?.slice(1).join(' / ')||id):[root?.name||''];
  return {taskId:d.taskId,bankId:d.bankId,categoryIds:ids.map(String),targetCount:Number(d.targetCount),scopeQuestionIds:[...scope],bankVersion:bank.version,scopeLabels:[root?.name||'',...names.filter(name=>name&&name!==root?.name)]};
 }
 function readDraft(){
  const mode=document.querySelector('input[name="daily-plan-mode"]:checked')?.value||'simple';
  const tasks=mode==='simple'?[{taskId:editing[0]?.taskId||makeId(),bankId:'all',categoryIds:[],targetCount:Number($('#daily-simple-count').value),scopeQuestionIds:allIds,bankVersion:bank.version,scopeLabels:['全部题库']}]:editing.map(taskFromDraft);
  if(!tasks.length)throw Error('请至少添加一项任务');
  for(const [i,task] of tasks.entries()){
   if(!Number.isInteger(task.targetCount)||task.targetCount<1||task.targetCount>999)throw Error(`任务 ${i+1} 的数量须为 1～999 的整数`);
   if(!task.scopeQuestionIds.length)throw Error(`任务 ${i+1} 没有可用题目，请调整范围`);
   if(task.targetCount>task.scopeQuestionIds.length)throw Error(`任务 ${i+1} 仅有 ${task.scopeQuestionIds.length} 道不同题，请减少数量或扩大范围`);
  }
  const owner=new Map();for(const [i,task] of tasks.entries())for(const id of task.scopeQuestionIds){if(owner.has(id))throw Error(`任务 ${owner.get(id)+1} 与任务 ${i+1} 范围重叠，请合并或调整章节`);owner.set(id,i)}
  return {mode,tasks};
 }
 function previewGoal(){
  const changedScope=(saved,current)=>{if(!saved)return false;const currentIds=new Set(current);return saved.length!==current.length||saved.some(id=>!currentIds.has(id))};
  const simpleChanged=simpleSavedScope&&(changedScope(simpleSavedScope.scopeQuestionIds,allIds)||simpleSavedScope.bankVersion!==bank.version);
  $('#daily-simple-available').textContent=`当前题库共 ${allIds.length} 道不同题。${simpleChanged?`已保存范围 ${simpleSavedScope.scopeQuestionIds.length} 道（题库 ${simpleSavedScope.bankVersion||'未知版本'}），保存会采用当前范围。`:''}`;
  editing.forEach((draft,i)=>{const el=$(`#daily-available-${i}`);if(el){const current=taskFromDraft(draft).scopeQuestionIds,changed=draft.savedScope&&(changedScope(draft.savedScope,current)||draft.savedBankVersion!==bank.version);el.textContent=`所选范围 ${current.length} 道不同题${changed?`；已保存范围 ${draft.savedScope.length} 道（题库 ${draft.savedBankVersion||'未知版本'}），保存会采用当前范围`:''}`}});
  try{const plan=readDraft(),p=progress(editorDate,{kind:'plan',tasks:plan.tasks});$('#daily-goal-error').textContent='';
   $('#daily-goal-preview').textContent=`预估进度：${p.credited} / ${p.target} · 目标外 ${p.outside} 题。\n今天已记的题会保留，并按新范围重新计算。`;
  }catch(e){$('#daily-goal-error').textContent=e.message;$('#daily-goal-preview').textContent='请调整目标后保存。'}
 }
 function loadEditor(date){
  editorDate=date;$('#daily-goal-date').min=today;$('#daily-goal-date').value=date;
  const plan=planFor(date),mode=plan.mode||'simple';
  document.querySelector(`input[name="daily-plan-mode"][value="${mode}"]`).checked=true;
  $('#daily-simple-count').value=plan.mode==='simple'?plan.tasks[0]?.targetCount||20:20;
  simpleSavedScope=plan.mode==='simple'?plan.tasks[0]:null;
  editing=plan.mode==='scoped'?plan.tasks.map(taskDraft):[taskDraft()];
  $('#daily-simple-editor').hidden=mode!=='simple';$('#daily-scoped-editor').hidden=mode!=='scoped';
  $('#daily-goal-current').textContent=`${date} 当前：${plan.source}${plan.kind==='plan'?`，共 ${plan.tasks.reduce((s,t)=>s+number(t.targetCount),0)} 题`:''}。`;
  $('#daily-apply-today').checked=false;$('#daily-apply-today').disabled=date!==today;
  $('#daily-save-default').textContent=`设为默认，从${date>today?shortDate(date):'明天'}起`;
  const template=defaultTemplate(date),defaultTotal=template?.tasks?.reduce((sum,task)=>sum+number(task.targetCount),0)||0;
  $('#daily-restore-default').disabled=!template;
  $('#daily-restore-preview').textContent=template?`恢复后采用 ${template.effectiveFrom} 起生效的默认版本（${template._base?'本机待同步':`修订 ${template.revision||0}`}），共 ${defaultTotal} 题。`:'该日期没有已设置的默认目标。';
  displayEditors();previewGoal();
 }
 function openGoal(date=today){loadEditor(date);$('#daily-goal-dialog').showModal()}
 async function saveDay(){
  try{const {mode,tasks}=readDraft();await saveOverride({date:editorDate,mode:'custom',planMode:mode,tasks});await refresh();onLocalWrite?.();$('#daily-goal-dialog').close()}
  catch(e){$('#daily-goal-error').textContent=e.message}
 }
 async function saveDefault(){
  try{const {mode,tasks}=readDraft(),effectiveFrom=editorDate>today?editorDate:nextDate(today,1);
   await saveTemplate({effectiveFrom,mode,tasks});
   if($('#daily-apply-today').checked)await saveOverride({date:today,mode:'custom',planMode:mode,tasks});
   await refresh();onLocalWrite?.();$('#daily-goal-dialog').close();
  }catch(e){$('#daily-goal-error').textContent=`保存未全部完成：${e.message}。请查看当前目标后重试。`;await refresh()}
 }
 async function setDayMode(mode){
  try{await saveOverride({date:editorDate,mode});await refresh();onLocalWrite?.();$('#daily-goal-dialog').close()}
  catch(e){$('#daily-goal-error').textContent=e.message}
 }
 function bind(){
  $('#daily-complete').onclick=()=>mark(false);$('#daily-complete-next').onclick=()=>mark(true);$('#daily-undo').onclick=()=>retract();
  $('#daily-adjust').onclick=()=>openGoal();$('#daily-details').onclick=()=>openHistory();$('#daily-trend').onclick=()=>openHistory();$('#daily-conflicts-open').onclick=()=>{openHistory();$('#daily-conflict-panel').scrollIntoView({block:'start'})};
  $('#daily-close-goal').onclick=()=>$('#daily-goal-dialog').close();$('#daily-close-history').onclick=()=>$('#daily-history-dialog').close();
  $('#daily-goal-date').onchange=e=>{const date=e.target.value;if(date>=today)loadEditor(date)};
  $('#daily-history-date').onchange=e=>{historyDate=e.target.value&&e.target.value<=today?e.target.value:today;$('#daily-history-date').value=historyDate;displayHistory()};
  for(const radio of document.querySelectorAll('input[name="daily-plan-mode"]'))radio.onchange=()=>{$('#daily-simple-editor').hidden=radio.value!=='simple';$('#daily-scoped-editor').hidden=radio.value!=='scoped';previewGoal()};
  $('#daily-simple-count').oninput=previewGoal;$('#daily-add-task').onclick=()=>{editing.push(taskDraft());displayEditors()};
  $('#daily-save-day').onclick=saveDay;$('#daily-save-default').onclick=saveDefault;
  $('#daily-rest-day').onclick=()=>setDayMode('rest');$('#daily-restore-default').onclick=()=>setDayMode('default');
  $('#daily-exit-goal').onclick=()=>onLeaveGoal().catch(showError);
  $('#daily-review-goal').onclick=()=>onEnterGoal(null,completedIds(today),true).catch(showError);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh().catch(showError)});
  window.setInterval(()=>{if(chinaDate()!==today)refresh().catch(showError)},30000);
  scheduleMidnight();
 }
 function scheduleMidnight(){
  clearTimeout(midnightTimer);
  const next=new Date(`${nextDate(chinaDate(),1)}T00:00:00+08:00`).getTime();
  midnightTimer=setTimeout(()=>{refresh().catch(showError).finally(scheduleMidnight)},Math.max(25,next-Date.now()+25));
 }
 function refresh(){
  refreshing=refreshing.catch(()=>{}).then(async()=>{
   data=await load();const previous=today;today=chinaDate();if(previous!==today){scheduleMidnight();await onLeaveGoal()}displaySummary();displayQuestion();heatmap.update(data,today);
   if($('#daily-history-dialog').open)displayHistory();
  });return refreshing;
 }
 bind();return {refresh,displayQuestion,completedIds,openGoal,openHistory,planFor,progress,getToday:()=>today};
}
