// Real menu/content/background code; only Chrome transport and model output are mocked.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mergeCaptionSource, shouldCommitCaption } from '../apps/browser-extension/caption-buffer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extension = path.join(root, 'apps/browser-extension');
const { chromium } = await import(pathToFileURL(path.join(process.env.QS_NODE_MODULES, 'playwright/index.mjs')));
const { expect } = await import(pathToFileURL(path.join(process.env.QS_NODE_MODULES, 'playwright/test.mjs')));
const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<!doctype html><title>Research fixture</title><main><h1>Statistical inference</h1><p id="source">The estimator is unbiased.</p><pre><span>const x = 42;</span></pre></main>');
      return;
    }
    const name = path.basename(pathname);
    response.setHeader('Content-Type', name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.js') ? 'text/javascript' : 'text/css');
    response.end(await fs.readFile(path.join(extension, 'popup', name)));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.QS_CHROME_PATH });
const stored = {};
const downloads = [];
const pdfPreviews = [];
const requestedBatches = [];
const uiActions = [];
let sidePanelFailure = false;
let modelDelay = 200;
let backgroundListener, toolbarClick, page, injected = 0, batches = 0, failTranslation = false, failHealth = false, nativeStarts = 0;
const tab = { id: 7, url: origin + '/', title: 'Research fixture' };
const noopEvent = { addListener() {} };
const chrome = {
  storage: { local: {
    get: async () => ({ ...stored }),
    set: async value => Object.assign(stored, value),
    remove: async key => { delete stored[key]; },
  } },
  runtime: {
    getURL: path => `chrome-extension://fixture/${path}`,
    onMessage: { addListener: listener => { backgroundListener = listener; } },
    connectNative: () => { nativeStarts++; throw new Error('Test: native host unavailable'); },
  },
  action: { onClicked: { addListener: listener => { toolbarClick = listener; } }, setTitle: async () => {}, setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  tabs: {
    get: async id => { assert.equal(id, tab.id, 'Must target owner, not active tab'); return tab; },
    query: async () => [{ id: 99, url: 'https://wrong-tab.invalid' }],
    create: async options => { assert.match(options.url, /learning\/bilingual-export\.html\?id=/); pdfPreviews.push(options); return { id: 99 }; },
    onRemoved: noopEvent,
    sendMessage: async (id, message, options) => {
      assert.equal(id, tab.id);
      assert.equal(options.frameId, 0);
      return page.evaluate(message => new Promise((resolve, reject) => {
        let answered = false, pending = false;
        for (const listener of window.__qsListeners || []) {
          const result = listener(message, {}, value => { answered = true; resolve(value); });
          if (result === true) pending = true;
        }
        if (!answered && !pending) reject(new Error('No receiving end'));
      }), message);
    },
  },
  scripting: {
    insertCSS: async ({ files }) => { await page.addStyleTag({ path: path.join(extension, files[0]) }); },
    executeScript: async ({ files }) => { injected++; await page.addScriptTag({ path: path.join(extension, files[0]) }); },
  },
  downloads: { download: async options => { downloads.push(options); return downloads.length; } },
};
const sandbox = vm.createContext({ chrome, URL, AbortSignal, crypto, setInterval, clearInterval, setTimeout, clearTimeout,
  console: { ...console, error() {} }, mergeCaptionSource, shouldCommitCaption,
  fetch: async () => { if (failHealth) throw new Error('Service offline'); return { ok: true }; },
});
vm.runInContext((await fs.readFile(path.join(extension, 'background.js'), 'utf8')).replace(/^import .*caption-buffer.js';\r?\n/m, ''), sandbox);
assert.equal(backgroundListener({ type: 'TRANSLATE_BATCH' }, {}, () => assert.fail('Wrong listener')), false);
async function dispatch(message) {
  if (message.type === 'TRANSLATE_BATCH') {
    batches++;
    requestedBatches.push(message.texts);
    await new Promise(resolve => setTimeout(resolve, modelDelay));
    return failTranslation ? { ok: false, error: '测试：模型连接失败' }
      : { ok: true, translations: message.texts.map(text => `专业译文：${text}`) };
  }
  return new Promise((resolve, reject) => {
    const handled = backgroundListener(message, { tab }, resolve);
    if (!handled) reject(new Error('Unhandled message: ' + message.type));
  });
}
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await context.exposeBinding('__dispatch', (_source, message) => dispatch(message));
  await context.exposeBinding('__uiAction', (_source, action) => {
    uiActions.push(action);
    if (action.kind === 'panelOpen' && sidePanelFailure) throw new Error('测试：工作台无法打开');
    return { ok: true };
  });
  await context.addInitScript(({ origin }) => {
    const local = {};
    window.chrome = {
      runtime: {
        getURL: value => `${origin}/${value}`,
        onMessage: { addListener: listener => (window.__qsListeners ||= []).push(listener) },
        sendMessage: message => window.__dispatch(message),
        openOptionsPage: () => window.__uiAction({ kind: 'researchOptions' }),
      },
      storage: { local: {
        get: (keys, callback) => { if (callback) { callback({ ...local }); return; } return Promise.resolve({ ...local }); },
        set: async value => Object.assign(local, value),
      } },
      tabs: {
        query: async () => [{ id: 99, url: 'https://wrong-tab.invalid' }],
        create: options => window.__uiAction({ kind: 'createTab', ...options }),
        sendMessage: (id, message) => window.__uiAction({ kind: 'tabMessage', id, message }),
      },
      sidePanel: {
        setOptions: options => window.__uiAction({ kind: 'panelOptions', ...options }),
        open: options => window.__uiAction({ kind: 'panelOpen', ...options }),
      },
    };
  }, { origin });
  page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  async function openMenu() {
    await page.goto(origin);
    await page.addStyleTag({ path: path.join(extension, 'content.css') });
    await page.addScriptTag({ path: path.join(extension, 'content.js') });
    await page.locator('#quant-scholar-floating-control .launcher').click();
    const menu = page.frameLocator('#quant-scholar-floating-control .full-menu');
    await menu.locator('#toggle').waitFor();
    return menu;
  }
  async function click(menu, id, status, pattern, kind) {
    await menu.locator('#' + id).click();
    await expect(menu.locator('#' + status)).toHaveAttribute('data-kind', kind);
    await expect(menu.locator('#' + status)).toHaveText(pattern);
  }
  let menu = await openMenu();
  await toolbarClick(tab);
  await expect(page.locator('#quant-scholar-floating-control .panel')).toBeHidden();
  await toolbarClick(tab);
  await expect(page.locator('#quant-scholar-floating-control .panel')).toBeVisible();
  assert.equal(await page.locator('#quant-scholar-floating-control').count(), 1);
  await toolbarClick({ id: 8, url: 'chrome://extensions/' });
  await click(menu, 'togglePageTranslation', 'pageActionStatus', /尚无译文/, 'error');
  await page.waitForTimeout(1200);
  await expect(menu.locator('#pageActionStatus')).toHaveText(/尚无译文/);
  assert.equal(batches, 0, 'Toggle must not silently call model');
  stored.currentLearningSession = { url: 'https://other.invalid/', segments: [{ source: 'Wrong session' }] };
  await click(menu, 'exportMarkdown', 'knowledgeActionStatus', /没有可导出/, 'error');
  assert.equal(downloads.length, 0, 'Must not export an unrelated video');
  await click(menu, 'translatePage', 'pageActionStatus', /网页翻译完成/, 'success');
  await expect(page.locator('#source')).toHaveText('专业译文：The estimator is unbiased.');
  await expect(page.locator('pre')).toHaveText('const x = 42;');
  assert.equal(injected, 1, 'Old tab must be repaired exactly once');
  await click(menu, 'togglePageTranslation', 'pageActionStatus', /原文/, 'success');
  await expect(page.locator('#source')).toHaveText('The estimator is unbiased.');
  await click(menu, 'openPdfReader', 'pageActionStatus', /已打开 PDF/, 'success');
  const pdfAction = uiActions.find(action => action.kind === 'createTab');
  assert.equal(new URL(pdfAction.url).searchParams.get('url'), tab.url, 'PDF entry uses the menu owner');
  await click(menu, 'openResearchSettings', 'pageActionStatus', /已打开网页与 PDF/, 'success');
  await click(menu, 'openLearningSettings', 'pageActionStatus', /已打开学习工作台设置/, 'success');
  await click(menu, 'openLearningPanel', 'pageActionStatus', /学习工作台已打开/, 'success');
  assert.equal(uiActions.find(action => action.kind === 'panelOpen').tabId, 7);
  sidePanelFailure = true;
  await click(menu, 'openLearningPanel', 'pageActionStatus', /工作台无法打开/, 'error');
  sidePanelFailure = false;
  await click(menu, 'exportMarkdown', 'knowledgeActionStatus', /已提交下载/, 'success');
  const markdown = decodeURIComponent(downloads.at(-1).url.split(',').slice(1).join(','));
  assert.match(markdown, /content_type: webpage_translation/);
  assert.ok(markdown.includes('专业译文：The estimator is unbiased.'));
  assert.ok(markdown.includes(origin));
  await click(menu, 'togglePageTranslation', 'pageActionStatus', /译文/, 'success');
  await expect(page.locator('#source')).toHaveText('专业译文：The estimator is unbiased.');
  await click(menu, 'exportJson', 'knowledgeActionStatus', /已提交下载/, 'success');
  const json = JSON.parse(decodeURIComponent(downloads.at(-1).url.split(',').slice(1).join(',')));
  assert.equal(json.contentType, 'webpage_translation');
  assert.equal(json.segments.length, 2);
  assert.equal(json.segments[1].source, 'The estimator is unbiased.');
  await click(menu, 'exportSrt', 'knowledgeActionStatus', /SRT 仅用于视频/, 'error');
  assert.equal(downloads.length, 2);
  stored.currentLearningSession = { title: 'Lecture', startedAt: new Date().toISOString(), segments: [{ source: 'Variance', translation: '方差', mediaTime: 5 }] };
  await menu.locator('#knowledgeSource').selectOption('video');
  await click(menu, 'exportSrt', 'knowledgeActionStatus', /已提交下载/, 'success');
  assert.match(decodeURIComponent(downloads.at(-1).url), /00:00:05,000 --> 00:00:09,000/);
  stored.currentLearningSession.segments[0].end = 5.9;
  await click(menu, 'exportSrt', 'knowledgeActionStatus', /已提交下载/, 'success');
  assert.match(decodeURIComponent(downloads.at(-1).url), /00:00:05,000 --> 00:00:05,900/);
  assert.equal(await menu.locator('#saveBilingual').count(), 0, 'No duplicate video Markdown button');
  await click(menu, 'exportMarkdown', 'knowledgeActionStatus', /已提交下载/, 'success');
  assert.match(downloads.at(-1).filename, /\.md$/);
  assert.match(decodeURIComponent(downloads.at(-1).url), /\*\*原文\*\*\n\nVariance\n\n\*\*译文\*\*\n\n方差/);
  await click(menu, 'exportPdf', 'knowledgeActionStatus', /已打开双语排版预览/, 'success');
  await expect.poll(() => pdfPreviews.length).toBe(1);
  assert.equal(Object.keys(stored).filter(key => key.startsWith('bilingual-pdf-')).length, 1);
  assert.equal(Object.entries(stored).find(([key]) => key.startsWith('bilingual-pdf-'))[1].title, 'Lecture');
  await menu.locator('#knowledgeSource').selectOption('webpage');
  await click(menu, 'exportPdf', 'knowledgeActionStatus', /已打开双语排版预览/, 'success');
  await expect.poll(() => pdfPreviews.length).toBe(2);
  assert.ok(Object.entries(stored).some(([key, value]) => key.startsWith('bilingual-pdf-') && value.contentType === 'webpage_translation'), 'PDF follows selected webpage source, not last video');
  await fs.mkdir(path.join(root, 'build/ui'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'build/ui/menu-actions.png') });
  menu = await openMenu();
  failTranslation = true;
  await click(menu, 'translatePage', 'pageActionStatus', /模型连接失败/, 'error');
  await expect(page.locator('#source')).toHaveText('The estimator is unbiased.');
  await menu.locator('#knowledgeSource').selectOption('webpage');
  await click(menu, 'exportJson', 'knowledgeActionStatus', /尚无译文/, 'error');
  failHealth = true;
  await click(menu, 'translatePage', 'pageActionStatus', /本地翻译服务未启动/, 'error');
  assert.equal(nativeStarts, 1);
  failHealth = false;
  failTranslation = false;
  modelDelay = 900;
  menu = await openMenu();
  await page.evaluate(() => {
    document.querySelector('main').innerHTML = Array.from({ length: 35 }, (_, index) => `<p>${index < 2 ? 'Repeated' : 'Paragraph ' + index}: ${'Statistical inference relies on explicit assumptions. '.repeat(4)}</p>`).join('');
  });
  const firstRequest = requestedBatches.length;
  await menu.locator('#translatePage').click();
  await expect(menu.locator('#pageProgress')).toHaveText(/翻译中/);
  assert.equal(await page.locator('.rt-hud').count(), 0, 'No standalone status bar during translation');
  await page.screenshot({ path: path.join(root, 'build/ui/translation-progress.png') });
  await page.locator('#quant-scholar-floating-control .launcher').click();
  assert.equal(await page.locator('.rt-hud').count(), 0, 'Closed menu must leave no floating status');
  await page.locator('#quant-scholar-floating-control .launcher').click();
  await expect(menu.locator('#pageProgress')).toHaveAttribute('data-kind', 'success');
  const requests = requestedBatches.slice(firstRequest);
  assert.ok(requests.length > 1);
  assert.ok(requests[0].join('').length <= 1600, 'Small first batch for early output');
  assert.ok(requests[1].join('').length > requests[0].join('').length, 'Later batches amortize CLI startup');
  assert.equal(requests.flat().length, 34, 'Deduplicate identical text within the same batch');
  await expect(page.locator('main p').first()).toHaveText(/^专业译文：/);
  await expect(page.locator('main p').nth(1)).toHaveText(await page.locator('main p').first().textContent());
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('.rt-hud').count(), 0);
  modelDelay = 2000;
  menu = await openMenu();
  await menu.locator('#translatePage').click();
  await menu.locator('#cancelPageTranslation').click();
  await expect(menu.locator('#pageActionStatus')).toHaveText(/已取消/);
  await expect(page.locator('#source')).toHaveText('The estimator is unbiased.');
  menu = await openMenu();
  await page.evaluate(() => {
    document.querySelector('main').insertAdjacentHTML('beforeend', '<div id="kami-subs-overlay">Live captions should not be translated again.</div><div style="display:none"><p>Hidden text.</p></div><div contenteditable="">Editable draft.</div>');
  });
  const ignoredRequest = requestedBatches.length;
  await click(menu, 'translatePage', 'pageActionStatus', /网页翻译完成/, 'success');
  const translatedText = requestedBatches.slice(ignoredRequest).flat().join(' ');
  assert.doesNotMatch(translatedText, /Live captions|Hidden text|Editable draft/);
  await page.evaluate(() => { document.getElementById('source').firstChild.nodeValue = 'Updated by the website.'; });
  await click(menu, 'togglePageTranslation', 'pageActionStatus', /原文/, 'success');
  await expect(page.locator('#source')).toHaveText('Updated by the website.');
  assert.deepEqual(errors, []);
  console.log('PASS: menu → background → actual page script; old-tab repair, owner binding, toggles, persistent errors, webpage Markdown/JSON, video SRT, failure rollback, local service startup failure. No model credits used.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
