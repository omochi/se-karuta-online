const deck = document.querySelector('#deck');
const jump = document.querySelector('#jump');
const previous = document.querySelector('#previous');
const next = document.querySelector('#next');
const present = document.querySelector('#present');
const overview = document.querySelector('#overview');
const fullscreen = document.querySelector('#fullscreen');
const announcement = document.querySelector('#announcement');
const dialog = document.querySelector('#screenshot-dialog');
const largeImage = document.querySelector('#screenshot-large');
let current = 0;
let all = false;
let presenting = false;
let pages = [];
let slides = [];
const cssPosition = (element, x, y, w, h) => Object.assign(element.style, {
  left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`,
});
function endpoint(box, side) {
  if (side === 'right') return [box.x + box.w, box.y + box.h / 2];
  if (side === 'left') return [box.x, box.y + box.h / 2];
  if (side === 'bottom') return [box.x + box.w / 2, box.y + box.h];
  return [box.x + box.w / 2, box.y];
}
function connector(layer, e, marker) {
  const [x1,y1] = endpoint(e.a,e.from), [x2,y2] = endpoint(e.b,e.to);
  const path = document.createElementNS('http://www.w3.org/2000/svg','path');
  const mid = (y1+y2)/2;
  path.setAttribute('d',e.from==='right' ? `M ${x1} ${y1} L ${x2} ${y2}` : `M ${x1} ${y1} L ${x1} ${mid} L ${x2} ${mid} L ${x2} ${y2}`);
  path.setAttribute('fill','none');path.setAttribute('stroke','#bf492f');path.setAttribute('stroke-width','2.5');
  path.setAttribute('marker-end',`url(#${marker})`);
  if(e.both)path.setAttribute('marker-start',`url(#${marker})`);
  layer.append(path);
}
function renderSlide(data) {
  const article = document.createElement('article');
  article.className='slide-page';article.dataset.number=data.number;
  const viewport=document.createElement('div');viewport.className='slide-viewport';
  const canvas=document.createElement('section');canvas.className='slide';canvas.style.background=data.background;
  canvas.setAttribute('aria-label',`${data.number}. ${data.title}`);
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('connections');svg.setAttribute('aria-hidden','true');
  const marker=`arrow-${data.number}`;
  svg.innerHTML=`<defs><marker id="${marker}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#bf492f"/></marker></defs>`;
  canvas.append(svg);
  for(const e of data.elements){
    if(e.type==='connector'){connector(svg,e,marker);continue;}
    if(e.type==='image'){
      const button=document.createElement('button');button.className='screenshot';button.type='button';
      cssPosition(button,e.x,e.y,e.w,e.h);
      const img=document.createElement('img');img.src=`./assets/${e.file}`;
      // 非表示のスライドも先に読み込み、ページ送り直後の空白を防ぐ。
      img.alt=`${data.title}の実画面（デモ）`;img.loading='eager';img.decoding='async';
      button.setAttribute('aria-label',`${img.alt}を拡大`);button.append(img);
      button.addEventListener('click',()=>{largeImage.src=img.src;largeImage.alt=img.alt;dialog.showModal();});canvas.append(button);continue;
    }
    if(e.type==='table'){
      const table=document.createElement('table');table.className='schedule';table.setAttribute('aria-label','当日の進行時間の目安');
      cssPosition(table,e.left,e.top,e.width,e.height);
      const colgroup=document.createElement('colgroup');for(const width of e.columnWidths){const col=document.createElement('col');col.style.width=`${width}px`;colgroup.append(col);}table.append(colgroup);
      const thead=document.createElement('thead'),tbody=document.createElement('tbody');
      e.values.forEach((row,i)=>{const tr=document.createElement('tr');for(const val of row){const cell=document.createElement(i===0?'th':'td');if(i===0)cell.scope='col';cell.textContent=val;tr.append(cell);}(i===0?thead:tbody).append(tr);});table.append(thead,tbody);canvas.append(table);continue;
    }
    if(e.type==='text'&&!e.str)continue;
    const tag=e.type==='text'&&e.y===38?'h2':'div';
    const el=document.createElement(tag);el.className='element';cssPosition(el,e.x,e.y,e.w,e.h);
    if(e.type==='rect'){el.style.background=e.fill;el.style.border=`1px solid ${e.line}`;}
    else {el.textContent=e.str;el.style.fontSize=`${e.size}px`;el.style.color=e.color;el.style.fontWeight=e.bold||e.type==='node'?'700':'400';el.style.textAlign=e.align||'center';if(e.type==='node'){el.classList.add('node');el.style.background=e.fill;}}
    canvas.append(el);
  }
  viewport.append(canvas);article.append(viewport);
  const notes=document.createElement('section');notes.className='explanation';notes.tabIndex=-1;
  const count=document.createElement('p');count.className='eyebrow';count.textContent=`${String(data.number).padStart(2,'0')} / ${slides.length}`;
  const heading=document.createElement('h2');heading.textContent=data.title;
  const copy=document.createElement('div');copy.className='copy';
  // 意味の切れ目を優先して、長い説明を2文ずつの段落にする。
  const sentences=data.explanation.match(/[^。]+。?/g)||[data.explanation];
  for(let i=0;i<sentences.length;i+=2){const p=document.createElement('p');p.textContent=sentences.slice(i,i+2).join('');copy.append(p);}
  notes.append(count,heading,copy);
  if(data.elements.some(e=>e.type==='image')){const hint=document.createElement('p');hint.className='screenshot-hint';hint.textContent='スライド内の画面を押すと、スクリーンショットを拡大できます。';notes.append(hint);}
  article.append(notes);return article;
}
function fit(){
  document.documentElement.style.setProperty('--toolbar-height',`${document.querySelector('.toolbar').getBoundingClientRect().height}px`);
  for(const page of pages){if(page.hidden)continue;const vp=page.querySelector('.slide-viewport');page.querySelector('.slide').style.transform=`scale(${vp.clientWidth/1280})`;}
}
function fromHash(){const n=Number(location.hash.slice(1));return Number.isInteger(n)&&n>0?Math.min(n-1,slides.length-1):0;}
function show(index,{history=true,scroll=true}={}){
  current=Math.min(slides.length-1,Math.max(0,index));
  pages.forEach((page,i)=>{page.hidden=!all&&i!==current;const notes=page.querySelector('.explanation');if(i===current)notes.id='explanation';else notes.removeAttribute('id');});
  jump.value=String(current);previous.disabled=current===0;next.disabled=current===slides.length-1;
  document.title=`${current+1}. ${slides[current].title} — SE Karuta`;
  announcement.textContent=`${current+1} / ${slides.length}：${slides[current].title}`;
  if(history)window.history.replaceState(null,'',`#${current+1}`);
  fit();if(scroll){if(all)pages[current].scrollIntoView({block:'start'});else window.scrollTo({top:0});}
}
function setMode({readAll=false,presentation=false}){
  all=readAll;presenting=presentation;document.body.classList.toggle('all',all);document.body.classList.toggle('presenting',presenting);
  overview.setAttribute('aria-pressed',String(all));overview.textContent=all?'1枚ずつ読む':'一覧で読む';
  present.setAttribute('aria-pressed',String(presenting));present.textContent=presenting?'説明文を読む':'発表モード';show(current);
}
previous.addEventListener('click',()=>show(current-1));next.addEventListener('click',()=>show(current+1));jump.addEventListener('change',()=>show(Number(jump.value)));
present.addEventListener('click',()=>setMode({presentation:!presenting}));overview.addEventListener('click',()=>setMode({readAll:!all}));
fullscreen.addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{announcement.textContent='このブラウザでは全画面に切り替えられません。発表モードをご利用ください。';}});
document.addEventListener('fullscreenchange',()=>{fullscreen.textContent=document.fullscreenElement?'全画面を終了':'全画面';fit();});
document.querySelector('#close-screenshot').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
document.addEventListener('keydown',event=>{
  if(dialog.open||['SELECT','INPUT','TEXTAREA'].includes(event.target.tagName))return;
  if(['ArrowRight','PageDown','ArrowLeft','PageUp','Home','End'].includes(event.key)){event.preventDefault();const n=event.key==='Home'?0:event.key==='End'?slides.length-1:current+(['ArrowRight','PageDown'].includes(event.key)?1:-1);show(n);}
  if(event.key==='Escape'&&presenting)setMode({});
});
window.addEventListener('hashchange',()=>{
  // 説明文へのスキップリンクで、現在のスライドを変更しない。
  if(slides.length && (!location.hash || /^#\d+$/.test(location.hash))) {
    show(fromHash(),{history:false});
  }
});
const resizeObserver=new ResizeObserver(()=>fit());resizeObserver.observe(deck);resizeObserver.observe(document.querySelector('.toolbar'));
try{
  const response=await fetch('./slides.json');if(!response.ok)throw new Error(`HTTP ${response.status}`);slides=await response.json();
  pages=slides.map(renderSlide);deck.replaceChildren(...pages);deck.setAttribute('aria-busy','false');
  for(const s of slides){const option=document.createElement('option');option.value=String(s.number-1);option.textContent=`${String(s.number).padStart(2,'0')}  ${s.title}`;jump.append(option);}
  show(fromHash(),{history:false,scroll:false});
}catch(error){deck.setAttribute('aria-busy','false');deck.replaceChildren();const p=document.createElement('p');p.className='loading';p.textContent='資料を読み込めませんでした。ネット接続を確認して再読み込みしてください。ローカルで見る場合はHTTPサーバー経由で開いてください。';deck.append(p);for(const button of [previous,next,present,overview])button.disabled=true;console.error(error);}
