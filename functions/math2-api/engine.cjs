const crypto = require('node:crypto');
const FIELDS = ['note','status','favorite','wrong','noteConflicts','contentHash','conflicts'];
const defaults = {note:'',status:'new',favorite:false,wrong:false,noteConflicts:[],contentHash:'',conflicts:{}};
function validValue(f,v){if(f==='conflicts')return v&&typeof v==='object'&&!Array.isArray(v)&&Object.entries(v).every(([k,a])=>['note','status','favorite','wrong'].includes(k)&&Array.isArray(a)&&a.length<=2000&&a.every(x=>x&&typeof x.id==='string'&&validValue(k,x.value)));return f==='noteConflicts'?Array.isArray(v)&&v.length<=2000&&v.every(x=>typeof x==='string'&&x.length<=2000000):f==='status'?['new','learning','mastered'].includes(v):['favorite','wrong'].includes(f)?typeof v==='boolean':typeof v==='string'&&v.length<=2000000;}
function initial(){return {epoch:crypto.randomUUID(),seq:0,records:{},receipts:{},position:null};}
function checkRecord(r){if(!r||!/^(?:cxyonly:\d+|lilin880:edition-[a-zA-Z0-9-]+:vol\d+:ch\d+:group\d+:(?:single_choice|fill_blank|essay):q\d+)$/.test(r.id))throw Error('INVALID_RECORD');for(const f of FIELDS)if(!validValue(f,r[f]??defaults[f]))throw Error('INVALID_FIELD');}
function apply(state,request){
 const s=structuredClone(state), ack=[], errors=[];
 if(request.epoch&&request.epoch!==s.epoch)return {state:s,response:{epoch:s.epoch,seq:s.seq,stale:true,ack:[],records:Object.values(s.records),position:s.position,positions:s.positions||{}}};
 if(request.action==='restore'){
  if(request.expectedSeq!==s.seq||request.epoch!==s.epoch)throw Error('PREVIEW_CHANGED');
  if(!Array.isArray(request.records)||request.records.length>10000)throw Error('INVALID_BACKUP');
  const next=initial();next.seq=s.seq+1;if(request.position&&/^(?:cxyonly:\d+|lilin880:edition-[a-zA-Z0-9-]+:vol\d+:ch\d+:group\d+:(?:single_choice|fill_blank|essay):q\d+)$/.test(request.position.current||''))next.position={current:request.position.current,device:'restore',seq:next.seq};
  if(next.position)next.positions={[next.position.current.startsWith('lilin880:')?'lilin880':'exam']:next.position};
  for(const [k,p] of Object.entries(request.bankPositions||{})){if(p?.current==='')continue;if(!['exam','lilin880'].includes(k)||typeof p?.current!=='string'||!(k==='exam'?/^cxyonly:\d+$/:/^lilin880:edition-[a-zA-Z0-9-]+:vol\d+:ch\d+:group\d+:(?:single_choice|fill_blank|essay):q\d+$/).test(p.current))throw Error('INVALID_BACKUP');next.positions={...(next.positions||{}),[k]:{current:p.current,device:'restore',seq:next.seq}};}
  for(const r of request.records){checkRecord(r);if(next.records[r.id])throw Error('DUPLICATE_RECORD');next.records[r.id]={id:r.id,...Object.fromEntries(FIELDS.map(f=>[f,r[f]??structuredClone(defaults[f])])),updatedAt:new Date().toISOString(),fieldVersions:Object.fromEntries(FIELDS.map(f=>[f,next.seq])),cloudVersion:next.seq};}
  return {state:next,response:{epoch:next.epoch,seq:next.seq,ack:[],records:Object.values(next.records),position:next.position,positions:next.positions||{},restored:true},archive:s};
 }
 if((request.ops||[]).length>100)throw Error('TOO_MANY_OPS');
 for(const op of request.ops||[]){
  if(op.epoch!==s.epoch){errors.push({id:op.id,error:'STALE_EPOCH'});continue;}
  if(!/^[a-zA-Z0-9-]{10,100}$/.test(op.id||'')||!/^(?:cxyonly:\d+|lilin880:edition-[a-zA-Z0-9-]+:vol\d+:ch\d+:group\d+:(?:single_choice|fill_blank|essay):q\d+)$/.test(op.questionId||'')){errors.push({id:op.id,error:'INVALID_OP'});continue;}
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify(op)).digest('hex');
  if(s.receipts[op.id]){if(s.receipts[op.id].fingerprint===fingerprint)ack.push(op.id);else errors.push({id:op.id,error:'OP_ID_REUSED'});continue;}
  if(!op.changes||Object.keys(op.changes).some(f=>!FIELDS.includes(f)||!validValue(f,op.changes[f].value))){errors.push({id:op.id,error:'INVALID_FIELD'});continue;}
  const r=s.records[op.questionId]||{...structuredClone(defaults),id:op.questionId,fieldVersions:{},conflicts:{}};
  ++s.seq;
  for(const [f,change] of Object.entries(op.changes)){
   const base=typeof change.base==='string'?s.receipts[change.base]?.versions?.[f]:change.base;
   const equal=JSON.stringify(r[f])===JSON.stringify(change.value);
   const matches=base===(r.fieldVersions[f]||0);
   if(f==='conflicts'){for(const [key,variants]of Object.entries(change.value)){r.conflicts[key]=[...new Map([...(r.conflicts[key]||[]),...variants].map(v=>[JSON.stringify(v.value),v])).values()];}}
   else if((matches&&(!r.conflicts[f]?.length||change.resolve))||equal){r[f]=change.value;if(change.resolve&&matches)delete r.conflicts[f];}
   else if(f==='noteConflicts'){r[f]=[...new Set([...r[f],...change.value])];}
   else if(f==='contentHash'){r[f]=change.value;}
   else {const variants=r.conflicts[f]||[];if(!variants.some(v=>JSON.stringify(v.value)===JSON.stringify(change.value)))variants.push({id:op.id,value:change.value});r.conflicts[f]=variants;}
   r.fieldVersions[f]=s.seq;
  }
  r.cloudVersion=s.seq;r.updatedAt=new Date().toISOString();s.records[r.id]=r;
  s.receipts[op.id]={fingerprint,versions:{...r.fieldVersions}};ack.push(op.id);
 }
 if(request.position&&/^(?:cxyonly:\d+|lilin880:edition-[a-zA-Z0-9-]+:vol\d+:ch\d+:group\d+:(?:single_choice|fill_blank|essay):q\d+)$/.test(request.position.current||'')){if(!s.positions)s.positions=s.position?{[s.position.current.startsWith('lilin880:')?'lilin880':'exam']:s.position}:{};s.position={current:request.position.current,device:request.device||'',seq:s.seq};s.positions={...(s.positions||{}),[request.position.current.startsWith('lilin880:')?'lilin880':'exam']:s.position};}
 const cursor=Number.isSafeInteger(request.cursor)?request.cursor:0;
 return {state:s,response:{epoch:s.epoch,seq:s.seq,ack,errors,records:Object.values(s.records).filter(r=>(r.cloudVersion||0)>cursor),position:s.position,positions:s.positions||{}}};
}
module.exports={initial,apply,FIELDS,defaults};
