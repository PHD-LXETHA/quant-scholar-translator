const qsApi=globalThis.browser||globalThis.chrome;
const QS_HOST='quant-scholar-safari-control';
let qsRunning=false,qsTimer=null,qsLastSource='',qsRequest=0,qsContext=[];
let qsPending=null,qsCommitTimer=null,qsQueue=Promise.resolve(),qsEpoch=0;

function qsMerge(left,right){
  if(!left)return right;if(left.toLowerCase().endsWith(right.toLowerCase()))return left;if(right.toLowerCase().startsWith(left.toLowerCase()))return right;
  const a=left.split(' '),b=right.split(' ');for(let n=Math.min(a.length,b.length);n>0;n--){if(a.slice(-n).join(' ').toLowerCase()===b.slice(0,n).join(' ').toLowerCase())return [...a,...b.slice(n)].join(' ')}return `${left} ${right}`;
}

function qsFlush(ui){
  if(!qsPending)return;const caption=qsPending,epoch=qsEpoch;qsPending=null;clearTimeout(qsCommitTimer);qsCommitTimer=null;
  qsQueue=qsQueue.catch(()=>{}).then(()=>{if(qsRunning&&epoch===qsEpoch)return qsTranslate(caption,ui,epoch)});
}

function qsBuffer(caption,ui){
  if(!caption?.text||caption.text===qsLastSource)return;qsLastSource=caption.text;
  if(!qsPending)qsPending={...caption,text:'',started:Date.now()};qsPending.text=qsMerge(qsPending.text,caption.text);
  ui.overlay.hidden=false;ui.source.textContent=qsPending.text;ui.translation.textContent='专业译文生成中…';ui.badge.textContent='原文 · 等待完整句子';
  if(/[.!?…。！？؟;:]$/.test(qsPending.text)||qsPending.text.length>=160||Date.now()-qsPending.started>=6000)qsFlush(ui);
  else{clearTimeout(qsCommitTimer);qsCommitTimer=setTimeout(()=>qsFlush(ui),2200)}
}

function qsCaption(){
  for(const video of document.querySelectorAll('video')){
    for(const track of Array.from(video.textTracks||[])){
      if(!['captions','subtitles'].includes(track.kind))continue;
      if(track.mode==='disabled')track.mode='hidden';
      const text=Array.from(track.activeCues||[]).map(cue=>cue.text||'').join(' ').replace(/\s+/g,' ').trim();
      if(text)return{text,time:Number.isFinite(video.currentTime)?video.currentTime:null,sourceLang:track.language||'auto'};
    }
  }
  const selectors=['.ytp-caption-segment','[class*="subtitle"] [class*="text"]','[class*="caption"] [class*="text"]','video::cue'];
  const nodes=selectors.flatMap(selector=>{try{return Array.from(document.querySelectorAll(selector))}catch(_error){return[]}});
  const text=nodes.filter(node=>{const rect=node.getBoundingClientRect();return rect.width&&rect.height}).map(node=>node.textContent||'').join(' ').replace(/\s+/g,' ').trim();
  const video=document.querySelector('video');
  return text?{text,time:video&&Number.isFinite(video.currentTime)?video.currentTime:null,sourceLang:(document.documentElement.lang||'auto').split('-')[0]}:null;
}

async function qsTranslate(caption,ui,epoch){
  if(!caption?.text)return;
  const requestId=++qsRequest;
  ui.overlay.hidden=false;ui.source.textContent=caption.text;ui.translation.textContent='专业翻译中…';ui.badge.textContent='原文 · 等待专业终稿';
  try{
    let finalDone=false;
    const payload={type:'translate',source:caption.text,sourceLang:caption.sourceLang||'auto',context:qsContext.slice(-4).join(' ').slice(-1600),url:location.href,mediaTime:caption.time};
    const finalPromise=qsApi.runtime.sendMessage(payload);
    if(ui.mode.value==='quick'){
      qsApi.runtime.sendMessage({...payload,translator:'nllb',offline:true,preview:true}).then(preview=>{
        if(qsRunning&&epoch===qsEpoch&&!finalDone&&requestId===qsRequest){ui.translation.textContent=preview.text;ui.badge.textContent='NLLB 快速预览 · 非终稿';}
      }).catch(()=>{});
    }
    const result=await finalPromise;finalDone=true;
    if(qsRunning&&epoch===qsEpoch){qsContext.push(caption.text);qsContext=qsContext.slice(-8);}
    if(qsRunning&&epoch===qsEpoch&&requestId===qsRequest){ui.translation.textContent=result.text;ui.badge.textContent=result.provider==='codex'?'Codex 专业终稿':result.provider==='nllb'?'NLLB 离线译文':'Kimi 专业终稿';ui.status.textContent='翻译中 · 已保存最终译文';}
  }catch(error){if(qsRunning&&epoch===qsEpoch&&requestId===qsRequest){ui.translation.textContent='';ui.badge.textContent='翻译失败';ui.status.textContent=String(error.message||error)}}
}

