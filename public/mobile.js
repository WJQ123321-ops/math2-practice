const $=s=>document.querySelector(s);
$('#menu-toggle').onclick=()=>{const on=document.body.classList.toggle('drawer-open');$('#menu-toggle').setAttribute('aria-expanded',String(on));$('#drawer-shade').hidden=!on;};
$('#drawer-shade').onclick=()=>{document.body.classList.remove('drawer-open');$('#drawer-shade').hidden=true;$('#menu-toggle').setAttribute('aria-expanded','false')};
$('#tree').addEventListener('click',e=>{if(e.target.closest('.node')&&matchMedia('(max-width:900px)').matches)$('#drawer-shade').click()});
$('#filter-toggle').onclick=()=>{const on=document.body.classList.toggle('filters-open');$('#filter-toggle').setAttribute('aria-expanded',String(on))};
let scale=1,x=0,y=0;const points=new Map();let oldDistance=0;
const transform=()=>{$('#large-image').style.transform=`translate(${x}px,${y}px) scale(${scale})`};
window.math2ResetZoom=()=>{scale=1;x=0;y=0;transform()};$('#zoom-in').onclick=()=>{scale=Math.min(8,scale*1.4);transform()};$('#zoom-out').onclick=()=>{scale=Math.max(1,scale/1.4);transform()};$('#zoom-reset').onclick=window.math2ResetZoom;
const stage=$('#image-stage');stage.onpointerdown=e=>{stage.setPointerCapture(e.pointerId);points.set(e.pointerId,{x:e.clientX,y:e.clientY});oldDistance=0;};stage.onpointermove=e=>{const previous=points.get(e.pointerId);if(!previous)return;points.set(e.pointerId,{x:e.clientX,y:e.clientY});if(points.size===2){const [a,b]=[...points.values()],distance=Math.hypot(a.x-b.x,a.y-b.y);if(oldDistance)scale=Math.max(1,Math.min(8,scale*distance/oldDistance));oldDistance=distance;}else{x+=e.clientX-previous.x;y+=e.clientY-previous.y;}transform()};stage.onpointerup=stage.onpointercancel=e=>{points.delete(e.pointerId);oldDistance=0;};stage.onwheel=e=>{e.preventDefault();scale=Math.max(1,Math.min(8,scale*(e.deltaY<0?1.1:1/1.1)));transform()};
function keyboard(){const viewport=window.visualViewport;document.body.classList.toggle('keyboard-open',!!viewport&&window.innerHeight-viewport.height>150);}window.visualViewport?.addEventListener('resize',keyboard);

const mobileTop=document.querySelector('.mobile-top');if(mobileTop&&typeof ResizeObserver!=='undefined')new ResizeObserver(()=>document.documentElement.style.setProperty('--topbar-h',mobileTop.getBoundingClientRect().height+'px')).observe(mobileTop);

$('#banks').addEventListener('click',e=>{if(e.target.closest('[data-bank]')&&matchMedia('(max-width:900px)').matches)$('#drawer-shade').click()});
