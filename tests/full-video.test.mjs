import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { parseCaptions, toSegments, translationBatch, alignedTranslations, preparationStatus, checkProfessionalEngine, discover, inspectPlayer, installClock, createController } from '../apps/browser-extension/full-video.mjs';

const cues = [{ start: 1.2, end: 2.13, text: 'If the variance' }, { start: 2.5, end: 4.01, text: 'is finite, use this estimator.' }, { start: 6, end: 7, text: 'Risk.' }, { start: 8, end: 9, text: 'Risk.' }];
test('original times, gaps, repeated speech and individual cues survive paragraph batching', () => {
  const rows = toSegments(cues, 's');
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map(s => [s.mediaTime, s.end]), cues.map(s => [s.start, s.end]));
  assert.equal(translationBatch(rows, 0).length, 4);
  assert.equal(rows[2].source, rows[3].source);
  assert.throws(() => toSegments([{ start: 2, end: 1, text: 'invalid' }], 's'));
});
test('Brightcove MM:SS VTT and SRT hours parse; metadata is not speech', () => {
  const parsed = parseCaptions('WEBVTT\n\nNOTE thumbnails\nignored\n\n1\n00:01.200 --> 00:02.130 align:start\nIf the variance\n\n2\n00:00:02,500 --> 00:00:04,010\nis finite, use this estimator.');
  assert.deepEqual(parsed, cues.slice(0, 2));
  assert.throws(() => parseCaptions('WEBVTT\n\nNOTE thumbnails only'));
});
test('ID alignment accepts reordered outputs but rejects omissions, duplicates and foreign IDs atomically', () => {
  const rows = toSegments(cues.slice(0, 2), 's');
  const values = rows.map((s, i) => ({ id: s.id, text: `译文${i}` }));
  assert.deepEqual(alignedTranslations(rows, { cues: values.toReversed() }), ['译文0', '译文1']);
  for (const bad of [values.slice(1), [values[0], values[0]], [values[0], { id: 'other', text: 'wrong' }], [values[0], { id: values[1].id, text: '' }]]) {
    assert.throws(() => alignedTranslations(rows, { cues: bad }));
  }
  assert.ok(rows.every(s => s.translation === ''));
});
test('readiness counts only the translated prefix, never later translated islands', () => {
  const session = { segments: toSegments(cues, 's'), full: { status: 'translating' } };
  session.segments[2].translation = '风险';
  assert.equal(preparationStatus(session).readyUntil, 0);
  session.segments[0].translation = '如果方差';
  assert.equal(preparationStatus(session).readyUntil, 2.13);
  assert.match(preparationStatus(session).message, /2\/4/);
  session.segments.forEach(s => s.translation = '已译');
  assert.match(preparationStatus(session).message, /全部翻译完成/);
});

