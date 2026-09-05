// Kami Subs — popup controller

const $ = (id) => document.getElementById(id);

const els = {
  videoLibrary: $('videoLibrary'), videoLibraryStatus: $('videoLibraryStatus'), saveVideoDocument: $('saveVideoDocument'),
  toggle: $('toggle'),
  prepareVideo: $('prepareVideo'),
  exportPdf: $('exportPdf'),
  showTranslated: $('showTranslated'),
  stopFull: $('stopFull'),
  playbackHelp: $('playbackHelp'),
  status: $('status'),
  backendStatus: $('backendStatus'),
  sourceLang: $('sourceLang'),
  targetLang: $('targetLang'),
  fontSize: $('fontSize'),
  fontSizeVal: $('fontSizeVal'),
  position: $('position'),
  subtitleDisplay: $('subtitleDisplay'),
  backendUrl: $('backendUrl'),
  model: $('model'),
  device: $('device'),
  translationMode: $('translationMode'),
  translationModeHelp: $('translationModeHelp'),
  translator: $('translator'),
  domain: $('domain'),
  preferNativeCaptions: $('preferNativeCaptions'),
  sourceStrategy: $('sourceStrategy'),
  exportMarkdown: $('exportMarkdown'),
  exportJson: $('exportJson'),
  exportSrt: $('exportSrt'),
  clearSession: $('clearSession'),
  translatePage: $('translatePage'),
  pageProgress: $('pageProgress'),
  cancelPageTranslation: $('cancelPageTranslation'),
  togglePageTranslation: $('togglePageTranslation'),
  openPdfReader: $('openPdfReader'),
  openResearchSettings: $('openResearchSettings'),
  openLearningPanel: $('openLearningPanel'),
  openLearningSettings: $('openLearningSettings'),
  pageActionStatus: $('pageActionStatus'),
  knowledgeActionStatus: $('knowledgeActionStatus'),
  knowledgeSource: $('knowledgeSource'),
};

const DEFAULTS = {
  videoLibrary: true,
  sourceLang: 'auto',
  targetLang: 'zh',
  domain: 'auto',
  preferNativeCaptions: true,
  sourceStrategy: 'auto',
  fontSize: 28,
  position: 'bottom',
  subtitleDisplay: 'translation',
  backendUrl: 'ws://127.0.0.1:8765/ws',
  task: 'transcribe',
  model: 'large-v3-turbo',
  device: 'auto',
  translationMode: 'professional',
  translator: 'kimi_subscription',
};

const MODE_HELP = {
  professional: '原文立即显示；Codex/Kimi 直接读取原文与上下文生成终稿，知识库只保存终稿。',
  quick: 'NLLB 只作临时预览；Codex/Kimi 仍从原文独立生成终稿，避免错误锚定。',
  offline: '完全离线使用 Whisper＋NLLB；不会调用 Codex、Kimi 或在线翻译。',
};

function renderTranslationMode(mode) {
  els.translationModeHelp.textContent = MODE_HELP[mode] || MODE_HELP.professional;
  els.translator.disabled = mode === 'offline';
}

// compute_type pairs naturally with device — float16 on GPU, int8 on CPU.
// For "auto" we hint float16; the backend downgrades to int8 itself if it ends
// up falling back to CPU, so this is just the preferred GPU compute type.
function computeFor(device) { return device === 'cpu' ? 'int8' : 'float16'; }

async function loadSettings() {
  const stored = await chrome.storage.local.get('settings');
  const s = { ...DEFAULTS, ...(stored.settings || {}) };
  els.videoLibrary.checked = s.videoLibrary !== false;
  if (s.translator === 'codex_subscription') s.translator = 'codex';
  els.sourceLang.value = s.sourceLang;
  els.targetLang.value = s.targetLang;
  els.fontSize.value = s.fontSize;
  els.fontSizeVal.textContent = s.fontSize;
  els.position.value = s.position;
  els.subtitleDisplay.value = ['translation', 'bilingual', 'sidebar'].includes(s.subtitleDisplay) ? s.subtitleDisplay : 'translation';
  els.backendUrl.value = s.backendUrl;
  els.model.value = s.model;
  els.device.value = s.device;
  els.translationMode.value = s.translationMode;
  els.translator.value = s.translator;
  els.domain.value = s.domain;
  els.preferNativeCaptions.checked = s.preferNativeCaptions !== false;
  els.sourceStrategy.value = ['full-captions', 'full-audio'].includes(s.sourceStrategy) ? s.sourceStrategy : 'auto';
  renderTranslationMode(s.translationMode);
  return s;
}

