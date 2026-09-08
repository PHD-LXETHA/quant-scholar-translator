import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mergeCaptionSource, shouldCommitCaption } from '../apps/browser-extension/caption-buffer.js';
import test from 'node:test';

const root = new URL('../apps/browser-extension/', import.meta.url);

test('extension manifest is valid MV3 and exposes capture plus knowledge export permissions', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', root), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, 'Quant Scholar Translator');
  assert.equal(manifest.version, '0.9.0');
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

test('toolbar click toggles the floating entry point, not a Chrome popup, new tab or side panel', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', root), 'utf8'));
  const coreBackground = fs.readFileSync(new URL('background.js', root), 'utf8');
  const background = fs.readFileSync(new URL('learning/background.js', root), 'utf8');
  const content = fs.readFileSync(new URL('content.js', root), 'utf8');
  assert.equal(manifest.action.default_popup, undefined);
  assert.match(coreBackground, /chrome\.action\.onClicked\.addListener/);
  assert.match(coreBackground, /floating:toggle-visibility/);
  assert.match(content, /host\.hidden = true/);
  assert.match(content, /host\.style\.display = visible \? 'block' : 'none'/);
  assert.match(content, /setControlVisible\(host\.hidden\)/);
  assert.doesNotMatch(coreBackground, /tabs\.create\(\{ url: chrome\.runtime\.getURL\('popup\/popup.html'\)/);
  assert.match(background, /setPanelBehavior\(\{ openPanelOnActionClick: false \}\)/);
  assert.doesNotMatch(background, /chrome\.action\.onClicked\.addListener/);
  assert.match(background, /path: "learning\/sidepanel\.html"/);
});

test('floating menu embeds the complete translation workspace', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', root), 'utf8'));
  const content = fs.readFileSync(new URL('content.js', root), 'utf8');
  const popup = fs.readFileSync(new URL('popup/popup.html', root), 'utf8');
  const expectedControls = [
    'toggle', 'sourceLang', 'targetLang', 'domain', 'preferNativeCaptions',
    'fontSize', 'position', 'model', 'device', 'translationMode', 'translator',
    'backendUrl', 'translatePage', 'togglePageTranslation', 'openPdfReader',
    'openResearchSettings', 'openLearningPanel', 'openLearningSettings',
    'exportMarkdown', 'exportPdf', 'exportJson', 'exportSrt', 'clearSession',
  ];
  for (const id of expectedControls) assert.match(popup, new RegExp(`id=["']${id}["']`));
  assert.match(popup, /class="checkbox-row archive-option"[\s\S]*id="videoLibrary"[\s\S]*自动保存视频文档[\s\S]*回看同一视频时自动恢复已译字幕/);
  assert.doesNotMatch(popup, /id=["']saveBilingual(?:Pdf)?["']/);
  assert.match(content, /popup\/popup\.html/);
  assert.ok(manifest.web_accessible_resources.some(entry => entry.resources.includes('popup/popup.html')));
});

test('native source captions are assembled without duplicating rolling fragments', () => {
  assert.equal(mergeCaptionSource('The estimator is', 'The estimator is unbiased'), 'The estimator is unbiased');
  assert.equal(mergeCaptionSource('The estimator is unbiased', 'is unbiased under weak dependence.'), 'The estimator is unbiased under weak dependence.');
  assert.equal(mergeCaptionSource('risk premium', 'premium'), 'risk premium');
  assert.equal(shouldCommitCaption('The estimator is unbiased.'), true);
  assert.equal(shouldCommitCaption('The estimator is', 1000), false);
  assert.equal(shouldCommitCaption('The estimator is', 6000), true);
});
