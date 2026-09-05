import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveKey, lookupArchive, saveArchive, restoredSession } from '../apps/browser-extension/video-library.mjs';

function fixture() {
  const session = { id: 's', url: 'https://learn.cqf.com/course', title: 'Part 01', captureMode: 'full-captions',
    full: { identity: 'video-1', duration: 60, tabId: 7, frameId: 2,
      signature: JSON.stringify(['cue-alignment-v2', 'auto', 'zh', 'auto', 'professional', 'codex']),
      pending: { startedAt: 1, body: { requestId: 'keep-this-job' } } },
    segments: [{ id: 'a', source: 'Variance.', translation: '方差。', mediaTime: 1.2, end: 2.1, timingVersion: 2 }] };
  const stored = {}, requests = [];
  const api = { storage: { local: {
    get: async keys => keys === null ? structuredClone(stored) : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in stored).map(k => [k, structuredClone(stored[k])])),
    set: async obj => Object.assign(stored, structuredClone(obj)),
  } } };
  const fetcher = async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ ok: true, path: 'library/video.md', done: 1 }) }; };
  const query = { url: session.url, identity: session.full.identity, signature: session.full.signature, duration: 60 };
  return { session, stored, api, fetcher, requests, query };
}

test('per-video document checkpoint keeps browser pending ID but sends no pending job to disk', async () => {
  const f = fixture();
  await saveArchive(f.session, f.api, 'http://localhost:8765', f.fetcher);
  assert.equal(Object.keys(f.stored).length, 1);
  assert.equal(Object.values(f.stored)[0].full.pending.body.requestId, 'keep-this-job');
  assert.equal(f.requests[0].body.full.pending, undefined);
  assert.equal(f.session.full.pending.body.requestId, 'keep-this-job');
  await saveArchive(f.session, f.api, 'http://localhost:8765', f.fetcher);
  assert.equal(Object.keys(f.stored).length, 1);
});

test('reopen on a new tab restores original times without any model or server call', async () => {
  const f = fixture();
  await saveArchive(f.session, f.api, 'http://localhost:8765', f.fetcher);
  const saved = await lookupArchive(f.query, f.api, 'http://localhost:8765', async () => assert.fail('Cache read must not call a model/server'));
  const restored = restoredSession(saved, { id: 55, url: f.session.url }, 3);
  assert.equal(restored.full.tabId, 55);
  assert.equal(restored.full.frameId, 3);
  assert.equal(restored.full.preparationPaused, true);
  assert.equal(restored.full.status, 'complete');
  assert.deepEqual(restored.segments, f.session.segments);
});

test('old learning archives are migrated without deleting history or confusing playlist parts', async () => {
  const f = fixture(); f.stored['learningArchive:old'] = structuredClone(f.session);
  let network = 0;
  assert.ok(await lookupArchive(f.query, f.api, 'http://localhost', async () => { network++; return { ok: false }; }));
  assert.equal(network, 0);
  assert.ok(f.stored['learningArchive:old']);
  assert.equal(await lookupArchive({ ...f.query, identity: 'video-2' }, f.api, 'http://localhost', async () => ({ ok: false })), null);
});

test('local document recovery validates identity and duration and does not execute translation', async () => {
  const f = fixture();
  const load = async (url, options) => {
    assert.ok(url.endsWith('/library/videos/lookup'));
    assert.equal(JSON.parse(options.body).identity, 'video-1');
    return { ok: true, json: async () => ({ ok: true, session: f.session }) };
  };
  assert.ok(await lookupArchive(f.query, f.api, 'http://localhost', load));
  assert.equal(await lookupArchive({ ...f.query, duration: 100 }, f.api, 'http://localhost', load), null);
});

test('document save failure preserves the browser archive and stable alias key', async () => {
  const f = fixture();
  await assert.rejects(saveArchive(f.session, f.api, 'http://localhost', async () => ({ ok: false, status: 500 })), /字幕已缓存/);
  assert.equal(Object.values(f.stored)[0].segments[0].translation, '方差。');
  assert.equal(await archiveKey(f.query.url, f.query.identity, f.query.signature),
    await archiveKey(f.query.url, f.query.identity, f.query.signature.replace('codex', 'codex_subscription')));
});
