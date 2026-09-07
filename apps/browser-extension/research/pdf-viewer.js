import * as pdfjsLib from "./vendor/pdf.min.mjs";
import { buildOcrTextBlocks, buildTextBlocks, sortBlocksForReading } from "./pdf-layout.mjs";
import { availableOverlayHeight, detectVisualRegions } from "./pdf-visual-regions.mjs";
import { renderScientificText } from "./scientific-text.mjs";
import { splitInlineSection } from "./section-heading.mjs";
import { parseReferenceList } from "./reference-list.mjs";
import { formatGlossaryPrompt, migrateProfessionalGlossary } from "./glossary.mjs";
import { estimateTranslationUsage, translationProgress } from "./translation-usage.mjs";
import { buildStableDocumentSignature, isCompatibleTranslationSession, matchCachedTranslations, sessionContentSimilarity } from "./pdf-session-cache.mjs";
import { isLikelyUntranslated } from "./translation-quality.mjs";
import { cleanupExternalTranslationSessions, deleteExternalDocumentSessions, getExternalTranslationSession, listExternalTranslationSessions, putExternalTranslationSession } from "./cache-directory.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("research/vendor/pdf.worker.min.mjs");
await migrateProfessionalGlossary(chrome.storage.local);

const $ = id => document.getElementById(id);
const APP_VERSION = chrome.runtime.getManifest().version_name || chrome.runtime.getManifest().version;
$('app-version').textContent=`v${APP_VERSION}`;
const state = { pdf: null, pages: [], mode: "reading", source: "", targetLanguage: "简体中文", bodyFontSize: 10, translationBodyFontSize: 0, autoLocate: false, documentKey: "", rawDocumentKey: "", documentKeys: [], profileKey: "", cacheKey: "", cacheRestoreKind: "", cacheMissReason: "", publisherArticleUrl: "", restoring: false, zoom: 1, zoomMode: "manual", currentPage: 1, activePane: "translation", searchResults: [], searchIndex: -1, translationTask: { running: false, paused: false, cancelled: false, failed: [], pauseWaiters: [], estimate: null } };
const sentenceLinks = new WeakMap();
const sourceSpanLinks = new WeakMap();
let selectionTimer;
let autoLocateTimer;
let counterpartPulseTimer;
let sessionSaveTimer;
let searchTimer;
let paneScrollFrame;
let sourceSelectionDrag=null;
const queryUrl = new URLSearchParams(location.search).get("url");
const queryLocalMode = new URLSearchParams(location.search).get("local");
updateToolbarHeight();
new ResizeObserver(updateToolbarHeight).observe(document.querySelector(".toolbar"));
new ResizeObserver(updateToolbarHeight).observe($("reader-tools"));
if (queryUrl) { $("url").value = queryUrl; openPdf(queryUrl); }
else if (queryLocalMode === "select") notice("请点击工具栏中的“本地 PDF”，重新选择要翻译的文件。若想以后从 Edge 当前 PDF 一键打开，请在扩展详情中开启“允许访问文件 URL”。", false, true);

$("open").onclick = () => openPdf($("url").value.trim());
$("url").onkeydown = event => { if (event.key === "Enter") $("open").click(); };
$("translate").onclick = translatePdf;
document.querySelector('.brand strong').textContent = 'Quant Scholar PDF Reader';
$("translate").textContent = 'Codex / Kimi 精译 PDF';
$("pause-translation").onclick=toggleTranslationPause;
$("cancel-translation").onclick=cancelTranslationTask;
$("retry-failed").onclick=retryFailedTranslation;
$("collapse-task").onclick=()=>{const collapsed=$("translation-task").classList.toggle("collapsed");$("collapse-task").textContent=collapsed?"＋":"−";$("collapse-task").setAttribute("aria-expanded",String(!collapsed));};
$("settings").onclick = () => chrome.runtime.openOptionsPage();
$("export-pdf").onclick = exportTranslatedPdf;
$("clear-cache").onclick = clearCurrentDocumentCache;
$("toggle-outline").onclick=()=>$("pdf-outline").hidden=!$("pdf-outline").hidden;
$("close-outline").onclick=()=>$("pdf-outline").hidden=true;
$("prev-page").onclick=()=>goToPage(state.currentPage-1);
$("next-page").onclick=()=>goToPage(state.currentPage+1);
$("page-number").onchange=()=>goToPage(Number($("page-number").value));
$("page-number").onkeydown=event=>{if(event.key==="Enter")goToPage(Number(event.currentTarget.value));};
$("zoom-out").onclick=()=>setZoom(state.zoom-.1,"manual");
$("zoom-in").onclick=()=>setZoom(state.zoom+.1,"manual");
$("zoom-value").onclick=()=>state.zoomMode==="width"?setZoom(1,"manual"):fitPageWidth();
$("pdf-search").addEventListener("input",()=>{clearTimeout(searchTimer);searchTimer=setTimeout(runPdfSearch,220);});
$("pdf-search").addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();stepSearch(event.shiftKey?-1:1);}});
$("search-prev").onclick=()=>stepSearch(-1); $("search-next").onclick=()=>stepSearch(1);
for(const id of ["auto-locate","mark-highlight","erase-highlight"])$(id).addEventListener("mousedown",event=>event.preventDefault());
$('auto-locate').onclick=()=>setAutoLocate(!state.autoLocate,true);
$("mark-highlight").onclick=()=>applyTranslationHighlight("add");
$("erase-highlight").onclick=()=>applyTranslationHighlight("erase");
$("choose-local").onclick = () => $("file").click();
$("retry-remote").onclick = () => openPdf($("url").value.trim());
$("open-publisher-page").onclick=async()=>{if(!state.publisherArticleUrl)return;await chrome.tabs.create({url:state.publisherArticleUrl,active:true});};
document.querySelectorAll("[data-mode]").forEach(button => button.onclick = () => setMode(button.dataset.mode));
document.addEventListener("selectionchange", () => {
  clearTimeout(selectionTimer);
  selectionTimer = setTimeout(updateLinkedSelection, 30);
});
chrome.storage.local.get({pdfAutoLocate:false},settings=>setAutoLocate(Boolean(settings.pdfAutoLocate),false));
window.addEventListener("scroll",()=>{scheduleSessionSave();if(state.mode!=="bilingual")scheduleCurrentPageUpdate();},{passive:true});
window.addEventListener("resize",()=>{updateToolbarHeight();if(state.zoomMode==="width")fitPageWidth();});
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")flushSessionSave();});
window.addEventListener("pagehide",flushSessionSave);
document.addEventListener("keydown",event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="f"&&state.pages.length){event.preventDefault();$("pdf-search").focus();$("pdf-search").select();}if(event.key==="Escape"&&!$("pdf-outline").hidden)$("pdf-outline").hidden=true;});

// FileReader is used instead of an object URL so PDF.js receives stable bytes.
$("file").addEventListener("change", async event => {
  const file = event.target.files[0]; if (!file) return;
  await openPdf(new Uint8Array(await file.arrayBuffer()), file.name);
});

async function openPdf(source, label = source) {
  if (!source || (source instanceof Uint8Array && !source.length)) return;
  notice("正在读取 PDF…", false, true); resetPagePanes(); clearPdfSearch(); resetTranslationTask(); $("pdf-fallback").hidden = true; state.pages = []; state.translationBodyFontSize = 0; state.documentKey=""; state.rawDocumentKey=""; state.documentKeys=[]; state.profileKey=""; state.cacheKey=""; state.cacheRestoreKind=""; state.cacheMissReason=""; state.publisherArticleUrl=""; $("open-publisher-page").hidden=true; state.currentPage=1; state.zoom=1; state.zoomMode="manual"; $("clear-cache").disabled=true; setReaderToolsEnabled(false);
  try {
    const pdfData = typeof source === "string" ? await fetchRemotePdf(source) : source;
    const [rawDocumentKey,profileKey,languageSettings]=await Promise.all([hashBytes(pdfData),translationProfileKey(),chrome.storage.local.get({targetLanguage:"简体中文"})]);
    state.targetLanguage=languageSettings.targetLanguage||"简体中文";
    state.rawDocumentKey=rawDocumentKey; state.profileKey=profileKey;
    const task = pdfjsLib.getDocument({ data: pdfData, cMapUrl: chrome.runtime.getURL("research/vendor/cmaps/"), cMapPacked: true, standardFontDataUrl: chrome.runtime.getURL("research/vendor/standard_fonts/") });
    state.pdf = await task.promise; state.source = String(label); document.title = `Quant Scholar PDF Reader · ${shortName(label)}`;
    for (let number = 1; number <= state.pdf.numPages; number++) await renderPage(number);
    const signature=buildStableDocumentSignature(state.pages.map(page=>({number:page.number,blocks:sortBlocksForReading(page.blocks,page.viewport,page.number)})));
    state.documentKey=signature?await hashText(signature):rawDocumentKey;
    state.documentKeys=[...new Set([state.documentKey,rawDocumentKey].filter(Boolean))]; state.cacheKey=`${state.documentKey}:${profileKey}`; $("clear-cache").disabled=false;
    state.bodyFontSize = median(state.pages.flatMap(page => page.blocks.filter(block => block.role === "body").map(block => block.fontSize))) || 10;
    $("page-total").textContent=String(state.pdf.numPages); $("page-number").max=String(state.pdf.numPages); buildPdfOutline(); setReaderToolsEnabled(true); applyZoom(); updatePageControls();
    const restored=await restoreTranslationSession(); updateTranslateButton(); await prepareTranslationEstimate();
    if(!restored)notice(state.cacheMissReason||`已载入 ${state.pdf.numPages} 页。点击“翻译 PDF”开始。`,Boolean(state.cacheMissReason),Boolean(state.cacheMissReason));
  } catch (error) { showPdfFallback(error); }
}

