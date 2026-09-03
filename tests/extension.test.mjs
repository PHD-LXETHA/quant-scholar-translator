import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root = new URL('../apps/browser-extension/', import.meta.url);

test('extension manifest is valid MV3 and exposes capture plus knowledge export permissions', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', root), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, 'Quant Scholar Translator');
  assert.equal(manifest.version, '0.5.0');
  for (const permission of ['tabCapture', 'offscreen', 'storage', 'downloads']) {
    assert.ok(manifest.permissions.includes(permission));
  }
  assert.equal(fs.existsSync(new URL('learning/manifest.json', root)), false);
  assert.equal(fs.existsSync(new URL('research/manifest.json', root)), false);
});

test('live transcript preserves source and translation and can export knowledge', () => {
  const background = fs.readFileSync(new URL('background.js', root), 'utf8');
  const offscreen = fs.readFileSync(new URL('offscreen.js', root), 'utf8');
  const content = fs.readFileSync(new URL('content.js', root), 'utf8');
  assert.match(offscreen, /raw: data\.raw/);
  assert.match(background, /currentLearningSession/);
  assert.match(background, /knowledge:export/);
  assert.match(background, /sessionSrt/);
  assert.match(content, /kami-subs-source/);
  assert.match(content, /textTracks/);
  assert.match(content, /caption:segment/);
  assert.match(background, /audio-asr/);
  assert.match(background, /mediaTime/);
  assert.match(background, /\/translate/);
});

test('learning workspace supports Codex and Kimi subscriptions without an external transcript API', () => {
  const settings = fs.readFileSync(new URL('learning/settings.js', root), 'utf8');
  const background = fs.readFileSync(new URL('learning/background.js', root), 'utf8');
  assert.match(settings, /https:\/\/api\.moonshot\.cn\/v1/);
  assert.match(settings, /kimi-k3/);
  assert.match(settings, /127\.0\.0\.1:8765\/codex\/v1/);
  assert.match(settings, /127\.0\.0\.1:8765\/kimi\/v1/);
  assert.match(background, /currentLearningSession/);
  assert.doesNotMatch(`${settings}\n${background}`, /x-api-key|\/v1\/transcript/i);
});
