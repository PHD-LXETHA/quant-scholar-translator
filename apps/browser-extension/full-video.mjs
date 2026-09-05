// Full-source preparation never extracts keys or downloads DRM manifests.
import { normalizeSignature, lookupArchive, saveArchive, restoredSession } from './video-library.mjs';
export { lookupArchive, saveArchive, restoredSession };
export const MAX_MEDIA_BYTES = 128 * 1024 * 1024;
const MAX_TEXT_BYTES = 5 * 1024 * 1024;

// The realtime API/UI uses `codex`; structured caption jobs use
// `codex_subscription`. Normalize only at this boundary, never switch engines.
export function captionProvider(value) {
  return value === 'codex' ? 'codex_subscription' : value;
}

const normalizedSignature = normalizeSignature;

export const settingsSignature = settings => JSON.stringify(['cue-alignment-v2', settings.sourceLang || 'auto', settings.targetLang || 'zh', settings.domain || 'auto', settings.translationMode || 'professional', captionProvider(settings.translator || 'kimi_subscription')]);

export function parseCaptions(text) {
  const cues = [];
  const seconds = value => value.replace(',', '.').split(':').reduce((n, part) => n * 60 + Number(part), 0);
  for (const block of String(text).replace(/^\uFEFF/, '').replace(/\r/g, '').split(/\n[ \t]*\n/)) {
    if (/^(WEBVTT|NOTE|STYLE|REGION)(\s|$)/.test(block.trim())) continue;
    const lines = block.split('\n');
    const index = lines.findIndex(line => line.includes('-->'));
    if (index < 0) continue;
    const match = lines[index].match(/^\s*((?:\d+:)?\d{2}:\d{2}[.,]\d+)\s+-->\s+((?:\d+:)?\d{2}:\d{2}[.,]\d+)/);
    if (!match) throw new Error('字幕时间格式不受支持');
    const source = lines.slice(index + 1).join(' ').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim();
    const start = seconds(match[1]), end = seconds(match[2]);
    if (!source || end <= start) throw new Error('字幕包含空文本或无效时间范围');
    cues.push({ start, end, text: source });
  }
  if (!cues.length) throw new Error('没有读取到正文字幕（缩略图轨道不能用作字幕）');
  return cues.sort((a, b) => a.start - b.start);
}

export function toSegments(cues, sessionId) {
  // Storage/display granularity is ALWAYS the original cue, never a paragraph.
  return cues.map((cue, index) => {
    if (!String(cue.text || '').trim() || !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end <= cue.start)
      throw new Error('字幕时间或正文无效，不能静默跳过');
    return { id: `${sessionId}:full:${index}`, source: cue.text, translation: '', mediaTime: cue.start, end: cue.end,
      capturedAt: new Date().toISOString(), stage: 'source-final', timingVersion: 2 };
  }).sort((a, b) => a.mediaTime - b.mediaTime);
}

export function translationBatch(segments, index) {
  const batch = [];
  let chars = 0;
  for (const cue of segments.slice(index)) {
    if (cue.translation || (cue.attempts || 0) >= 3) break;
    const last = batch.at(-1);
    if (last && (batch.length >= 24 || chars + cue.source.length > 4000 || cue.mediaTime - last.end >= 2 || cue.end - batch[0].mediaTime > 45)) break;
    batch.push(cue); chars += cue.source.length;
    if (chars >= 500 && /[.!?。！？]["'”’)]?$/.test(cue.source)) break;
  }
  return batch;
}

export function alignedTranslations(batch, result) {
  const rows = result?.cues;
  if (!Array.isArray(rows) || rows.length !== batch.length) throw new Error('译文条数不匹配，保留原文并重试');
  const mapped = new Map();
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || mapped.has(row.id) || typeof row.text !== 'string' || !row.text.trim())
      throw new Error('译文编号重复或正文为空');
    mapped.set(row.id, row.text.trim());
  }
  if (batch.some(cue => !mapped.has(cue.id))) throw new Error('译文编号不匹配，不能回填到其他字幕');
  return batch.map(cue => mapped.get(cue.id));
}