function fixture() {
  const session = { id: 's', sourceLanguage: 'en', targetLanguage: 'zh', domain: 'statistics', translationMode: 'professional', professionalTranslator: 'codex_subscription',
    full: { tabId: 7, frameId: 2, identity: 'cqf-video-1', status: 'translating' }, segments: toSegments(cues, 's') };
  const displayed = [], requests = [];
  let reply = body => ({ status: 'complete', cues: body.cues.map(c => ({ id: c.id, text: `译：${c.text}` })) });
  let time = Date.now();
  const timers = new Map(); let nextTimer = 1;
  const api = { storage: { local: { async set() {} } }, scripting: { async executeScript() { return [{ result: { identity: 'cqf-video-1' } }]; } } };
  const options = { getSession: () => session, isActive: () => true, endpoint: () => 'http://localhost:8765',
    now: () => time += 1100, schedule: fn => { const id = nextTimer++; timers.set(id, fn); return id; }, unschedule: id => timers.delete(id),
    deliver: async m => displayed.push(m), report() {}, chromeApi: api, fetcher: async (url, options) => {
      if (url.endsWith('/status')) return { ok: true, json: async () => ({ available: true, loggedIn: true, subscription: true }) };
      const body = JSON.parse(options.body); requests.push({ url, body }); return { ok: true, json: async () => reply(body) };
    } };
  const controller = createController(options);
  const clock = time => controller.clock({ sessionId: 's', time }, { tab: { id: 7 }, frameId: 2 });
  return { session, displayed, requests, controller, clock, options, timers, setReply: fn => reply = fn };
}
test('paragraph translation uses original context and stores translations per cue', async () => {
  const f = fixture();
  await f.controller.step();
  assert.match(f.requests[0].url, /\/translate\/cues\/jobs$/);
  assert.equal(f.requests[0].body.cues.length, 4);
  assert.equal(f.requests[0].body.translator, 'codex_subscription');
  assert.equal(f.session.segments[0].translation, '译：If the variance');
  assert.equal(f.session.segments[0].end, 2.13);
  await f.controller.step();
  assert.equal(f.session.full.status, 'complete');
});
test('saved codex session resumes after provider error without losing originals or completed translations', async () => {
  const f = fixture();
  f.session.professionalTranslator = 'codex';
  f.session.full.status = 'failed';
  f.session.full.error = '提前专业翻译请选择 Codex 或 Kimi';
  f.session.segments[0].translation = '已有译文';
  const originals = f.session.segments.map(s => [s.id, s.source, s.mediaTime, s.end]);
  await f.controller.togglePreparation();
  for (let i = 0; i < 10 && !f.requests.length; i++) await new Promise(resolve => setImmediate(resolve));
  for (let i = 0; i < 10 && !f.session.segments[1].translation; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.requests[0].body.translator, 'codex_subscription');
  assert.equal(f.requests[0].body.cues.length, 3);
  assert.equal(f.session.segments[0].translation, '已有译文');
  assert.deepEqual(f.session.segments.map(s => [s.id, s.source, s.mediaTime, s.end]), originals);
  assert.equal(f.session.full.error, '');
  assert.equal(preparationStatus(f.session).done, 4);
  await f.controller.stop();
});

test('unsupported advance engines are rejected without falling back to Kimi or API', async () => {
  for (const provider of ['llm', 'nllb', 'unknown', undefined]) {
    await assert.rejects(checkProfessionalEngine({ professionalTranslator: provider }, 'http://localhost', async () => assert.fail('Must not contact another provider')), /仅支持套餐引擎|请选择 Codex 或 Kimi/);
  }
});

test('Continue cannot switch an already dispatched batch to another provider', async () => {
  const f = fixture(); f.setReply(() => ({ status: 'running' }));
  await f.controller.step();
  const body = JSON.stringify(f.session.full.pending.body);
  f.session.full.status = 'failed';
  await assert.rejects(f.controller.togglePreparation({ translator: 'kimi_subscription' }), /保持原套餐引擎/);
  assert.equal(JSON.stringify(f.session.full.pending.body), body);
  assert.equal(f.requests.length, 1);
  assert.equal(f.session.professionalTranslator, 'codex_subscription');
});

test('Continue persists the current login error instead of keeping a stale provider error', async () => {
  const f = fixture();
  f.session.professionalTranslator = 'llm';
  f.session.full.status = 'failed';
  f.session.full.error = '提前专业翻译请选择 Codex 或 Kimi';
  const controller = createController({ ...f.options, fetcher: async url => {
    assert.ok(url.endsWith('/codex/status'));
    return { ok: true, json: async () => ({ available: true, loggedIn: false }) };
  } });
  await assert.rejects(controller.togglePreparation({ translator: 'codex' }), /Codex 未登录/);
  assert.match(f.session.full.error, /Codex 未登录/);
  assert.equal(f.requests.length, 0);
  assert.equal(f.session.segments.length, 4);
});

