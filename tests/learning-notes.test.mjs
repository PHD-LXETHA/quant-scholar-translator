import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function harness(stored, fail = false) {
  const event = { addListener() {} };
  const context = vm.createContext({ console, URL, TextDecoder, TextEncoder, AbortController,
    setTimeout, clearTimeout, importScripts() {},
    YTD_SETTINGS: { STORAGE_KEY: 'ytd_settings', normalize: x => x },
    chrome: {
      storage: { local: { setAccessLevel: async () => {}, get: async () => structuredClone(stored),
        set: async value => { if (fail) throw Error('Quota exceeded'); Object.assign(stored, structuredClone(value)); } } },
      action: { onClicked: event }, sidePanel: { setPanelBehavior() {}, setOptions: async () => {} },
      runtime: { onInstalled: event, onMessage: event, sendMessage: async () => {}, getURL: x => x },
      tabs: { onUpdated: event, onActivated: event },
    },
  });
  vm.runInContext(fs.readFileSync('apps/browser-extension/learning/background.js', 'utf8'), context);
  return source => vm.runInContext(source, context);
}

const session = () => ({ id: 'session', url: 'https://learn.cqf.com/course', title: 'Statistics', segments: [
  { id: 'a', source: 'Variance.', translation: '方差。', mediaTime: 20 },
  { id: 'b', source: 'Tail risk.', translation: '尾部风险。', mediaTime: 30 },
] });

test('CQF-like notes save exact bilingual text, survive reopen, and do not evict old notes', async () => {
  const stored = { currentLearningSession: session(), ytd_notes: Array.from({ length: 101 }, (_, i) => ({ id: `old-${i}` })) };
  let run = harness(stored);
  const result = await run("handleSaveLearningNote('session', 'a')");
  assert.equal(result.success, true);
  assert.equal(result.note.text, 'Variance.\n方差。');
  assert.equal(stored.ytd_notes.length, 102);
  run = harness(stored); // New service-worker context, same persisted store.
  const loaded = await run("handleGetNotes('new-session', 'https://learn.cqf.com/course')");
  assert.equal(loaded.notes.length, 1);
  assert.equal(loaded.notes[0].timestampSeconds, 20);
});

test('concurrent note saves do not overwrite one another and failures are not reported as saved', async () => {
  const stored = { currentLearningSession: session() };
  const run = harness(stored);
  await Promise.all([run("handleSaveLearningNote('session', 'a')"), run("handleSaveLearningNote('session', 'b')")]);
  assert.equal(stored.ytd_notes.length, 2);
  await assert.rejects(harness(stored, true)("handleSaveLearningNote('session', 'a')"), /Quota/);
  await assert.rejects(run("handleSaveLearningNote('old-session', 'a')"), /改变/);
});