function qsDownload(name,type,text){const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([text],{type}));link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000)}

async function qsMount(){
  if(document.getElementById(QS_HOST))return;
  const host=document.createElement('div');host.id=QS_HOST;host.style.cssText='position:fixed;right:16px;top:96px;z-index:2147483647;pointer-events:none';
  const root=host.attachShadow({mode:'open'});root.innerHTML=`<style>
  :host{all:initial}.shell{font:13px/1.45 system-ui,-apple-system,sans-serif;color:#edf8fb}.orb{width:46px;height:46px;border:1px solid rgba(54,214,194,.6);border-radius:15px;color:#f0c66d;background:linear-gradient(145deg,#123247,#071521);box-shadow:0 10px 30px rgba(0,0,0,.3);font-weight:800;pointer-events:auto;touch-action:none}.menu{position:absolute;right:0;top:54px;width:min(320px,calc(100vw - 24px));max-height:75vh;overflow:auto;padding:14px;border:1px solid #21445a;border-radius:16px;background:rgba(7,21,33,.98);box-shadow:0 18px 55px rgba(0,0,0,.42);pointer-events:auto}.menu[hidden],.overlay[hidden]{display:none}.head{display:flex;justify-content:space-between;align-items:center;padding-bottom:10px;border-bottom:1px solid #21445a}.head span{display:grid}.head small,.hint,.status{color:#91adba;font-size:10px}.close{border:0;color:#91adba;background:none;font-size:20px}label{display:grid;gap:4px;margin-top:9px;color:#91adba;font-size:10px}input,select,button{box-sizing:border-box;width:100%;padding:9px;border:1px solid #21445a;border-radius:9px;color:#edf8fb;background:#102535;font:12px system-ui}.actions{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:12px}.primary{grid-column:1/-1;border:0;color:#071521;background:#36d6c2;font-weight:700}.status{margin:9px 0 0;text-align:center}.hint{margin:9px 0 0}.overlay{position:fixed;left:50%;bottom:8vh;transform:translateX(-50%);width:min(90vw,900px);padding:10px 14px;border-radius:10px;background:rgba(0,0,0,.76);text-align:center;pointer-events:none}.badge{display:inline-block;padding:2px 7px;border:1px solid rgba(54,214,194,.5);border-radius:999px;color:#67e8d7;font-size:9px}.source{margin-top:5px;color:#c8d6dc;font-size:13px}.translation{margin-top:4px;color:#fff;font-size:18px}@media(max-width:600px){.menu{position:fixed;left:8px;right:8px;top:max(8px,env(safe-area-inset-top));bottom:max(8px,env(safe-area-inset-bottom));width:auto;max-height:none}.overlay{bottom:max(7vh,env(safe-area-inset-bottom));}.translation{font-size:16px}}
  .head span{flex:1;min-width:0}.close{width:30px;flex:0 0 30px;padding:0}.menu{background:#071521}.orb{transition:opacity .2s}.orb.idle{opacity:.34}.orb:hover,.orb:focus-visible{opacity:1}
  </style><div class="shell"><button class="orb" aria-label="打开 Quant Scholar">QS</button><section class="menu" hidden><div class="head"><span><strong>Quant Scholar</strong><small>Safari iPhone / iPad</small></span><button class="close">×</button></div><label>电脑服务地址<input class="backend" placeholder="http://电脑局域网IP:8765"></label><label>配对令牌<input class="token" type="password" autocomplete="off"></label><label>翻译模式<select class="mode"><option value="professional">专业实时</option><option value="quick">极速预览＋专业终稿</option><option value="offline">离线 NLLB</option></select></label><label>专业引擎<select class="provider"><option value="kimi_subscription">Kimi 套餐</option><option value="codex">Codex 套餐</option></select></label><label>专业领域<select class="domain"><option value="auto">自动判断</option><option value="finance">金融学</option><option value="quant_finance">量化金融</option><option value="economics">经济学</option><option value="statistics">统计与计量</option><option value="mathematics">数学</option><option value="programming">编程与计算机</option></select></label><div class="actions"><button class="primary start">开始读取网页字幕</button><button class="workspace">移动工作台</button><button class="export">导出知识库</button><button class="clear">清空知识库</button></div><p class="status">仅读取网页可访问字幕；不录音、不上传音频。</p><p class="hint">无字幕视频受 iOS 权限限制，不能通用捕获其他标签页音频。</p></section><section class="overlay" hidden><span class="badge"></span><div class="source"></div><div class="translation"></div></section></div>`;
  document.documentElement.append(host);
  const ui={host,orb:root.querySelector('.orb'),menu:root.querySelector('.menu'),close:root.querySelector('.close'),backend:root.querySelector('.backend'),token:root.querySelector('.token'),mode:root.querySelector('.mode'),provider:root.querySelector('.provider'),domain:root.querySelector('.domain'),start:root.querySelector('.start'),workspace:root.querySelector('.workspace'),export:root.querySelector('.export'),clear:root.querySelector('.clear'),status:root.querySelector('.status'),overlay:root.querySelector('.overlay'),badge:root.querySelector('.badge'),source:root.querySelector('.source'),translation:root.querySelector('.translation')};
  const loaded=await qsApi.runtime.sendMessage({type:'settings:get'});for(const key of['backend','token','mode','provider','domain']){const map={backend:'backendUrl',token:'mobileToken',mode:'translationMode',provider:'translator',domain:'domain'};ui[key].value=loaded.settings[map[key]]||ui[key].value}ui.provider.disabled=ui.mode.value==='offline';
  const save=()=>qsApi.runtime.sendMessage({type:'settings:save',settings:{backendUrl:ui.backend.value.trim(),mobileToken:ui.token.value,translationMode:ui.mode.value,translator:ui.provider.value,domain:ui.domain.value}});
  for(const control of[ui.backend,ui.token,ui.mode,ui.provider,ui.domain])control.addEventListener('change',()=>{ui.provider.disabled=ui.mode.value==='offline';save()});
  let drag=null,idleTimer=null;
  const wake=()=>{ui.orb.classList.remove('idle');clearTimeout(idleTimer);idleTimer=setTimeout(()=>{if(ui.menu.hidden)ui.orb.classList.add('idle')},4200)};
  const toggleMenu=()=>{ui.menu.hidden=!ui.menu.hidden;wake()};
  ui.orb.addEventListener('pointerenter',wake);ui.orb.addEventListener('pointerdown',wake);wake();
  ui.orb.addEventListener('pointerdown',event=>{const rect=host.getBoundingClientRect();drag={x:event.clientX,y:event.clientY,left:rect.left,top:rect.top,moved:false};ui.orb.setPointerCapture(event.pointerId)});
  ui.orb.addEventListener('pointermove',event=>{if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.hypot(dx,dy)>4)drag.moved=true;if(!drag.moved)return;host.style.left=`${Math.min(Math.max(8,drag.left+dx),innerWidth-54)}px`;host.style.top=`${Math.min(Math.max(8,drag.top+dy),innerHeight-54)}px`;host.style.right='auto'});
  ui.orb.addEventListener('pointerup',async event=>{if(!drag)return;ui.orb.releasePointerCapture(event.pointerId);if(drag.moved){const rect=host.getBoundingClientRect();await qsApi.storage.local.set({safariFloatingPosition:{left:rect.left,top:rect.top}})}else toggleMenu();drag=null});
  ui.close.addEventListener('click',toggleMenu);
  ui.orb.addEventListener('pointercancel',()=>{drag=null});
  ui.orb.addEventListener('click',event=>{if(event.detail===0)toggleMenu()});
  const position=(await qsApi.storage.local.get('safariFloatingPosition')).safariFloatingPosition;if(position&&Number.isFinite(position.left)&&Number.isFinite(position.top)){host.style.left=`${Math.min(Math.max(8,position.left),innerWidth-54)}px`;host.style.top=`${Math.min(Math.max(8,position.top),innerHeight-54)}px`;host.style.right='auto'}
  ui.start.addEventListener('click',async()=>{await save();qsRunning=!qsRunning;qsEpoch++;qsLastSource='';qsPending=null;clearTimeout(qsCommitTimer);ui.start.textContent=qsRunning?'停止读取字幕':'开始读取网页字幕';if(qsRunning){qsContext=[];ui.status.textContent='正在查找网页原字幕…';qsTimer=setInterval(()=>{const caption=qsCaption();if(caption)qsBuffer(caption,ui)},350)}else{clearInterval(qsTimer);qsTimer=null;ui.status.textContent='已停止';ui.overlay.hidden=true}});
  ui.workspace.addEventListener('click',async()=>{await save();if(ui.backend.value)open(`${ui.backend.value.replace(/\/$/,'')}/mobile/`,'_blank')});
  ui.export.addEventListener('click',async()=>{const result=await qsApi.runtime.sendMessage({type:'knowledge:get'});qsDownload('quant-scholar-safari.json','application/json',JSON.stringify(result.records||[],null,2))});
  ui.clear.addEventListener('click',async()=>{await qsApi.runtime.sendMessage({type:'knowledge:clear'});ui.status.textContent='移动知识库已清空'});
  qsApi.runtime.onMessage.addListener(message=>{if(message?.type==='floating:toggle'){toggleMenu();return Promise.resolve({ok:true,open:!ui.menu.hidden})}});
}

qsMount();