async function fetchRemotePdf(url) {
  const result = await chrome.runtime.sendMessage({ type: "FETCH_PDF", url });
  if (!result?.ok) {
    const error=new Error(result?.error||"无法读取在线 PDF");error.code=result?.code||"";error.articleUrl=result?.articleUrl||"";throw error;
  }
  const record = await takePdfCache(result.key);
  if (!record?.data) throw new Error("PDF 临时缓存丢失，请重试");
  if (result.finalUrl && result.finalUrl !== url) $("url").value = result.finalUrl;
  return new Uint8Array(record.data);
}

function openPdfCache() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("researchlens-pdf-cache", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("pdfs", { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开 PDF 临时缓存"));
  });
}

async function takePdfCache(key) {
  const db = await openPdfCache();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("pdfs", "readwrite");
      const store = transaction.objectStore("pdfs");
      const request = store.get(key);
      request.onsuccess = () => { const value = request.result; store.delete(key); resolve(value); };
      request.onerror = () => reject(request.error || new Error("无法读取 PDF 临时缓存"));
    });
  } finally { db.close(); }
}

async function hashBytes(value){
  const digest=await crypto.subtle.digest("SHA-256",value); return [...new Uint8Array(digest)].slice(0,20).map(byte=>byte.toString(16).padStart(2,"0")).join("");
}

async function hashText(value){return hashBytes(new TextEncoder().encode(String(value)));}

async function translationProfileKey(){
  const keys=["provider","apiStyle","endpoint","model","targetLanguage","prompt","glossaryTerms"];
  const settings=await chrome.storage.local.get(keys);
  return hashText(JSON.stringify(keys.map(key=>[key,settings[key]??""])));
}

function openReaderStateDb(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open("researchlens-reader-state",1);
    request.onupgradeneeded=()=>request.result.createObjectStore("sessions",{keyPath:"key"});
    request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error||new Error("无法打开阅读缓存"));
  });
}

async function withSessionStore(mode,operation){
  const db=await openReaderStateDb();
  try{return await new Promise((resolve,reject)=>{const tx=db.transaction("sessions",mode);const request=operation(tx.objectStore("sessions"));request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error("阅读缓存操作失败"));});}
  finally{db.close();}
}

async function getTranslationSession(key){
  const internal=await withSessionStore("readonly",store=>store.get(key));
  return internal||await getExternalTranslationSession(key).catch(()=>null);
}
async function putTranslationSession(record){
  await withSessionStore("readwrite",store=>store.put(record));
  await putExternalTranslationSession(record).catch(()=>false);
}
async function listTranslationSessions(){
  const [internal,external]=await Promise.all([withSessionStore("readonly",store=>store.getAll()),listExternalTranslationSessions().catch(()=>[])]);
  const combined=new Map();
  for(const session of [...internal,...external]){const previous=combined.get(session.key);if(!previous||(session.updatedAt||0)>(previous.updatedAt||0))combined.set(session.key,session);}
  return [...combined.values()];
}

async function deleteDocumentSessions(documentKeys,currentPages){
  const keys=new Set(Array.isArray(documentKeys)?documentKeys:[documentKeys]);
  const db=await openReaderStateDb();
  try{await new Promise((resolve,reject)=>{const tx=db.transaction("sessions","readwrite"),store=tx.objectStore("sessions"),request=store.openCursor();request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;const record=cursor.value;const exact=keys.has(record.documentKey)||[...keys].some(key=>String(cursor.key).startsWith(`${key}:`));const compatible=currentPages?.length&&isCompatibleTranslationSession(sessionContentSimilarity(currentPages,record.pages||[]));if(exact||compatible)cursor.delete();cursor.continue();};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error("无法清除阅读缓存"));});}
  finally{db.close();}
  await deleteExternalDocumentSessions(documentKeys).catch(()=>0);
}

