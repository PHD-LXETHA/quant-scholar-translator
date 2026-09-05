import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { mergeCaptionSource, shouldCommitCaption } from '../apps/browser-extension/caption-buffer.js';
import * as fullVideo from '../apps/browser-extension/full-video.mjs';

function harness({ permissionError = false, audioError = false, overlayFailures = 0, storageError = false, stopError = false, nativeCaptions = false, fullSource = false } = {}) {
  let listener, audioStarts = 0, stops = 0;
  const deliveries = [];
  const translations = [];
  const statusUrls = [];
  let offscreenClosed = 0;
  let mediaTime = 20;
  let videoIdentity = 'cqf-1';
  const stored = {};
  const event = { addListener() {} };
  const chrome = {
    scripting: { executeScript: async () => [{ frameId: 0, result: { identity: videoIdentity, duration: 20, area: 400, tracks: [{ language: 'en', url: 'https://media.example/captions.vtt' }], sources: [{ drm: true }], encrypted: true } }] },
    storage: { local: { get: async () => stored, set: async value => {
      if (storageError && value.currentLearningSession?.segments?.length) throw new Error('Quota exceeded');
      Object.assign(stored, value);
    }, remove: async () => {} } },
    action: { onClicked: event },
    offscreen: { closeDocument: async () => { offscreenClosed++; } },
    tabs: { onRemoved: event, get: async id => ({ id, url: 'https://course.example/lesson', title: 'CQF-like embedded player' }), sendMessage: async (id, msg, options) => {
      if (msg.type === 'overlay:text') {
        deliveries.push({ id, msg, options });
        if (overlayFailures-- > 0) throw new Error('Receiving end does not exist');
      }
      return { ok: msg.type !== 'captions:start' || nativeCaptions, mediaTime };
    } },
    runtime: {
      onMessage: { addListener(fn) { listener = fn; } }, getURL: path => path,
      getContexts: async () => [{ contextType: 'OFFSCREEN_DOCUMENT' }],
      sendMessage: async msg => {
        if (msg.type === 'stop') { stops++; if (stopError) throw new Error('Offscreen gone'); return { ok: true }; }
        audioStarts++;
        if (audioError) return { ok: false, error: 'Audio device failed' };
        listener({ target: 'background', type: 'ws:state', state: 'connected' }, {}, () => {});
        return { ok: true };
      },
    },
    tabCapture: { getMediaStreamId({ targetTabId }, callback) {
      assert.equal(targetTabId, 7, 'Capture must use the menu owner');
      chrome.runtime.lastError = permissionError ? { message: 'Extension has not been invoked for current page (see activeTab permission)' } : undefined;
      callback(permissionError ? undefined : 'fake-stream-id');
      chrome.runtime.lastError = undefined;
    } },
  };
  const context = vm.createContext({ chrome, console: { ...console, error() {} }, URL, AbortSignal,
    ...(fullSource ? { QSFullVideo: fullVideo } : {}),
    setInterval, clearInterval, setTimeout, clearTimeout, mergeCaptionSource, shouldCommitCaption,
    fetch: async (_url, options) => {
      if (_url.endsWith('/library/videos/lookup')) return { ok: true, json: async () => ({ ok: true, session: null }) };
      if (_url.endsWith('/library/videos/save')) return { ok: true, json: async () => ({ ok: true, path: 'test-library/video.md', done: JSON.parse(options.body).segments.filter(s => s.translation).length }) };
      if (_url.endsWith('/status')) { statusUrls.push(_url); return { ok: true, json: async () => ({ available: true, loggedIn: true, subscription: true }) }; }
      if (_url.endsWith('/captions.vtt')) return new Response('WEBVTT\n\n00:01.200 --> 00:02.100\nThe variance\n\n00:02.300 --> 00:04.100\nis finite.');
      if (options?.body) translations.push(JSON.parse(options.body));
      if (_url.endsWith('/translate/cues/jobs')) return { ok: true, json: async () => ({ status: 'complete', cues: JSON.parse(options.body).cues.map(cue => ({ id: cue.id, text: '译文：' + cue.text })) }) };
      return { ok: true, json: async () => ({ text: '方差有限。' }) };
    },
  });
  vm.runInContext(fs.readFileSync(new URL('../apps/browser-extension/background.js', import.meta.url), 'utf8').replace(/^import .*caption-buffer.js';\r?\n/m, ''), context);
  const request = (message, tabId = 7) => new Promise(resolve => listener({ target: 'background', ...message }, { tab: { id: tabId }, frameId: 0 }, resolve));
  return { request, stored, deliveries, translations, statusUrls, setVideoIdentity: value => { videoIdentity = value; }, setMediaTime: value => { mediaTime = value; }, offscreenClosed: () => offscreenClosed, counts: () => ({ audioStarts, stops }) };
}

for (const translator of ['codex', 'codex_subscription', 'kimi_subscription']) test(`CQF full-source preserves selected ${translator} engine; progress and time-bound display reach UI`, async () => {
  const h = harness({ fullSource: true });
  const start = await h.request({ type: 'capture:start', settings: { sourceStrategy: 'ahead', translator, translationMode: 'professional' } });
  assert.equal(start.ok, true, start.error);
  for (let i = 0; i < 10 && !h.stored.currentLearningSession.segments[1].translation; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.counts().audioStarts, 0);
  const session = h.stored.currentLearningSession;
  assert.equal(session.captureMode, 'full-captions');
  assert.equal(session.segments.length, 2);
  assert.equal(session.segments[0].end, 2.1);
  assert.equal(h.translations[0].cues.length, 2);
  assert.equal(h.translations[0].translator, translator === 'codex' ? 'codex_subscription' : translator);
  assert.equal(h.statusUrls.length, 1);
  assert.ok(h.statusUrls[0].endsWith(translator.startsWith('codex') ? '/codex/status' : '/kimi/status'));
  await h.request({ type: 'full:clock', sessionId: session.id, time: 2.5 });
  assert.equal(h.deliveries.at(-1).msg.raw, 'is finite.');
  const status = await h.request({ type: 'capture:status' });
  assert.match(status.full.message, /全部翻译完成/);
  assert.equal(status.full.done, 2);
  await h.request({ type: 'capture:stop' });
  const calls = h.translations.length;
  const autoRestore = await h.request({ type: 'library:restore' });
  assert.equal(autoRestore.active, false, 'Explicit Stop must not be undone by the page timer');
  assert.equal((await h.request({ type: 'capture:status' })).isCapturing, false);
  const show = await h.request({ type: 'full:show' });
  assert.equal(show.ok, true, show.error);
  await h.request({ type: 'full:clock', sessionId: session.id, time: 2.5 });
  assert.match(h.deliveries.at(-1).msg.text, /译文/);
  assert.equal(h.translations.length, calls, 'Showing finished subtitles does not retranslate');
  await h.request({ type: 'capture:stop' });
});

test('Continue applies the selected Codex subscription to a failed task with a stale API engine', async () => {
  const h = harness({ fullSource: true });
  await h.request({ type: 'capture:start', settings: { sourceStrategy: 'ahead', translator: 'llm', translationMode: 'professional' } });
  for (let i = 0; i < 10 && h.stored.currentLearningSession.full.status !== 'failed'; i++) await new Promise(resolve => setImmediate(resolve));
  const session = h.stored.currentLearningSession;
  assert.equal(session.full.status, 'failed');
  assert.equal(h.translations.length, 0);
  const rows = session.segments;
  const originals = rows.map(s => [s.id, s.source, s.mediaTime, s.end]);
  await h.request({ type: 'capture:settings', settings: { translator: 'codex' } });
  assert.equal(session.professionalTranslator, 'llm', 'Style changes must not silently switch a running engine');
  const result = await h.request({ type: 'full:preparation', settings: { translator: 'codex' } });
  assert.equal(result.ok, true, result.error);
  for (let i = 0; i < 10 && !rows[1].translation; i++) await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(session.segments, rows);
  assert.deepEqual(rows.map(s => [s.id, s.source, s.mediaTime, s.end]), originals);
  assert.equal(h.translations.length, 1);
  assert.equal(h.translations[0].translator, 'codex_subscription');
  assert.ok(h.statusUrls.every(url => url.endsWith('/codex/status')));
  const status = await h.request({ type: 'capture:status' });
  assert.equal(status.full.done, 2);
  assert.equal(status.captureError, '');
  assert.equal(status.full.error, '');
  await h.request({ type: 'capture:stop' });
  rows[1].translation = '';
  const retry = await h.request({ type: 'knowledge:retry', sessionId: session.id, segmentId: rows[1].id });
  assert.equal(retry.ok, true, retry.error);
  assert.equal(h.translations.at(-1).translator, 'codex', 'Single-cue retry uses the realtime API provider ID');
});

test('returning to Part 01 on a new tab after Part 02 automatically restores saved captions without model calls', async () => {
  const h = harness({ fullSource: true });
  const settings = { sourceStrategy: 'ahead', translator: 'codex', translationMode: 'professional', videoLibrary: true };
  h.stored.settings = settings;
  for (const identity of ['cqf-1', 'cqf-2']) {
    h.setVideoIdentity(identity);
    const start = await h.request({ type: 'capture:start', settings });
    assert.equal(start.ok, true, start.error);
    for (let i = 0; i < 50 && !h.stored.currentLearningSession.segments[1].translation; i++) await new Promise(resolve => setImmediate(resolve));
    await h.request({ type: 'capture:stop' });
  }
  const calls = h.translations.length;
  assert.equal(calls, 2);
  h.setVideoIdentity('cqf-1');
  const restored = await h.request({ type: 'library:restore' }, 55);
  assert.equal(restored.restored, true, restored.error);
  const saved = h.stored.currentLearningSession;
  assert.equal(saved.full.identity, 'cqf-1');
  assert.equal(saved.full.tabId, 55);
  assert.equal(saved.full.preparationPaused, true);
  await h.request({ type: 'full:clock', sessionId: saved.id, time: 2.5 }, 55);
  assert.match(h.deliveries.at(-1).msg.text, /译文/);
  assert.equal(h.translations.length, calls);
  assert.equal(h.counts().audioStarts, 0);
  await h.request({ type: 'capture:stop' }, 55);
});

test('native subtitles use original text directly and persist one aligned final record without audio capture', async () => {
  const h = harness({ nativeCaptions: true });
  await h.request({ type: 'capture:start', settings: { translator: 'codex', translationMode: 'professional' } });
  await h.request({ type: 'caption:segment', source: 'The variance is finite.', sourceLang: 'en', mediaTime: 12 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.counts().audioStarts, 0);
  assert.equal(h.translations.length, 1);
  assert.equal(h.translations[0].translator, 'codex');
  assert.equal(h.translations[0].text, 'The variance is finite.');
  assert.equal(h.stored.currentLearningSession.segments[0].translation, '方差有限。');
  assert.equal(h.stored.currentLearningSession.segments[0].mediaTime, 12);
  await h.request({ type: 'capture:stop' });
});

test('committed source survives failed translation and late finals update the same record without dropping repeats', async () => {
  const h = harness();
  await h.request({ type: 'capture:start', settings: { translator: 'codex' } });
  for (const recordId of ['speech-1', 'speech-2']) {
    await h.request({ type: 'transcript', raw: 'Risk.', text: '', stage: 'source-final', recordId, chunkId: recordId === 'speech-1' ? 1 : 2 });
  }
  assert.equal(h.stored.currentLearningSession.segments.length, 2);
  assert.equal(h.stored.currentLearningSession.segments[0].translation, '');
  await h.request({ type: 'transcript', raw: 'Risk.', text: '风险。', stage: 'professional-final', recordId: 'speech-1', chunkId: 1, isFinal: true });
  assert.equal(h.stored.currentLearningSession.segments.length, 2);
  assert.equal(h.stored.currentLearningSession.segments[0].translation, '风险。');
  const sessionId = h.stored.currentLearningSession.id;
  await h.request({ type: 'capture:stop' });
  assert.equal((await h.request({ type: 'knowledge:retry', sessionId, segmentId: 'speech-2' })).ok, true);
  assert.equal(h.stored.currentLearningSession.segments[1].translation, '方差有限。');
  assert.equal(h.translations.at(-1).text, 'Risk.');
});

test('offscreen retains unsent audio and flushes the final partial chunk before closing', async () => {
  const frames = [];
  const context = vm.createContext({ console, Float32Array, Int16Array, setTimeout, clearTimeout, setInterval, clearInterval,
    WebSocket: { OPEN: 1 },
    chrome: { runtime: { onMessage: { addListener() {} }, sendMessage: async () => ({ ok: true }) } },
  });
  vm.runInContext(fs.readFileSync('apps/browser-extension/offscreen.js', 'utf8'), context);
  vm.runInContext('chunkBuffer = new Float32Array(CHUNK_SAMPLES + 100); sendChunkIfReady();', context);
  assert.equal(vm.runInContext('chunkBuffer.length', context), 48100);
  context.fakeSocket = { readyState: 1, send(value) {
    frames.push(value);
    if (typeof value === 'string' && JSON.parse(value).type === 'flush') vm.runInContext('finishFlush()', context);
  }, close() { frames.push('closed'); } };
  vm.runInContext('ws = fakeSocket; isRunning = true; sendChunkIfReady();', context);
  assert.equal(vm.runInContext('chunkBuffer.length', context), 100);
  assert.equal(await vm.runInContext('stop()', context), '');
  assert.equal(frames[0].byteLength, 96000);
  assert.equal(frames[1].byteLength, 200);
  assert.equal(JSON.parse(frames[2]).type, 'flush');
  assert.equal(frames[3], 'closed');
});

test('final transcript uses recognition-time position, not the later translation completion time', async () => {
  const h = harness();
  await h.request({ type: 'capture:start', settings: {} });
  await h.request({ type: 'transcript', chunkId: 4, text: '', raw: 'Variance.', stage: 'source', isFinal: false });
  h.setMediaTime(85);
  await h.request({ type: 'transcript', chunkId: 4, text: '方差。', raw: 'Variance.', stage: 'professional-final', isFinal: true });
  assert.equal(h.stored.currentLearningSession.segments[0].mediaTime, 20);
  await h.request({ type: 'capture:stop' });
});

test('offscreen preserves original language and ignores late messages from replaced sockets', async () => {
  const sockets = [], sent = [];
  class Socket {
    constructor() { this.listeners = {}; sockets.push(this); }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    send(value) { this.config = JSON.parse(value); }
  }
  const context = vm.createContext({ console, WebSocket: Socket, Float32Array, Int16Array,
    setTimeout, clearTimeout, setInterval, clearInterval,
    chrome: { runtime: { sendMessage: async message => { sent.push(message); return {}; }, onMessage: { addListener() {} } } },
  });
  vm.runInContext(fs.readFileSync(new URL('../apps/browser-extension/offscreen.js', import.meta.url), 'utf8'), context);
  vm.runInContext("isRunning = true; settings = {task:'translate', targetLang:'zh'}; captureSessionId = 'new-session'; openSocket();", context);
  sockets[0].listeners.open();
  assert.equal(sockets[0].config.task, 'transcribe');
  vm.runInContext('openSocket()', context);
  const event = { data: JSON.stringify({ type: 'transcript', text: '旧结果', raw: 'old', isFinal: true }) };
  sockets[0].listeners.message(event);
  assert.equal(sent.filter(msg => msg.type === 'transcript').length, 0);
  sockets[1].listeners.message(event);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.find(msg => msg.type === 'transcript').sessionId, 'new-session');
  vm.runInContext('isRunning = false', context);
  sockets[1].listeners.message(event);
  assert.equal(sent.filter(msg => msg.type === 'transcript').length, 1);
});

test('stop recovers from a broken offscreen channel and releases capture state', async () => {
  const h = harness({ stopError: true });
  await h.request({ type: 'capture:start', settings: {} });
  assert.equal((await h.request({ type: 'capture:stop' })).ok, true);
  assert.equal(h.offscreenClosed(), 1);
  const status = await h.request({ type: 'capture:status' });
  assert.equal(status.isCapturing, false);
  assert.equal(status.activeTabId, null);
  assert.equal(status.captureMode, 'idle');
});

test('clearing saved records while capturing preserves the live session for later final results', async () => {
  const h = harness();
  await h.request({ type: 'capture:start', settings: {} });
  const id = h.stored.currentLearningSession.id;
  await h.request({ type: 'transcript', text: '第一句', raw: 'First', isFinal: true, sessionId: id });
  await h.request({ type: 'knowledge:clear' });
  assert.equal(h.stored.currentLearningSession.segments.length, 0);
  assert.equal(h.stored.currentLearningSession.id, id);
  await h.request({ type: 'transcript', text: '第二句', raw: 'Second', isFinal: true, sessionId: id });
  assert.equal(h.stored.currentLearningSession.segments[0].source, 'Second');
  await h.request({ type: 'capture:stop' });
});

test('live style updates do not change the running translation language or provider', async () => {
  const h = harness();
  await h.request({ type: 'capture:start', settings: { translator: 'codex', targetLang: 'zh' } });
  await h.request({ type: 'capture:settings', settings: { fontSize: 32, position: 'top', translator: 'nllb', targetLang: 'en' } });
  const { settings } = await h.request({ type: 'overlay:resume' });
  assert.equal(settings.fontSize, 32);
  assert.equal(settings.position, 'top');
  assert.equal(settings.translator, 'codex');
  assert.equal(settings.targetLang, 'zh');
  await h.request({ type: 'capture:stop' });
});

test('transcript delivery retries in frame zero and restores only the capture owner', async () => {
  const h = harness({ overlayFailures: 1 });
  await h.request({ type: 'capture:start', settings: { fontSize: 34 } });
  assert.equal((await h.request({ type: 'transcript', text: '风险溢价', raw: 'Risk premium', isFinal: true })).ok, true);
  assert.equal(h.deliveries.length, 2);
  assert.ok(h.deliveries.every(d => d.id === 7 && d.options.frameId === 0));
  const resumed = await h.request({ type: 'overlay:resume' });
  assert.equal(resumed.lastOverlay.text, '风险溢价');
  assert.equal(resumed.settings.fontSize, 34);
  assert.equal((await h.request({ type: 'overlay:resume' }, 9)).active, false);
  assert.equal(h.stored.currentLearningSession.segments.length, 1);
  await h.request({ type: 'capture:stop' });
  assert.equal((await h.request({ type: 'overlay:resume' })).active, false);
});

test('persistent overlay failure is exposed without discarding final bilingual records', async () => {
  const h = harness({ overlayFailures: 10 });
  await h.request({ type: 'capture:start', settings: {} });
  await h.request({ type: 'transcript', text: '方差', raw: 'Variance', isFinal: true });
  assert.match((await h.request({ type: 'capture:status' })).captureError, /字幕框未响应/);
  assert.equal(h.stored.currentLearningSession.segments[0].translation, '方差');
  await h.request({ type: 'capture:stop' });
});

test('storage failure does not prevent visible transcript delivery', async () => {
  const h = harness({ storageError: true });
  await h.request({ type: 'capture:start', settings: {} });
  const result = await h.request({ type: 'transcript', text: '收益', raw: 'Return', isFinal: true });
  assert.equal(result.ok, false);
  assert.equal(h.deliveries[0].msg.text, '收益');
  await h.request({ type: 'capture:stop' });
});

test('late stopped sessions and preview-only results cannot enter the knowledge store', async () => {
  const h = harness();
  await h.request({ type: 'capture:start', settings: {} });
  await h.request({ type: 'transcript', text: '临时', raw: 'Risk', stage: 'quick-preview', isFinal: false });
  await h.request({ type: 'transcript', text: '', raw: 'Risk', isFinal: true });
  assert.equal(h.stored.currentLearningSession.segments.length, 0);
  const late = await h.request({ type: 'transcript', sessionId: 'old-session', text: '过期', raw: 'Stale', isFinal: true });
  assert.equal(late.ignored, true);
  await h.request({ type: 'capture:stop' });
  const stopped = await h.request({ type: 'transcript', text: '过期', raw: 'Stale', isFinal: true });
  assert.equal(stopped.ignored, true);
});

test('audio-start failure is not reported as successful capture and remains in status', async () => {
  const h = harness({ audioError: true });
  const result = await h.request({ type: 'capture:start', tabId: 99, settings: {} });
  assert.equal(result.ok, false);
  const status = await h.request({ type: 'capture:status' });
  assert.equal(status.isCapturing, false);
  assert.equal(status.captureStarting, false);
  assert.match(status.captureError, /Audio device failed/);
  assert.deepEqual(h.counts(), { audioStarts: 1, stops: 1 });
});

test('Chrome invocation failure gives a persistent toolbar-permission instruction', async () => {
  const h = harness({ permissionError: true });
  const result = await h.request({ type: 'capture:start', settings: {} });
  assert.equal(result.ok, false);
  assert.match(result.error, /浏览器工具栏或扩展菜单/);
  assert.equal((await h.request({ type: 'capture:status' })).isCapturing, false);
  assert.equal(h.counts().audioStarts, 0);
});

test('missing native subtitles falls back to audio without overwriting connected status', async () => {
  const h = harness();
  assert.equal((await h.request({ type: 'capture:start', settings: {} })).ok, true);
  const status = await h.request({ type: 'capture:status' });
  assert.equal(status.captureMode, 'audio-asr');
  assert.equal(status.isCapturing, true);
  assert.equal(status.wsState, 'connected');
  assert.equal(h.counts().audioStarts, 1);
  const duplicate = await h.request({ type: 'capture:start', settings: {} });
  assert.equal(duplicate.ok, false);
  assert.equal(h.counts().stops, 0, 'Duplicate start must not stop the existing capture');
  await h.request({ type: 'capture:stop' });
});

test('offscreen getUserMedia rejection cleans up running state', async () => {
  let listener;
  const context = vm.createContext({ console: { ...console, error() {} }, Float32Array, Int16Array,
    setTimeout, clearTimeout, setInterval, clearInterval,
    navigator: { mediaDevices: { getUserMedia: async () => { throw new Error('Permission denied'); } } },
    chrome: { runtime: { sendMessage: async () => ({}), onMessage: { addListener(fn) { listener = fn; } } } },
  });
  vm.runInContext(fs.readFileSync(new URL('../apps/browser-extension/offscreen.js', import.meta.url), 'utf8'), context);
  const result = await new Promise(resolve => listener({ target: 'offscreen', type: 'start', streamId: 'test' }, {}, resolve));
  assert.equal(result.ok, false);
  assert.equal(vm.runInContext('isRunning', context), false);
  assert.equal(vm.runInContext('mediaStream', context), null);
});