test('Codex alias changes reuse original timed captions and translations without refetching', async () => {
  const f = fixture();
  f.session.segments[0].translation = '已有译文';
  f.session.captureMode = 'full-captions';
  const player = { identity: f.session.full.identity, duration: 50, tracks: [], sources: [], cues: [] };
  const api = { scripting: { executeScript: async () => [{ result: player, frameId: 2 }] } };
  for (const saved of ['codex', 'codex_subscription']) {
    f.session.full.signature = JSON.stringify(['cue-alignment-v2', 'auto', 'zh', 'auto', 'professional', saved]);
    for (const selected of ['codex', 'codex_subscription']) {
      const result = await discover(7, { translator: selected, sourceStrategy: 'ahead' }, 'http://localhost', api, async () => assert.fail('Cache must be reused'), f.session);
      assert.strictEqual(result.reuse, f.session.segments);
    }
  }
});

test('pause, speed changes and backwards seek follow player time; gaps clear old subtitles', async () => {
  const f = fixture(); await f.controller.step(); await f.controller.step();
  await f.clock(1.5); assert.equal(f.displayed.at(-1).raw, cues[0].text);
  const count = f.displayed.length; await f.clock(1.5); assert.equal(f.displayed.length, count);
  await f.clock(2.2); assert.equal(f.displayed.at(-1).type, 'overlay:clear');
  await f.clock(3.8); assert.equal(f.displayed.at(-1).raw, cues[1].text);
  await f.clock(1.3); assert.equal(f.displayed.at(-1).raw, cues[0].text);
  await f.clock(200); assert.equal(f.displayed.at(-1).type, 'overlay:clear');
  await f.controller.clock({ sessionId: 's', time: 1.3 }, { tab: { id: 8 }, frameId: 2 });
  assert.equal(f.displayed.at(-1).type, 'overlay:clear');
});
test('bad batches retry three times without partial or guessed alignment', async () => {
  const f = fixture(); f.setReply(() => ({ status: 'complete', cues: [] }));
  for (let i = 0; i < 4; i++) await f.controller.step();
  assert.equal(f.requests.length, 3);
  assert.equal(f.session.full.status, 'failed');
  assert.ok(f.session.segments.every(s => !s.translation && s.attempts === 3));
});
test('stopping clears display and ignores a late model response', async () => {
  const f = fixture(); let resolve;
  f.setReply(() => new Promise(r => resolve = r));
  const pending = f.controller.step();
  while (!resolve) await new Promise(r => setImmediate(r));
  await f.controller.stop();
  resolve({ cues: f.session.segments.map(s => ({ id: s.id, text: 'late' })) });
  await pending;
  assert.ok(f.session.segments.every(s => !s.translation));
  assert.equal(f.displayed.at(-1).type, 'overlay:clear');
});

test('overlapping cues remain separate and switching videos clears previous subtitles', async () => {
  const f = fixture();
  f.session.segments[1].mediaTime = 2;
  await f.controller.step(); await f.controller.step();
  await f.clock(2.05);
  assert.equal(f.displayed.at(-1).raw, `${cues[0].text}\n${cues[1].text}`);
  await f.controller.clock({ sessionId: 's', time: 2, changed: true }, { tab: { id: 7 }, frameId: 2 });
  assert.equal(f.displayed.at(-1).type, 'overlay:clear');
  assert.equal(f.session.full.status, 'paused');
});