async function cleanupReaderState(){
  const cutoff=Date.now()-30*24*60*60*1000,db=await openReaderStateDb();
  try{await new Promise((resolve,reject)=>{const tx=db.transaction("sessions","readwrite"),request=tx.objectStore("sessions").openCursor();request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;if((cursor.value.updatedAt||0)<cutoff)cursor.delete();cursor.continue();};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
  finally{db.close();}
  await cleanupExternalTranslationSessions(cutoff).catch(()=>0);
}

function sessionViewState(){
  return {mode:state.mode,windowScroll:window.scrollY,sourceScroll:$("source-pages")?.scrollTop||0,translationScroll:$("translation-pages")?.scrollTop||0,zoom:state.zoom,zoomMode:state.zoomMode,currentPage:state.currentPage};
}

function serializeHighlights(){
  const saved=[];
  for(const page of state.pages){
    const sentences=[...page.translated.querySelectorAll(".translation-sentence")];
    for(const mark of page.translated.querySelectorAll("mark.user-highlight")){
      const sentence=mark.closest(".translation-sentence"),sentenceIndex=sentences.indexOf(sentence); if(sentenceIndex<0)continue;
      const prefix=document.createRange(); prefix.selectNodeContents(sentence); prefix.setEndBefore(mark);
      const start=prefix.toString().length; saved.push({page:page.number,sentence:sentenceIndex,start,end:start+mark.textContent.length});
    }
  }
  return saved;
}

async function saveTranslationSession(){
  if(state.restoring||!state.cacheKey||!state.pages.length)return;
  const pages=state.pages.map(page=>page.blocks.map(block=>({source:block.text,translation:block.translation||""})));
  await putTranslationSession({key:state.cacheKey,documentKey:state.documentKey,rawDocumentKey:state.rawDocumentKey,documentKeys:state.documentKeys,profileKey:state.profileKey,label:shortName(state.source),updatedAt:Date.now(),pages,highlights:serializeHighlights(),view:sessionViewState()});
}

function scheduleSessionSave(){
  if(state.restoring||!state.cacheKey)return;
  clearTimeout(sessionSaveTimer); sessionSaveTimer=setTimeout(()=>saveTranslationSession().catch(()=>{}),650);
}

function flushSessionSave(){
  clearTimeout(sessionSaveTimer); sessionSaveTimer=null;
  if(state.cacheKey&&state.pages.length)saveTranslationSession().catch(()=>{});
}

async function locateTranslationSession(){
  for(const documentKey of state.documentKeys){
    const key=`${documentKey}:${state.profileKey}`,session=await getTranslationSession(key);
    if(session)return {session,kind:documentKey===state.documentKey?"semantic":"legacy"};
  }
  const sessions=await listTranslationSessions(),sameProfile=sessions.filter(session=>session.profileKey===state.profileKey&&session.key!==state.cacheKey);
  let best=null;
  for(const session of sameProfile){
    const similarity=sessionContentSimilarity(state.pages,session.pages||[]);
    if(isCompatibleTranslationSession(similarity)&&(!best||similarity.score>best.similarity.score||(similarity.score===best.similarity.score&&(session.updatedAt||0)>(best.session.updatedAt||0))))best={session,similarity};
  }
  if(best)return {session:best.session,kind:"compatible"};
  for(const session of sessions.filter(session=>session.profileKey!==state.profileKey)){
    const exact=state.documentKeys.includes(session.documentKey)||state.documentKeys.some(key=>String(session.key||"").startsWith(`${key}:`));
    if(exact||isCompatibleTranslationSession(sessionContentSimilarity(state.pages,session.pages||[]))){
      state.cacheMissReason="检测到这篇论文的旧译文，但当前服务商、模型、Prompt 或术语表已经改变。为避免混用不同翻译要求，本次未自动恢复。"; break;
    }
  }
  return null;
}

async function restoreTranslationSession(){
  if(!state.cacheKey)return 0;
  const located=await locateTranslationSession(); cleanupReaderState().catch(()=>{}); if(!located)return 0;
  const {session,kind}=located; state.cacheRestoreKind=kind;
  state.restoring=true; let restored=0,invalidated=0;
  try{
    const matches=matchCachedTranslations(state.pages,session.pages||[]);
    for(const match of matches){
      const block=state.pages[match.pageIndex]?.blocks?.[match.blockIndex];
      if(!block)continue;
      if(isLikelyUntranslated(block.text,match.translation,state.targetLanguage,{role:block.role||""})){block.translation="";invalidated++;continue;}
      block.translation=match.translation;restored++;
    }
    for(const page of state.pages){
      if(page.blocks.some(block=>block.translation))drawTranslation(page);
    }
    if(restored||invalidated){
      harmonizeDocumentTypography(); setMode(["original","overlay","reading","bilingual"].includes(session.view?.mode)?session.view.mode:"reading");
      applyCachedHighlights(session.highlights||[]); await restoreSessionView(session.view||{}); updateTranslateButton();
      const total=state.pages.flatMap(page=>page.blocks.filter(isTranslatablePdfBlock)).length;
      const prefix=kind==="semantic"?"已从本机":"已识别为同一篇论文，并从本机";
      if(invalidated)notice(`${prefix}恢复 ${restored}/${total} 个翻译段落；已清除 ${invalidated} 段疑似英文伪译文，可点击“继续翻译 PDF”自动补译。`,false,true);
      else notice(restored>=total?`${prefix}恢复完整译文、批注和阅读位置。`:`${prefix}恢复 ${restored}/${total} 个翻译段落，可点击“继续翻译 PDF”。`,false,true);
    }
  }finally{state.restoring=false;}
  if(invalidated||restored&&session.key!==state.cacheKey)await saveTranslationSession();
  return restored+invalidated;
}

async function restoreSessionView(view){
  state.currentPage=Math.max(1,Math.min(state.pages.length,Number(view.currentPage)||1)); setZoom(Number(view.zoom)||1,view.zoomMode==="width"?"width":"manual",false);
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  if($("source-pages"))$("source-pages").scrollTop=Number(view.sourceScroll)||0;
  if($("translation-pages"))$("translation-pages").scrollTop=Number(view.translationScroll)||0;
  if(state.mode!=="bilingual")window.scrollTo({top:Number(view.windowScroll)||0,behavior:"auto"});
  updatePageControls();
}

function applyCachedHighlights(records){
  const grouped=new Map();
  for(const record of records){const key=`${record.page}:${record.sentence}`;if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(record);}
  for(const [key,items] of grouped){
    const [pageNumber,sentenceIndex]=key.split(":").map(Number),page=state.pages[pageNumber-1];
    const sentence=page?.translated.querySelectorAll(".translation-sentence")[sentenceIndex]; if(!sentence)continue;
    for(const item of items.sort((a,b)=>b.start-a.start))wrapTextRange(sentence,item.start,item.end);
  }
}

function wrapTextRange(container,start,end){
  const walker=document.createTreeWalker(container,NodeFilter.SHOW_TEXT),nodes=[];let node,offset=0;
  while((node=walker.nextNode())){const next=offset+node.length;if(end>offset&&start<next)nodes.push({node,start:Math.max(0,start-offset),end:Math.min(node.length,end-offset)});offset=next;}
  for(const piece of nodes.reverse()){
    const selected=piece.node.splitText(piece.start); selected.splitText(piece.end-piece.start);
    const mark=document.createElement("mark");mark.className="user-highlight";selected.replaceWith(mark);mark.append(selected);
  }
}

async function clearCurrentDocumentCache(){
  if(!state.documentKey)return;
  await deleteDocumentSessions(state.documentKeys,state.pages); notice("已清除当前文献保存在本机的译文、批注和阅读位置；当前页面内容不会立即消失。",false);
}

function updateTranslateButton(){
  const blocks=state.pages.flatMap(page=>page.blocks.filter(isTranslatablePdfBlock));
  const completed=blocks.filter(block=>block.translation).length;
  const noReadableText=Boolean(state.pages.length&&!blocks.length);
  $("translate").textContent=noReadableText?"本地 OCR 并精译":!completed?"Codex / Kimi 精译 PDF":completed<blocks.length?`继续精译 PDF（${completed}/${blocks.length}）`:"精译完成";
  $("translate").disabled=state.translationTask.running||Boolean(blocks.length&&completed>=blocks.length);
  renderTranslationTaskPanel();
}

function resetTranslationTask(){
  const previous=state.translationTask; if(previous){previous.cancelled=true;for(const resolve of previous.pauseWaiters||[])resolve();}
  state.translationTask={running:false,paused:false,cancelled:false,failed:[],pauseWaiters:[],estimate:null,message:"尚未开始"};
  $("translation-task").hidden=true; $("pause-translation").disabled=true; $("cancel-translation").disabled=true; $("retry-failed").hidden=true;
}

async function prepareTranslationEstimate(){
  if(!state.pages.length)return;
  const pending=state.pages.flatMap(page=>page.blocks.filter(block=>isTranslatablePdfBlock(block)&&!block.translation));
  const settings=await chrome.storage.local.get(["prompt","targetLanguage","glossaryTerms"]);
  const prompt=String(settings.prompt||"").replaceAll("{targetLanguage}",settings.targetLanguage||"简体中文")+formatGlossaryPrompt(settings.glossaryTerms);
  const batchCount=state.pages.reduce((count,page)=>count+batches(page.blocks.filter(block=>isTranslatablePdfBlock(block)&&!block.translation),6000,45).length,0);
  state.translationTask.estimate=estimateTranslationUsage({sourceChars:pending.reduce((sum,block)=>sum+block.text.length,0),promptChars:prompt.length,batchCount});
  $("translation-task").hidden=false; renderTranslationTaskPanel();
}

function renderTranslationTaskPanel(){
  if(!state.pages.length)return;
  const task=state.translationTask,progress=translationProgress(state.pages),estimate=task.estimate;
  const failedEntries=task.failed.flatMap(item=>item.batch.filter(block=>!block.translation).map(block=>({page:item.page?.number||"?",block,failure:item.failure||{}})));
  const failedPreview=failedEntries.slice(0,2).map(({page,block})=>`第 ${page} 页“${String(block.text||"").replace(/\s+/g," ").slice(0,42)}${String(block.text||"").length>42?"…":""}”`).join("；");
  $("task-progress").max=Math.max(1,progress.total); $("task-progress").value=progress.completed; $("task-percent").textContent=`${progress.percent}%`;
  $("task-estimate").textContent=estimate?`待译 ${estimate.sourceChars.toLocaleString()} 字符 · 约 ${estimate.batchCount} 批 · 预计合计约 ${estimate.totalTokens.toLocaleString()} Token`:"正在估算待译内容…";
  $("task-detail").textContent=`${task.message||"尚未开始"} · 已完成 ${progress.completed}/${progress.total} 段、${progress.completedPages}/${progress.totalPages} 页${failedEntries.length?` · 待重试 ${failedEntries.length} 段${failedPreview?`：${failedPreview}`:""}`:""}`;
  $("task-state").textContent=task.running?(task.paused?"已暂停":"翻译中"):failedEntries.length?"有待重试":progress.total&&progress.completed>=progress.total?"已完成":"准备就绪";
  const errorPanel=$("task-errors"),errorList=$("task-error-list");errorPanel.hidden=!failedEntries.length;errorList.replaceChildren();
  for(const {page,block,failure} of failedEntries){
    const item=document.createElement("li"),lastAttempt=Array.isArray(failure.attempts)?failure.attempts.at(-1):null;
    const code=failure.code||lastAttempt?.code||"TRANSLATION_FAILED",stage=failure.stage||lastAttempt?.stage||"batch-json",status=Number(failure.status||lastAttempt?.status)||0;
    const source=String(block.text||"").replace(/\s+/g," ").slice(0,88),reason=failure.error||lastAttempt?.message||"翻译失败";
    item.textContent=`第 ${page} 页 · ${code} · ${stage}${status?` · HTTP ${status}`:""}：${reason}；原文“${source}${block.text.length>88?"…":""}”`;
    errorList.append(item);
  }
  $("pause-translation").disabled=!task.running; $("pause-translation").textContent=task.paused?"继续":"暂停"; $("cancel-translation").disabled=!task.running;
  $("retry-failed").hidden=!task.failed.length||task.running;
}

function pendingTranslationTasks(){
  return state.pages.flatMap(page=>batches(page.blocks.filter(block=>isTranslatablePdfBlock(block)&&!block.translation),6000,45).map(batch=>({page,batch})));
}

function isTranslatablePdfBlock(block){return !["figure-content","artifact"].includes(block?.role);}

function toggleTranslationPause(){
  const task=state.translationTask;if(!task.running)return;
  task.paused=!task.paused; task.message=task.paused?"已暂停；当前 API 批次完成后停止发送":"已继续";
  if(!task.paused){for(const resolve of task.pauseWaiters.splice(0))resolve();}
  renderTranslationTaskPanel();
}

function cancelTranslationTask(){
  const task=state.translationTask;if(!task.running)return;
  task.cancelled=true;task.paused=false;task.message="正在取消；当前 API 批次完成后停止";for(const resolve of task.pauseWaiters.splice(0))resolve();renderTranslationTaskPanel();
}

async function waitForTranslationResume(){
  const task=state.translationTask;if(!task.paused||task.cancelled)return;
  await new Promise(resolve=>task.pauseWaiters.push(resolve));
}

async function retryFailedTranslation(){
  const tasks=state.translationTask.failed.filter(task=>task.batch.some(block=>!block.translation));
  state.translationTask.failed=[]; await runTranslationTasks(tasks,true);
}

function showPdfFallback(reason) {
  const error=reason instanceof Error?reason:new Error(String(reason||"无法读取在线 PDF"));
  notice(error.code==="LOCAL_FILE_ACCESS_DENIED"?"尚未取得本地文件访问权，可开启权限或重新选择文件。":"自动解析或读取未成功，可改用下方的本地文件方式。", true, true);
  $("fallback-message").textContent = error.message;
  state.publisherArticleUrl=error.articleUrl||"";
  $("open-publisher-page").hidden=error.code!=="PUBLISHER_CHALLENGE"||!state.publisherArticleUrl;
  $("pdf-fallback").hidden = false;
}

async function renderPage(number) {
  const page = await state.pdf.getPage(number); const base = page.getViewport({ scale: 1 });
  const scale = Math.min(1.55, 980 / base.width); const viewport = page.getViewport({ scale });
  const wrap = document.createElement("section"); wrap.className = "page-wrap"; wrap.style.width = `${viewport.width}px`; wrap.style.height = `${viewport.height}px`;
  const canvas = document.createElement("canvas"); const ratio = devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * ratio); canvas.height = Math.floor(viewport.height * ratio); canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
  const selectionLayer = document.createElement("div"); selectionLayer.className = "selection-layer";
  const layer = document.createElement("div"); layer.className = "translation-layer";
  const translated = document.createElement("article"); translated.className = "page-translation"; translated.innerHTML = `<h3>第 ${number} 页</h3>`;
  wrap.append(canvas, selectionLayer, layer); $("source-pages").append(wrap); $("translation-pages").append(translated);
  await page.render({ canvasContext: canvas.getContext("2d"), viewport, transform: ratio === 1 ? null : [ratio,0,0,ratio,0,0] }).promise;
  const content = await page.getTextContent(); const blocks = buildTextBlocks(content.items, viewport);
  const bodySizes=blocks.filter(block=>block.role==="body").map(block=>block.fontSize).sort((a,b)=>a-b);
  const bodyFontSize=bodySizes.length?bodySizes[Math.floor(bodySizes.length/2)]:10;
  const figureRegions=detectVisualRegions(blocks,viewport,bodyFontSize);
  const pageState={ number, wrap, canvas, selectionLayer, layer, translated, blocks, viewport, bodyFontSize, figureRegions };
  state.pages.push(pageState); drawTranslation(pageState); buildSourceTextLayer(pageState);
}

async function translatePdf() {
  if (!state.pages.length) return notice("请先打开 PDF", true);
  if(state.pages.some(page=>!page.blocks.some(isTranslatablePdfBlock))){
    const recognized=await recognizeScannedPdf();
    if(!recognized)return;
  }
  state.translationTask.failed=[]; await runTranslationTasks(pendingTranslationTasks(),false);
}

async function recognizeScannedPdf(){
  if(state.translationTask.running)return false;
  const pages=state.pages.filter(page=>!page.blocks.some(isTranslatablePdfBlock));
  if(!pages.length)return true;
  const task=state.translationTask;task.running=true;task.paused=false;task.cancelled=false;task.failed=[];task.message="正在启动本地 OCR";
  $("translation-task").hidden=false;updateTranslateButton();
  let recognized=0;
  try{
    for(let index=0;index<pages.length;index++){
      await waitForTranslationResume();if(task.cancelled)break;
      const page=pages[index];task.message=`正在 OCR 识别第 ${page.number}/${state.pages.length} 页`;
      $("task-state").textContent=task.paused?"OCR 已暂停":"OCR 识别中";$("task-estimate").textContent="扫描页图像仅发送到本机 127.0.0.1，不上传第三方 OCR 服务。";
      $("task-progress").max=pages.length;$("task-progress").value=index;$("task-percent").textContent=`${Math.round(index/pages.length*100)}%`;$("task-detail").textContent=task.message;
      notice(task.message,false,true);
      const image=await renderOcrPage(page.number);
      const result=await chrome.runtime.sendMessage({type:"OCR_PDF_PAGE",imageBase64:image.dataUrl,minimumScore:.45});
      if(!result?.ok)throw new Error(result?.error||"本地 OCR 识别失败");
      page.blocks=buildOcrTextBlocks(result.lines,page.viewport,result.width||image.width,result.height||image.height);
      if(page.blocks.length){
        recognized+=page.blocks.length;
        const bodySizes=page.blocks.filter(block=>block.role==="body").map(block=>block.fontSize).sort((a,b)=>a-b);
        page.bodyFontSize=bodySizes.length?bodySizes[Math.floor(bodySizes.length/2)]:10;
        page.figureRegions=detectVisualRegions(page.blocks,page.viewport,page.bodyFontSize);
        page.selectionLayer.replaceChildren();buildSourceTextLayer(page);drawTranslation(page);
      }
      $("task-progress").value=index+1;$("task-percent").textContent=`${Math.round((index+1)/pages.length*100)}%`;
    }
  }catch(error){
    task.message=error?.message||String(error);notice(`OCR 失败：${task.message}`,true,true);return false;
  }finally{
    task.running=false;task.paused=false;$("pause-translation").disabled=true;$("cancel-translation").disabled=true;updateTranslateButton();
  }
  if(task.cancelled)return notice("OCR 已取消；已识别内容仍保留。",true),false;
  if(!recognized&&!state.pages.some(page=>page.blocks.some(isTranslatablePdfBlock)))return notice("OCR 未识别到正文。请确认页面清晰、方向正确，或提高扫描分辨率。",true,true),false;
  buildPdfOutline();state.bodyFontSize=median(state.pages.flatMap(page=>page.blocks.filter(block=>block.role==="body").map(block=>block.fontSize)))||10;
  await restoreTranslationSession();await prepareTranslationEstimate();notice(`OCR 已识别 ${recognized} 个段落，正在开始专业精译。`,false,true);return true;
}

async function renderOcrPage(number){
  const pdfPage=await state.pdf.getPage(number),base=pdfPage.getViewport({scale:1});
  const scale=Math.min(3.5,Math.max(2,2000/Math.max(1,base.width))),viewport=pdfPage.getViewport({scale});
  const canvas=document.createElement("canvas");canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  await pdfPage.render({canvasContext:canvas.getContext("2d",{alpha:false}),viewport}).promise;
  return {dataUrl:canvas.toDataURL("image/png"),width:canvas.width,height:canvas.height};
}

async function runTranslationTasks(tasks,isRetry) {
  if(state.translationTask.running)return;
  const queue=(tasks||[]).filter(task=>task.batch.some(block=>!block.translation));
  if(!queue.length){
    const blocks=state.pages.flatMap(page=>page.blocks.filter(isTranslatablePdfBlock));
    updateTranslateButton();
    return blocks.length
      ? notice(`全部 ${blocks.length} 个段落已有译文。`,false)
      : notice("未识别到可翻译文字。点击“本地 OCR 并精译”识别扫描页。",true,true);
  }
  const taskState=state.translationTask;taskState.running=true;taskState.paused=false;taskState.cancelled=false;taskState.message=isRetry?"正在重试失败部分":"正在开始翻译";updateTranslateButton();renderTranslationTaskPanel();
  let fatalError="";
  try {
    for(let index=0;index<queue.length;index++){
      await waitForTranslationResume(); if(taskState.cancelled)break;
      const task=queue[index],activeBatch=task.batch.filter(block=>!block.translation);if(!activeBatch.length)continue;
      taskState.message=`正在翻译第 ${task.page.number}/${state.pages.length} 页，第 ${index+1}/${queue.length} 批`;notice(taskState.message,false,true);renderTranslationTaskPanel();
      let result;
      try{result=await chrome.runtime.sendMessage({type:"TRANSLATE_BATCH",professionalOnly:true,texts:activeBatch.map(block=>block.text),roles:activeBatch.map(block=>block.role||"")});}
      catch(error){result={ok:false,error:error?.message||String(error),retryable:true,code:"EXTENSION_MESSAGE_FAILED",stage:"extension-message",status:0,attempts:[]};}
      const returned=Array.isArray(result?.translations)?result.translations:[];
      let applied=0;
      activeBatch.forEach((block,itemIndex)=>{const value=returned[itemIndex];if(typeof value==="string"&&value.trim()){block.translation=value;applied++;}});
      if(applied||task.page.figureRegions.length)drawTranslation(task.page);
      if(applied)await saveTranslationSession();
      const failedBlocks=activeBatch.filter(block=>!block.translation);
      if(result?.ok&&!failedBlocks.length){continue;}
      else{
        if(failedBlocks.length)taskState.failed.push({page:task.page,batch:failedBlocks,failure:{error:result?.error||"翻译失败",retryable:Boolean(result?.retryable),code:result?.code||"",stage:result?.stage||"",status:Number(result?.status)||0,attempts:Array.isArray(result?.attempts)?result.attempts:[]}});
        taskState.message=`第 ${task.page.number} 页有 ${failedBlocks.length||activeBatch.length} 段待重试：${result?.error||"翻译失败"}`;renderTranslationTaskPanel();
        if(!result?.retryable){fatalError=result?.error||"翻译失败";for(const remaining of queue.slice(index+1))if(remaining.batch.some(block=>!block.translation))taskState.failed.push(remaining);break;}
      }
    }
    harmonizeDocumentTypography();setMode(state.mode);await saveTranslationSession();
    const progress=translationProgress(state.pages);
    if(taskState.cancelled){taskState.message="已取消，已完成译文已保存";notice("翻译已取消；已完成部分已保存在本机，下次可继续。",false,true);}
    else if(taskState.failed.length){const failedCount=taskState.failed.reduce((sum,item)=>sum+item.batch.filter(block=>!block.translation).length,0);taskState.message=fatalError?`已停止：${fatalError}`:`已完成其余内容，仍有 ${failedCount} 段待重试`;notice(`${taskState.message}。可点击“重试失败部分”。`,true,true);}
    else{taskState.message=`翻译完成：${progress.completedPages} 页`;notice(taskState.message);}
  }catch(error){taskState.message=`翻译中断：${error.message}`;notice(taskState.message,true,true);}
  finally{taskState.running=false;taskState.paused=false;for(const resolve of taskState.pauseWaiters.splice(0))resolve();await prepareTranslationEstimate();updateTranslateButton();renderTranslationTaskPanel();}
}

async function exportTranslatedPdf(){
  const complete=state.pages.length&&state.pages.every(page=>page.blocks.filter(isTranslatablePdfBlock).every(block=>block.translation));
  if(!complete)return notice("请先完成整篇 PDF 翻译，再导出纯译文。",true);
  setMode("reading"); notice("正在准备纯译文 PDF，请稍候…",false,true);
  const previousTitle=document.title;
  const baseName=shortName(state.source).replace(/\.pdf(?:\?.*)?$/i,"")||"科研译文";
  document.title=`${baseName}-纯译文`;
  document.body.classList.add("print-export");
  try{
    if(document.fonts?.ready)await document.fonts.ready;
    const images=[...document.querySelectorAll(".page-translation img")];
    await Promise.all(images.map(image=>image.complete?Promise.resolve():image.decode().catch(()=>{})));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    window.print();
  }finally{
    document.body.classList.remove("print-export"); document.title=previousTitle;
    notice("已打开打印窗口：请选择“另存为 PDF”。");
  }
}

function drawTranslation(page) {
  page.layer.replaceChildren(); page.translated.querySelectorAll(":scope > :not(h3)").forEach(element=>element.remove());
  const overlayEntries=[];
  for(const block of blocksForTextSelection(page)) {
    if(!block.translation||!isTranslatablePdfBlock(block)) continue;
    const roleClass=block.role==="heading"?`translation-heading heading-level-${block.headingLevel||3}`:block.role==="figure-caption"?"translation-figure-caption":block.role==="metadata"?"translation-metadata":block.role==="caption"?"translation-caption":"";
    const el=document.createElement("div"); el.className=`translation-block ${roleClass}`;
    el.dataset.role=block.role; if(block.headingLevel)el.dataset.headingLevel=String(block.headingLevel);
    const text=document.createElement("span"); text.className="translation-text"; renderScientificText(text,block.translation); el.append(text);
    el.style.left=`${Math.max(0,block.x-1)}px`; el.style.top=`${Math.max(0,block.y-1)}px`; el.style.width=`${Math.max(24,block.width+2)}px`; el.style.height=`${availableOverlayHeight(block,page.blocks,page.figureRegions)}px`;
    el.style.backgroundColor=sampleBackground(page.canvas,block); page.layer.append(el); overlayEntries.push({element:el,text,block});
  }
  page.overlayEntries=overlayEntries; optimizeOverlayTypography(overlayEntries,page,state.translationBodyFontSize||0);
  for(const block of sortBlocksForReading(page.blocks,page.viewport,page.number)) {
    if(!isTranslatablePdfBlock(block)) continue;
    const figureRegion=page.figureRegions.find(region=>region.caption===block);
    if(figureRegion){appendReadingFigure(page,figureRegion,block);continue;}
    if(!block.translation) continue;
    const references=parseReferenceList(block.translation,block.text);
    if(references){appendReferenceList(page,block,references);continue;}
    const inlineSection=block.role==="body"?splitInlineSection(block.text,block.translation):null;
    if(inlineSection){
      const heading=document.createElement("h4"); heading.className="inline-section-heading";
      appendLinkedSentences(heading,page,block,inlineSection.heading,inlineSection.sourceHeadingStart,inlineSection.sourceHeadingEnd);
      const body=document.createElement("p");
      appendLinkedSentences(body,page,block,inlineSection.body,inlineSection.sourceBodyStart,inlineSection.sourceBodyEnd);
      page.translated.append(heading,body); continue;
    }
    const p=document.createElement("p"); p.textContent=block.translation;
    if(block.role==="heading")p.className=`translation-heading-text heading-level-${block.headingLevel||3}`;
    else if(block.role==="figure-caption")p.className="translation-figure-caption-text";
    else if(block.role==="metadata")p.className="translation-metadata-text";
    else if(block.role==="caption")p.className="translation-caption-text";
    appendLinkedSentences(p,page,block);
    page.translated.append(p);
  }
}

function appendReferenceList(page,block,references){
  const section=document.createElement("section"); section.className="translation-reference-section";
  if(references.heading){
    const heading=document.createElement("h4"); heading.className="translation-reference-heading"; heading.textContent=references.heading; section.append(heading);
  }
  const sourceOffset=offset=>Math.round(Math.max(0,Math.min(block.translation.length,offset))/Math.max(1,block.translation.length)*block.text.length);
  if(references.lead){
    const continuation=document.createElement("p"); continuation.className="translation-reference-continuation";
    appendLinkedSentences(continuation,page,block,references.lead,sourceOffset(references.leadStart),sourceOffset(references.leadEnd)); section.append(continuation);
  }
  const list=document.createElement("ol"); list.className="translation-reference-list"; list.start=references.entries[0].number;
  for(const entry of references.entries){
    const item=document.createElement("li"); item.value=entry.number;
    appendLinkedSentences(item,page,block,entry.text,sourceOffset(entry.start),sourceOffset(entry.end)); list.append(item);
  }
  section.append(list); page.translated.append(section);
}

function figureDataUrl(page,region){
  if(region.dataUrl)return region.dataUrl;
  const ratio=page.canvas.width/parseFloat(page.canvas.style.width||page.canvas.width);
  const sx=Math.max(0,Math.floor(region.x*ratio)); const sy=Math.max(0,Math.floor(region.y*ratio));
  const sw=Math.min(page.canvas.width-sx,Math.ceil(region.width*ratio)); const sh=Math.min(page.canvas.height-sy,Math.ceil(region.height*ratio));
  const crop=document.createElement("canvas"); crop.width=sw; crop.height=sh;
  crop.getContext("2d").drawImage(page.canvas,sx,sy,sw,sh,0,0,sw,sh);
  region.dataUrl=crop.toDataURL("image/webp",.94); return region.dataUrl;
}

function appendReadingFigure(page,region,block){
  const figure=document.createElement("figure"); figure.className=`reading-figure${region.kind==="table"?" reading-table":""}`;
  const image=document.createElement("img"); image.src=figureDataUrl(page,region); image.alt=block.text.split(/[.:：]/,1)[0]||`第 ${page.number} 页图像`;
  const caption=document.createElement("figcaption");
  if(block.translation)appendLinkedSentences(caption,page,block);
  else{caption.className="pending-figure-caption";caption.textContent=block.text;caption.title="图注待补译";}
  if(region.kind==="table")figure.append(caption,image);else figure.append(image,caption);
  page.translated.append(figure);
}

function appendLinkedSentences(paragraph,page,block,translationText=block.translation,sourceStart=0,sourceEnd=block.text.length){
  paragraph.textContent="";
  const translated=sentenceRanges(translationText,"zh");
  const sourceText=block.text.slice(sourceStart,sourceEnd);
  const source=sentenceRanges(sourceText,"en");
  const translatedCount=Math.max(1,translated.length);
  for(let index=0;index<translated.length;index++){
    const segment=translated[index]; const sourceIndex=Math.min(source.length-1,Math.floor(index*Math.max(1,source.length)/translatedCount));
    const sourceSegment=source[sourceIndex]||{start:0,end:sourceText.length};
    const span=document.createElement("span"); span.className="translation-sentence"; renderScientificText(span,segment.text);
    sentenceLinks.set(span,{page,block,start:sourceStart+sourceSegment.start,end:sourceStart+sourceSegment.end}); paragraph.append(span);
  }
}

function buildSourceTextLayer(page){
  const records=[];
  const measureContext=document.createElement("canvas").getContext("2d");
  for(const block of blocksForTextSelection(page)){
    let cursor=0;
    for(const line of block.lines){
      let lineStart=block.text.indexOf(line.text,Math.max(0,cursor-2));
      if(lineStart<0)lineStart=cursor;
      cursor=lineStart+line.text.length+1;
      const segments=line.segments?.length?line.segments:[{text:line.text,x:line.x,y:line.y,width:line.width,height:line.height,fontSize:line.fontSize,start:0,end:line.text.length}];
      for(const segment of segments){
        const span=document.createElement("span"); span.className="source-text-span"; span.textContent=segment.text;
        span.style.left=`${segment.x}px`; span.style.top=`${segment.y}px`; span.style.fontSize=`${Math.max(6,segment.fontSize)}px`;
        span.style.height=`${Math.max(segment.height,segment.fontSize*1.1)}px`;
        const link={page,block,start:lineStart+segment.start,end:lineStart+segment.end,left:segment.x,top:segment.y,width:segment.width,height:Math.max(segment.height,segment.fontSize*1.1)};
        sourceSpanLinks.set(span,link); page.selectionLayer.append(span);
        records.push({span,width:segment.width,link});
      }
    }
  }
  for(const {span,width,link} of records){
    measureContext.font=`${Math.max(6,parseFloat(span.style.fontSize)||10)}px Arial, sans-serif`;
    const natural=Math.max(1,measureContext.measureText(span.textContent).width);
    let targetWidth=Math.min(width,natural*1.55);
    const half=page.viewport.width/2;
    let column="wide";
    if(targetWidth<=page.viewport.width*.62){
      if(link.left<half){
        column="left";
        targetWidth=Math.min(targetWidth,Math.max(4,half-link.left-page.viewport.width*.012));
      }else column="right";
    }
    span.style.transform=`scaleX(${targetWidth/natural})`;
    link.width=targetWidth;
    span.dataset.column=column;
  }
  const firstColumnTop=Math.min(...records.filter(record=>record.span.dataset.column!=="wide").map(record=>record.link.top),Infinity);
  const group=record=>record.span.dataset.column==="wide"&&record.link.top<=firstColumnTop?0:record.span.dataset.column==="left"?1:record.span.dataset.column==="right"?2:3;
  records.sort((a,b)=>group(a)-group(b)||a.link.top-b.link.top||a.link.left-b.link.left).forEach(record=>page.selectionLayer.append(record.span));
  page.selectionLayer.addEventListener("pointerdown",event=>startSourceSelection(page,event));
  page.selectionLayer.addEventListener("pointermove",event=>moveSourceSelection(page,event));
  page.selectionLayer.addEventListener("pointerup",event=>endSourceSelection(page,event));
  page.selectionLayer.addEventListener("pointercancel",event=>endSourceSelection(page,event));
}

function startSourceSelection(page,event){
  if(event.button!==0)return;
  const span=event.target.closest?.(".source-text-span"); if(!span)return;
  event.preventDefault();
  const point=sourceCaretPoint(span,event.clientX);
  sourceSelectionDrag={page,pointerId:event.pointerId,column:span.dataset.column,anchor:point};
  page.selectionLayer.setPointerCapture?.(event.pointerId);
  setSourceSelection(point,point);
}

function moveSourceSelection(page,event){
  const drag=sourceSelectionDrag;
  if(!drag||drag.page!==page||drag.pointerId!==event.pointerId)return;
  event.preventDefault();
  const span=sourceSpanAtPoint(page,event.clientX,event.clientY,drag.column);
  if(span)setSourceSelection(drag.anchor,sourceCaretPoint(span,event.clientX));
}

function endSourceSelection(page,event){
  const drag=sourceSelectionDrag;
  if(!drag||drag.page!==page||drag.pointerId!==event.pointerId)return;
  moveSourceSelection(page,event);
  try{page.selectionLayer.releasePointerCapture?.(event.pointerId)}catch{}
  sourceSelectionDrag=null;
}

function sourceSpanAtPoint(page,x,y,column){
  const allowed=span=>column==="wide"||span.dataset.column===column||span.dataset.column==="wide";
  const direct=document.elementsFromPoint(x,y).find(element=>element.classList?.contains("source-text-span")&&allowed(element));
  if(direct)return direct;
  let best=null,bestDistance=Infinity;
  for(const span of page.selectionLayer.querySelectorAll(".source-text-span")){
    if(!allowed(span))continue;
    const rect=span.getBoundingClientRect();
    const dx=x<rect.left?rect.left-x:x>rect.right?x-rect.right:0;
    const dy=y<rect.top?rect.top-y:y>rect.bottom?y-rect.bottom:0;
    const distance=dy*dy*4+dx*dx;
    if(distance<bestDistance){best=span;bestDistance=distance;}
  }
  return best;
}

function sourceCaretPoint(span,x){
  const node=span.firstChild;
  const rect=span.getBoundingClientRect();
  const ratio=Math.max(0,Math.min(1,(x-rect.left)/Math.max(1,rect.width)));
  return{node,offset:Math.max(0,Math.min(node.length,Math.round(node.length*ratio)))};
}

function setSourceSelection(anchor,focus){
  const anchorBeforeFocus=anchor.node===focus.node?anchor.offset<=focus.offset:Boolean(anchor.node.compareDocumentPosition(focus.node)&Node.DOCUMENT_POSITION_FOLLOWING);
  const start=anchorBeforeFocus?anchor:focus,end=anchorBeforeFocus?focus:anchor;
  const range=document.createRange();range.setStart(start.node,start.offset);range.setEnd(end.node,end.offset);
  const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
}

function blocksForTextSelection(page){
  // A coordinate-sorted PDF layer interleaves left/right column lines in the DOM.
  // Force column reading order even on page one so a native selection stays in its visual column.
  return sortBlocksForReading(page.blocks.filter(isTranslatablePdfBlock),page.viewport,Math.max(2,page.number));
}

function sentenceRanges(text,language){
  const value=String(text||"");
  if(!value)return [];
  try{
    return [...new Intl.Segmenter(language,{granularity:"sentence"}).segment(value)]
      .map(item=>({text:item.segment,start:item.index,end:item.index+item.segment.length})).filter(item=>item.text.trim());
  }catch{
    const out=[]; const pattern=/[^.!?。！？]+[.!?。！？]+\s*|[^.!?。！？]+$/g; let match;
    while((match=pattern.exec(value)))out.push({text:match[0],start:match.index,end:match.index+match[0].length});
    return out;
  }
}

function updateLinkedSelection(){
  clearTimeout(autoLocateTimer);
  clearSourceHighlights();
  if(state.mode!=="bilingual")return;
  const selection=getSelection(); if(!selection||selection.isCollapsed||!selection.rangeCount)return;
  const range=selection.getRangeAt(0); const anchor=selection.anchorNode?.parentElement||selection.anchorNode;
  const panel=anchor?.closest?.(".page-translation");
  if(panel){
    const links=[];
    for(const span of panel.querySelectorAll(".translation-sentence")){
      try{if(range.intersectsNode(span)){span.classList.add("linked-selection");const link=sentenceLinks.get(span);if(link)links.push(link);}}catch{}
    }
    for(const link of links)drawSourceHighlight(link);
    scheduleCounterpartCenter([...new Set(links.map(link=>link.page))].flatMap(page=>[...page.selectionLayer.querySelectorAll(".source-highlight")]));
    return;
  }
  const sourceLayer=anchor?.closest?.(".selection-layer"); if(!sourceLayer)return;
  const sourceLinks=[];
  for(const span of sourceLayer.querySelectorAll(".source-text-span")){
    try{if(range.intersectsNode(span)){const link=sourceSpanLinks.get(span);if(link)sourceLinks.push(link);}}catch{}
  }
  for(const link of sourceLinks){
    for(const translatedSpan of link.page.translated.querySelectorAll(".translation-sentence")){
      const translatedLink=sentenceLinks.get(translatedSpan);
      if(translatedLink?.block===link.block&&translatedLink.end>link.start&&translatedLink.start<link.end)translatedSpan.classList.add("linked-selection");
    }
  }
  scheduleCounterpartCenter(document.querySelectorAll(".translation-sentence.linked-selection"));
}

function clearSourceHighlights(){
  document.querySelectorAll(".source-highlight").forEach(element=>element.remove());
  document.querySelectorAll(".translation-sentence.linked-selection").forEach(element=>element.classList.remove("linked-selection"));
}

function setAutoLocate(enabled,persist=false){
  state.autoLocate=enabled;
  const button=$("auto-locate");
  button.textContent=`联动定位：${enabled?"开":"关"}`;
  button.classList.toggle("active",enabled);
  button.setAttribute("aria-pressed",String(enabled));
  if(persist){
    chrome.storage.local.set({pdfAutoLocate:enabled});
    notice(enabled?"已开启联动定位：选完文字后，另一侧对应语句会自动移到屏幕中部。":"已关闭联动定位。",false);
    if(enabled)updateLinkedSelection();
  }
  if(!enabled){
    clearTimeout(autoLocateTimer);
    clearCounterpartPulse();
  }
}

function scheduleCounterpartCenter(elements){
  if(!state.autoLocate||state.mode!=="bilingual")return;
  const targets=[...new Set([...elements].filter(element=>element?.isConnected))];
  if(!targets.length)return;
  clearTimeout(autoLocateTimer);
  autoLocateTimer=setTimeout(()=>centerCounterpart(targets),360);
}

function centerCounterpart(targets){
  const visible=targets.filter(element=>element?.isConnected).map(element=>({element,rect:element.getBoundingClientRect()})).filter(item=>item.rect.width>0&&item.rect.height>0);
  if(!visible.length)return;
  const top=Math.min(...visible.map(item=>item.rect.top));
  const bottom=Math.max(...visible.map(item=>item.rect.bottom));
  const pane=visible[0].element.closest(".pages-pane");
  if(!pane)return;
  const paneRect=pane.getBoundingClientRect();
  const destination=Math.max(0,pane.scrollTop+(top+bottom)/2-(paneRect.top+paneRect.bottom)/2);
  pane.scrollTo({top:destination,behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});
  clearCounterpartPulse();
  visible.map(item=>item.element).forEach(element=>element.classList.add("counterpart-focus"));
  counterpartPulseTimer=setTimeout(clearCounterpartPulse,1500);
}

function clearCounterpartPulse(){
  clearTimeout(counterpartPulseTimer);
  document.querySelectorAll(".counterpart-focus").forEach(element=>element.classList.remove("counterpart-focus"));
}

function setReaderToolsEnabled(enabled){
  for(const id of ["toggle-outline","prev-page","next-page","page-number","zoom-out","zoom-value","zoom-in","pdf-search"]){$(id).disabled=!enabled;}
  if(!enabled){$("search-prev").disabled=true;$("search-next").disabled=true;$("page-total").textContent="0";}
}

function updatePageControls(){
  const total=state.pages.length;state.currentPage=Math.max(1,Math.min(total||1,state.currentPage||1));
  $("page-number").value=String(state.currentPage);$("prev-page").disabled=!total||state.currentPage<=1;$("next-page").disabled=!total||state.currentPage>=total;
  $("zoom-value").textContent=`${Math.round(state.zoom*100)}%${state.zoomMode==="width"?"·宽":""}`;
}

function scrollContainerToElement(container,element,behavior="smooth"){
  const pane=container.getBoundingClientRect(),target=element.getBoundingClientRect();
  container.scrollTo({top:Math.max(0,container.scrollTop+target.top-pane.top-16),behavior});
}

function goToPage(number,side="both"){
  if(!state.pages.length)return;const pageNumber=Math.max(1,Math.min(state.pages.length,Math.round(number)||1)),page=state.pages[pageNumber-1];state.currentPage=pageNumber;updatePageControls();
  if(state.mode==="bilingual"){
    if(side!=="translation")scrollContainerToElement($("source-pages"),page.wrap);
    if(side!=="source")scrollContainerToElement($("translation-pages"),page.translated);
  }else{
    const target=state.mode==="reading"?page.translated:page.wrap,rect=target.getBoundingClientRect();
    window.scrollTo({top:Math.max(0,window.scrollY+rect.top-(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--toolbar-height"))||50)-(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--reader-tools-height"))||42)-12),behavior:"smooth"});
  }
  scheduleSessionSave();
}

