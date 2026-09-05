import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { preparationStatus } from '../apps/browser-extension/full-video.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const playwright = process.env.QS_NODE_MODULES
  ? await import(pathToFileURL(path.join(process.env.QS_NODE_MODULES, 'playwright/index.mjs')))
  : await import('playwright');
const fixture = '<!doctype html><html><body style="margin:0;background:#17212b;color:#e8f1f5;font:24px system-ui"><main style="padding:60px"><h1>Technical lecture fixture</h1><p>Finance · mathematics · statistics</p><div style="height:400px;background:#071521;border-radius:20px;display:grid;place-items:center">Video area</div></main></body></html>';
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end(fixture); return; }
    const base = url.pathname.startsWith('/research/') ? path.join(root, 'apps/browser-extension/research') : url.pathname.startsWith('/learning/') ? path.join(root, 'apps/browser-extension/learning') : url.pathname.startsWith('/mobile/')
      ? path.join(root, 'quant_scholar_translator', 'mobile')
      : path.join(root, 'apps', 'browser-extension', 'popup');
    const name = path.basename(url.pathname) || 'index.html';
    const file = path.join(base, name);
    response.setHeader('Content-Type', name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : /\.m?js$/.test(name) ? 'text/javascript' : 'application/json');
    response.end(await fs.readFile(file));
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  headless: true,
  ...(process.env.QS_CHROME_PATH ? { executablePath: process.env.QS_CHROME_PATH } : {}),
});
const output = path.join(root, 'build', 'ui');
await fs.mkdir(output, { recursive: true });

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(({ origin }) => {
    const stored = { quantScholarFloatingPosition: { left: 10, top: 10 } };
    window.__qsStored = stored;
    window.__qsRequests = [];
    const runtime = {
      getURL: value => `${origin}/${value}`,
      onMessage: { addListener: listener => (window.__qsListeners ||= []).push(listener) },
      sendMessage: async message => { window.__qsRequests.push(message);
        if (message.type === 'menu:context') return { ok: true, tab: { id: 1, url: origin } };
        if (message.type === 'capture:status' && window.__qsCaptureState) return window.__qsCaptureState;
        return message.type === 'settings:get'
        ? { ok: true, settings: { backendUrl: origin, translator: 'kimi_subscription', domain: 'auto', translationMode: 'professional' } }
        : { ok: true, isCapturing: false, backendState: 'up', records: [] }; },
      openOptionsPage: async () => {},
    };
    window.chrome = window.browser = {
      runtime,
      storage: { onChanged: { addListener() {} }, local: {
        get: (keys, callback) => { const value = { ...stored }; if (callback) { queueMicrotask(() => callback(value)); return; } return Promise.resolve(value); },
        set: async value => Object.assign(stored, value),
        remove: async key => { delete stored[key]; },
      } },
      windows: { getCurrent: async () => ({ id: 1 }) },
      tabs: { onUpdated: { addListener() {} }, onActivated: { addListener() {} }, query: async () => [{ id: 1, url: origin }], sendMessage: async () => ({ ok: true }), create: async () => ({ id: 2 }) },
      sidePanel: { setOptions: async () => {}, open: async () => {} },
    };
  }, { origin });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.addStyleTag({ path: path.join(root, 'apps/browser-extension/content.css') });
  await page.addScriptTag({ path: path.join(root, 'apps/browser-extension/content.js') });
  await page.addScriptTag({ path: path.join(root, 'apps/browser-extension/content.js') });
  assert.equal(await page.locator('#quant-scholar-floating-control').count(), 1, 'Reinjection must not duplicate menus');
  const launcher = page.locator('#quant-scholar-floating-control .launcher');
  assert.equal((await launcher.textContent()).trim(), '', 'Launcher must be a pure icon');
  assert.equal(await launcher.locator('svg').count(), 1);
  await launcher.screenshot({ path: path.join(output, 'translation-icon.png'), scale: 'css' });
  const assertAnchor = async (width, height) => {
    const button = await launcher.boundingBox();
    const menuBox = await page.locator('#quant-scholar-floating-control .panel').boundingBox();
    assert.ok(Math.abs(width - button.x - button.width - 20) <= 1, 'Button must stay 20px from right edge');
    assert.ok(Math.abs(height - button.y - button.height - 20) <= 1, 'Button must stay 20px from bottom edge');
    assert.ok(Math.abs(button.y - menuBox.y - menuBox.height - 20) <= 1, 'Menu must open upward with a 20px gap');
    assert.ok(menuBox.x >= 8 && menuBox.y >= 8 && menuBox.x + menuBox.width <= width - 8, 'Menu must stay in viewport');
  };
  await page.locator('#quant-scholar-floating-control .launcher').click();
  const menu = page.frameLocator('#quant-scholar-floating-control .full-menu');
  await menu.locator('#toggle').waitFor();
  for (const id of ['prepareVideo','exportPdf','sourceStrategy','toggle','sourceLang','targetLang','domain','preferNativeCaptions','subtitleDisplay','fontSize','position','model','device','translationMode','translator','backendUrl','translatePage','togglePageTranslation','openPdfReader','openResearchSettings','openLearningPanel','openLearningSettings','knowledgeSource','exportMarkdown','exportJson','exportSrt','clearSession']) {
    assert.equal(await menu.locator(`#${id}`).count(), 1, `Missing control: ${id}`);
  }
  await assertAnchor(1280, 900);
  const menuFrame = page.frames().find(frame => frame.url().includes('popup/popup.html'));
  await menu.locator('#prepareVideo').click();
  await menuFrame.waitForFunction(() => window.__qsRequests.some(m => m.type === 'capture:start'));
  assert.equal(await menuFrame.evaluate(() => window.__qsRequests.filter(m => m.type === 'capture:start').at(-1).settings.sourceStrategy), 'ahead');
  await menuFrame.evaluate(() => { window.__qsCaptureState = { isCapturing: true, activeTabId: 1, full: { done: 24, total: 1043, status: 'translating', message: '提前翻译中 · 24/1043 条 · 前段已就绪至 1:20，可边译边播' } }; return refresh(); });
  assert.match(await menu.locator('#status').textContent(), /24\/1043/);
  assert.equal(await menu.locator('#toggle').isDisabled(), true);
  assert.equal(await menu.locator('#showTranslated').isDisabled(), false);
  assert.match(await menu.locator('#prepareVideo').textContent(), /暂停提前翻译/);
  await menu.locator('#showTranslated').click();
  assert.equal(await menuFrame.evaluate(() => window.__qsRequests.at(-1).type), 'full:show');
  await page.screenshot({ path: path.join(output, 'ahead-translation-progress.png') });
  const waiting = preparationStatus({ professionalTranslator: 'kimi_subscription', translationMode: 'professional',
    segments: [{ translation: '', end: 10 }], full: { status: 'translating', pending: { startedAt: Date.now() - 42000, body: { cues: [{ id: 'a', text: 'Risk.' }] } } } });
  await menuFrame.evaluate(status => { window.__qsCaptureState.full = { status: 'translating', ...status }; return refresh(); }, waiting);
  assert.match(await menu.locator('#status').textContent(), /Kimi.*本批 1 条.*42 秒/);
  assert.equal(await menu.locator('#showTranslated').isDisabled(), true);
  await page.screenshot({ path: path.join(output, 'ahead-translation-waiting.png') });
  await menuFrame.evaluate(() => { window.__qsCaptureState = null; return refresh(); });
  await menu.locator('#toggle').click();
  await menuFrame.waitForFunction(() => window.__qsRequests.filter(m => m.type === 'capture:start').at(-1)?.settings.sourceStrategy === 'live');
  await page.screenshot({ path: path.join(output, 'desktop-menu.png') });
  await menu.locator('#clearSession').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'desktop-menu-bottom.png') });
  assert.equal(await page.locator('#quant-scholar-floating-control .close').count(), 0, 'No separate close button');
  await launcher.click();
  assert.equal(await page.locator('#quant-scholar-floating-control .full-menu').getAttribute('src'), 'about:blank');
  await page.locator('#quant-scholar-floating-control .launcher').click();
  await assertAnchor(1280, 900);
  await page.setViewportSize({ width: 390, height: 844 });
  await assertAnchor(390, 844);
  await page.screenshot({ path: path.join(output, 'small-screen-menu.png') });
  await page.setViewportSize({ width: 844, height: 390 });
  await assertAnchor(844, 390);
  await menu.locator('#clearSession').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'short-window-menu.png') });
  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(`${origin}/mobile/index.html`);
  await mobile.screenshot({ path: path.join(output, 'mobile-workspace.png'), fullPage: true });
  const safari = await context.newPage();
  await safari.setViewportSize({ width: 390, height: 844 });
  safari.on('pageerror', error => errors.push(error.message));
  await safari.goto(origin);
  await safari.addScriptTag({ path: path.join(root, 'apps/safari-extension/content.js') });
  await safari.locator('#quant-scholar-safari-control .orb').click();
  await safari.screenshot({ path: path.join(output, 'safari-menu.png') });
  const subtitles = await context.newPage();
  subtitles.on('pageerror', error => errors.push(error.message));
  await subtitles.goto(origin);
  await subtitles.addStyleTag({ path: path.join(root, 'apps/browser-extension/content.css') });
  await subtitles.addScriptTag({ path: path.join(root, 'apps/browser-extension/content.js') });
  await subtitles.evaluate(() => {
    for (const fn of window.__qsListeners) {
      fn({ type: 'overlay:mount', settings: { fontSize: 28 } }, {}, () => {});
      fn({ type: 'overlay:text', raw: 'An unbiased estimator does not necessarily have the smallest variance.', text: '无偏估计量不一定具有最小方差。', stage: 'professional-final', provider: 'codex' }, {}, () => {});
    }
  });
  await subtitles.waitForTimeout(4500);
  assert.equal(await subtitles.locator('#kami-subs-overlay').evaluate(el => getComputedStyle(el).opacity), '1', 'Subtitles must not blink away after four seconds');
  await subtitles.screenshot({ path: path.join(output, 'live-subtitles.png') });
  assert.equal(await subtitles.locator('.kami-subs-stage').count(), 0, 'Overlay contains no provider or status label');
  assert.equal(await subtitles.locator('#kami-subs-overlay').evaluate(el => getComputedStyle(el).pointerEvents), 'none');
  await subtitles.evaluate(() => {
    for (const fn of window.__qsListeners) fn({ type: 'overlay:error', message: '测试错误不应显示在视频上' }, {}, () => {});
  });
  assert.doesNotMatch(await subtitles.locator('#kami-subs-overlay').textContent(), /测试错误|专业终稿|生成中/);
  await subtitles.evaluate(() => {
    for (const fn of window.__qsListeners) fn({ type: 'overlay:settings', settings: { subtitleDisplay: 'sidebar' } }, {}, () => {});
  });
  assert.equal(await subtitles.locator('#kami-subs-overlay').evaluate(el => getComputedStyle(el).display), 'none');
  await subtitles.evaluate(() => {
    for (const fn of window.__qsListeners) fn({ type: 'overlay:settings', settings: { subtitleDisplay: 'translation' } }, {}, () => {});
  });
  await subtitles.evaluate(() => document.getElementById('kami-subs-overlay').remove());
  await subtitles.locator('#kami-subs-overlay.kami-visible').waitFor();
  assert.match(await subtitles.locator('.kami-subs-text').textContent(), /无偏估计量/);
  await subtitles.evaluate(() => {
    for (const fn of window.__qsListeners) fn({ type: 'overlay:settings', settings: { fontSize: 32, position: 'top' } }, {}, () => {});
  });
  assert.equal(await subtitles.locator('#kami-subs-overlay').getAttribute('data-position'), 'top');
  assert.equal(await subtitles.locator('#kami-subs-overlay').evaluate(el => el.style.getPropertyValue('--kami-font-size')), '32px');
  await subtitles.evaluate(() => {
    for (const fn of window.__qsListeners) fn({ type: 'overlay:text', text: '', raw: '' }, {}, () => {});
  });
  assert.match(await subtitles.locator('.kami-subs-text').textContent(), /无偏估计量/);
  await subtitles.evaluate(() => {
    for (const fn of window.__qsListeners) fn({ type: 'overlay:unmount' }, {}, () => {});
    document.body.appendChild(document.createElement('p'));
  });
  assert.equal(await subtitles.locator('#kami-subs-overlay').count(), 0, 'Stop must disable DOM recovery');
  await subtitles.evaluate(async () => {
    const cue = document.createElement('div');
    cue.className = 'vjs-text-track-cue';
    cue.innerHTML = '<div>The estimator is unbiased.</div>';
    document.body.appendChild(cue);
    const noise = document.createElement('span');
    document.body.appendChild(noise);
    window.__qsNoiseTimer = setInterval(() => { noise.textContent = String(Date.now()); }, 20);
    for (const fn of window.__qsListeners) fn({ type: 'captions:start', settings: {} }, {}, () => {});
  });
  await subtitles.waitForFunction(() => window.__qsRequests.some(msg => msg.type === 'caption:segment' && msg.source === 'The estimator is unbiased.'), { timeout: 3000 });
  await subtitles.evaluate(() => {
    clearInterval(window.__qsNoiseTimer);
    for (const fn of window.__qsListeners) fn({ type: 'captions:stop' }, {}, () => {});
  });
  const sidepanel = await context.newPage();
  sidepanel.on('pageerror', error => errors.push(error.message));
  await sidepanel.setViewportSize({ width: 390, height: 844 });
  await sidepanel.goto(`${origin}/learning/sidepanel.html`);
  await sidepanel.waitForTimeout(300);
  assert.equal((await sidepanel.locator('.workspace-mark').textContent()).trim(), '');
  assert.equal(await sidepanel.locator('.workspace-mark svg').count(), 1);
  await sidepanel.screenshot({ path: path.join(output, 'learning-sidebar.png') });
  await sidepanel.evaluate(async ({ origin }) => {
    window.__qsStored.currentLearningSession = {
      id: 'fixture-session', title: 'Stochastic calculus', url: origin, domain: 'mathematics', captureMode: 'audio-asr',
      startedAt: '2026-09-04T00:00:00Z', targetLanguage: 'zh', segments: [
        { id: 'one', mediaTime: 301, source: 'We have a bust. So, unfortunately.', translation: '出现了衰退。因此，很遗憾。', stage: 'professional-final' },
        { id: 'two', mediaTime: 301, source: 'The cost is high.', translation: '成本很高。', stage: 'professional-final' },
        { id: 'three', mediaTime: 20, source: 'Variance is not volatility.', translation: '方差并不是波动率。', stage: 'professional-final' },
      ],
    };
    await loadUnifiedLearningSession({ url: origin });
  }, { origin });
  assert.equal(await sidepanel.locator('.transcript-entry').count(), 3);
  assert.equal(await sidepanel.locator('.transcript-save-note').count(), 3, 'Every live bilingual record can be saved as a note');
  assert.match(await sidepanel.locator('.transcript-entry').nth(0).textContent(), /出现了衰退/);
  assert.match(await sidepanel.locator('.transcript-entry').nth(1).textContent(), /成本很高/);
  assert.match(await sidepanel.locator('.transcript-entry').nth(2).textContent(), /方差并不是波动率/);
  assert.equal(await sidepanel.locator('[data-transcript-mode="bilingual"]').getAttribute('aria-pressed'), 'true');
  assert.match(await sidepanel.evaluate(() => currentTranscriptExportText()), /The cost is high\.\n成本很高/);
  await sidepanel.locator('[data-transcript-mode="original"]').click();
  assert.equal(await sidepanel.locator('.transcript-entry').count(), 3);
  await sidepanel.locator('[data-transcript-mode="zh"]').click();
  assert.doesNotMatch(await sidepanel.locator('#transcriptList').textContent(), /The cost is high/);
  await sidepanel.locator('[data-transcript-mode="bilingual"]').click();
  assert.equal(await sidepanel.evaluate(() => window.__qsRequests.filter(msg => msg.action === 'translateContent').length), 0, 'Live sidebar must never retranslate authoritative pairs');
  await sidepanel.waitForTimeout(400); // Wait for the final-row fade-in before visual QA.
  await sidepanel.screenshot({ path: path.join(output, 'learning-sidebar-bilingual.png') });
  await sidepanel.evaluate(async ({ origin }) => {
    window.__qsStored.currentLearningSession.segments.push({ id: 'pending', mediaTime: 30, source: 'Pending source.', translation: '', stage: 'source-final' });
    await loadUnifiedLearningSession({ url: origin });
    window.__qsCaptureState = { isCapturing: true, activeTabId: 1, full: { status: 'failed', error: 'Codex 未登录', message: 'Codex 未登录，原文已保留' } };
    await refreshPreparationStatus();
  }, { origin });
  assert.match(await sidepanel.locator('#videoPreparationStatus').textContent(), /Codex 未登录/);
  assert.match(await sidepanel.locator('.translation-pending').textContent(), /翻译已中断/);
  const options = await context.newPage();
  options.on('pageerror', error => errors.push(error.message));
  await options.goto(`${origin}/research/options.html`);
  await options.locator('#professional-preset').click();
  await options.waitForFunction(() => document.querySelectorAll('#glossary-body tr').length >= 330);
  const row = options.locator('#glossary-body tr').first();
  await row.locator('.term-aliases').fill('custom alias | another alias');
  await row.locator('.term-note').fill('按金融语境解释，不机械替换。');
  await options.locator('#save').click();
  await options.waitForFunction(() => window.__qsStored.glossaryTerms?.[0]?.note === '按金融语境解释，不机械替换。');
  const saved = await options.evaluate(() => window.__qsStored.glossaryTerms[0]);
  assert.deepEqual(saved.aliases, ['custom alias', 'another alias']);
  assert.ok(saved.domain, 'Saving must retain domain metadata');
  await options.screenshot({ path: path.join(output, 'professional-glossary.png') });
  const exportPage = await context.newPage();
  exportPage.on('pageerror', error => errors.push(error.message));
  await exportPage.addInitScript(() => {
    window.__qsStored['bilingual-pdf-fixture'] = { title: '随机微积分 · 双语学习记录', url: 'https://example.org/lecture', sourceLanguage: 'en', targetLanguage: 'zh', segments: Array.from({ length: 18 }, (_, i) => ({ mediaTime: i * 12, end: i * 12 + 8,
      source: 'The variance is not volatility. Under the risk-neutral measure, the discounted asset price is a martingale. dS = μS dt + σS dW.',
      translation: '方差不是波动率。在风险中性测度下，贴现后的资产价格是鞅。保留原式：dS = μS dt + σS dW。' })) };
  });
  await exportPage.goto(`${origin}/learning/bilingual-export.html?id=bilingual-pdf-fixture`);
  await exportPage.locator('#print:not([disabled])').waitFor();
  assert.equal(await exportPage.locator('article').count(), 18);
  assert.match(await exportPage.locator('article').first().textContent(), /0:00 - 0:08.*原文.*译文/s);
  assert.equal(await exportPage.evaluate(() => window.__qsStored['bilingual-pdf-fixture']), undefined, 'Preview snapshot is moved to tab storage, not accumulated in extension storage');
  await exportPage.pdf({ path: path.join(output, 'bilingual-export-check.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true });
  await exportPage.reload();
  await exportPage.locator('#print:not([disabled])').waitFor();
  assert.equal(await exportPage.locator('article').count(), 18, 'Preview remains readable after reload');
  assert.deepEqual(errors, [], 'Browser UI errors');
  console.log('UI verified: 27 controls, separate ahead/live actions and preparation progress, caption-only overlay, sidebar-only mode, note entry points, desktop/mobile layout.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