test('CQF extractor selects current player, HTTPS English captions, not thumbnail metadata or another playlist video', () => {
  const media = { paused: false, duration: 3334.635, currentSrc: 'blob:current', mediaKeys: {},
    getBoundingClientRect: () => ({ width: 900, height: 500 }), querySelectorAll: () => [], getAttribute: () => null };
  const info = { id: '6374938814112', name: 'The Random Behaviour Of Assets Part 01', sources: [{ src: 'https://media.example/manifest.mpd', key_systems: { widevine: {} } }],
    text_tracks: [{ kind: 'metadata', src: 'https://media.example/thumb.vtt' }, { kind: 'captions', srclang: 'en', src: 'http://media.brightcovecdn.com/english.vtt?token=test', sources: [{ src: 'https://media.brightcovecdn.com/english.vtt?token=test' }] }] };
  const player = { el: () => ({ contains: m => m === media }), mediainfo: info };
  const result = vm.runInNewContext(`(${inspectPlayer.toString()})()`, { URL, document: { title: 'CQF', querySelectorAll: () => [media] }, location: { href: 'https://learn.cqf.com/course' }, window: { videojs: { getPlayers: () => ({ other: { el: () => ({ contains: () => false }), mediainfo: { id: 'other' } }, current: player }) } } });
  assert.equal(result.identity, info.id); assert.equal(result.tracks.length, 1);
  assert.equal(result.tracks[0].language, 'en'); assert.match(result.tracks[0].url, /^https:/);
  assert.equal(result.encrypted, true);
});
test('DRM video may expose clear captions: fetch only VTT; never fetch encrypted media', async () => {
  const urls = [];
  const player = { identity: 'cqf', duration: 50, area: 1, tracks: [{ language: 'fr', url: 'https://media.example/fr.vtt' }, { language: 'en', url: 'https://media.example/en.vtt' }], cues: [], encrypted: true, sources: [{ drm: true }] };
  const api = { scripting: { executeScript: async () => [{ result: player, frameId: 2 }] } };
  const result = await discover(7, { sourceStrategy: 'full-captions' }, 'http://localhost', api, async url => {
    urls.push(url); return new Response('WEBVTT\n\n00:01.000 --> 00:02.000\nRisk.');
  });
  assert.equal(result.kind, 'full-captions'); assert.deepEqual(urls, ['https://media.example/en.vtt']);
  player.tracks = [];
  await assert.rejects(discover(7, {}, 'http://localhost', api, async () => assert.fail('DRM fetch')));
});
test('clock reacts immediately to seek/rate/pause events and removes old listeners', () => {
  const events = new Map(), messages = [], timers = new Set();
  const media = { currentSrc: 'blob:x', currentTime: 1.2, isConnected: true, getAttribute: () => null, closest: () => null,
    getBoundingClientRect: () => ({ width: 1, height: 1 }), addEventListener: (e, fn) => events.set(e, fn), removeEventListener: e => events.delete(e) };
  const sandbox = { window: {}, document: { querySelectorAll: () => [media] }, chrome: { runtime: { sendMessage: async m => messages.push(m) } }, setInterval: fn => { timers.add(fn); return fn; }, clearInterval: fn => timers.delete(fn) };
  const run = stop => vm.runInNewContext(`(${installClock.toString()})('s', ${stop})`, sandbox);
  run(false); assert.equal(messages[0].time, 1.2);
  media.currentTime = 9; events.get('seeking')(); assert.equal(messages.at(-1).time, 9);
  run(false); assert.equal(timers.size, 1);
  run(true); assert.equal(events.size, 0); assert.equal(timers.size, 0);
});

test('slow model polls one persistent job without consuming retry attempts', async () => {
  const f = fixture(); f.setReply(() => ({ status: 'running' }));
  await f.controller.step();
  const id = f.session.full.pending.body.requestId;
  for (let i = 0; i < 5; i++) await f.controller.step();
  assert.equal(new Set(f.requests.map(r => r.body.requestId)).size, 1);
  assert.ok(f.session.segments.every(s => s.attempts === 1 && !s.translation));
  assert.match(preparationStatus(f.session).message, /Codex.*本批 4 条.*秒/);
  // A fresh worker recovers exactly the same request, not a second model call.
  const recovered = createController(f.options);
  await recovered.step();
  assert.equal(f.requests.at(-1).body.requestId, id);
  f.setReply(body => ({ status: 'complete', cues: body.cues.map(c => ({ id: c.id, text: '译文' })) }));
  await recovered.step();
  assert.equal(f.session.full.status, 'complete');
});

test('scheduler advances multiple batches with no playback or menu messages', async () => {
  const f = fixture();
  f.session.segments[2].mediaTime = 60; f.session.segments[2].end = 61;
  f.session.segments[3].mediaTime = 62; f.session.segments[3].end = 63;
  await f.controller.start(f.session);
  for (let i = 0; i < 20 && f.session.full.status !== 'complete'; i++) {
    await new Promise(r => setImmediate(r));
    const timer = f.timers.entries().next().value;
    if (timer) { f.timers.delete(timer[0]); timer[1](); }
  }
  assert.equal(f.session.full.status, 'complete');
  assert.equal(f.requests.length, 2);
  assert.equal(f.timers.size, 0);
});