function scheduleCurrentPageUpdate(side=state.activePane){
  state.activePane=side;cancelAnimationFrame(paneScrollFrame);paneScrollFrame=requestAnimationFrame(()=>{
    if(!state.pages.length)return;
    const container=state.mode==="bilingual"?(side==="source"?$("source-pages"):$("translation-pages")):null;
    const center=container?container.getBoundingClientRect().top+container.clientHeight/2:innerHeight/2;
    const targetFor=page=>side==="source"||state.mode!=="reading"?page.wrap:page.translated;
    let best=state.currentPage,distance=Infinity;
    for(const page of state.pages){const rect=targetFor(page).getBoundingClientRect(),value=Math.abs((rect.top+rect.bottom)/2-center);if(value<distance){distance=value;best=page.number;}}
    if(best!==state.currentPage){state.currentPage=best;updatePageControls();}
  });
}

function setZoom(value,mode="manual",save=true){
  state.zoom=Math.max(.5,Math.min(2,Math.round(value*100)/100));state.zoomMode=mode;
  applyZoom();updatePageControls();if(save)scheduleSessionSave();
}

function applyZoom(){
  for(const page of state.pages){page.wrap.style.zoom=String(state.zoom);page.translated.style.zoom=String(state.zoom);}
}

function fitPageWidth(){
  if(!state.pages.length)return;let available;
  if(state.mode==="bilingual")available=Math.min($("source-pages").clientWidth-28,$("translation-pages").clientWidth-28);
  else available=Math.min(innerWidth-40,state.mode==="reading"?860:state.pages[0].viewport.width);
  const base=state.mode==="reading"?760:state.pages[0].viewport.width;setZoom(available/Math.max(1,base),"width");
}