async function saveSettings() {
  const device = els.device.value;
  const s = {
    videoLibrary: els.videoLibrary.checked,
    sourceLang: els.sourceLang.value,
    targetLang: els.targetLang.value,
    fontSize: parseInt(els.fontSize.value, 10),
    position: els.position.value,
    subtitleDisplay: els.subtitleDisplay.value,
    backendUrl: els.backendUrl.value.trim() || DEFAULTS.backendUrl,
    task: 'transcribe',
    model: els.model.value,
    device,
    compute: computeFor(device),
    translationMode: els.translationMode.value,
    translator: els.translator.value,
    domain: els.domain.value,
    preferNativeCaptions: els.preferNativeCaptions.checked,
    sourceStrategy: els.sourceStrategy.value,
  };
  await chrome.storage.local.set({ settings: s });
  return s;
}

function setStatus(text, kind) {
  els.status.textContent = text;
  els.status.className = 'status ' + (kind || 'idle');
}

let ownerTabPromise;
let ownerTab;
function getOwnerTab() {
  if (!ownerTabPromise) ownerTabPromise = chrome.runtime.sendMessage({ target: 'background', type: 'menu:context' }).then(result => {
    if (!result?.ok || !result.tab?.id) throw new Error('找不到菜单所属网页，请关闭菜单后重新打开');
    ownerTab = result.tab;
    return ownerTab;
  }).catch(error => { ownerTabPromise = null; throw error; });
  return ownerTabPromise;
}