test('network failures retain pending ID and show an actionable error, not endless waiting', async () => {
  const f = fixture();
  const broken = createController({ ...f.options, fetcher: async (url, options) => { if (url.endsWith('/status')) return f.options.fetcher(url, options); throw new TypeError('Failed to fetch'); } });
  await broken.step();
  assert.equal(f.session.full.status, 'failed');
  assert.ok(f.session.full.pending.body.requestId);
  assert.match(preparationStatus(f.session).message, /本地服务连接失败.*保留断点/);
});

test('old backend and failed model are explicit and never silently fall back to NLLB', async () => {
  const f = fixture();
  const old = createController({ ...f.options, fetcher: async (url, options) => url.endsWith('/status') ? f.options.fetcher(url, options) : ({ ok: false, status: 404 }) });
  await old.step();
  assert.match(f.session.full.error, /版本过旧.*重启/);
  const failed = fixture(); failed.setReply(() => ({ status: 'failed', error: '套餐未登录' }));
  await failed.controller.step();
  assert.equal(failed.session.full.status, 'failed');
  assert.match(failed.session.full.error, /套餐未登录/);
  assert.equal(failed.requests.length, 1);
  assert.ok(failed.session.segments.every(s => !s.translation));
});

test('last allowed attempt still polls its running job; long waits stop dispatch', async () => {
  const f = fixture(); f.session.segments.forEach(s => s.attempts = 2);
  f.setReply(() => ({ status: 'running' }));
  await f.controller.step(); await f.controller.step();
  assert.equal(f.session.full.status, 'translating');
  const count = f.requests.length;
  f.session.full.pending.startedAt = 1;
  await f.controller.step();
  assert.equal(f.requests.length, count);
  assert.equal(f.session.full.status, 'failed');
  assert.match(f.session.full.error, /10 分钟/);
});

test('not logged in retains all original cues and does not dispatch a model task', async () => {
  const f = fixture(); let modelCalls = 0;
  const controller = createController({ ...f.options, fetcher: async url => {
    if (!url.endsWith('/status')) modelCalls++;
    return { ok: true, json: async () => ({ available: true, loggedIn: false, subscription: false }) };
  } });
  await controller.step();
  assert.equal(modelCalls, 0);
  assert.equal(f.session.full.status, 'failed');
  assert.equal(preparationStatus(f.session).percent, 0);
  assert.match(preparationStatus(f.session).message, /0\/4.*Codex 未登录/);
  assert.equal(f.session.segments.length, 4);
});

test('pausing preparation does not stop translated subtitles or dispatch more batches', async () => {
  const f = fixture();
  f.session.segments[2].mediaTime = 60; f.session.segments[2].end = 61;
  await f.controller.step();
  await f.controller.togglePreparation();
  assert.equal(f.session.full.preparationPaused, true);
  await f.clock(1.5);
  assert.match(f.displayed.at(-1).text, /译：/);
  assert.equal(f.requests.length, 1);
  await f.controller.stop();
  await f.controller.start(f.session, { prepare: false });
  await f.clock(1.5);
  assert.match(f.displayed.at(-1).text, /译：/);
  assert.equal(f.requests.length, 1, 'Displaying cached subtitles must not call the model');
});

test('progress counts translated cues, not extracted source or current playback time', () => {
  const f = fixture(); f.session.segments[0].translation = '   ';
  assert.equal(preparationStatus(f.session).done, 0);
  assert.match(preparationStatus(f.session).message, /已提取原文 4 条.*译文 0\/4/);
  f.session.segments[0].translation = '如果方差'; f.session.full.lastTime = 6.5;
  const status = preparationStatus(f.session);
  assert.equal(status.done, 1); assert.equal(status.percent, 25);
  assert.equal(status.currentReady, false);
  assert.match(status.message, /当前播放片段尚未译到/);
});