function buildPdfOutline(){
  const container=$("outline-items");container.replaceChildren();const seen=new Set(),items=[];
  for(const page of state.pages){
    for(const block of sortBlocksForReading(page.blocks,page.viewport,page.number)){
      if(block.role!=="heading")continue;const text=block.text.replace(/\s+/g," ").trim();if(!text||seen.has(text)||text.length>180)continue;seen.add(text);items.push({page:page.number,text,level:block.headingLevel||3});
    }
  }
  if(!items.length)state.pages.forEach(page=>items.push({page:page.number,text:`第 ${page.number} 页`,level:3}));
  for(const item of items){const button=document.createElement("button");button.className=`outline-item outline-level-${item.level}`;button.textContent=item.text;button.title=`跳到第 ${item.page} 页`;button.onclick=()=>{goToPage(item.page);$("pdf-outline").hidden=true;};container.append(button);}
}

function textRanges(element,query){
  const ranges=[],needle=query.toLocaleLowerCase(),walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let node;
  while((node=walker.nextNode())){const text=node.data.toLocaleLowerCase();let from=0,index;while((index=text.indexOf(needle,from))>=0){const range=document.createRange();range.setStart(node,index);range.setEnd(node,index+query.length);ranges.push(range);from=index+Math.max(1,query.length);}}
  return ranges;
}

