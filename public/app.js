import {cloneData,randomId,installDialogs} from './compat.js';
import {startCloud,syncNow,cloudApi,cloudRestore} from './cloud.js';
import {blank,indexBank,filterQuestions,validateBackup,previewImport,mergeBackupForRestore,orderedExportGoals} from './core.js';
import {openDB,snapshot,getMeta,putMeta,saveRecord,importRecords} from './storage.js';
import {renderContent} from './render.js';
import {createScratchpad} from './scratchpad.js';
import {loadPractice,saveCompletion,undoCompletion,saveGoalTemplate,saveGoalOverride,resolvePracticeConflict} from './daily-data.js';
import {createDailyUI} from './daily-ui.js';
import {previewRecovery,finishRecovery,describeGoal} from './backup-recovery.js';
const $=s=>document.querySelector(s),labels={single_choice:'选择题',fill:'填空题',essay:'解答题',subjective:'主观题'},viewNames={all:'全部题目',favorite:'我的收藏',wrong:'错题回顾',history:'历史题'};
let bank,index,db,records=new Map(),queue=[],draft=null,dirty=false,editCounter=0,timer,pending=Promise.resolve(true),importData,importExpected,cloudPreview,lastExport,sessionResume,recoveryPlan,recoveryCurrent=false,recoveryChoices={},recoveryDownloaded=false;
let state={bankId:'exam',search:'',view:'all',category:'',year:'',type:'',status:'',current:'',expanded:[]};
let dailyUI,goalTask=null,normalState=null,goalReview=false;
const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('math2-records'):null;
const scratchpad=createScratchpad();
function error(e){$('#global-error').textContent=e.message||String(e)}
function status(text,bad=false){$('#save-status').textContent=text;$('#save-status').style.color=bad?'#aa3333':'#527254';$('#save-recovery').hidden=!bad}
function button(text,fn,className=''){const b=document.createElement('button');b.textContent=text;b.className=className;b.onclick=()=>Promise.resolve(fn()).catch(error);return b}
function content(parent,text,q){const div=document.createElement('div');div.className='content';renderContent(div,text,q);parent.append(div);return div}
const retiredNotice='上次题目已从当前练习范围移除，已切换到可用题目；旧题正文、笔记、收藏和每日记录仍可在历史记录中查看。';
function migrateRetiredPosition(){if(!index.archivedIds.has(state.current))return false;state={...state,view:'all',category:'',year:'',type:'',status:'',search:'',current:''};return true}
async function savePosition(publish=false){if(goalTask)return;try{await putMeta(db,'position',cloneData(state));const positions=await getMeta(db,'bankPositions')||{};positions[state.bankId]=cloneData(state);await putMeta(db,'bankPositions',positions);if(publish){await putMeta(db,'pendingPosition',{current:state.current,nonce:randomId()});window.dispatchEvent(new Event('math2-position-save'));}}catch(e){error(Error('练习位置保存失败：'+e.message))}}
function flush(){clearTimeout(timer);pending=pending.then(async()=>{if(!dirty||!draft)return true;const version=editCounter,value=cloneData(draft);status('保存中…');try{const saved=await saveRecord(db,value,value.revision);records.set(saved.id,saved);if(draft?.id===saved.id){draft.revision=saved.revision;draft.updatedAt=saved.updatedAt;if(version===editCounter){dirty=false;status('已存本机')}else{status('有新输入，等待保存');timer=setTimeout(flush,450)}}channel?.postMessage({id:saved.id});renderTree();return true}catch(e){status('保存失败：'+e.message,true);return false}});return pending}
async function prepareNavigation(){if(!await flush())return false;if(dirty)return prepareNavigation();return true}
function changeRecord(){if(!draft)return;draft.status=$('#mastery').value;draft.favorite=$('#favorite').getAttribute('aria-pressed')==='true';draft.wrong=$('#wrong').getAttribute('aria-pressed')==='true';draft.note=$('#note').value;if(!draft.contentHash)draft.contentHash=index.byId.get(draft.id).contentHash;dirty=true;editCounter++;status('保存中…');clearTimeout(timer);timer=setTimeout(flush,450)}
function syncFilters(){$('#year-label').hidden=state.bankId==='lilin880';$('#number-label').hidden=!['lilin880','yanxuan'].includes(state.bankId);$('#number-search').value=state.search||'';for(const key of ['year','type','status'])$('#'+key).value=state[key]}
function renderTree(){
 if(goalTask?.bankId==='all'&&index.byId.has(state.current)){const activeBank=index.byId.get(state.current).bankId||'exam';if(state.bankId!==activeBank){state.bankId=activeBank;syncFilters()}}
 const areaQuestions=index.questions.filter(q=>(q.bankId||'exam')===state.bankId);const practiced=areaQuestions.filter(q=>(records.get(q.id)||blank(q.id)).status!=='new').length;$('#banks').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.bank===state.bankId));document.querySelector('h1').textContent=state.bankId==='lilin880'?'分册练习':state.bankId==='yanxuan'?'精选练习':'分类练习';
 $('#overview').innerHTML=`<strong>${practiced}</strong> / ${areaQuestions.length} 题已评估掌握程度 <progress value="${practiced}" max="${areaQuestions.length||1}"></progress>`;
 $('#views').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.view===state.view));
 const build=nodes=>{const ul=document.createElement('ul');for(const n of nodes.filter(n=>n.ids.size)){const li=document.createElement('li'),row=document.createElement('div');row.className='tree-row';const children=n.children.filter(c=>c.ids.size),expanded=state.expanded.includes(n.id);const expand=button(children.length?(expanded?'▾':'▸'):'·',()=>{state.expanded=expanded?state.expanded.filter(id=>id!==n.id):[...state.expanded,n.id];renderTree();return savePosition()},'expander');expand.disabled=!children.length;expand.setAttribute('aria-label',(expanded?'折叠':'展开')+n.name);if(children.length)expand.setAttribute('aria-expanded',String(expanded));const select=button('',()=>setFilter({category:n.id}),'node'+(state.category===n.id?' active':''));renderContent(select,n.name);const count=document.createElement('span');count.className='count';count.textContent=` ${[...n.ids].filter(id=>(records.get(id)||blank(id)).status!=='new').length}/${n.ids.size}`;select.append(count);row.append(expand,select);li.append(row);if(expanded)li.append(build(children));ul.append(li)}return ul};$('#tree').replaceChildren(build(index.roots.filter(n=>(n.bankId||'exam')===state.bankId)));
 const node=index.nodes.get(state.category);renderContent($('#breadcrumb'),viewNames[state.view]+(node?' / '+node.path.join(' / '):''));
}
function renderList(){const panel=$('#question-list');panel.replaceChildren(...queue.map((q,i)=>button((q.bankId==='lilin880'?`${i+1}. ${q.chapterLabel} · ${q.groupLabel} · ${labels[q.type]||q.type} 第${q.originalNumber}题`:`${i+1}. ${q.year||'例题'} · ${labels[q.type]||q.type} · #${q.id.split(':')[1]}`)+(index.archivedIds.has(q.id)?' · 历史题':''),()=>navigateTo(q.id),q.id===state.current?'active':'')))}
function expandPath(){const q=index.byId.get(state.current);let node=index.nodes.get(state.category||String(q?.categoryIds[0]));while(node){if(!state.expanded.includes(node.id))state.expanded.push(node.id);node=index.nodes.get(node.parent_id)}}
function renderQuestion(){
 scratchpad.setQuestion(state.current);
 const q=index.byId.get(state.current),at=queue.findIndex(q=>q.id===state.current),article=$('#question');article.replaceChildren();article.classList.toggle('source-page',q?.bankId==='lilin880');$('#record-panel').hidden=!q;$('#prev').disabled=at<=0;$('#next').disabled=at<0||at>=queue.length-1;$('#counter').textContent=q?`当前第 ${at+1} 题 / 共 ${queue.length} 题`:'当前筛选没有题目';
 if(!q){draft=null;article.innerHTML=state.view==='history'?'<div class="empty">本分区没有已保存的历史题记录。</div>':goalTask&&!goalReview?'<div class="empty">本目标范围今天已全部做过。可以回看本范围题目，或退出目标练习。</div>':'<div class="empty">当前分类和筛选条件没有匹配题目。<br>可以清除筛选，或切换题集。</div>';renderList();dailyUI?.displayQuestion(null);renderGoalBanner();return}
 draft=cloneData(records.get(q.id)||blank(q.id));dirty=false;
 if(index.archivedIds.has(q.id)){const history=document.createElement('p');history.className='notice';history.textContent='历史题：已从当前练习范围移除。正文、答案、笔记与学习状态保留；不再计入新的练习或目标。';article.append(history)}
 const meta=document.createElement('div');meta.className='meta';for(const text of (q.bankId==='lilin880'?['分册练习',q.chapterLabel,q.groupLabel,labels[q.type]||q.type,`第${q.originalNumber}题`]:[q.year?String(q.year):'例题',labels[q.type]||q.type,...q.papers,`#${q.id.split(':')[1]}`])){const tag=document.createElement('span');tag.className='tag';tag.textContent=text;meta.append(tag)}article.append(meta);if(q.selectedSubquestions?.length){const scope=document.createElement('p');scope.className='scope-note';scope.textContent='本次重点：仅做第 '+q.selectedSubquestions.join('、')+' 小问；题面保留公共条件。';article.append(scope);}content(article,q.document.stem_md,q);
 if((q.displayOptions??q.document.options)?.length){const options=document.createElement('div');options.className='options';(q.displayOptions??q.document.options).forEach(o=>{const b=button('',()=>{options.querySelectorAll('button').forEach(el=>{el.classList.remove('selected');el.setAttribute('aria-pressed','false')});b.classList.add('selected');b.setAttribute('aria-pressed','true')},'option');b.setAttribute('aria-pressed','false');const label=document.createElement('b');label.textContent=o.label;b.append(label);content(b,o.content_md,q);options.append(b)});article.append(options)}
 article.append(scratchpad.element);
 const answer=q.document.answer?.reference_answer_md??(q.document.answer?.option_ids||[]).map(id=>q.document.options?.find(o=>o.id===id)?.label||id).join('、');
 for(const [title,text] of [['查看答案',answer],['详细解析',q.document.explanation_md]]){const d=document.createElement('details'),s=document.createElement('summary');s.textContent=title;d.append(s);content(d,text,q);article.append(d)}
 const source=document.createElement('details'),summary=document.createElement('summary');summary.textContent='来源与知识点';source.append(summary);const info=document.createElement('p');info.textContent=q.source;source.append(info);for(const c of q.classification){const line=document.createElement('p');renderContent(line,c.path.join(' / ')+`（${c.source}）`);source.append(line)}for(const text of q.resourceNotes||[]){const line=document.createElement('p');line.className='source-note';line.textContent=text;source.append(line)}article.append(source);
 if(draft.contentHash&&draft.contentHash!==q.contentHash){const note=document.createElement('p');note.className='notice';note.textContent='本题内容版本已变化；原笔记和掌握状态已保留，请重新核对。';article.prepend(note)}
 $('#mastery').value=draft.status;$('#favorite').setAttribute('aria-pressed',String(draft.favorite));$('#favorite').textContent=draft.favorite?'★ 已收藏':'☆ 收藏';$('#wrong').setAttribute('aria-pressed',String(draft.wrong));$('#wrong').textContent=draft.wrong?'已标记错题':'标记错题';$('#note').value=draft.note;status(records.has(q.id)?'已存本机':'尚无学习记录');renderConflicts();renderFieldConflicts();renderList();dailyUI?.displayQuestion(q);renderGoalBanner();
}
function renderConflicts(){const box=$('#conflicts');box.replaceChildren();for(const note of draft?.noteConflicts||[]){const d=document.createElement('div');d.className='conflict-note';const title=document.createElement('strong');title.textContent='保留的另一份笔记（请核对）';const p=document.createElement('p');p.textContent=note;d.append(title,p);box.append(d)}}
function renderFieldConflicts(){const box=$('#conflicts');for(const [field,variants] of Object.entries(draft?.conflicts||{})){if(!variants.length)continue;const d=document.createElement('div');d.className='conflict-note';const title=document.createElement('strong');title.textContent=({note:'笔记',status:'掌握状态',favorite:'收藏',wrong:'错题'})[field]+'有并发修改，请选择保留值';d.append(title);for(const v of [{value:draft[field],id:'current'},...variants]){const p=document.createElement('p');p.textContent=typeof v.value==='string'?v.value:JSON.stringify(v.value);d.append(p,button('采用此版本',async()=>{if(!await prepareNavigation())return;const value=cloneData(draft);if(field==='note'){value.noteConflicts=[...new Set([...(value.noteConflicts||[]),value.note,...variants.map(x=>x.value)])].filter(x=>x&&x!==v.value);}value[field]=v.value;const saved=await saveRecord(db,value,value.revision,field);records.set(saved.id,saved);renderQuestion();await syncNow();}));}box.append(d);}}
function renderGoalBanner(){const bar=$('#daily-goal-mode');bar.hidden=!goalTask;if(!goalTask)return;const completed=dailyUI?.completedIds(dailyUI.getToday())||new Set(),remaining=queue.filter(q=>!completed.has(q.id)).length;$('#daily-goal-mode-label').textContent=`目标练习 · ${goalTask.scopeLabels?.join(' / ')||goalTask.bankId} · 今天还可做 ${remaining} 题${goalReview?' · 回看全部题目':''}`;$('#daily-review-goal').hidden=!!state.current||goalReview}
async function enterGoal(task,completed=new Set(),review=false){
 if(review&&goalTask){goalReview=true;state.current=queue[0]?.id||'';renderTree();renderQuestion();return}
 if(!task)return;if(!await prepareNavigation())return;
 if(!goalTask)normalState=cloneData(state);
 goalTask=task;goalReview=false;
 const scope=new Set(task.scopeQuestionIds||[]);queue=index.questions.filter(q=>scope.has(q.id));
 state={...state,bankId:task.bankId==='all'?(queue[0]?.bankId||'exam'):task.bankId,view:'all',category:'',year:'',type:'',status:'',search:'',current:queue.find(q=>!completed.has(q.id))?.id||''};
 syncFilters();expandPath();renderTree();renderQuestion();$('#question').scrollIntoView({behavior:'instant',block:'start'});
}
async function leaveGoal(){if(!goalTask)return;if(!await prepareNavigation())return;goalTask=null;goalReview=false;state=normalState||state;normalState=null;queue=filterQuestions(index,records,state);if(!queue.some(q=>q.id===state.current))state.current=queue[0]?.id||'';syncFilters();expandPath();renderTree();renderQuestion()}
async function setFilter(patch,publish=true){if(!await prepareNavigation())return;if(goalTask){goalTask=null;goalReview=false;state=normalState||state;normalState=null}state={...state,...patch};const migrated=state.view==='all'&&migrateRetiredPosition();queue=filterQuestions(index,records,state);if(!queue.some(q=>q.id===state.current))state.current=queue[0]?.id||'';syncFilters();$('#notice').textContent=[baseNotice(),migrated?retiredNotice:''].filter(Boolean).join(' ');expandPath();renderTree();renderQuestion();await savePosition(publish)}
async function navigateTo(id){if(!await prepareNavigation())return;if(!goalTask)queue=filterQuestions(index,records,state);state.current=queue.some(q=>q.id===id)?id:queue[0]?.id||'';expandPath();renderTree();renderQuestion();await savePosition(true);$('#question').scrollIntoView({behavior:'instant',block:'start'})}
async function openDailyQuestion(id){const q=index.byId.get(id);if(!q)return;if(!await prepareNavigation())return;if(goalTask)await leaveGoal();await setFilter({bankId:q.bankId||'exam',view:'all',category:'',year:'',type:'',status:'',search:'',current:id});if(index.archivedIds.has(id)){queue=[q];state.current=id;renderTree();renderQuestion()}}
async function completedNext(completed){
 if(!goalTask){await move(1);return}
 if(goalReview){await move(1);return}
 const current=queue.findIndex(q=>q.id===state.current),next=[...queue.slice(current+1),...queue.slice(0,Math.max(0,current+1))].find(q=>!completed.has(q.id));
 state.current=next?.id||'';renderTree();renderQuestion();if(next)$('#question').scrollIntoView({behavior:'instant',block:'start'});
}
async function move(delta){if(!await prepareNavigation())return;if(goalTask){const at=queue.findIndex(q=>q.id===state.current),target=queue[at+delta];if(target)await navigateTo(target.id);return}const old=queue,oldAt=old.findIndex(q=>q.id===state.current),fresh=filterQuestions(index,records,state);let target;if(fresh.some(q=>q.id===state.current)){const i=fresh.findIndex(q=>q.id===state.current);target=fresh[i+delta]?.id}else{const ids=new Set(fresh.map(q=>q.id));const tail=delta>0?old.slice(oldAt+1):old.slice(0,oldAt).reverse();target=tail.find(q=>ids.has(q.id))?.id||fresh[delta>0?0:fresh.length-1]?.id}await navigateTo(target||state.current)}
function download(data,name){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000)}
async function makeBackup(){if(!await prepareNavigation())throw Error('请先处理未保存的笔记');const snap=await snapshot(db);return {app:'math2-practice',schemaVersion:3,pendingOperations:snap.ops,pendingPracticeOperations:snap.practiceOps||[],sync:snap.sync,bankVersion:bank.version,exportedAt:new Date().toISOString(),records:[...snap.records.values()],dailyCompletions:snap.dailyCompletions||[],goalTemplates:orderedExportGoals(snap.goalTemplates||[],snap.practiceOps||[]),goalOverrides:snap.goalOverrides||[],position:snap.position||state,bankPositions:snap.bankPositions}}
async function exportBackup(prefix='数二学习记录'){const data=await makeBackup();download(data,`${prefix}-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);lastExport=new Date().toLocaleString();await putMeta(db,'lastExport',lastExport);$('#last-export').textContent='最近导出：'+lastExport;return data}
function recoveryOptionText(value){
 if(value==null)return '无记录';if(Array.isArray(value))return value.length?`优先：${describeGoal(value.at(-1))}（保留 ${value.length} 个版本）`:'无目标';
 return typeof value.completed==='boolean'?(value.completed?'已完成':'已撤销'):describeGoal(value);
}
function updateRecoveryButton(){
 $('#recovery-submit').disabled=!recoveryDownloaded||!$('#recovery-downloaded').checked||recoveryPlan?.conflicts.some(c=>!recoveryChoices[c.id])||!!recoveryPlan?.issues.length&&!$('#recovery-partial').checked||!cloudPreview||cloudPreview.capabilities?.backupRecovery!==1||(!recoveryCurrent&&!!(importExpected?.ops.length+importExpected?.practiceOps.length));
}
function renderRecovery(){
 recoveryPlan=previewRecovery(importData,cloudPreview,$('#recovery-mode').value);recoveryChoices={};recoveryDownloaded=false;$('#recovery-downloaded').checked=false;
 const p=recoveryPlan.summary,n=importExpected.ops.length+importExpected.practiceOps.length;
 $('#recovery-summary').textContent=`备份含 ${recoveryPlan.operationCount} 条未同步操作，原设备无需可用。可恢复 ${p.records} 条学习记录、${p.daily} 条每日记录（新增 ${p.addedDaily} 条）、${p.templates} 个默认目标版本、${p.overrides} 个单日目标。${p.recordConflicts} 题的笔记或状态不同，合并会保留另一版本供核对。${recoveryPlan.mode==='replace'?`完整替换将移除云端 ${p.removedRecords} 条学习记录、${p.removedDaily} 条每日记录和 ${p.removedGoals} 个目标。`: '合并保留未冲突的云端内容。'}${n?`本机 ${n} 条队列${recoveryCurrent?'将在恢复成功后由已确认的新快照替换':'需先同步；有阻塞时可使用“核对并恢复本机待处理记录”'}。`:'本机没有待同步操作。'}`;
 const list=$('#recovery-conflicts');list.replaceChildren();
 for(const c of recoveryPlan.conflicts){
  const row=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=c.label;row.append(legend);
  const label=document.createElement('label');label.textContent='请选择保留的状态（未选择前不会提交）';const select=document.createElement('select');select.dataset.conflict=c.id;select.setAttribute('aria-label',c.label);
  const empty=document.createElement('option');empty.value='';empty.textContent='待核对：请逐项选择';select.append(empty);
  for(const o of c.options){const option=document.createElement('option');option.value=o.id;option.textContent=o.label+' · '+recoveryOptionText(o.value);select.append(option)}
  select.onchange=()=>{recoveryChoices[c.id]=select.value;updateRecoveryButton()};label.append(select);row.append(label);list.append(row);
 }
 if(!recoveryPlan.conflicts.length)list.textContent='未发现需要选择的每日记录或目标冲突。';
 const issues=$('#recovery-issues');issues.replaceChildren();for(const item of recoveryPlan.issues){const li=document.createElement('li');li.textContent=item.label+'：'+item.reason;issues.append(li)}
 $('#recovery-partial-label').hidden=!recoveryPlan.issues.length;$('#recovery-partial').checked=false;$('#recovery-issues-title').hidden=!recoveryPlan.issues.length;
 $('#recovery-panel').hidden=false;$('#import-actions').hidden=true;
 if(cloudPreview.capabilities?.backupRecovery!==1)$('#backup-error').textContent='服务器尚未启用新版恢复；可查看预览并保存文件，待服务升级后提交。';
 updateRecoveryButton();
}
async function loadImport(raw,current=false){
 importData=null;recoveryPlan=null;recoveryCurrent=current;cloudPreview=null;$('#recovery-panel').hidden=true;$('#import-actions').hidden=true;$('#backup-error').textContent='';$('#import-preview').textContent='';
 if(!await prepareNavigation())throw Error('请先处理未保存的笔记');
 importData=raw.schemaVersion===3?raw:validateBackup(raw);
 try{cloudPreview=await cloudApi('preview')}catch(e){if(raw.schemaVersion===3)throw Error('新版备份需联网预览；文件已保留，请联网后重新选择。'+e.message)}
 importExpected=await snapshot(db);
 if(raw.schemaVersion===3){$('#recovery-mode').value='merge';renderRecovery();return}
 const p=previewImport(importData,importExpected.records,index);
 $('#import-preview').textContent=`匹配 ${p.matched} 题 · 新记录 ${p.added} · 同题冲突 ${p.conflicts} · 未匹配 ${p.unknown} · 含笔记 ${p.notes}。旧备份不含每日记录和目标，这部分云端数据会保留。`;
 $('#merge').disabled=false;$('#pre-replace').disabled=false;$('#replace').disabled=true;$('#import-actions').hidden=false;
}
async function recoverCurrent(){try{
 if(!await prepareNavigation())return;const raw=await makeBackup();$('#daily-history-dialog').close();$('#backup-dialog').showModal();await loadImport(raw,true);
 }catch(e){$('#backup-dialog').showModal();$('#backup-error').textContent=e.message}}
async function submitRecovery(){try{
 if(!await prepareNavigation())return;if(!$('#recovery-downloaded').checked||!recoveryDownloaded)throw Error('请先下载并确认恢复前备份已保存');
 const data=finishRecovery(recoveryPlan,recoveryChoices,$('#recovery-partial').checked);
 if(!confirm(`按已选择的 ${recoveryPlan.conflicts.length} 项冲突结果${recoveryPlan.mode==='merge'?'合并':'完整替换'}云端记录？${recoveryPlan.issues.length?'仅恢复可用内容，异常项仍保存在原文件中。':''}`))return;
 $('#recovery-submit').disabled=true;await cloudRestore(data,cloudPreview,importExpected,recoveryCurrent);
 const snap=await snapshot(db);records=snap.records;if(snap.position)state=snap.position;channel?.postMessage({all:true});$('#backup-dialog').close();await setFilter({});await dailyUI?.refresh();
 $('#notice').textContent=baseNotice()+' '+(recoveryPlan.issues.length?`已恢复可用内容；${recoveryPlan.issues.length} 项未自动处理，请保留原备份。`:'已按确认结果恢复，未同步操作已折算为最终状态。');
 }catch(e){$('#backup-error').textContent=e.message}finally{updateRecoveryButton()}}
async function doImport(mode){try{if(!importData)throw Error('请先选择文件');if(!await prepareNavigation())return;if(mode==='replace'){if(!cloudPreview)throw Error('请联网重新选择备份预览');if(importData.schemaVersion===3&&importData.pendingPracticeOperations?.length)throw Error('备份含未同步的每日操作，请先在原设备同步或处理，再完整恢复');await cloudRestore(importData,cloudPreview,importExpected)}else if(importData.schemaVersion===3){if(!cloudPreview?.practiceFull)throw Error('新版备份合并需要联网取得完整云端预览');const merged=mergeBackupForRestore(importData,cloudPreview);await exportBackup('数二合并前备份');if(!confirm('已发起完整备份下载。确认文件已保存后，按预览结果合并并恢复到云端？'))return;await cloudRestore(merged,cloudPreview,importExpected)}else await importRecords(db,importData,mode,importExpected);const snap=await snapshot(db);records=snap.records;if((mode==='replace'||importData.schemaVersion===3)&&snap.position)state=snap.position;channel?.postMessage({all:true});$('#backup-dialog').close();await setFilter({});await dailyUI?.refresh();$('#notice').textContent=baseNotice()+' 已导入备份；每日记录与目标已按备份版本处理。'}catch(e){$('#backup-error').textContent=e.message}}
function baseNotice(){return bank.mode==='demo'?'示例题库 · 仅供体验，请按仓库导入指南加入自己的题目。':''}
async function boot(){
 installDialogs();
 bank=await startCloud();index=indexBank(bank);db=await openDB();const snap=await snapshot(db);records=snap.records;lastExport=snap.lastExport;const previous=snap.position?.current;if(snap.position)state={...state,...snap.position};state.bankId=index.byId.get(state.current)?.bankId||(state.current.startsWith('lilin880:')?'lilin880':(state.bankId||'exam'));sessionResume=cloneData(state);const retiredPosition=migrateRetiredPosition();
 if(state.category&&!index.nodes.has(state.category))state.category='';state.expanded=state.expanded.filter(id=>index.nodes.has(id));
 for(const [key,values] of [['year',[...new Set(index.questions.filter(q=>q.year).map(q=>q.year))].sort((a,b)=>b-a)],['type',[...new Set(index.questions.map(q=>q.type))]]])for(const v of values){const option=document.createElement('option');option.value=v;option.textContent=labels[v]||v;$('#'+key).append(option)}
 $('#version').textContent='题库 '+bank.version;$('#notice').textContent=baseNotice();await setFilter({},false);if(retiredPosition)$('#notice').textContent+=' '+retiredNotice;if(previous&&!index.byId.has(previous))$('#notice').textContent+=' 上次题目不在当前题库，已进入可用题目；旧记录仍保留。';
 dailyUI=createDailyUI({index,bank,load:()=>loadPractice(db),complete:value=>saveCompletion(db,value),undo:value=>undoCompletion(db,value),saveTemplate:value=>saveGoalTemplate(db,value),saveOverride:value=>saveGoalOverride(db,value),resolveConflict:(id,choice)=>resolvePracticeConflict(db,id,choice),onRecoverBackup:recoverCurrent,exportBackup,prepareNavigation,getCurrentQuestion:()=>index.byId.get(state.current),isGoalMode:()=>!!goalTask&&!goalReview,onCompletedNext:completedNext,onOpenQuestion:openDailyQuestion,onEnterGoal:enterGoal,onLeaveGoal:leaveGoal,onLocalWrite:()=>syncNow().catch(error)});
 await dailyUI.refresh();
 if(!await getMeta(db,'dailyLabelExplained')){$('#notice').textContent=[$('#notice').textContent,'原“未做”状态现称“未评估”，表示尚未评估掌握程度，不代表从未做过。'].filter(Boolean).join(' ');await putMeta(db,'dailyLabelExplained',true)}
 $('#banks').onclick=async e=>{const b=e.target.closest('[data-bank]');if(!b||b.dataset.bank===state.bankId||!await prepareNavigation())return;await savePosition();const positions=await getMeta(db,'bankPositions')||{};await setFilter({view:'all',category:'',year:'',type:'',status:'',search:'',current:'',expanded:[],...(positions[b.dataset.bank]||{}),bankId:b.dataset.bank});};$('#number-search').oninput=()=>setFilter({search:$('#number-search').value}).catch(error);
 $('#views').onclick=e=>{const b=e.target.closest('[data-view]');if(b)setFilter({view:b.dataset.view,category:''}).catch(error)};
 for(const key of ['year','type','status'])$('#'+key).onchange=()=>setFilter({[key]:$('#'+key).value}).then(syncFilters).catch(error);
 $('#clear').onclick=()=>setFilter({view:'all',category:'',year:'',type:'',status:'',search:''});$('#resume').onclick=async()=>{const s=await snapshot(db);const saved=s.sync.positions?.[state.bankId]||s.bankPositions?.[state.bankId];const id=saved?.current||((index.byId.get(s.sync.position?.current)?.bankId||'exam')===state.bankId?s.sync.position.current:null);if(id&&index.byId.has(id)&&(index.byId.get(id).bankId||'exam')===state.bankId)await setFilter({view:'all',category:'',year:'',type:'',status:'',search:'',current:id});else await setFilter({});};
 $('#list-toggle').onclick=()=>{$('#question-list').hidden=!$('#question-list').hidden;$('#list-toggle').setAttribute('aria-expanded',String(!$('#question-list').hidden))};$('#prev').onclick=()=>move(-1);$('#next').onclick=()=>move(1);
 $('#note').oninput=changeRecord;$('#mastery').onchange=()=>{if(draft)draft.contentHash=index.byId.get(draft.id).contentHash;changeRecord();flush()};for(const id of ['favorite','wrong'])$('#'+id).onclick=()=>{const el=$('#'+id),next=el.getAttribute('aria-pressed')!=='true';el.setAttribute('aria-pressed',String(next));el.textContent=id==='favorite'?(next?'★ 已收藏':'☆ 收藏'):(next?'已标记错题':'标记错题');changeRecord();flush()};
 $('#retry').onclick=flush;$('#copy-note').onclick=()=>navigator.clipboard.writeText($('#note').value).then(()=>status('草稿已复制；尚未保存',true)).catch(error);
 $('#reload-record').onclick=async()=>{if(!draft)return;const local=cloneData(draft);await pending;const snap=await snapshot(db);records=snap.records;draft=cloneData(records.get(local.id)||blank(local.id));if(local.note&&local.note!==draft.note)draft.noteConflicts=[...new Set([...draft.noteConflicts,...local.noteConflicts,local.note])];$('#note').value=draft.note;$('#mastery').value=draft.status;$('#favorite').setAttribute('aria-pressed',String(draft.favorite));$('#favorite').textContent=draft.favorite?'★ 已收藏':'☆ 收藏';$('#wrong').setAttribute('aria-pressed',String(draft.wrong));$('#wrong').textContent=draft.wrong?'已标记错题':'标记错题';dirty=true;editCounter++;renderConflicts();await flush()};
 $('#backup').onclick=()=>{$('#last-export').textContent=lastExport?'最近导出：'+lastExport:'尚未导出备份';$('#backup-dialog').showModal()};$('#close-backup').onclick=()=>$('#backup-dialog').close();$('#close-image').onclick=()=>$('#image-dialog').close();$('#export').onclick=()=>exportBackup().catch(e=>$('#backup-error').textContent=e.message);
 $('#import-file').onchange=async e=>{importData=null;recoveryPlan=null;$('#recovery-panel').hidden=true;$('#import-actions').hidden=true;try{const file=e.target.files[0];if(!file)return;if(file.size>20000000)throw Error('备份超过20MB，请检查文件');await loadImport(JSON.parse(await file.text()))}catch(e){$('#recovery-submit').disabled=true;$('#backup-error').textContent=e.message}};
 $('#merge').onclick=()=>doImport('merge');$('#pre-replace').onclick=async()=>{try{await exportBackup('数二替换前备份');$('#replace').disabled=false}catch(e){$('#backup-error').textContent=e.message}};$('#replace').onclick=()=>doImport('replace');
 $('#recovery-mode').onchange=()=>{try{renderRecovery()}catch(e){$('#backup-error').textContent=e.message}};
 $('#recovery-refresh').onclick=async()=>{try{await loadImport(importData,recoveryCurrent)}catch(e){$('#backup-error').textContent=e.message}};
 $('#recover-current').onclick=recoverCurrent;
 $('#recovery-original').onclick=()=>download(importData,'数二原始恢复备份.json');
 $('#recovery-save-usable').onclick=()=>{try{download(finishRecovery(recoveryPlan,recoveryChoices,$('#recovery-partial').checked),'数二已核对可恢复内容.json')}catch(e){$('#backup-error').textContent=e.message}};
 $('#recovery-export-before').onclick=async()=>{try{
  const local=await makeBackup();
  download(local,'数二恢复前本机备份.json');
  download({app:'math2-practice',schemaVersion:3,bankVersion:bank.version,exportedAt:new Date().toISOString(),sync:{epoch:cloudPreview.epoch},records:cloudPreview.records.map(r=>({...blank(r.id),...r,revision:r.cloudVersion||0})),dailyCompletions:cloudPreview.dailyCompletions,goalTemplates:orderedExportGoals(cloudPreview.goalTemplates),goalOverrides:cloudPreview.goalOverrides,pendingPracticeOperations:[],position:null,bankPositions:{}},'数二恢复前云端备份.json');
  recoveryDownloaded=true;updateRecoveryButton();
 }catch(e){$('#backup-error').textContent=e.message}};
 $('#recovery-downloaded').onchange=updateRecoveryButton;$('#recovery-partial').onchange=updateRecoveryButton;$('#recovery-submit').onclick=submitRecovery;
 const refreshRecords=async()=>{const snap=await snapshot(db);const current=snap.records.get(state.current);records=snap.records;renderTree();if(draft&&(current?.revision||0)!==draft.revision){if(dirty)status('另一页面已更新，当前草稿已保留',true);else renderQuestion()}await dailyUI?.refresh()};channel&&(channel.onmessage=refreshRecords);window.addEventListener('math2-cloud-change',refreshRecords);window.addEventListener('math2-practice-change',()=>dailyUI?.refresh().catch(error));window.math2Flush=prepareNavigation;
 window.addEventListener('beforeunload',e=>{if(dirty){flush();e.preventDefault();e.returnValue=''}});document.addEventListener('visibilitychange',()=>{if(document.hidden)flush()});
 if(document.modelContext?.registerTool){try{await document.modelContext.registerTool({name:'read_practice_position',description:'读取当前题号、筛选条件和题数，不显示答案。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:async input=>{if(!input||Object.keys(input).length)throw Error('不接受参数');return {questionId:state.current,count:queue.length,filters:{view:state.view,category:state.category,year:state.year,type:state.type,status:state.status}}}})}catch(e){console.warn('WebMCP不可用',e)}}
}
boot().then(()=>{for(const el of document.querySelectorAll('[data-boot-disabled]')){el.disabled=false;el.removeAttribute('data-boot-disabled');}$('#startup-panel').hidden=true;}).catch(e=>{error(e);$('#startup-message').textContent=e.message||'启动未完成，请重试';$('#startup-retry').hidden=false;$('#startup-retry').onclick=()=>location.reload();$('#question').textContent='启动尚未完成，暂不能做题。已有本地记录仍保留。';});
