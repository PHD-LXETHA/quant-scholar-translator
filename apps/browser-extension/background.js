// Kami Subs — background service worker
// Coordinates: popup <-> offscreen (audio capture) <-> content (overlay)
//             popup -> native host (spawns the Python backend)

import { mergeCaptionSource, shouldCommitCaption } from './caption-buffer.js';

const OFFSCREEN_DOC = 'offscreen.html';
const NATIVE_HOST   = 'com.quant_scholar.translator';

let activeTabId = null;
let isCapturing = false;
let captureStarting = false;
let captureStopping = false;
let captureError = '';
let captureDiagnostics = {};
let wsState = 'idle';           // idle | connecting | connected | error | closed
let backendState = 'unknown';   // unknown | starting | up | down | unavailable
let backendInfo = {};           // { pid?, wsUrl?, lastError? }
let nativePort = null;          // chrome.runtime.Port to native host, or null
let captureSession = null;
let captureMode = 'idle';       // idle | native-captions | audio-asr
let activeSettings = {};
let captionQueue = Promise.resolve();
let nativePending = null;
let nativeCommitTimer = null;
let lastOverlay = null;
let transcriptQueue = Promise.resolve();
let captureSequence = 0;
const sourceMediaTimes = new Map();
let fullController = null;
let archiveRestoring = false;
const archiveProbeTimes = new Map();

async function checkpointVideoSession(session) {
  if (!session?.full || session.videoLibrary === false || !globalThis.QSFullVideo?.saveArchive) return;
  try {
    const result = await globalThis.QSFullVideo.saveArchive(session, chrome, new URL(translationHttpUrl(activeSettings)).origin, fetch);
    if (result) { session.full.libraryDocument = result.path; session.full.librarySaved = result.done; session.full.libraryError = ''; }
  } catch (error) {
    session.full.libraryError = error.message || '本地文档保存失败，浏览器记录仍保留';
  }
  if (session === captureSession) await chrome.storage.local.set({ currentLearningSession: session });
}

async function restoreSavedVideo(tabId, force = false) {
  if (!Number.isInteger(tabId) || archiveRestoring || captureStarting || captureStopping || !globalThis.QSFullVideo) return { active: false };
  if (!force && Date.now() - (archiveProbeTimes.get(tabId) || 0) < 8000) return { active: false };
  archiveProbeTimes.set(tabId, Date.now());
  if (isCapturing && (!captureSession?.full || (activeTabId !== tabId && !captureSession.full.preparationPaused && !['complete', 'paused'].includes(captureSession.full.status)))) return { active: false };
  const { settings = {} } = await chrome.storage.local.get('settings');
  if (settings.videoLibrary === false) return { active: false };
  archiveRestoring = true;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!/^https?:/.test(tab.url || '')) return { active: false };
    const results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world: 'MAIN', func: globalThis.QSFullVideo.inspectPlayer });
    const found = results.filter(r => r.result && Number.isFinite(r.result.duration) && r.result.duration > 0)
      .sort((a, b) => Number(b.result.playing) - Number(a.result.playing) || b.result.area - a.result.area)[0];
    if (!found) return { active: false };
    const { result: player, frameId } = found;
    // An explicit Stop must stay stopped on this tab/video, including after a
    // service-worker restart. A different video or an explicit Show may resume.
    if (!force && captureSession?.full?.tabId === tabId
        && captureSession.full.identity === player.identity
        && captureSession.full.syncEnabled === false) return { active: false };
    if (isCapturing && activeTabId === tabId && captureSession?.full?.identity === player.identity) return { active: true };
    const saved = await globalThis.QSFullVideo.lookupArchive({ url: tab.url, identity: player.identity,
      duration: player.duration, signature: globalThis.QSFullVideo.settingsSignature(settings) }, chrome, new URL(translationHttpUrl(settings)).origin, fetch);
    if (!saved?.segments.some(s => s.translation.trim())) return { active: false };
    if (isCapturing) await getFullController().stop();
    captureSession = globalThis.QSFullVideo.restoredSession(saved, tab, frameId);
    captureSession.videoLibrary = true;
    activeTabId = tabId; isCapturing = true; captureMode = captureSession.captureMode; activeSettings = settings;
    captureError = ''; lastOverlay = null;
    try {
      await ensureContentScript(tabId);
      await chrome.tabs.sendMessage(tabId, { type: 'overlay:mount', settings }, { frameId: 0 });
      await getFullController().start(captureSession, { prepare: false });
    } catch (error) {
      isCapturing = false; activeTabId = null;
      captureSession.full.syncEnabled = false;
      await chrome.storage.local.set({ isCapturing, activeTabId, currentLearningSession: captureSession });
      throw error;
    }
    await chrome.storage.local.set({ isCapturing, activeTabId, currentLearningSession: captureSession });
    return { active: true, restored: true };
  } finally { archiveRestoring = false; }
}

function getFullController() {
  if (!globalThis.QSFullVideo) return null;
  return fullController ||= globalThis.QSFullVideo.createController({
    chromeApi: chrome,
    fetcher: fetch,
    getSession: () => captureSession, isActive: () => isCapturing && !captureStopping,
    endpoint: () => new URL(translationHttpUrl(activeSettings)).origin,
    deliver: message => deliverOverlay(message), report: message => { captureError = message; },
    onCheckpoint: checkpointVideoSession,
  });
}

const stateReady = chrome.storage.local.get(['isCapturing', 'activeTabId', 'currentLearningSession', 'settings']).then(stored => {
  isCapturing = Boolean(stored.isCapturing);
  activeTabId = stored.activeTabId ?? null;
  captureSession = stored.currentLearningSession || null;
  captureMode = captureSession?.captureMode || (isCapturing ? 'audio-asr' : 'idle');
  activeSettings = stored.settings || {};
});

// Preparation does not depend on video playback, menu visibility or clock events.
void stateReady.then(() => getFullController()?.resume()).catch(error => { captureError = error.message; });
chrome.alarms?.onAlarm.addListener(alarm => {
  if (alarm.name !== globalThis.QSFullVideo?.PREPARATION_ALARM) return;
  void stateReady.then(() => getFullController()?.resume()).catch(error => { captureError = error.message; });
});

