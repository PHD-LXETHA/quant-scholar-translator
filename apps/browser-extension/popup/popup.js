// Kami Subs — popup controller

const $ = (id) => document.getElementById(id);

const els = {
  toggle: $('toggle'),
  status: $('status'),
  backendStatus: $('backendStatus'),
  sourceLang: $('sourceLang'),
  targetLang: $('targetLang'),
  fontSize: $('fontSize'),
  fontSizeVal: $('fontSizeVal'),
  position: $('position'),
  backendUrl: $('backendUrl'),
  model: $('model'),
  device: $('device'),
  translator: $('translator'),
  domain: $('domain'),
  preferNativeCaptions: $('preferNativeCaptions'),
  exportMarkdown: $('exportMarkdown'),
  exportJson: $('exportJson'),
  exportSrt: $('exportSrt'),
  clearSession: $('clearSession'),
  translatePage: $('translatePage'),
  togglePageTranslation: $('togglePageTranslation'),
  openPdfReader: $('openPdfReader'),
  openResearchSettings: $('openResearchSettings'),
  openLearningPanel: $('openLearningPanel'),
  openLearningSettings: $('openLearningSettings'),
};

const DEFAULTS = {
  sourceLang: 'auto',
  targetLang: 'zh',
  domain: 'auto',
  preferNativeCaptions: true,
  fontSize: 28,
  position: 'bottom',
  backendUrl: 'ws://127.0.0.1:8765/ws',
  task: 'translate',
  model: 'large-v3-turbo',
  device: 'auto',
  translator: 'llm',
};

// compute_type pairs naturally with device — float16 on GPU, int8 on CPU.
// For "auto" we hint float16; the backend downgrades to int8 itself if it ends
// up falling back to CPU, so this is just the preferred GPU compute type.
function computeFor(device) { return device === 'cpu' ? 'int8' : 'float16'; }

async function loadSettings() {
  const stored = await chrome.storage.local.get('settings');
  const s = { ...DEFAULTS, ...(stored.settings || {}) };
  els.sourceLang.value = s.sourceLang;
  els.targetLang.value = s.targetLang;
  els.fontSize.value = s.fontSize;
  els.fontSizeVal.textContent = s.fontSize;
  els.position.value = s.position;
  els.backendUrl.value = s.backendUrl;
  els.model.value = s.model;
  els.device.value = s.device;
  els.translator.value = s.translator;
  els.domain.value = s.domain;
  els.preferNativeCaptions.checked = s.preferNativeCaptions !== false;
  return s;
}

async function saveSettings() {
  const device = els.device.value;
  const s = {
    sourceLang: els.sourceLang.value,
    targetLang: els.targetLang.value,
    fontSize: parseInt(els.fontSize.value, 10),
    position: els.position.value,
    backendUrl: els.backendUrl.value.trim() || DEFAULTS.backendUrl,
    task: 'translate',
    model: els.model.value,
    device,
    compute: computeFor(device),
    translator: els.translator.value,
    domain: els.domain.value,
    preferNativeCaptions: els.preferNativeCaptions.checked,
  };
  await chrome.storage.local.set({ settings: s });
  return s;
}

function setStatus(text, kind) {
  els.status.textContent = text;
  els.status.className = 'status ' + (kind || 'idle');
}

function setBackendStatus(state, info) {
  // state: unknown | starting | up | down | unavailable
  const map = {
    unknown:     ['本地引擎：检测中',                'idle'],
    starting:    ['本地引擎：正在启动…',             'starting'],
    up:          [`本地引擎：已运行${info && info.pid ? ' (pid ' + info.pid + ')' : ''}`, 'up'],
    down:        ['本地引擎：未运行',                'down'],
    unavailable: ['本地引擎：未注册，请按 README 安装', 'bad'],
  };
  const [text, cls] = map[state] || map.unknown;
  els.backendStatus.textContent = text;
  els.backendStatus.className = 'backend-status ' + cls;
}