export function preparationStatus(session) {
  const rows = session.segments || [], done = rows.filter(s => String(s.translation || '').trim()).length, total = rows.length;
  let readyUntil = 0;
  for (const row of rows) { if (!String(row.translation || '').trim()) break; readyUntil = Math.max(readyUntil, row.end); }
  const full = session.full;
  const stamp = value => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
  let message;
  if (full.status === 'recognizing') message = `正在识别完整音轨 · ${Math.round(full.progress || 0)}% · 尚未开始翻译`;
  else if (total && done === total) message = `全部翻译完成 · ${done}/${total} 条 · 点击“显示译文字幕”，再用视频播放器的 ▶ 播放`;
  else if (full.status === 'paused' || full.preparationPaused) message = `提前翻译已暂停 · 已译 ${done}/${total} 条；已有译文可继续显示`;
  else if (full.status === 'failed') message = `翻译未完成 · ${done}/${total} 条 · 原文与已有译文已保留，处理下方提示后点击“继续提前翻译”`;
  else message = `已提取原文 ${total} 条 · 译文 ${done}/${total} 条（${total ? Math.floor(done * 100 / total) : 0}%） · ${readyUntil > 0 ? `前段已就绪至 ${stamp(readyUntil)}，可边译边播；如需全程无等待，请等全部完成` : '尚无就绪译文，播放时只能显示原文'}`;
  if (full.pending && !full.preparationPaused && !['failed', 'paused', 'complete'].includes(full.status)) {
    const elapsed = Math.max(0, Math.floor((Date.now() - full.pending.startedAt) / 1000));
    const provider = session.translationMode === 'offline' ? 'NLLB' : captionProvider(session.professionalTranslator) === 'codex_subscription' ? 'Codex' : 'Kimi';
    message += ` · ${provider} 正在处理本批 ${full.pending.body.cues.length} 条，已等待 ${elapsed} 秒（无需播放视频）`;
  }
  const currentRows = Number.isFinite(full.lastTime) ? rows.filter(s => full.lastTime >= s.mediaTime && full.lastTime < s.end) : [];
  const currentReady = currentRows.length > 0 && currentRows.every(s => String(s.translation || '').trim());
  if (done > 0 && currentRows.length && !currentReady) message += ' · 当前播放片段尚未译到';
  if (full.error) message += ` · ${full.error}`;
  return { done, total, readyUntil, currentReady, percent: total ? Math.floor(done * 100 / total) : 0, message };
}