function isoNow() { return new Date().toISOString(); }

function formatMediaTime(seconds) {
  if (!Number.isFinite(seconds)) return null;
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

async function currentMediaTime() {
  if (activeTabId == null) return null;
  try {
    const response = await chrome.tabs.sendMessage(activeTabId, { type: 'media:time' }, { frameId: 0 });
    return Number.isFinite(response?.mediaTime) ? response.mediaTime : null;
  } catch (_error) {
    return null;
  }
}

async function persistFinalSegment(msg) {
  const sourceCommitted = msg.stage === 'source-final';
  if (!captureSession || (!msg.isFinal && !sourceCommitted) || !(msg.raw || msg.text)) return;
  if (msg.stage === 'source' || String(msg.stage || '').includes('preview')) return;
  const source = String(msg.raw || '').trim();
  const translation = String(msg.text || '').trim();
  if (!translation && !sourceCommitted) return;
  const session = captureSession;
  const resolvedMediaTime = Number.isFinite(msg.mediaTime) ? msg.mediaTime : await currentMediaTime();
  if (captureSession !== session || !isCapturing) return;
  const existing = msg.recordId && session.segments.find(item => item.id === msg.recordId);
  if (existing) {
    if (translation) { existing.translation = translation; existing.stage = msg.stage; existing.provider = msg.provider; }
    session.updatedAt = isoNow();
    await chrome.storage.local.set({ currentLearningSession: session });
    return;
  }
  const previous = captureSession.segments.at(-1);
  if (!msg.recordId && previous && previous.source.toLocaleLowerCase() === source.toLocaleLowerCase()
      && (resolvedMediaTime == null || previous.mediaTime == null || Math.abs(previous.mediaTime - resolvedMediaTime) < 3)) {
    return;
  }
  const segment = {
    id: msg.recordId || `${captureSession.id}:${captureSession.segments.length + 1}`,
    capturedAt: isoNow(),
    sourceLanguage: msg.detectedLang || captureSession.sourceLanguage || 'auto',
    source,
    translation,
    domain: captureSession.domain,
    mediaTime: resolvedMediaTime,
    provider: msg.provider || captureMode,
    stage: msg.stage || 'final'
  };
  if (!segment.source && !segment.translation) return;
  captureSession.segments.push(segment);
  captureSession.updatedAt = segment.capturedAt;
  await chrome.storage.local.set({ currentLearningSession: captureSession });
}

function sessionMarkdown(session) {
  const lines = [
    '---',
    `title: ${JSON.stringify(session.title || 'Untitled learning session')}`,
    `source_url: ${JSON.stringify(session.url || '')}`,
    `domain: ${session.domain || 'auto'}`,
    `captured_at: ${session.startedAt}`,
    `content_type: ${session.contentType || 'video_transcript'}`,
    '---', '',
    `# ${session.title || 'Learning session'}`, '',
    '> Generated by Quant Scholar Translator. Review terminology and numerical claims against the source.', ''
  ];
  for (const item of session.segments || []) {
    const time = formatMediaTime(item.mediaTime);
    const end = Number.isFinite(item.end) ? formatMediaTime(item.end) : '';
    lines.push(`## ${time ? `[${time}${end ? ` - ${end}` : ''}]` : item.capturedAt || '学习片段'}`, '', '**原文**', '', item.source || '', '', '**译文**', '', item.translation || '', '');
  }
  return lines.join('\n');
}

function srtTimestamp(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const rest = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(rest).padStart(3, '0')}`;
}

function sessionSrt(session) {
  const started = Date.parse(session.startedAt);
  return (session.segments || []).map((item, index, all) => {
    const wallTime = Math.max(0, (Date.parse(item.capturedAt) - started) / 1000);
    const start = Number.isFinite(item.mediaTime) ? item.mediaTime : wallTime;
    const next = all[index + 1];
    const nextStart = Number.isFinite(next?.mediaTime) ? next.mediaTime : null;
    const end = Number.isFinite(item.end) && item.end > start ? item.end
      : nextStart != null && nextStart > start ? Math.max(start + 0.8, nextStart - 0.05) : start + 4;
    const bilingual = [item.source, item.translation].filter(Boolean).join('\n');
    return `${index + 1}\n${srtTimestamp(start)} --> ${srtTimestamp(end)}\n${bilingual}\n`;
  }).join('\n');
}

async function exportCurrentSession(format = 'markdown', tabId, source = 'auto') {
  if (!['markdown', 'pdf', 'json', 'srt'].includes(format)) throw new Error('双语文本支持 Markdown 或 PDF；不再导出 TXT');
  const stored = await chrome.storage.local.get('currentLearningSession');
  let session = null;
  const tab = Number.isInteger(tabId) ? await chrome.tabs.get(tabId) : null;
  if (source !== 'video' && tab) {
    let page;
    try { page = await sendResearchCommand(tab.id, 'GET_PAGE_KNOWLEDGE'); }
    catch (error) { if (source === 'webpage') throw error; }
    if (page?.running) throw new Error('网页翻译尚未完成，请完成后再导出');
    if (page?.segments?.length) {
      const now = isoNow();
      session = { schemaVersion: 1, id: `webpage-${Date.now()}`, title: page.title || tab.title,
        url: tab.url, contentType: 'webpage_translation', startedAt: now, updatedAt: now,
        segments: page.segments.map((item, index) => ({ ...item, id: `webpage:${index + 1}`, capturedAt: now, mediaTime: null, stage: 'final' })) };
    }
  }
  if (!session && source !== 'webpage') {
    const video = stored.currentLearningSession;
    if (source === 'video' || (tab && video?.url === tab.url)) session = video;
  }
  if (session?.segments?.some(item => !item.translation)) throw new Error('仍有原文尚未翻译，请先在右栏补译，避免导出不完整的学习记录');
  if (!session?.segments?.length) throw new Error(source === 'webpage'
    ? '当前网页尚无译文，请先翻译网页，再导出 Markdown 或 JSON'
    : '没有可导出的最终译文：请先翻译当前网页或生成视频字幕；临时预览不会导出');
  if (format === 'srt' && session.contentType === 'webpage_translation') throw new Error('网页译文没有视频时间戳，请选 Markdown 或 JSON；SRT 仅用于视频记录');
  const safe = (session.title || 'learning-session').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
  if (format === 'pdf') {
    const id = `bilingual-pdf-${crypto.randomUUID()}`;
    await chrome.storage.local.set({ [id]: session });
    try { return await chrome.tabs.create({ url: chrome.runtime.getURL(`learning/bilingual-export.html?id=${encodeURIComponent(id)}`) }); }
    catch (error) { await chrome.storage.local.remove(id); throw error; }
  }
  const json = format === 'json';
  const srt = format === 'srt';
  const body = json ? JSON.stringify(session, null, 2) : srt ? sessionSrt(session) : sessionMarkdown(session);
  const mime = json ? 'application/json' : srt ? 'application/x-subrip' : 'text/markdown';
  const ext = json ? 'json' : srt ? 'srt' : 'md';
  const url = `data:${mime};charset=utf-8,${encodeURIComponent(body)}`;
  return chrome.downloads.download({ url, filename: `quant-scholar/${safe}.${ext}`, saveAs: true });
}

async function hasOffscreenDocument() {
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOC)]
    });
    return contexts.length > 0;
  }
  return false;
}

async function ensureOffscreen() {
  if (await hasOffscreenDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOC,
    reasons: ['USER_MEDIA'],
    justification: 'Capture tab audio for live subtitle generation'
  });
}

async function ensureContentScript(tabId) {
  // First try to ping the content script.
  try {
    const ready = await chrome.tabs.sendMessage(tabId, { type: 'ping' }, { frameId: 0 });
    if (ready?.ok) return;
  } catch (e) {
    // Not loaded — inject programmatically. Required for tabs opened before
    // the extension was installed/reloaded.
  }
  try {
    await chrome.scripting.insertCSS({
      target: { tabId, frameIds: [0] },
      files: ['content.css']
    });
  } catch (e) { /* ignore — may already be injected */ }
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    files: ['content.js']
  });
}

async function deliverOverlay(message) {
  const tabId = activeTabId;
  const sessionId = captureSession?.id;
  const current = () => activeTabId === tabId && captureSession?.id === sessionId && (isCapturing || captureStarting);
  if (tabId == null || !current()) return false;
  if (message.type === 'overlay:text') lastOverlay = message;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (attempt) {
        await ensureContentScript(tabId);
        if (!current()) return false;
        await chrome.tabs.sendMessage(tabId, { type: 'overlay:mount', settings: activeSettings }, { frameId: 0 });
      }
      if (!current()) return false;
      const result = await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
      if (!result?.ok) throw new Error('字幕框没有确认接收');
      captureDiagnostics.overlayError = '';
      captureDiagnostics.lastOverlayAt = Date.now();
      return true;
    } catch (error) {
      if (!current()) return false;
      if (attempt) {
        captureDiagnostics.overlayError = '字幕已生成，但网页字幕框未响应。请刷新此视频页后重试。';
        console.warn('[quant-scholar] subtitle delivery failed:', error);
      }
    }
  }
  return false;
}

async function sendResearchCommand(tabId, command) {
  if (!['TRANSLATE_PAGE', 'TOGGLE_TRANSLATION', 'GET_PAGE_KNOWLEDGE', 'GET_STATUS', 'CANCEL_PAGE_TRANSLATION'].includes(command)) throw new Error('不支持的网页操作');
  const tab = await chrome.tabs.get(tabId);
  if (!/^(https?|file):/i.test(tab.url || '')) throw new Error('浏览器内部页或扩展页面不能翻译，请切回普通网页');
  try {
    const ready = await chrome.tabs.sendMessage(tabId, { type: 'RESEARCH_PING' }, { frameId: 0 });
    if (!ready?.ok) throw new Error('Research script missing');
  } catch (_error) {
    await chrome.scripting.insertCSS({ target: { tabId, frameIds: [0] }, files: ['research/content.css'] });
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ['research/content.js'] });
  }
  if (command === 'TRANSLATE_PAGE') {
    const config = await chrome.storage.local.get(['provider', 'endpoint', 'settings']);
    const endpoint = new URL(config.endpoint || 'http://127.0.0.1:8765/kimi/v1/chat/completions');
    if (['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) && (endpoint.port || '80') === '8765') {
      try {
        const health = await fetch(`${endpoint.origin}/`, { signal: AbortSignal.timeout(1500) });
        if (!health.ok) throw new Error('Local service unavailable');
      } catch (_error) {
        if (!await ensureBackend(config.settings || {})) throw new Error('本地翻译服务未启动，请先启动本地服务或检查自动启动配置');
      }
    }
  }
  const result = await chrome.tabs.sendMessage(tabId, { type: command }, { frameId: 0 });
  if (!result) throw new Error('网页脚本未响应，请刷新当前网页后重试');
  return result;
}

// ---- Native Messaging: spawn the Python backend on demand ------------------
//
// Graceful degradation: if the user hasn't installed the native host, every
// Start still works as long as they launched the backend manually. The host
// is a nice-to-have, not a hard dependency.

function connectNative() {
  // chrome.runtime.connectNative is synchronous — failure shows up on the
  // onDisconnect listener with chrome.runtime.lastError set.
  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST);
  } catch (e) {
    backendState = 'unavailable';
    backendInfo = { lastError: String(e) };
    nativePort = null;
    return false;
  }

  nativePort.onMessage.addListener((msg) => {
    switch (msg.type) {
      case 'started':
        backendState = 'up';
        backendInfo = { pid: msg.pid, wsUrl: msg.wsUrl };
        break;
      case 'already_up':
        backendState = 'up';
        backendInfo = { wsUrl: msg.wsUrl, note: 'attached to existing backend' };
        break;
      case 'stopped':
        backendState = 'down';
        backendInfo = {};
        break;
      case 'status':
        backendState = msg.running ? 'up' : 'down';
        backendInfo = { pid: msg.pid || null, wsUrl: msg.wsUrl };
        break;
      case 'error':
        backendState = 'down';
        backendInfo = { lastError: msg.message };
        console.error('[kami-subs native]', msg.message);
        break;
      case 'log':
        // Backend stdout/stderr, surfaced for debugging. Comment out if noisy.
        console.log('[kami-backend]', msg.line);
        break;
    }
  });

  nativePort.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError;
    if (err) {
      // Most common: "Specified native messaging host not found." — the user
      // hasn't run install.ps1 yet. Mark unavailable so we stop trying.
      backendState = 'unavailable';
      backendInfo = { lastError: err.message || String(err) };
      console.warn('[kami-subs] native host unavailable:', err.message);
    } else if (backendState !== 'down') {
      backendState = 'down';
    }
    nativePort = null;
  });

  return true;
}

async function ensureBackend(settings) {
  // Already attempted and unavailable — don't keep retrying; user will start
  // the backend manually or run install.ps1.
  if (backendState === 'unavailable') return false;
  if (backendState === 'up' && nativePort) return true;

  if (!nativePort) {
    if (!connectNative()) return false;
  }

  // Pull whisper settings off the popup settings object if present.
  const startMsg = {
    type: 'start',
    model:      settings.model      || undefined,
    device:     settings.device     || undefined,
    compute:    settings.compute    || undefined,
    translator: settings.translator || undefined,
  };
  backendState = 'starting';
  try {
    nativePort.postMessage(startMsg);
  } catch (e) {
    backendState = 'unavailable';
    backendInfo = { lastError: String(e) };
    nativePort = null;
    return false;
  }

  // Block startCapture until the backend confirms ready (or errors out).
  // The launcher.py only sends 'started' after the port is actually accepting
  // connections, so 'up' = WS will succeed. Without this wait, the offscreen
  // WS open call races whisper model load (1-4s warm, 10s+ cold large-v3).
  // 60s ceiling matches launcher's deadline.
  await new Promise((resolve) => {
    const t0 = Date.now();
    const tick = setInterval(() => {
      if (backendState === 'up' || backendState === 'down' || backendState === 'unavailable' || Date.now() - t0 > 60000) {
        clearInterval(tick);
        resolve();
      }
    }, 150);
  });
  return backendState === 'up';
}

// The PDF/research worker shares this service worker but lives in a separate
// module scope. Expose only the backend readiness operation so PDF translation
// can start the same native service without duplicating launcher logic.
globalThis.QSEnsureBackend = ensureBackend;

function stopBackend() {
  if (!nativePort) return;
  try { nativePort.postMessage({ type: 'stop' }); } catch (e) { /* ignore */ }
  try { nativePort.disconnect(); } catch (e) { /* ignore */ }
  nativePort = null;
  backendState = 'down';
}

// The toolbar icon shows or hides the page-level floating entry point. The
// launcher itself opens the complete workspace, so ordinary reading pages stay
// untouched until the user explicitly enables it for that tab.
const toolbarActions = new Set();
chrome.action.onClicked.addListener(async tab => {
  if (!tab?.id || toolbarActions.has(tab.id)) return;
  toolbarActions.add(tab.id);
  try {
    if (!/^(https?|file):/i.test(tab.url || '')) throw new Error('请切换到普通网页后使用翻译菜单');
    await ensureContentScript(tab.id);
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'floating:toggle-visibility' }, { frameId: 0 });
    if (!result?.ok) throw new Error('网页悬浮入口未响应');
    await chrome.action.setBadgeText({ tabId: tab.id, text: '' });
    await chrome.action.setTitle({ tabId: tab.id, title: 'Quant Scholar · 显示 / 隐藏网页悬浮按钮' });
  } catch (error) {
    await Promise.allSettled([
      chrome.action.setBadgeText({ tabId: tab.id, text: '!' }),
      chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#9b651b' }),
      chrome.action.setTitle({ tabId: tab.id, title: '此页无法显示悬浮按钮，请切换到普通网页并刷新后重试。' }),
    ]);
    console.info('[quant-scholar] toolbar menu unavailable:', String(error));
  } finally {
    toolbarActions.delete(tab.id);
  }
});

function translationHttpUrl(settings) {
  const wsUrl = settings.backendUrl || 'ws://127.0.0.1:8765/ws';
  const url = new URL(wsUrl.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:'));
  url.pathname = '/translate';
  url.search = '';
  return url.toString();
}


function normalizedTranslationMode(settings = activeSettings) {
  return ['professional', 'quick', 'offline'].includes(settings?.translationMode)
    ? settings.translationMode
    : 'professional';
}

function professionalTranslator(settings = activeSettings) {
  // Keep the realtime API's provider ID while accepting saved caption-job IDs.
  if (settings?.translator === 'codex_subscription') return 'codex';
  return ['codex', 'kimi_subscription', 'llm'].includes(settings?.translator)
    ? settings.translator
    : 'kimi_subscription';
}

function recentSourceContext() {
  return (captureSession?.segments || []).slice(-4).map(item => item.source).filter(Boolean).join(' ').slice(-1600);
}

async function translateNativeCaption(msg, translator, offline = false) {
  const response = await fetch(translationHttpUrl(activeSettings), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(130000),
    body: JSON.stringify({
      text: msg.source,
      sourceLang: msg.sourceLang || activeSettings.sourceLang || 'auto',
      targetLang: activeSettings.targetLang || 'zh',
      domain: activeSettings.domain || 'auto',
      translator,
      context: recentSourceContext(),
      offline
    })
  });
  if (!response.ok) throw new Error(`Translation service returned HTTP ${response.status}`);
  const result = await response.json();
  if (!String(result.text || '').trim()) throw new Error('Translation service returned an empty final result');
  return result.text;
}

async function processNativeCaption(msg, sessionId) {
  const stillCurrent = () => isCapturing && captureMode === 'native-captions' && captureSession?.id === sessionId;
  if (!stillCurrent() || !msg.source) return;
  await persistFinalSegment({ raw: msg.source, text: '', stage: 'source-final', recordId: msg.recordId, mediaTime: msg.mediaTime });
  const mode = normalizedTranslationMode();
  const finalProvider = mode === 'offline' ? 'nllb' : professionalTranslator();
  if (mode === 'quick') {
    try {
      const preview = await translateNativeCaption(msg, 'nllb', true);
      if (stillCurrent() && activeTabId != null) {
        await deliverOverlay({
          type: 'overlay:text', text: preview, raw: msg.source, isFinal: false,
          stage: 'quick-preview', provider: 'nllb'
        });
      }
    } catch (error) {
      console.info('[quant-scholar] local preview skipped:', error);
    }
  }

  if (!stillCurrent()) return;
  let text;
  try {
    text = await translateNativeCaption(msg, finalProvider, mode === 'offline');
  } catch (error) {
    console.warn('[quant-scholar] final caption translation unavailable:', error);
    if (stillCurrent() && activeTabId != null) {
      captureError = '专业翻译暂不可用，未写入知识库。请检查所选引擎的登录状态。';
      await deliverOverlay({
        type: 'overlay:error',
        message: mode === 'offline' ? '本地 NLLB 暂不可用' : '专业翻译暂不可用，未写入知识库'
      });
    }
    return;
  }
  if (!stillCurrent()) return;
  const transcript = {
    recordId: msg.recordId,
    text,
    raw: msg.source,
    detectedLang: msg.sourceLang || 'auto',
    mediaTime: msg.mediaTime,
    provider: finalProvider,
    stage: mode === 'offline' ? 'offline-final' : 'professional-final',
    isFinal: true
  };
  if (activeTabId != null) {
    await deliverOverlay({
      type: 'overlay:text', text, raw: msg.source, isFinal: true,
      stage: transcript.stage, provider: finalProvider
    });
  }
  if (stillCurrent()) {
    captureError = '';
    await persistFinalSegment(transcript);
  }
}

function clearNativePending() {
  if (nativeCommitTimer) clearTimeout(nativeCommitTimer);
  nativeCommitTimer = null;
  nativePending = null;
}

function flushNativePending() {
  if (!nativePending) return;
  const pending = nativePending;
  clearNativePending();
  captionQueue = captionQueue.catch(() => undefined).then(() => processNativeCaption(pending, pending.sessionId));
}

async function bufferNativeCaption(msg) {
  if (!isCapturing || captureMode !== 'native-captions' || !captureSession || !msg.source) return;
  const now = Date.now();
  if (!nativePending) nativePending = { ...msg, source: '', startedAt: now, sessionId: captureSession.id, recordId: `${captureSession.id}:native:${++captureSequence}` };
  nativePending.source = mergeCaptionSource(nativePending.source, msg.source);
  const pending = nativePending;
  const display = deliverOverlay({
    type: 'overlay:text', text: '', raw: nativePending.source, isFinal: false,
    stage: 'source', provider: professionalTranslator()
  });
  if (shouldCommitCaption(pending.source, now - pending.startedAt)) {
    flushNativePending();
  } else {
    if (nativeCommitTimer) clearTimeout(nativeCommitTimer);
    nativeCommitTimer = setTimeout(flushNativePending, 2200);
  }
  await display;
}

async function initializeSession(tabId, settings) {
  clearNativePending();
  lastOverlay = null;
  sourceMediaTimes.clear();
  const tab = await chrome.tabs.get(tabId);
  activeTabId = tabId;
  activeSettings = settings;
  if (captureSession?.segments?.length) await chrome.storage.local.set({ [`learningArchive:${captureSession.id}`]: captureSession });
  captureSession = {
    schemaVersion: 1,
    id: `session-${Date.now()}-${++captureSequence}`,
    title: tab.title || 'Web video',
    url: tab.url || '',
    startedAt: isoNow(),
    updatedAt: isoNow(),
    sourceLanguage: settings.sourceLang || 'auto',
    targetLanguage: settings.targetLang || 'zh',
    domain: settings.domain || 'auto',
    translationMode: normalizedTranslationMode(settings),
    professionalTranslator: professionalTranslator(settings),
    videoLibrary: settings.videoLibrary !== false,
    captureMode: 'detecting',
    segments: []
  };
  await chrome.storage.local.set({ currentLearningSession: captureSession });
}

async function startCapture(tabId, settings) {
  const previousSession = captureSession;
  // Best-effort: try to spawn the backend before we start capturing. If the
  // native host isn't installed, fall through — user may have launched it
  // manually, in which case the WS connect still works.
  // Make sure the overlay is mounted before we start sending transcripts.
  try {
    await ensureContentScript(tabId);
  } catch (e) {
    throw new Error('无法在此页显示字幕，请刷新普通视频网页后重试');
  }

  await initializeSession(tabId, settings);
  try {
    const mounted = await chrome.tabs.sendMessage(tabId, { type: 'overlay:mount', settings }, { frameId: 0 });
    if (!mounted?.ok) throw new Error('字幕框未响应');
  } catch (_error) { throw new Error('无法挂载字幕框，请刷新视频网页后重试'); }

  const endpoint = new URL(translationHttpUrl(settings));
  const probeHealth = async () => {
    const response = await fetch(`${endpoint.origin}/`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) throw new Error('服务未就绪');
  };
  try { await probeHealth(); }
  catch (_error) {
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname);
    if (!local || !await ensureBackend(settings)) throw new Error('无法连接本地识别服务，请确认服务地址并启动服务后重试');
    await probeHealth();
  }
  backendState = 'up';
  captureDiagnostics = { startedAt: Date.now(), chunksSent: 0, lastAudioAt: 0, lastTranscriptAt: 0 };

  if (globalThis.QSFullVideo && settings.sourceStrategy !== 'live') {
    let prepared;
    try {
      prepared = await globalThis.QSFullVideo.discover(tabId, settings, endpoint.origin, chrome, fetch, previousSession);
    } catch (error) {
      if (settings.sourceStrategy && settings.sourceStrategy !== 'auto') throw error;
      captureDiagnostics.fallbackReason = error.message;
    }
    if (prepared) {
      captureMode = prepared.kind;
      captureSession.captureMode = captureMode;
      captureSession.title = prepared.title || captureSession.title;
      captureSession.sourceLanguage = prepared.language || settings.sourceLang || 'auto';
      captureSession.segments = prepared.reuse
        ? prepared.reuse.map(s => ({ ...s, attempts: s.translation ? s.attempts : 0 }))
        : globalThis.QSFullVideo.toSegments(prepared.cues, captureSession.id);
      captureSession.full = { tabId, frameId: prepared.frameId, identity: prepared.identity, signature: prepared.signature,
        duration: prepared.duration, status: prepared.jobId ? 'recognizing' : 'translating', jobId: prepared.jobId || null, progress: 0 };
      // Retain an in-flight batch when resuming the same source and settings.
      const reusedSession = prepared.saved || previousSession;
      if (prepared.reuse && reusedSession?.full?.pending) captureSession.full.pending = { ...reusedSession.full.pending, startedAt: Date.now() };
      isCapturing = true; wsState = 'connected';
      await chrome.storage.local.set({ isCapturing: true, activeTabId: tabId, currentLearningSession: captureSession });
      await getFullController().start(captureSession);
      return;
    }
  }

  // Any player exposing HTML5 TextTracks or a readable caption surface gets
  // the more accurate source-caption path. Every other site falls back to
  // capturing the tab audio, so site-specific support is never required.
  if (settings.preferNativeCaptions !== false && settings.sourceStrategy !== 'live') {
    try {
      isCapturing = true;
      captureMode = 'native-captions';
      const probe = await chrome.tabs.sendMessage(tabId, { type: 'captions:start', settings });
      if (probe?.ok) {
        captureSession.captureMode = 'native-captions';
        captureSession.captionProvider = probe.provider;
        wsState = 'connected';
        await chrome.storage.local.set({ isCapturing: true, activeTabId: tabId, currentLearningSession: captureSession });
        return;
      }
      isCapturing = false;
      captureMode = 'idle';
    } catch (_error) { /* no readable caption surface */ }
  }

  // A failed probe may have installed observers before failing; stop them
  // so native captions cannot run concurrently with the audio fallback.
  await chrome.tabs.sendMessage(tabId, { type: 'captions:stop' }).catch(() => {});
  await ensureOffscreen();

  const streamId = await new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!id) return reject(new Error('未获得标签页音频权限'));
      resolve(id);
    });
  });

  captureMode = 'audio-asr';
  wsState = 'connecting';
  const audioStart = await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'start',
    streamId,
    sessionId: captureSession.id,
    settings
  });
  if (!audioStart?.ok) throw new Error(audioStart?.error || '音频采集未启动，请刷新网页后重试');

  captureMode = 'audio-asr';
  captureSession.captureMode = captureMode;
  isCapturing = true;
  await chrome.storage.local.set({ isCapturing: true, activeTabId: tabId });

  await chrome.storage.local.set({ currentLearningSession: captureSession });
}

async function stopCapture() {
  captureStopping = true;
  if (captureSession?.full) await getFullController()?.stop();
  if (activeTabId != null) await chrome.tabs.sendMessage(activeTabId, { type: 'captions:stop' }).catch(() => {});
  flushNativePending();
  await captionQueue.catch(() => {});
  lastOverlay = null;
  clearNativePending();
  try {
    if (await hasOffscreenDocument()) {
      const result = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' });
      if (result?.warning) captureError = result.warning;
    }
  } catch (error) {
    // A disconnected offscreen channel must not strand state as "capturing".
    // Closing our own document releases its media tracks even if Stop failed.
    await chrome.offscreen.closeDocument().catch(() => {});
    captureError = '音频通道已断开，末尾内容可能未处理完整，请检查学习记录。';
  }
  await transcriptQueue.catch(() => {});
  sourceMediaTimes.clear();
  if (activeTabId != null) {
    try {
      await chrome.tabs.sendMessage(activeTabId, { type: 'captions:stop' });
      await chrome.tabs.sendMessage(activeTabId, { type: 'overlay:unmount' });
    } catch (e) { /* tab may be gone */ }
  }
  // Tear down the backend too — Stop should fully clean up, not leave the
  // Python process running silently. If the user prefers always-on, they can
  // launch the Quant Scholar service manually and attach on the next Start.
  stopBackend();
  isCapturing = false;
  captureMode = 'idle';
  activeSettings = {};
  wsState = 'idle';
  captureDiagnostics = {};
  activeTabId = null;
  captureStopping = false;
  await chrome.storage.local.set({ isCapturing: false, activeTabId: null });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Leave messages owned by research/learning modules to their own listeners.
  if (!['library:restore', 'library:save', 'full:show', 'full:preparation', 'full:clock', 'full:seek', 'knowledge:retry', 'overlay:resume', 'menu:context', 'page:command', 'capture:settings', 'capture:start', 'capture:stop', 'capture:status', 'capture:audio', 'ws:state', 'transcript', 'caption:segment', 'knowledge:export', 'knowledge:clear', 'backend:error'].includes(msg?.type)) return false;
  (async () => {
    try {
      await stateReady;
      if (msg.target && msg.target !== 'background') return;

      switch (msg.type) {
        case 'library:restore': {
          sendResponse({ ok: true, ...await restoreSavedVideo(sender.tab?.id ?? msg.tabId, Boolean(msg.force)) });
          break;
        }
        case 'library:save': {
          if (!captureSession?.full || (sender.tab?.id ?? msg.tabId) !== captureSession.full.tabId) throw new Error('请回到视频所属页面保存文档');
          captureSession.videoLibrary = true;
          await checkpointVideoSession(captureSession);
          if (captureSession.full.libraryError) throw new Error(captureSession.full.libraryError);
          sendResponse({ ok: true, path: captureSession.full.libraryDocument }); break;
        }
        case 'full:preparation': {
          const tabId = sender.tab?.id ?? msg.tabId;
          if (!isCapturing || captureStarting || captureStopping || !captureSession?.full || tabId !== activeTabId) throw new Error('请回到提前翻译所属视频页面操作');
          await getFullController().togglePreparation({ translator: msg.settings?.translator });
          sendResponse({ ok: true }); break;
        }
        case 'full:show': {
          const tabId = sender.tab?.id ?? msg.tabId;
          if (!captureSession?.full || tabId !== captureSession.full.tabId || captureStarting || captureStopping) throw new Error('请回到原视频页面启用字幕');
          if (!captureSession.segments.some(s => String(s.translation || '').trim())) throw new Error('尚无可用译文：原文已提取，请先完成首批专业翻译');
          if (isCapturing && activeTabId !== tabId) throw new Error('另一网页正在翻译，请先停止');
          const wasActive = isCapturing;
          await ensureContentScript(tabId);
          const settings = { ...activeSettings, subtitleDisplay: activeSettings.subtitleDisplay === 'sidebar' ? 'bilingual' : activeSettings.subtitleDisplay || 'bilingual' };
          await chrome.tabs.sendMessage(tabId, { type: 'overlay:mount', settings }, { frameId: 0 });
          activeTabId = tabId; isCapturing = true; captureMode = captureSession.captureMode;
          try { await getFullController().start(captureSession, { prepare: false }); }
          catch (error) { isCapturing = wasActive; if (!wasActive) activeTabId = null; throw error; }
          await chrome.storage.local.set({ isCapturing, activeTabId, currentLearningSession: captureSession });
          sendResponse({ ok: true }); break;
        }
        case 'full:clock': {
          await getFullController()?.clock(msg, sender);
          sendResponse({ ok: true }); break;
        }
        case 'full:seek': {
          if (!captureSession?.full || !isCapturing || sender.tab?.id !== activeTabId || !Number.isFinite(msg.seconds)) { sendResponse({ ok: false }); break; }
          await chrome.scripting.executeScript({ target: { tabId: activeTabId, frameIds: [captureSession.full.frameId] }, args: [msg.seconds], func: seconds => {
            const media = [...document.querySelectorAll('video,audio')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
            if (media) media.currentTime = Math.max(0, seconds);
          } });
          sendResponse({ ok: true }); break;
        }
        case 'knowledge:retry': {
          if (isCapturing || captureStarting || captureStopping) throw new Error('请先停止实时采集并等待收尾，再补译未完成内容');
          const session = captureSession;
          if (!session || session.id !== msg.sessionId) throw new Error('学习记录已改变，请重新打开右栏');
          const item = session.segments.find(s => s.id === msg.segmentId);
          if (!item || item.translation) { sendResponse({ ok: true }); break; }
          const { settings = {} } = await chrome.storage.local.get('settings');
          const endpoint = new URL(translationHttpUrl(settings));
          try {
            const health = await fetch(`${endpoint.origin}/`, { signal: AbortSignal.timeout(2000) });
            if (!health.ok) throw new Error('服务未就绪');
          } catch (error) {
            if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) || !await ensureBackend(settings)) throw new Error('请启动本地翻译服务后补译');
          }
          const response = await fetch(translationHttpUrl(settings), { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(130000),
            body: JSON.stringify({ text: item.source, sourceLang: item.sourceLanguage || session.sourceLanguage,
              targetLang: session.targetLanguage, domain: session.domain,
              translator: session.translationMode === 'offline' ? 'nllb'
                : session.professionalTranslator === 'codex_subscription' ? 'codex' : session.professionalTranslator,
              offline: session.translationMode === 'offline',
              context: session.segments.slice(Math.max(0, session.segments.indexOf(item) - 3), session.segments.indexOf(item)).map(s => s.source).join(' ').slice(-1600) }) });
          if (!response.ok) throw new Error(`补译失败 HTTP ${response.status}，请确认本地服务正在运行`);
          const result = await response.json();
          if (!String(result.text || '').trim()) throw new Error('返回空译文，原文已保留，请重试');
          if (captureSession !== session || isCapturing) throw new Error('采集任务已改变，此次补译未覆盖新记录');
          item.translation = String(result.text).trim(); item.stage = session.translationMode === 'offline' ? 'offline-final' : 'professional-final';
          await chrome.storage.local.set({ currentLearningSession: session });
          sendResponse({ ok: true });
          break;
        }
        case 'overlay:resume': {
          const active = isCapturing && sender.tab?.id === activeTabId;
          if (active && captureSession?.full) await getFullController()?.start(captureSession);
          const saved = captureSession?.segments?.at(-1);
          sendResponse({ active, ...(active ? { settings: activeSettings, lastOverlay: lastOverlay || (saved ? {
            text: saved.translation, raw: saved.source, stage: saved.stage, provider: saved.provider
          } : null) } : {}) });
          break;
        }
        case 'menu:context': {
          const tab = sender.tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
          sendResponse({ ok: Boolean(tab?.id), tab });
          break;
        }
        case 'page:command': {
          sendResponse(await sendResearchCommand(sender.tab?.id ?? msg.tabId, msg.command));
          break;
        }
        case 'capture:start': {
          if (captureStarting || isCapturing) throw new Error('已有实时翻译正在启动或运行，请先停止');
          captureStarting = true;
          captureError = '';
          try {
            const tab = sender.tab || (msg.tabId ? await chrome.tabs.get(msg.tabId) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]);
            if (!tab?.id) throw new Error('找不到视频网页，请重新打开菜单');
            await startCapture(tab.id, msg.settings || {});
          } catch (error) {
            await stopCapture().catch(() => {});
            const raw = error?.message || String(error);
            captureError = /not been invoked|activeTab|not allowed|permission|标签页音频权限/i.test(raw)
              ? 'Chrome 尚未授权此页音频：请先点击浏览器工具栏或扩展菜单中的 Quant Scholar 图标，再点击“开始实时翻译”。'
              : raw;
            throw new Error(captureError);
          } finally { captureStarting = false; }
          sendResponse({ ok: true });
          break;
        }
        case 'capture:stop': {
          if (captureStarting || captureStopping) throw new Error('正在启动或收尾，请稍候');
          await stopCapture();
          sendResponse({ ok: true });
          break;
        }
        case 'capture:status': {
          sendResponse({ isCapturing, captureStarting, captureStopping, full: captureSession?.full ? { ...captureSession.full, ...globalThis.QSFullVideo.preparationStatus(captureSession) } : null, captureError: captureError || captureDiagnostics.overlayError || captureDiagnostics.storageError || '', captureDiagnostics, activeTabId, captureMode, wsState, backendState, backendInfo });
          break;
        }
        case 'capture:settings': {
          const tabId = sender.tab?.id ?? msg.tabId;
          if (captureSession?.full && tabId === captureSession.full.tabId && typeof msg.settings?.videoLibrary === 'boolean') {
            captureSession.videoLibrary = msg.settings.videoLibrary;
            await chrome.storage.local.set({ currentLearningSession: captureSession });
          }
          if (isCapturing && tabId === activeTabId) {
            const settings = { fontSize: Math.min(64, Math.max(14, Number(msg.settings?.fontSize) || 28)), position: msg.settings?.position === 'top' ? 'top' : 'bottom' };
            settings.subtitleDisplay = ['translation', 'bilingual', 'sidebar'].includes(msg.settings?.subtitleDisplay)
              ? msg.settings.subtitleDisplay : (activeSettings.subtitleDisplay || 'translation');
            activeSettings = { ...activeSettings, ...settings };
            await chrome.tabs.sendMessage(tabId, { type: 'overlay:settings', settings }, { frameId: 0 });
          }
          sendResponse({ ok: true });
          break;
        }
        case 'capture:audio': {
          // Audio metadata only, never sample data or a recording.
          if (!sender.tab && captureMode === 'audio-asr') {
            captureDiagnostics = { ...captureDiagnostics, chunksSent: Number(msg.chunksSent) || 0, lastAudioAt: Number(msg.lastAudioAt) || 0, audioState: String(msg.audioState || '') };
          }
          sendResponse({ ok: true });
          break;
        }
        case 'ws:state': {
          wsState = msg.state;
          if (msg.state === 'connecting') sourceMediaTimes.clear();
          sendResponse({ ok: true });
          break;
        }
        case 'transcript': {
          if (!isCapturing || captureMode !== 'audio-asr' || (msg.sessionId && msg.sessionId !== captureSession?.id)) {
            sendResponse({ ok: false, ignored: true });
            break;
          }
          captureDiagnostics.lastTranscriptAt = Date.now();
          captureError = '';
          const sessionId = captureSession?.id;
          transcriptQueue = transcriptQueue.catch(() => {}).then(async () => {
            if (!isCapturing || captureSession?.id !== sessionId) return;
            const timingKey = Number.isFinite(msg.chunkId) ? msg.chunkId : null;
            let mediaTime = msg.mediaTime;
            if (timingKey != null) {
              if (!msg.isFinal) {
                mediaTime = Number.isFinite(mediaTime) ? mediaTime : await currentMediaTime();
                if (!isCapturing || captureSession?.id !== sessionId) return;
                sourceMediaTimes.set(timingKey, mediaTime);
                if (sourceMediaTimes.size > 256) sourceMediaTimes.delete(sourceMediaTimes.keys().next().value);
              } else if (sourceMediaTimes.has(timingKey)) {
                mediaTime = sourceMediaTimes.get(timingKey);
                sourceMediaTimes.delete(timingKey);
              }
            }
            if (!isCapturing || captureSession?.id !== sessionId) return;
            await deliverOverlay({ type: 'overlay:text', text: msg.text, raw: msg.raw,
              isFinal: msg.isFinal, stage: msg.stage === 'source-final' ? 'source' : msg.stage, provider: msg.provider });
            if (captureSession?.id === sessionId) {
              try {
                await persistFinalSegment({ ...msg, mediaTime });
                if (msg.isFinal) captureDiagnostics.storageError = '';
              } catch (error) {
                captureDiagnostics.storageError = '字幕已显示，但学习记录保存失败，请检查扩展存储空间后导出已有记录。';
                throw error;
              }
            }
          });
          await transcriptQueue;
          sendResponse({ ok: true });
          break;
        }
        case 'caption:segment': {
          if (sender.tab?.id === activeTabId) await bufferNativeCaption(msg);
          sendResponse({ ok: true });
          break;
        }
        case 'knowledge:export': {
          const downloadId = await exportCurrentSession(msg.format || 'markdown', sender.tab?.id ?? msg.tabId, msg.source || 'auto');
          sendResponse({ ok: true, downloadId });
          break;
        }
        case 'knowledge:clear': {
          lastOverlay = null;
          if (isCapturing && captureSession) {
            captureSession.segments = [];
            captureSession.updatedAt = isoNow();
            await chrome.storage.local.set({ currentLearningSession: captureSession });
          } else {
            captureSession = null;
            await chrome.storage.local.remove('currentLearningSession');
          }
          sendResponse({ ok: true });
          break;
        }
        case 'backend:error': {
          if (!isCapturing && !captureStarting) break;
          captureError = String(msg.message || '识别或翻译服务发生错误');
          if (activeTabId != null) {
            try {
              await deliverOverlay({
                type: 'overlay:error',
                message: msg.message
              });
            } catch (e) { /* ignore */ }
          }
          break;
        }
      }
    } catch (err) {
      console.error('[kami-subs bg]', err);
      sendResponse({ ok: false, error: String(err) });
    }
  })();
  return true; // keep channel open for async sendResponse
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  archiveProbeTimes.delete(tabId);
  if (tabId === activeTabId) await stopCapture();
});