function clearPdfSearchHighlights(){
  if(globalThis.CSS?.highlights){CSS.highlights.delete("pdf-search");CSS.highlights.delete("pdf-search-current");}
  document.querySelectorAll(".search-fallback,.search-current-fallback").forEach(element=>element.classList.remove("search-fallback","search-current-fallback"));document.body.classList.remove("has-pdf-search");
}

function renderPdfSearchHighlights(){
  clearPdfSearchHighlights();if(!state.searchResults.length)return;document.body.classList.add("has-pdf-search");
  const all=state.searchResults.flatMap(result=>result.ranges),current=state.searchResults[state.searchIndex]?.ranges||[];
  if(globalThis.CSS?.highlights&&globalThis.Highlight){CSS.highlights.set("pdf-search",new Highlight(...all));CSS.highlights.set("pdf-search-current",new Highlight(...current));}
  else{state.searchResults.forEach(result=>result.target.classList.add("search-fallback"));state.searchResults[state.searchIndex]?.target.classList.add("search-current-fallback");}
}

function runPdfSearch(){
  clearPdfSearchHighlights();state.searchResults=[];state.searchIndex=-1;const query=$("pdf-search").value.trim();
  if(!query){$("search-count").textContent="0/0";$("search-prev").disabled=true;$("search-next").disabled=true;return;}
  for(const page of state.pages){
    for(const span of page.selectionLayer.querySelectorAll(".source-text-span")){const ranges=textRanges(span,query);if(ranges.length)state.searchResults.push({page:page.number,side:"source",target:span,ranges});}
    for(const span of page.translated.querySelectorAll(".translation-sentence")){const ranges=textRanges(span,query);if(ranges.length)state.searchResults.push({page:page.number,side:"translation",target:span,ranges});}
  }
  $("search-prev").disabled=$("search-next").disabled=!state.searchResults.length;
  if(state.searchResults.length){state.searchIndex=0;showSearchResult();}else{$("search-count").textContent="0/0";notice(`没有找到“${query}”`,true);}
}

