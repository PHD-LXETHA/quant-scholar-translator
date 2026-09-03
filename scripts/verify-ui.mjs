import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const playwright = process.env.QS_NODE_MODULES
  ? await import(pathToFileURL(path.join(process.env.QS_NODE_MODULES, 'playwright/index.mjs')))
  : await import('playwright');
const fixture = '<!doctype html><html><body style="margin:0;background:#17212b;color:#e8f1f5;font:24px system-ui"><main style="padding:60px"><h1>Technical lecture fixture</h1><p>Finance · mathematics · statistics</p><div style="height:400px;background:#071521;border-radius:20px;display:grid;place-items:center">Video area</div></main></body></html>';
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end(fixture); return; }
    const base = url.pathname.startsWith('/mobile/')
      ? path.join(root, 'quant_scholar_translator', 'mobile')
      : path.join(root, 'apps', 'browser-extension', 'popup');
    const name = path.basename(url.pathname) || 'index.html';
    const file = path.join(base, name);
    response.setHeader('Content-Type', name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' : 'application/json');
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
    const stored = {};
    const runtime = {
      getURL: value => `${origin}/${value}`,
      onMessage: { addListener: listener => (window.__qsListeners ||= []).push(listener) },
      sendMessage: async message => message.type === 'settings:get'
        ? { ok: true, settings: { backendUrl: origin, translator: 'kimi_subscription', domain: 'auto', translationMode: 'professional' } }
        : { ok: true, isCapturing: false, backendState: 'up', records: [] },
      openOptionsPage: async () => {},
    };
    window.chrome = window.browser = {
      runtime,
      storage: { local: {
        get: (keys, callback) => { const value = { ...stored }; if (callback) { queueMicrotask(() => callback(value)); return; } return Promise.resolve(value); },
        set: async value => Object.assign(stored, value),
        remove: async key => { delete stored[key]; },
      } },
      tabs: { query: async () => [{ id: 1, url: origin }], sendMessage: async () => ({ ok: true }), create: async () => ({ id: 2 }) },
      sidePanel: { setOptions: async () => {}, open: async () => {} },
    };
  }, { origin });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.addStyleTag({ path: path.join(root, 'apps/browser-extension/content.css') });
  await page.addScriptTag({ path: path.join(root, 'apps/browser-extension/content.js') });
  await page.locator('#quant-scholar-floating-control .launcher').click();
  const menu = page.frameLocator('#quant-scholar-floating-control .full-menu');
  await menu.locator('#toggle').waitFor();
  for (const id of ['toggle','sourceLang','targetLang','domain','preferNativeCaptions','fontSize','position','model','device','translationMode','translator','backendUrl','translatePage','togglePageTranslation','openPdfReader','openResearchSettings','openLearningPanel','openLearningSettings','exportMarkdown','exportJson','exportSrt','clearSession']) {
    assert.equal(await menu.locator(`#${id}`).count(), 1, `Missing control: ${id}`);
  }
  await page.screenshot({ path: path.join(output, 'desktop-menu.png') });
  await menu.locator('#clearSession').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'desktop-menu-bottom.png') });
  await page.locator('#quant-scholar-floating-control .close').click();
  assert.equal(await page.locator('#quant-scholar-floating-control .full-menu').getAttribute('src'), 'about:blank');
  await page.evaluate(() => { const host=document.getElementById('quant-scholar-floating-control'); host.style.left='1210px'; host.style.top='830px'; host.style.right='auto'; });
  await page.locator('#quant-scholar-floating-control .launcher').click();
  const box = await page.locator('#quant-scholar-floating-control .panel').boundingBox();
  assert.ok(box.x >= 0 && box.y >= 0 && box.x+box.width <= 1280 && box.y+box.height <= 900, 'Desktop menu escaped viewport');
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileBox = await page.locator('#quant-scholar-floating-control .panel').boundingBox();
  assert.ok(mobileBox.x >= 0 && mobileBox.x+mobileBox.width <= 390, 'Mobile menu escaped viewport');
  await page.screenshot({ path: path.join(output, 'small-screen-menu.png') });
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
  assert.deepEqual(errors, [], 'Browser UI errors');
  console.log('UI verified: 22 controls, desktop edge placement, small-screen layout, lazy iframe, mobile workspace, Safari menu.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
