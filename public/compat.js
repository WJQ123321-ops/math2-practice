// Fallbacks are limited to the plain JSON data used by this application.
export function cloneData(value){return typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value));}
export function randomId(){
 if(typeof crypto.randomUUID==='function')return crypto.randomUUID();
 const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
 const h=Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export function installDialogs(){
 for(const d of document.querySelectorAll('dialog'))if(typeof d.showModal!=='function'){
  d.classList.add('dialog-fallback');d.setAttribute('role','dialog');d.setAttribute('aria-modal','true');
  let previous;
  d.showModal=()=>{previous=document.activeElement;d.setAttribute('open','');d.querySelector('input,button')?.focus();};
  d.close=()=>{d.removeAttribute('open');previous?.focus();};
  d.addEventListener('submit',e=>{if(e.target.getAttribute('method')==='dialog'){e.preventDefault();d.close();}});
  d.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();d.close();d.dispatchEvent(new Event('cancel'));}if(e.key==='Tab'){const els=[...d.querySelectorAll('input,button,select,textarea,[tabindex]')].filter(x=>!x.disabled&&x.tabIndex>=0);if(!els.length)return;const first=els[0],last=els[els.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
 }
}