function stepSearch(direction){if(!state.searchResults.length)return;state.searchIndex=(state.searchIndex+direction+state.searchResults.length)%state.searchResults.length;showSearchResult();}

function showSearchResult(){
  const result=state.searchResults[state.searchIndex];if(!result)return;$("search-count").textContent=`${state.searchIndex+1}/${state.searchResults.length}`;
  if(state.mode!=="bilingual"&&result.side==="source"&&state.mode==="reading")setMode("original");
  if(state.mode!=="bilingual"&&result.side==="translation"&&(state.mode==="original"||state.mode==="overlay"))setMode("reading");
  renderPdfSearchHighlights();state.currentPage=result.page;updatePageControls();
  if(state.mode==="bilingual")scrollContainerToElement(result.side==="source"?$("source-pages"):$("translation-pages"),result.target);
  else{const rect=result.target.getBoundingClientRect();window.scrollTo({top:Math.max(0,window.scrollY+rect.top-innerHeight*.42),behavior:"smooth"});}
}

function clearPdfSearch(){state.searchResults=[];state.searchIndex=-1;if($("pdf-search"))$("pdf-search").value="";if($("search-count"))$("search-count").textContent="0/0";clearPdfSearchHighlights();}

function resetPagePanes(){
  const source=document.createElement("div"); source.id="source-pages"; source.className="pages-pane source-pages";
  const translation=document.createElement("div"); translation.id="translation-pages"; translation.className="pages-pane translation-pages";
  source.addEventListener("scroll",()=>{scheduleSessionSave();scheduleCurrentPageUpdate("source");},{passive:true}); translation.addEventListener("scroll",()=>{scheduleSessionSave();scheduleCurrentPageUpdate("translation");},{passive:true});
  source.addEventListener("pointerdown",()=>state.activePane="source");translation.addEventListener("pointerdown",()=>state.activePane="translation");
  $("pages").replaceChildren(source,translation);
}

function updateToolbarHeight(){
  const height=Math.ceil(document.querySelector(".toolbar")?.getBoundingClientRect().height||56),readerHeight=Math.ceil($("reader-tools")?.getBoundingClientRect().height||42);
  document.documentElement.style.setProperty("--toolbar-height",`${height}px`);document.documentElement.style.setProperty("--reader-tools-height",`${readerHeight}px`);
}

function applyTranslationHighlight(action){
  const selection=getSelection();
  if(!selection||selection.isCollapsed||!selection.rangeCount)return notice(action==="add"?"请先在纯译文中选中文字。":"请先选中需要擦除的高亮文字。",true);
  const range=selection.getRangeAt(0);
  const elementFor=node=>node?.nodeType===Node.ELEMENT_NODE?node:node?.parentElement;
  const startPanel=elementFor(range.startContainer)?.closest?.(".page-translation");
  const endPanel=elementFor(range.endContainer)?.closest?.(".page-translation");
  if(!startPanel||startPanel!==endPanel)return notice("高亮标记需在同一页的纯译文内完成。",true);
  if(action==="erase"){
    const marks=[...startPanel.querySelectorAll("mark.user-highlight")].filter(mark=>{try{return range.intersectsNode(mark)}catch{return false}});
    if(!marks.length)return notice("所选文字中没有可擦除的高亮。",true);
    for(const mark of marks){const parent=mark.parentNode;mark.replaceWith(...mark.childNodes);parent?.normalize();}
    selection.removeAllRanges(); clearSourceHighlights(); scheduleSessionSave(); return notice(`已擦除 ${marks.length} 处高亮。`);
  }
  const walker=document.createTreeWalker(startPanel,NodeFilter.SHOW_TEXT,{acceptNode(node){
    if(!node.data.trim()||node.parentElement?.closest("mark.user-highlight"))return NodeFilter.FILTER_REJECT;
    try{return range.intersectsNode(node)?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT}catch{return NodeFilter.FILTER_REJECT}
  }});
  const pieces=[]; let node;
  while((node=walker.nextNode())){
    let start=0,end=node.length;
    if(node===range.startContainer)start=range.startOffset;
    if(node===range.endContainer)end=range.endOffset;
    if(end>start)pieces.push({node,start,end});
  }
  if(!pieces.length)return notice("没有找到可标记的译文文字。",true);
  for(const piece of pieces.reverse()){
    const selected=piece.node.splitText(piece.start); selected.splitText(piece.end-piece.start);
    const mark=document.createElement("mark"); mark.className="user-highlight"; selected.replaceWith(mark); mark.append(selected);
  }
  selection.removeAllRanges(); clearSourceHighlights(); scheduleSessionSave(); notice(`已标记 ${pieces.length} 处文字；导出 PDF 时会保留。`);
}

