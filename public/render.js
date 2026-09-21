import {marked} from './vendor/marked.esm.js';
export function renderContent(element,source,question={id:'分类',resources:{}}){
 const maths=[],images=[];
 let text=String(source??'').replace(/!\[((?:\\.|[^\]\\])*)\]\(([^)]+)\)/g,(_,alt,ref)=>{images.push({alt:alt.replace(/\\([\[\]])/g,'$1'),ref});return `IMAGEPLACEHOLDER${images.length-1}END`});
 text=text.replace(/\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|(?<!\\)\$([^$\n]+?)\$/g,(match,a,b,c,d)=>{maths.push({text:a??b??c??d,display:a!==undefined||b!==undefined});return `MATHPLACEHOLDER${maths.length-1}END`});
 let html=DOMPurify.sanitize(marked.parse(text),{FORBID_TAGS:['img','style','iframe','form','input','button','svg'],FORBID_ATTR:['style','id','name']});
 html=html.replace(/MATHPLACEHOLDER(\d+)END/g,(_,i)=>{const m=maths[i];try{return `<span class="${m.display?'math-block':'math-inline'}">${katex.renderToString(m.text,{displayMode:m.display,throwOnError:true,trust:false,strict:'warn',macros:{}})}</span>`}catch(e){const d=document.createElement('span');d.className='render-error';d.textContent=`题 ${question.id} 公式显示失败：${m.text}（${e.message}）`;return d.outerHTML}}).replace(/IMAGEPLACEHOLDER(\d+)END/g,(_,i)=>`<span data-image="${i}"></span>`);
 element.innerHTML=html;
 element.querySelectorAll('a').forEach(a=>{a.removeAttribute('href');a.removeAttribute('target')});
 element.querySelectorAll('[data-image]').forEach(slot=>{const {alt,ref}=images[Number(slot.dataset.image)];const path=question.resources?.[ref];if(typeof path==='string'&&/^images\/[a-zA-Z0-9_.-]+$/.test(path)){const img=document.createElement('img');img.src=window.math2ImageUrls?.[path]||path;img.alt=alt;img.tabIndex=0;img.onerror=()=>{slot.textContent=`题 ${question.id}：配图加载失败`;slot.className='missing'};const open=()=>{document.querySelector('#large-image').src=img.src;window.math2ResetZoom?.();document.querySelector('#image-dialog').showModal()};img.onclick=open;img.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open()}};slot.replaceChildren(img)}else{slot.className='missing';slot.textContent=`题 ${question.id}：缺少原图「${alt}」，本题内容不完整。`}});
}