async function runAction(button, feedback, pendingText, action) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = pendingText;
  feedback.textContent = pendingText;
  feedback.dataset.kind = 'pending';
  try {
    feedback.textContent = await action();
    feedback.dataset.kind = 'success';
  } catch (error) {
    feedback.textContent = error?.message || String(error);
    feedback.dataset.kind = 'error';
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

async function pageCommand(command) {
  const tab = await getOwnerTab();
  const result = await chrome.runtime.sendMessage({ target: 'background', type: 'page:command', tabId: tab.id, command });
  if (!result?.ok) throw new Error(result?.error || '网页未响应，请刷新页面再试');
  return result;
}

let pagePolling = false;
let localPageAction = false;
async function refreshPageProgress() {
  if (pagePolling) return;
  pagePolling = true;
  try {
    const result = await pageCommand('GET_STATUS');
    const progress = result.progress;
    els.cancelPageTranslation.hidden = !result.running;
    els.cancelPageTranslation.disabled = Boolean(result.cancelled);
    if (!localPageAction) {
      els.translatePage.disabled = Boolean(result.running);
      els.translatePage.textContent = result.running ? '正在翻译网页…' : '翻译当前网页';
    }
    els.pageProgress.hidden = !progress;
    if (progress) {
      const seconds = Math.max(0, Math.floor(((progress.finished || Date.now()) - progress.started) / 1000));
      els.pageProgress.textContent = progress.error || (result.running
        ? (result.cancelled ? '正在停止，等待当前请求返回…' : `翻译中 · ${progress.done}/${progress.total} 批 · ${seconds} 秒`)
        : `已完成 ${result.count} 段 · ${seconds} 秒`);
      els.pageProgress.dataset.kind = progress.error ? 'error' : result.running ? 'pending' : 'success';
    }
  } catch (_error) { /* Unsupported pages have no translation task; action errors remain visible. */ }
  finally { pagePolling = false; }
}
setInterval(refreshPageProgress, 1000);
refreshPageProgress();

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

let captureActionPending = false;
let captureActionError = '';
async function refresh() {
  let res;
  try { res = await chrome.runtime.sendMessage({ target: 'background', type: 'capture:status' }); }
  catch (_error) { setStatus('扩展连接已断开，请刷新视频网页并重新打开菜单', 'error'); return; }
  if (!res) return;
  setBackendStatus(res.backendState, res.backendInfo);
  const ownsFull = Boolean(res.full && (!ownerTab?.id || res.full.tabId === ownerTab.id || res.activeTabId === ownerTab.id));
  els.saveVideoDocument.disabled = !ownsFull;
  els.videoLibraryStatus.textContent = ownsFull && res.full.libraryError ? res.full.libraryError
    : ownsFull && res.full.libraryDocument ? `本地 MD 已保存 ${res.full.librarySaved || 0}/${res.full.total} 条译文：${res.full.libraryDocument}`
    : '每个视频一份双语 MD，保存在项目“学习资料 / 视频双语”；回看已译部分不调用模型。';
  els.videoLibraryStatus.dataset.kind = ownsFull && res.full.libraryError ? 'error' : 'success';
  els.showTranslated.hidden = els.playbackHelp.hidden = !ownsFull;
  els.stopFull.hidden = !ownsFull || !res.isCapturing;
  els.stopFull.disabled = Boolean(res.captureStarting || res.captureStopping);
  els.showTranslated.disabled = !ownsFull || !res.full.done || res.captureStarting || res.captureStopping;
  if (ownsFull) els.playbackHelp.textContent = res.full.done
    ? '点击“显示译文字幕”，再用视频播放器的 ▶ 播放；未译到的片段仍会显示原文。无需点“开始实时翻译”。'
    : '已提取原文，但尚无可用译文。请先解决下方错误或等待首批翻译完成，再播放。';
  if (captureActionPending && !res.captureStarting) return;
  els.toggle.disabled = Boolean(res.captureStarting || res.captureStopping);
  els.prepareVideo.disabled = els.toggle.disabled;
  els.prepareVideo.textContent = res.isCapturing && res.full
    ? res.full.status === 'complete' ? '全文已译完' : res.full.preparationPaused || ['failed', 'paused'].includes(res.full.status) ? '继续提前翻译' : '暂停提前翻译'
    : '提前全文翻译';
  els.prepareVideo.classList.toggle('stop', Boolean(res.isCapturing && res.full));
  if (res.captureStopping) { els.toggle.textContent = '正在保存剩余内容…'; setStatus('已停止收音，正在处理队尾；请保持服务运行。', 'idle'); return; }
  if (res.captureStarting) { els.toggle.textContent = '正在准备…'; setStatus('正在连接服务、自动读取完整字幕；无字幕时检查音轨…', 'idle'); return; }
  if (res.isCapturing) {
    if (ownerTab?.id && res.activeTabId != null && ownerTab.id !== res.activeTabId) {
      els.toggle.textContent = '开始实时翻译';
      els.toggle.disabled = Boolean(res.full);
      els.prepareVideo.disabled = !res.full;
      if (res.full) els.prepareVideo.textContent = '停止另一网页的提前翻译';
      else els.toggle.textContent = '停止另一网页的实时翻译';
      setStatus('翻译正在另一个网页运行；停止后可在本页重新开始。', 'idle');
      return;
    }
    els.toggle.textContent = res.full ? '开始实时翻译' : '停止实时翻译';
    els.toggle.classList.toggle('stop', !res.full);
    els.toggle.disabled = Boolean(res.full);
    els.prepareVideo.disabled = !res.full;
    if (res.full) {
      els.prepareVideo.disabled = res.full.status === 'complete';
      setStatus(res.full.message || '正在准备提前译文…', res.full.error || res.full.status === 'failed' ? 'error' : 'live');
      return;
    }
    switch (res.wsState) {
      case 'connected': {
        const d = res.captureDiagnostics || {};
        let text = '已连接 · 等待语音识别结果';
        if (res.captureMode === 'native-captions') text = '翻译中 · 网页原字幕';
        else if (d.audioState === 'suspended') text = '音频处理已暂停，请停止后重新开始';
        else if (Date.now() - (d.lastAudioAt || d.startedAt || Date.now()) > 8000) text = '未检测到声音：请播放视频并检查播放器静音；受保护视频可能无法采集';
        else if (d.lastTranscriptAt) text = '翻译中 · 音频识别';
        else if (d.lastAudioAt) text = '已收到声音 · 等待 Whisper 识别及模型翻译';
        setStatus(text, 'live'); break;
      }
      case 'connecting': setStatus('正在连接…', 'idle'); break;
      case 'error':
      case 'closed':     setStatus('识别服务连接中断，请检查本地服务', 'error'); break;
      default:           setStatus('正在连接音频识别服务…', 'idle');
    }
  } else {
    els.toggle.textContent = '开始实时翻译';
    els.toggle.classList.remove('stop');
    setStatus('未开始', 'idle');
  }
  if (captureActionError || res.captureError) setStatus(captureActionError || res.captureError, 'error');
}

// Poll while popup is open so status reflects WS state changes in real time.
setInterval(refresh, 1000);

async function onToggle(prepare = false) {
  if (captureActionPending) return;
  captureActionPending = true;
  captureActionError = '';
  els.toggle.disabled = true;
  els.prepareVideo.disabled = true;
  setStatus('正在处理，请稍候…', 'idle');
  try {
    const settings = await saveSettings();
    const status = await chrome.runtime.sendMessage({ target: 'background', type: 'capture:status' });
    const tab = await getOwnerTab();
    if (status?.isCapturing && Boolean(status.full) !== prepare) throw new Error('请先停止当前翻译，再切换提前 / 实时模式');
    settings.sourceStrategy = prepare ? (settings.sourceStrategy === 'auto' ? 'ahead' : settings.sourceStrategy) : 'live';
    const type = status?.isCapturing ? prepare && status.full && status.activeTabId === tab.id ? 'full:preparation' : 'capture:stop' : 'capture:start';
    const res = await chrome.runtime.sendMessage({ target: 'background', type, tabId: tab.id, settings });
    if (!res?.ok) throw new Error(res?.error || '实时翻译未能启动');
  } catch (error) { captureActionError = error.message || String(error); }
  finally { captureActionPending = false; els.toggle.disabled = false; els.prepareVideo.disabled = false; await refresh(); }
}

els.fontSize.addEventListener('input', () => {
  els.fontSizeVal.textContent = els.fontSize.value;
});
['sourceLang','targetLang','fontSize','position','subtitleDisplay','backendUrl','model','device','translationMode','translator','domain','preferNativeCaptions','sourceStrategy','videoLibrary'].forEach(k => {
  els[k].addEventListener('change', async () => {
    try {
      const settings = await saveSettings();
      const tab = await getOwnerTab();
      const result = await chrome.runtime.sendMessage({ target: 'background', type: 'capture:settings', tabId: tab.id, settings });
      if (result?.ok === false) throw new Error(result.error || '字幕样式未能更新');
      els.translationModeHelp.textContent = (MODE_HELP[settings.translationMode] || MODE_HELP.professional) + ' 字幕显示、字号和位置立即生效；语言、引擎和识别设置在下次开始时生效。';
    } catch (error) { captureActionError = error.message || String(error); setStatus(captureActionError, 'error'); }
  });
});
els.translationMode.addEventListener('change', () => renderTranslationMode(els.translationMode.value));
els.toggle.addEventListener('click', () => onToggle(false));
els.prepareVideo.addEventListener('click', () => onToggle(true));
els.saveVideoDocument.addEventListener('click', () => runAction(els.saveVideoDocument, els.videoLibraryStatus, '正在更新本地双语文档…', async () => {
  const tab = await getOwnerTab();
  const result = await chrome.runtime.sendMessage({ target: 'background', type: 'library:save', tabId: tab.id });
  if (!result?.ok) throw new Error(result?.error || '文档保存失败');
  return `已保存：${result.path}`;
}));
els.stopFull.addEventListener('click', () => runAction(els.stopFull, els.knowledgeActionStatus, '正在结束字幕会话…', async () => {
  const res = await chrome.runtime.sendMessage({ target: 'background', type: 'capture:stop' });
  if (!res?.ok) throw new Error(res?.error || '结束失败');
  await refresh();
  return '字幕会话已结束，已保存译文仍可再次启用或导出。';
}));
els.showTranslated.addEventListener('click', () => runAction(els.showTranslated, els.knowledgeActionStatus, '正在启用译文字幕…', async () => {
  const tab = await getOwnerTab();
  const res = await chrome.runtime.sendMessage({ target: 'background', type: 'full:show', tabId: tab.id });
  if (!res?.ok) throw new Error(res?.error || '译文字幕未能启用');
  return '译文字幕已启用。请点击视频播放器的 ▶ 播放；此按钮不会重新调用模型。';
}));
for (const [button, format] of [[els.exportMarkdown, 'markdown'], [els.exportPdf, 'pdf'], [els.exportJson, 'json'], [els.exportSrt, 'srt']]) {
  button.addEventListener('click', () => runAction(button, els.knowledgeActionStatus, '正在准备导出…', async () => {
    const tab = await getOwnerTab();
    const res = await chrome.runtime.sendMessage({ target: 'background', type: 'knowledge:export', format, tabId: tab.id, source: els.knowledgeSource.value });
    if (!res?.ok) throw new Error(res?.error || '导出失败，请重试');
    if (format === 'pdf') return '已打开双语排版预览，点击“打印 / 保存 PDF”，目标选择“另存为 PDF”。';
    return '已提交下载，请在浏览器下载列表中查看；若出现保存窗口，请选择保存位置。';
  }));
}
els.clearSession.addEventListener('click', () => runAction(els.clearSession, els.knowledgeActionStatus, '正在清空…', async () => {
  const res = await chrome.runtime.sendMessage({ target: 'background', type: 'knowledge:clear' });
  if (!res?.ok) throw new Error(res?.error || '清空失败');
  return '当前视频会话记录已清空；视频存档、MD 文档和当前网页译文未删除。';
}));
els.translatePage.addEventListener('click', async () => {
  localPageAction = true;
  try {
    await runAction(els.translatePage, els.pageActionStatus, '正在翻译网页，请稍候…', async () => {
      const res = await pageCommand('TRANSLATE_PAGE');
      return `网页翻译完成 · ${res.count || 0} 段，可切换原文 / 译文或导出知识库。`;
    });
  } finally { localPageAction = false; await refreshPageProgress(); }
});
els.cancelPageTranslation.addEventListener('click', async () => {
  els.cancelPageTranslation.disabled = true;
  try { await pageCommand('CANCEL_PAGE_TRANSLATION'); }
  catch (error) { els.pageActionStatus.textContent = error.message; els.pageActionStatus.dataset.kind = 'error'; }
  finally { await refreshPageProgress(); }
});
els.togglePageTranslation.addEventListener('click', () => runAction(els.togglePageTranslation, els.pageActionStatus, '正在切换…', async () => {
  const res = await pageCommand('TOGGLE_TRANSLATION');
  return res.translated ? '当前显示：译文' : '当前显示：原文';
}));
els.openPdfReader.addEventListener('click', () => runAction(els.openPdfReader, els.pageActionStatus, '正在打开 PDF…', async () => {
  const tab = await getOwnerTab();
  const query = tab?.url && /^(https?|file):/.test(tab.url) ? `?url=${encodeURIComponent(tab.url)}` : '';
  await chrome.tabs.create({ url: chrome.runtime.getURL(`research/pdf-viewer.html${query}`) });
  return '已打开 PDF 阅读器，可选择本地文件或网页 PDF。';
}));
els.openResearchSettings.addEventListener('click', () => runAction(els.openResearchSettings, els.pageActionStatus, '正在打开…', async () => {
  await chrome.runtime.openOptionsPage(); return '已打开网页与 PDF 翻译设置。';
}));
els.openLearningPanel.addEventListener('click', () => runAction(els.openLearningPanel, els.pageActionStatus, '正在打开工作台…', async () => {
  // Resolve the owner when loading the menu, not after the click. Keep open()
  // in the click's user-gesture turn, before awaiting setOptions().
  if (!ownerTab?.id) throw new Error('菜单仍在初始化，请稍候再点击学习工作台');
  const tab = ownerTab;
  await Promise.all([
    chrome.sidePanel.setOptions({ tabId: tab.id, path: 'learning/sidepanel.html', enabled: true }),
    chrome.sidePanel.open({ tabId: tab.id }),
  ]);
  await chrome.tabs.sendMessage(tab.id, { type: 'floating:close-menu' }, { frameId: 0 }).catch(() => {});
  return '学习工作台已打开。';
}));
els.openLearningSettings.addEventListener('click', () => runAction(els.openLearningSettings, els.pageActionStatus, '正在打开…', async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL('learning/options.html') }); return '已打开学习工作台设置。';
}));

getOwnerTab().catch(error => {
  els.pageActionStatus.textContent = error.message;
  els.pageActionStatus.dataset.kind = 'error';
});

loadSettings().then(refresh);