function drawSourceHighlight({page,block,start,end}){
  let drawn=0;
  for(const span of page.selectionLayer.querySelectorAll(".source-text-span")){
    const link=sourceSpanLinks.get(span);
    if(link?.block!==block)continue;
    const overlapStart=Math.max(start,link.start); const overlapEnd=Math.min(end,link.end);
    if(overlapEnd<=overlapStart)continue;
    const from=(overlapStart-link.start)/Math.max(1,link.end-link.start); const to=(overlapEnd-link.start)/Math.max(1,link.end-link.start);
    addHighlightRect(page,link.left+link.width*from,link.top,Math.max(3,link.width*(to-from)),link.height); drawn++;
  }
  if(!drawn)addHighlightRect(page,block.x,block.y,block.width,block.height);
}

function addHighlightRect(page,left,top,width,height){
  const marker=document.createElement("div"); marker.className="source-highlight";
  marker.style.left=`${left}px`; marker.style.top=`${top}px`; marker.style.width=`${width}px`; marker.style.height=`${height}px`;
  page.selectionLayer.append(marker);
}

function harmonizeDocumentTypography(){
  const entries=state.pages.flatMap(page=>page.overlayEntries||[]).filter(entry=>entry.block.role==="body");
  if(!entries.length)return;
  const sourceBase=state.bodyFontSize||10;
  const limits=entries.map(entry=>maximumFittingSize(entry,Math.max(7,sourceBase*.72),sourceBase*1.32));
  state.translationBodyFontSize=clamp(percentile(limits,.2)||sourceBase,sourceBase*.94,sourceBase*1.18);
  for(const page of state.pages)if(page.overlayEntries?.length)optimizeOverlayTypography(page.overlayEntries,page,state.translationBodyFontSize);
}

function optimizeOverlayTypography(entries,page,fixedBodyBase=0){
  const sourceBase=state.bodyFontSize||page.bodyFontSize||10;
  const bodyEntries=entries.filter(entry=>entry.block.role==="body");
  for(const entry of entries){
    entry.element.title=entry.block.translation;
    entry.text.style.lineHeight="1.22";
  }
  const fitLimits=bodyEntries.map(entry=>maximumFittingSize(entry,Math.max(7,sourceBase*.72),sourceBase*1.32));
  const robustLimit=percentile(fitLimits,.2)||sourceBase;
  const bodyBase=fixedBodyBase||clamp(robustLimit,sourceBase*.94,sourceBase*1.18);
  page.translationBodyFontSize=bodyBase;

  for(const entry of entries){
    const {block}=entry;
    if(block.role==="body"){
      const fit=maximumFittingSize(entry,Math.max(7,sourceBase*.72),bodyBase*1.08);
      const preferred=fit>=bodyBase*1.18?bodyBase*1.05:Math.min(fit,bodyBase);
      const size=clamp(preferred,sourceBase*.76,bodyBase*1.05);
      applyFittedTypography(entry,size,Math.max(6.8,sourceBase*.72),true);
    }else if(block.role==="figure-caption"){
      applyFittedTypography(entry,bodyBase*.9,Math.max(6.8,bodyBase*.72),false);
    }else if(block.role==="caption"){
      applyFittedTypography(entry,bodyBase*.76,Math.max(6.2,bodyBase*.62),false);
    }else if(block.role==="metadata"){
      applyFittedTypography(entry,bodyBase*.84,Math.max(7,bodyBase*.68),false);
    }else{
      const ratio=block.headingLevel===1?1.72:block.headingLevel===2?1.38:1.16;
      const desired=Math.min(30,Math.max(bodyBase*ratio,block.fontSize*.82));
      applyFittedTypography(entry,desired,Math.max(9,bodyBase*1.02),false);
    }
  }
}

function maximumFittingSize(entry,minimum,maximum){
  let low=minimum,high=Math.max(minimum,maximum);
  for(let index=0;index<8;index++){
    const middle=(low+high)/2; entry.text.style.fontSize=`${middle}px`; entry.text.style.lineHeight="1.22";
    if(fits(entry.element))low=middle;else high=middle;
  }
  return low;
}

function applyFittedTypography(entry,preferred,minimum,fillRegion){
  let size=preferred; entry.text.style.fontSize=`${size}px`; entry.text.style.lineHeight="1.22";
  while(size>minimum&&!fits(entry.element)){size-=.25;entry.text.style.fontSize=`${size}px`;}
  if(fillRegion&&fits(entry.element)){
    const estimatedLines=Math.max(1,Math.round(entry.text.scrollHeight/(size*1.22)));
    const available=Math.max(1,entry.element.clientHeight-2);
    const balancedLineHeight=clamp(available/(estimatedLines*size),1.22,1.52);
    entry.text.style.lineHeight=String(balancedLineHeight);
    while(!fits(entry.element)&&Number(entry.text.style.lineHeight)>1.18){
      entry.text.style.lineHeight=String(Number(entry.text.style.lineHeight)-.02);
    }
    if(entry.text.getBoundingClientRect().height<entry.element.clientHeight*.58)entry.element.classList.add("translation-sparse");
  }
  if(!fits(entry.element)){entry.element.classList.add("translation-tight");}
}

function fits(element){return element.scrollHeight<=element.clientHeight+1&&element.scrollWidth<=element.clientWidth+1;}
function clamp(value,minimum,maximum){return Math.max(minimum,Math.min(maximum,value));}
function median(values){return percentile(values,.5);}
function percentile(values,ratio){
  if(!values.length)return 0; const sorted=[...values].sort((a,b)=>a-b); const position=(sorted.length-1)*ratio;
  const lower=Math.floor(position),upper=Math.ceil(position); return sorted[lower]+(sorted[upper]-sorted[lower])*(position-lower);
}

function sampleBackground(canvas,block){
  try{
    const context=canvas.getContext("2d",{willReadFrequently:true}); const ratio=canvas.width/parseFloat(canvas.style.width||canvas.width);
    const points=[[block.x-3,block.y+block.height/2],[block.right+3,block.y+block.height/2],[block.x+2,block.y-3],[block.right-2,block.bottom+3]];
    const samples=[];
    for(const [x,y] of points){const px=Math.max(0,Math.min(canvas.width-1,Math.round(x*ratio)));const py=Math.max(0,Math.min(canvas.height-1,Math.round(y*ratio)));samples.push([...context.getImageData(px,py,1,1).data].slice(0,3));}
    const channel=index=>samples.map(sample=>sample[index]).sort((a,b)=>a-b)[Math.floor(samples.length/2)];
    return `rgb(${channel(0)},${channel(1)},${channel(2)})`;
  }catch{return "rgb(255,255,255)";}
}
function batches(items,limit,maxItems){const out=[];let b=[],n=0;for(const item of items){if(b.length&&(n+item.text.length>limit||b.length>=maxItems)){out.push(b);b=[];n=0}b.push(item);n+=item.text.length+8}if(b.length)out.push(b);return out}
function setMode(mode){
  state.mode=mode;$("pages").className=`mode-${mode}`;document.body.classList.toggle("bilingual-active",mode==="bilingual");document.querySelectorAll("[data-mode]").forEach(b=>b.classList.toggle("active",b.dataset.mode===mode));
  const annotationEnabled=mode==="reading"||mode==="bilingual";
  $("mark-highlight").disabled=!annotationEnabled; $("erase-highlight").disabled=!annotationEnabled;
  $("auto-locate").disabled=mode!=="bilingual";
  clearSourceHighlights();
  if(mode!=="bilingual"){clearTimeout(autoLocateTimer);clearCounterpartPulse();}
  if(mode==="bilingual"&&state.pages.some(page=>page.blocks.some(block=>block.translation)))notice(state.autoLocate?"提示：两栏可独立滚动；选完文字后，只让另一栏的对应语句平滑移到中部。":"提示：两栏可独立滚动；左右任一侧选中文字，另一侧会高亮对应语句。",false);
  if(state.zoomMode==="width")requestAnimationFrame(fitPageWidth);
  scheduleSessionSave();
}
function notice(text,error=false,persist=false){const el=$("notice");el.textContent=text;el.style.color=error?"#922":"#365b52";el.style.display="block";clearTimeout(notice.timer);if(!persist)notice.timer=setTimeout(()=>el.style.display="none",3500)}
function shortName(value){try{return decodeURIComponent(new URL(String(value)).pathname.split("/").pop())||"PDF"}catch{return String(value).split(/[\\/]/).pop()}}