async function refresh() {
  const res = await chrome.runtime.sendMessage({ target: 'background', type: 'capture:status' });
  if (!res) return;
  setBackendStatus(res.backendState, res.backendInfo);
  if (res.isCapturing) {
    els.toggle.textContent = '停止实时翻译';
    els.toggle.classList.add('stop');
    switch (res.wsState) {
      case 'connected':  setStatus(res.captureMode === 'native-captions' ? '翻译中 · 网页原字幕' : '翻译中 · 音频识别', 'live'); break;
      case 'connecting': setStatus('正在连接…', 'idle'); break;
      case 'error':
      case 'closed':     setStatus('Backend offline — start server', 'error'); break;
      default:           setStatus('Capturing (no backend)', 'error');
    }
  } else {
    els.toggle.textContent = '开始实时翻译';
    els.toggle.classList.remove('stop');
    setStatus('未开始', 'idle');
  }
}

// Poll while popup is open so status reflects WS state changes in real time.
setInterval(refresh, 1000);

async function onToggle() {
  const settings = await saveSettings();
  const status = await chrome.runtime.sendMessage({ target: 'background', type: 'capture:status' });
  if (status && status.isCapturing) {
    await chrome.runtime.sendMessage({ target: 'background', type: 'capture:stop' });
  } else {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs.length) return setStatus('No active tab', 'error');
    const res = await chrome.runtime.sendMessage({
      target: 'background',
      type: 'capture:start',
      tabId: tabs[0].id,
      settings
    });
    if (res && !res.ok) setStatus(res.error || 'Failed to start', 'error');
  }
  await refresh();
}

els.fontSize.addEventListener('input', () => {
  els.fontSizeVal.textContent = els.fontSize.value;
});
['sourceLang','targetLang','fontSize','position','backendUrl','model','device','translator','domain','preferNativeCaptions'].forEach(k => {
  els[k].addEventListener('change', saveSettings);
});
els.toggle.addEventListener('click', onToggle);
els.exportMarkdown.addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({ target: 'background', type: 'knowledge:export', format: 'markdown' });
  if (!res?.ok) setStatus(res?.error || 'Nothing to export', 'error');
});
els.exportJson.addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({ target: 'background', type: 'knowledge:export', format: 'json' });
  if (!res?.ok) setStatus(res?.error || 'Nothing to export', 'error');
});
els.exportSrt.addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({ target: 'background', type: 'knowledge:export', format: 'srt' });
  if (!res?.ok) setStatus(res?.error || 'Nothing to export', 'error');
});
els.clearSession.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ target: 'background', type: 'knowledge:clear' });
  setStatus('Transcript cleared', 'idle');
});
els.translatePage.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'TRANSLATE_PAGE' });
    setStatus(res?.ok ? `网页翻译完成 · ${res.count || 0} 段` : (res?.error || '网页翻译失败'), res?.ok ? 'live' : 'error');
  } catch (_error) {
    setStatus('当前页面不允许网页翻译', 'error');
  }
});
els.togglePageTranslation.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try { await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_TRANSLATION' }); }
  catch (_error) { setStatus('当前页面不可用', 'error'); }
});
els.openPdfReader.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const query = tab?.url && /^(https?|file):/.test(tab.url) ? `?url=${encodeURIComponent(tab.url)}` : '';
  await chrome.tabs.create({ url: chrome.runtime.getURL(`research/pdf-viewer.html${query}`) });
});
els.openResearchSettings.addEventListener('click', () => chrome.runtime.openOptionsPage());
els.openLearningPanel.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.sidePanel.setOptions({ tabId: tab.id, path: 'learning/sidepanel.html', enabled: true });
  await chrome.sidePanel.open({ tabId: tab.id });
  window.close();
});
els.openLearningSettings.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('learning/options.html') });
});

loadSettings().then(refresh);