export async function checkProfessionalEngine(session, endpoint, fetcher = fetch) {
  if (session.translationMode === 'offline') return;
  const provider = captionProvider(session.professionalTranslator);
  if (!['codex_subscription', 'kimi_subscription'].includes(provider)) throw new Error(provider === 'llm'
    ? '当前任务使用 API 备用引擎；提前专业翻译仅支持套餐引擎。请在菜单选择“Codex 套餐专业翻译”或“Kimi 套餐专业翻译”，再点“继续提前翻译”'
    : '当前任务没有有效的套餐引擎；提前专业翻译请选择 Codex 或 Kimi 套餐，再点“继续提前翻译”');
  const name = provider === 'codex_subscription' ? 'Codex' : 'Kimi';
  const response = await fetcher(`${endpoint}/${name.toLowerCase()}/status`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${name} 登录状态检测失败，请重启本地服务后重试`);
  const status = await response.json();
  if (!status.available) throw new Error(`未找到 ${name} 本地工具，请先安装并登录`);
  if (!status.loggedIn) throw new Error(`${name} 未登录，原文已保留但尚未翻译。首次使用或凭据失效时请在 PowerShell 运行稳定命令 ${name.toLowerCase()} login；正常重启服务无需重登。登录后点击“继续提前翻译”`);
  if (!status.subscription) throw new Error(`${name} 未确认使用套餐登录，为避免额外 API 计费，已停止翻译`);
}

export function safeSourceUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    // Remote page metadata may not probe local services through the extension.
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[|172\.(1[6-9]|2\d|3[01])\.)/i.test(url.hostname) || !url.hostname.includes('.')) return null;
    return url.href;
  } catch { return null; }
}

// Executed in each permitted page frame. Read the active player, not a whole
// course playlist. Do not export cookies, policy keys, licenses or DRM keys.
export function inspectPlayer() {
  const media = [...document.querySelectorAll('video,audio')].sort((a, b) => {
    const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
    return (br.width * br.height) - (ar.width * ar.height);
  })[0];
  if (!media) return null;
  let player;
  try { player = Object.values(window.videojs?.getPlayers?.() || {}).find(p => p?.el?.()?.contains(media)); } catch {}
  const info = player?.mediainfo || {};
  const tracks = [];
  const addTrack = t => {
    // Brightcove returns thumbnails alongside captions. Never use metadata.
    if (!['captions', 'subtitles'].includes(String(t.kind).toLowerCase())) return;
    const candidates = [...(Array.isArray(t.sources) ? t.sources : []), { src: t.src }];
    for (const candidate of candidates.sort((a, b) => Number(b.src?.startsWith('https:')) - Number(a.src?.startsWith('https:')))) {
      if (!candidate.src) continue;
      let url;
      try {
        url = new URL(candidate.src, location.href);
        if (url.protocol === 'http:' && /(^|\.)brightcovecdn\.com$/i.test(url.hostname)) url.protocol = 'https:';
      } catch { continue; }
      if (url.protocol !== 'https:' || tracks.some(item => item.url === url.href)) continue;
      tracks.push({ language: t.srclang || t.language || 'auto', label: t.label, url: url.href });
    }
  };
  for (const track of info.text_tracks || []) addTrack(track);
  // Video.js can expose resolved caption URLs before/after mediainfo updates.
  try {
    for (const track of Array.from(player?.remoteTextTracks?.() || [])) addTrack(track);
  } catch {}
  for (const el of media.querySelectorAll('track[src]')) {
    addTrack(el);
  }
  const loaded = [...media.querySelectorAll('track[src]')].find(t => t.readyState === 2 && ['captions', 'subtitles'].includes(t.kind));
  const cues = loaded ? Array.from(loaded.track.cues || []).map(c => ({ start: c.startTime, end: c.endTime, text: c.text })) : [];
  const sources = (info.sources || []).map(s => ({ url: s.src, type: s.type, drm: Boolean(s.key_systems && Object.keys(s.key_systems).length) }));
  if (!sources.length && media.currentSrc) sources.push({ url: media.currentSrc, type: '', drm: Boolean(media.mediaKeys) });
  const r = media.getBoundingClientRect();
  return { identity: String(info.id || media.getAttribute('data-video-id') || media.currentSrc || media.src || ''),
    title: info.name || document.title, duration: media.duration, area: r.width * r.height, playing: !media.paused,
    tracks, cues, sources, encrypted: Boolean(media.mediaKeys), language: loaded?.srclang || 'auto', provider: player ? 'brightcove' : 'html5' };
}

export async function boundedFetch(url, limit, fetcher = fetch) {
  const safe = safeSourceUrl(url);
  if (!safe) throw new Error('来源不是可直接读取的 HTTPS 公网文件');
  const response = await fetcher(safe, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`资源读取失败 HTTP ${response.status}（签名可能过期，请刷新课程页）`);
  if (Number(response.headers.get('Content-Length')) > limit) throw new Error('资源超过处理大小上限');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('资源超过处理大小上限');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return new Blob(chunks, { type: response.headers.get('Content-Type') || 'application/octet-stream' });
}

export async function discover(tabId, settings, endpoint, chromeApi = chrome, fetcher = fetch, previous = null) {
  const results = await chromeApi.scripting.executeScript({ target: { tabId, allFrames: true }, world: 'MAIN', func: inspectPlayer });
  const found = results.filter(r => r.result).sort((a, b) => Number(b.result.playing) - Number(a.result.playing) || b.result.area - a.result.area);
  if (!found.length) throw new Error('没有找到可读取的播放器');
  let { result: player, frameId } = found[0];
  // CQF/Brightcove sets mediainfo asynchronously. Re-probe only the selected
  // frame, allowing captions to become available before falling back to ASR.
  if (player.provider === 'brightcove' && !player.tracks.length && !player.cues?.length) {
    for (let attempt = 0; attempt < 3; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const [probe] = await chromeApi.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, world: 'MAIN', func: inspectPlayer });
      if (!probe?.result || probe.result.identity !== player.identity) throw new Error('播放器正在切换，请加载完成后重试');
      player = probe.result;
      if (player.tracks.length || player.cues?.length) break;
    }
  }
  if (!Number.isFinite(player.duration) || player.duration <= 0) throw new Error('直播或尚未加载时长，不能确认完整来源');
  const preference = settings.sourceStrategy || 'auto';
  const details = { frameId, identity: player.identity, title: player.title, duration: player.duration };
  const signature = settingsSignature(settings);
  details.signature = signature;
  if (player.identity && previous?.full?.identity === player.identity && normalizedSignature(previous.full.signature) === signature && previous.segments?.length
      && previous.segments.every(s => s.timingVersion === 2)
      && (['auto', 'ahead'].includes(preference) || preference === previous.captureMode)) {
    return { ...details, kind: previous.captureMode, language: previous.sourceLanguage, reuse: previous.segments, cues: [] };
  }
  if (settings.videoLibrary !== false && chromeApi.tabs?.get) {
    const tab = await chromeApi.tabs.get(tabId);
    const saved = await lookupArchive({ url: tab.url, identity: player.identity, signature, duration: player.duration }, chromeApi, endpoint, fetcher);
    if (saved && (['auto', 'ahead'].includes(preference) || preference === saved.captureMode))
      return { ...details, kind: saved.captureMode, language: saved.sourceLanguage, reuse: saved.segments, saved, cues: [] };
  }
  let reason = '';
  if (preference !== 'full-audio') {
    const preferred = settings.sourceLang && settings.sourceLang !== 'auto' ? settings.sourceLang : 'en';
    const rank = track => track.language === preferred ? 2 : track.language?.split('-')[0] === preferred.split('-')[0] ? 1 : 0;
    const tracks = [...player.tracks].sort((a, b) => rank(b) - rank(a));
    for (const track of tracks) {
      try {
        const text = await (await boundedFetch(track.url, MAX_TEXT_BYTES, fetcher)).text();
        return { ...details, kind: 'full-captions', language: track.language || 'auto', cues: parseCaptions(text) };
      } catch (error) { reason = error.message; }
    }
    if (player.cues?.length) return { ...details, kind: 'full-captions', language: player.language, cues: player.cues };
    if (preference === 'full-captions') throw new Error(reason || '播放器没有暴露完整字幕文件');
  }
  if (player.encrypted || player.sources.some(s => s.drm)) throw new Error(reason || '媒体源有 DRM 标记，没有可读取字幕；不读取加密音轨');
  const source = player.sources.find(s => safeSourceUrl(s.url) && (/\.(mp3|m4a|wav|ogg|flac|mp4|webm)(?:[?#]|$)/i.test(s.url) || /^(audio\/(mpeg|mp4|wav|ogg|flac)|video\/(mp4|webm))$/i.test(s.type)));
  if (!source) throw new Error(reason || '没有独立的未加密音频/视频文件（暂不下载 HLS/DASH 分片流）');
  const media = await boundedFetch(source.url, MAX_MEDIA_BYTES, fetcher);
  const response = await fetcher(`${endpoint}/media/jobs?source_lang=${encodeURIComponent(settings.sourceLang || 'auto')}&domain=${encodeURIComponent(settings.domain || 'auto')}&offline=${settings.translationMode === 'offline'}`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: media, signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(`完整音轨识别服务返回 HTTP ${response.status}，请更新本地服务`);
  const data = await response.json();
  return { ...details, kind: 'full-audio', jobId: data.id, cues: [], language: settings.sourceLang || 'auto' };
}

export function installClock(sessionId, stop = false) {
  window.__qsFullClockCleanup?.();
  clearInterval(window.__qsFullClock);
  window.__qsFullClock = null;
  if (stop) return;
  const media = [...document.querySelectorAll('video,audio')].sort((a, b) => {
    const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect(); return br.width * br.height - ar.width * ar.height;
  })[0];
  if (!media) return;
  const initial = media.currentSrc;
  const videoId = () => media.getAttribute('data-video-id') || media.closest('[data-video-id]')?.getAttribute('data-video-id') || '';
  const initialId = videoId();
  const tick = () => {
    chrome.runtime.sendMessage({ target: 'background', type: 'full:clock', sessionId, time: media.currentTime,
      changed: !media.isConnected || media.currentSrc !== initial || videoId() !== initialId }).catch(() => { window.__qsFullClockCleanup?.(); });
  };
  const events = ['timeupdate', 'seeking', 'seeked', 'pause', 'play', 'ratechange', 'ended', 'loadedmetadata'];
  for (const event of events) media.addEventListener(event, tick);
  window.__qsFullClock = setInterval(tick, 100);
  window.__qsFullClockCleanup = () => {
    clearInterval(window.__qsFullClock);
    for (const event of events) media.removeEventListener(event, tick);
    window.__qsFullClockCleanup = null;
  };
  tick();
}

export const PREPARATION_ALARM = 'qs-full-preparation';

export function createController({ getSession, isActive, endpoint, deliver, report, chromeApi = chrome, fetcher = fetch,
  now = Date.now, schedule = setTimeout, unschedule = clearTimeout, onCheckpoint = async () => {} }) {
  let busy = false, lastLine = null, stopped = false, generation = 0, timer = null, scheduled = false;
  const save = session => chromeApi.storage.local.set({ currentLearningSession: session });
  async function checkpoint(session) {
    try { await onCheckpoint(session); } catch (error) { session.full.libraryError = error.message; await save(session); }
  }
  const current = session => !stopped && isActive() && getSession() === session;
  const runnable = session => session?.full && current(session) && !session.full.preparationPaused && !['complete', 'failed', 'paused'].includes(session.full.status);
  function queue() {
    if (timer) unschedule(timer);
    timer = null;
    if (!scheduled || !runnable(getSession())) {
      void chromeApi.alarms?.clear(PREPARATION_ALARM);
      return;
    }
    timer = schedule(() => { timer = null; void step().catch(error => report(error.message)); }, 1000);
    timer?.unref?.();
  }
  async function step() {
    const session = getSession();
    if (busy || !runnable(session)) return;
    if (session.full.nextPollAt > now()) { queue(); return; }
    busy = true;
    const run = generation;
    let batch = [];
    const valid = () => run === generation && current(session);
    try {
      if (session.full.jobId) {
        const response = await fetcher(`${endpoint()}/media/jobs/${encodeURIComponent(session.full.jobId)}`, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error('完整音轨任务已失效，请重新开始');
        const job = await response.json();
        if (!valid()) return;
        session.full.progress = job.progress;
        if (job.status === 'failed' || job.status === 'cancelled') throw new Error(job.error || '音轨识别未完成');
        if (job.status !== 'complete') { await save(session); return; }
        session.segments = toSegments(job.cues, session.id);
        if (!session.segments.length) throw new Error('完整音轨未识别到有效语音，不能标记全文完成');
        await fetcher(`${endpoint()}/media/jobs/${encodeURIComponent(session.full.jobId)}`, { method: 'DELETE', signal: AbortSignal.timeout(10000) }).catch(() => {});
        if (!valid()) return;
        session.full.jobId = null; session.full.status = 'translating'; await save(session);
      }
      if (!valid()) return;
      const index = session.full.pending
        ? session.segments.findIndex(s => s.id === session.full.pending.body.cues[0]?.id)
        : session.segments.findIndex(s => !s.translation && (s.attempts || 0) < 3);
      if (index < 0) {
        session.full.status = session.segments.length && session.segments.every(s => s.translation) ? 'complete' : 'failed';
        await save(session); return;
      }
      const offline = session.translationMode === 'offline';
      if (!offline && (!session.full.engineCheckedAt || now() - session.full.engineCheckedAt > 600000)) {
        await checkProfessionalEngine(session, endpoint(), fetcher);
        if (!valid() || session.full.preparationPaused) return;
        session.full.engineCheckedAt = now();
      }
      if (!session.full.pending) {
        batch = offline ? [session.segments[index]] : translationBatch(session.segments, index);
        for (const item of batch) item.attempts = (item.attempts || 0) + 1;
        const before = session.segments.slice(Math.max(0, index - 5), index).map(s => s.source).join(' ').slice(-1800);
        const after = session.segments.slice(index + batch.length, index + batch.length + 5).map(s => s.source).join(' ').slice(0, 1800);
        session.full.pending = { startedAt: now(), body: {
          requestId: crypto.randomUUID(), cues: batch.map(s => ({ id: s.id, text: s.source })),
          sourceLang: session.sourceLanguage, targetLang: session.targetLanguage, domain: session.domain,
          translator: offline ? 'nllb' : captionProvider(session.professionalTranslator),
          context: `Previous original context: ${before}\nFollowing original context: ${after}` } };
        // Persist the idempotency key BEFORE dispatch: worker restarts reuse it.
        await save(session);
      }
      if (!valid() || session.full.preparationPaused) return;
      const pending = session.full.pending;
      batch = pending.body.cues.map(cue => session.segments.find(s => s.id === cue.id));
      if (batch.some(s => !s)) throw new Error('待处理字幕与当前视频不一致，请重新提取');
      if (now() - pending.startedAt > 600000) throw new Error('本批等待超过 10 分钟，已暂停派发；请检查本地服务，未自动重复调用模型');
      // Repeating this short request queries the same job, never launches a second CLI call.
      const response = await fetcher(`${endpoint()}/translate/cues/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000), body: JSON.stringify(pending.body) });
      if (!valid()) return;
      if (!response.ok) {
        if ([404, 405].includes(response.status)) throw new Error('本地服务版本过旧，请重启更新后的本地服务，再继续提前翻译');
        if (response.status === 429) { session.full.error = '其他翻译任务仍在运行，正在等待空闲'; return; }
        throw new Error(`翻译任务服务返回 HTTP ${response.status}，已保留断点`);
      }
      const data = await response.json();
      if (!valid()) return;
      if (data.status === 'running') { session.full.error = ''; return; }
      if (data.status === 'failed') {
        session.full.pending = null;
        throw new Error(data.error || '本批专业翻译失败，请检查所选引擎');
      }
      if (data.status !== 'complete') throw new Error('本地服务返回未知任务状态，请更新并重启服务');
      let texts;
      try { texts = alignedTranslations(batch, data); }
      catch (error) { session.full.pending = null; session.full.error = error.message; report(error.message); return; }
      batch.forEach((item, i) => { item.translation = texts[i]; item.stage = offline ? 'offline-final' : 'professional-final'; item.error = ''; });
      session.full.pending = null;
      if (session.segments.every(s => s.translation)) session.full.status = 'complete';
      session.full.error = ''; await save(session); report('');
      await checkpoint(session);
    } catch (error) {
      if (valid()) {
        const message = ['TypeError', 'TimeoutError', 'AbortError'].includes(error.name)
          ? '本地服务连接失败或响应超时，已保留断点；请启动服务后停止并重新开始' : error.message;
        for (const item of batch.filter(Boolean)) item.error = message;
        session.full.error = message;
        session.full.status = 'failed';
        await save(session); report(message);
      }
    } finally {
      busy = false;
      if (valid()) { session.full.nextPollAt = now() + 1000; await save(session); }
      queue();
    }
  }
  return {
    async resume() {
      if (!runnable(getSession())) return;
      scheduled = true;
      await chromeApi.alarms?.create(PREPARATION_ALARM, { periodInMinutes: 1 });
      void step().catch(error => report(error.message));
    },
    async togglePreparation({ translator } = {}) {
      const session = getSession();
      if (!session?.full || session.full.status === 'complete') return;
      const resume = session.full.preparationPaused || ['failed', 'paused'].includes(session.full.status);
      if (resume) {
        // Only an explicit Continue applies the menu's engine selection. Never
        // change the payload/provider of an already dispatched idempotent job.
        const provider = captionProvider(translator ?? session.professionalTranslator);
        try {
          if (busy) throw new Error('当前批次仍在返回结果，请稍后再点“继续提前翻译”');
          if (session.full.pending && provider !== captionProvider(session.full.pending.body.translator))
            throw new Error('还有已派发的翻译批次，请保持原套餐引擎完成本批后再切换；未重复调用其他模型');
          await checkProfessionalEngine({ ...session, professionalTranslator: provider }, endpoint(), fetcher);
        } catch (error) {
          session.full.error = error.message;
          await save(session); report(error.message);
          throw error;
        }
        session.professionalTranslator = provider;
        if (session.full.signature) {
          try {
            const parts = JSON.parse(session.full.signature);
            if (Array.isArray(parts) && parts.length === 6 && parts[0] === 'cue-alignment-v2') {
              parts[5] = provider; session.full.signature = JSON.stringify(parts);
            }
          } catch { /* Preserve unrecognized legacy cache metadata. */ }
        }
        session.full.engineCheckedAt = now(); session.full.error = ''; session.full.nextPollAt = 0;
        report('');
        session.full.status = session.full.jobId ? 'recognizing' : 'translating';
        if (session.full.pending) session.full.pending.startedAt = now();
      }
      session.full.preparationPaused = !resume;
      await save(session);
      if (resume) await this.resume(); else queue();
    },
    async start(session, { prepare = true } = {}) {
      if (session.segments.some(s => s.timingVersion !== 2)) throw new Error('旧字幕缓存没有逐条时间信息，请停止后重新提取');
      stopped = false; lastLine = null;
      if (prepare && session.full.status === 'paused') session.full.status = session.full.jobId ? 'recognizing' : 'translating';
      const [probe] = await chromeApi.scripting.executeScript({ target: { tabId: session.full.tabId, frameIds: [session.full.frameId] }, world: 'MAIN', func: inspectPlayer });
      if (probe?.result?.identity !== session.full.identity) throw new Error('播放器已切换，请重新开始');
      await chromeApi.scripting.executeScript({ target: { tabId: session.full.tabId, frameIds: [session.full.frameId] }, func: installClock, args: [session.id] });
      session.full.syncEnabled = true;
      await save(session);
      await checkpoint(session);
      if (prepare) await this.resume();
    },
    async clock(msg, sender) {
      const session = getSession();
      if (!session?.full || !current(session) || msg.sessionId !== session.id || sender.tab?.id !== session.full.tabId || sender.frameId !== session.full.frameId) return;
      if (msg.changed) { session.full.status = 'paused'; session.full.error = '播放器已切换，请重新开始以读取新视频'; await save(session); report(session.full.error); await this.stop(); return; }
      if (!Number.isFinite(msg.time) || msg.time < 0) return;
      session.full.lastTime = msg.time;
      // Preserve overlaps and gaps; never stretch a cue to the next cue start.
      const items = session.segments.filter(s => msg.time >= s.mediaTime && msg.time < s.end);
      const key = JSON.stringify(items.map(s => [s.id, s.translation]));
      if (key !== lastLine) {
        lastLine = key;
        const ready = items.length && items.every(s => s.translation);
        await deliver(items.length ? { type: 'overlay:text', text: ready ? items.map(s => s.translation).join('\n') : '',
          raw: items.map(s => s.source).join('\n'), stage: ready ? items[0].stage : 'source' } : { type: 'overlay:clear' });
      }
      void step().catch(error => report(error.message));
    },
    async stop() {
      stopped = true; generation++; lastLine = null;
      scheduled = false;
      if (timer) unschedule(timer);
      timer = null;
      await chromeApi.alarms?.clear(PREPARATION_ALARM);
      await deliver({ type: 'overlay:clear' });
      const session = getSession();
      if (!session?.full) return;
      if (session.full.status !== 'complete') session.full.status = 'paused';
      session.full.syncEnabled = false;
      await save(session);
      await checkpoint(session);
      await chromeApi.scripting.executeScript({ target: { tabId: session.full.tabId, frameIds: [session.full.frameId] }, func: installClock, args: [session.id, true] }).catch(() => {});
      if (session.full.jobId) await fetcher(`${endpoint()}/media/jobs/${encodeURIComponent(session.full.jobId)}`, { method: 'DELETE', signal: AbortSignal.timeout(10000) }).catch(() => {});
    },
    step,
  };
}
