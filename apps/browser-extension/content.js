// Kami Subs — content script
// Mounts a subtitle overlay anchored over the most likely active video element.

(() => {
if (window.top !== window || window.__quantScholarContentLoaded) return;
window.__quantScholarContentLoaded = true;

const OVERLAY_ID = 'kami-subs-overlay';

let overlayEl = null;
let textEl = null;
let sourceEl = null;
let overlaySettings = {};
let overlayRecoveryObserver = null;
let hideTimer = null;
let trackedVideo = null;
let resizeObserver = null;
let scrollHandler = null;
let nativeCaptionObserver = null;
let nativeTrackBindings = [];
let lastNativeCaption = '';
let nativeCaptionSettings = {};
let domCaptionTimer = null;
let pendingDomCaption = '';
let youtubeTimedTextCues = [];
let youtubeTimedTextTimer = null;
let youtubeTimedTextNonce = 0;

const CAPTION_SELECTORS = [
  '.ytp-caption-segment',
  '.vimeo-captions-text',
  '.vp-captions span',
  '.jw-text-track-cue',
  '.vjs-text-track-cue div',
  '.plyr__captions span',
  '[data-testid="captions"]',
  '[class*="subtitle"] [class*="text"]',
  '[class*="caption"] [class*="text"]'
];

function pickPrimaryVideo() {
  const videos = Array.from(document.querySelectorAll('video'));
  if (videos.length === 0) return null;
  // Prefer the largest visible video.
  let best = null;
  let bestArea = 0;
  for (const v of videos) {
    const r = v.getBoundingClientRect();
    const area = Math.max(0, r.width) * Math.max(0, r.height);
    if (area > bestArea) { bestArea = area; best = v; }
  }
  return best;
}

function mediaTime() {
  const video = trackedVideo || pickPrimaryVideo();
  return video && Number.isFinite(video.currentTime) ? Number(video.currentTime.toFixed(3)) : null;
}

function cleanCaptionText(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function emitNativeCaption(source, provider) {
  const clean = cleanCaptionText(source);
  if (!clean || clean === lastNativeCaption) return;
  lastNativeCaption = clean;
  chrome.runtime.sendMessage({
    target: 'background',
    type: 'caption:segment',
    source: clean,
    sourceLang: nativeCaptionSettings.sourceLang || 'auto',
    mediaTime: mediaTime(),
    provider
  });
}

// YouTube keeps its subtitle data in the page's own JavaScript world. The
// bundled sniffer observes timedtext requests there and sends normalized cues
// across this narrow window-message bridge. Translation still goes through our
// own professional backend and glossary.
function youtubeTimedTextConfig() {
  if (!location.hostname.endsWith('youtube.com')) return;
  const nonce = ++youtubeTimedTextNonce;
  window.postMessage({
    source: 'ytds-content',
    type: 'config',
    targetLang: nativeCaptionSettings.targetLang || 'zh-Hans',
    mode: 'gtx',
    nonce
  }, '*');
}

function startYoutubeTimedTextBridge() {
  if (!location.hostname.endsWith('youtube.com') || youtubeTimedTextTimer) return;
  window.addEventListener('message', event => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'ytds-inject' || data.type !== 'cues') return;
    if (typeof data.nonce === 'number' && data.nonce !== youtubeTimedTextNonce) return;
    youtubeTimedTextCues = Array.isArray(data.cues)
      ? data.cues.filter(cue => cue && cue.text).sort((a, b) => a.start - b.start)
      : [];
  });
  window.addEventListener('yt-navigate-finish', () => {
    youtubeTimedTextCues = [];
    setTimeout(youtubeTimedTextConfig, 250);
  }, true);
  youtubeTimedTextTimer = setInterval(() => {
    if (!nativeCaptionObserver || !youtubeTimedTextCues.length) return;
    const nowMs = (mediaTime() || 0) * 1000;
    let active = null;
    for (const cue of youtubeTimedTextCues) {
      if (cue.start > nowMs) break;
      const duration = Math.max(1000, Number(cue.dur) || 0);
      if (nowMs < cue.start + duration) active = cue;
    }
    if (active) emitNativeCaption(active.text, 'youtube-timedtext');
  }, 120);
  youtubeTimedTextConfig();
}

function readDomCaption() {
  const nodes = [...new Set(CAPTION_SELECTORS.flatMap(selector => Array.from(document.querySelectorAll(selector))))];
  const visible = nodes.filter(node => {
    if (node.closest(`#${OVERLAY_ID}, #${FLOATING_HOST_ID}, .rt-quick-host`)) return false;
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  });
  const value = visible.map(node => node.textContent || '').join(' ').replace(/\s+/g, ' ').trim();
  if (value && value !== lastNativeCaption && value !== pendingDomCaption) {
    if (domCaptionTimer) clearTimeout(domCaptionTimer);
    pendingDomCaption = value;
    domCaptionTimer = setTimeout(() => {
      emitNativeCaption(value, location.hostname.includes('youtube.com') ? 'youtube-dom' : 'player-dom');
      domCaptionTimer = null;
      pendingDomCaption = '';
    }, 280);
  }
  return Boolean(value);
}

function bindHtml5TextTrack() {
  const video = trackedVideo || pickPrimaryVideo();
  if (!video || !video.textTracks) return false;
  const tracks = Array.from(video.textTracks).filter(track => ['captions', 'subtitles'].includes(track.kind));
  if (!tracks.length) return false;
  const wanted = nativeCaptionSettings.sourceLang;
  const selected = tracks.find(track => wanted && wanted !== 'auto' && track.language?.startsWith(wanted))
    || tracks.find(track => track.mode === 'showing')
    || tracks[0];
  if (nativeTrackBindings.some(([track]) => track === selected)) return true;
  if (selected.mode === 'disabled') selected.mode = 'hidden';
  const onCue = () => {
    const value = Array.from(selected.activeCues || []).map(cue => cue.text || '').join(' ');
    if (value) emitNativeCaption(value, 'html5-texttrack');
  };
  selected.addEventListener('cuechange', onCue);
  nativeTrackBindings.push([selected, onCue]);
  onCue();
  return true;
}

function stopNativeCaptions() {
  if (domCaptionTimer) clearTimeout(domCaptionTimer);
  domCaptionTimer = null;
  pendingDomCaption = '';
  if (nativeCaptionObserver) nativeCaptionObserver.disconnect();
  nativeCaptionObserver = null;
  for (const [track, listener] of nativeTrackBindings) track.removeEventListener('cuechange', listener);
  nativeTrackBindings = [];
  lastNativeCaption = '';
}

async function startNativeCaptions(settings) {
  stopNativeCaptions();
  nativeCaptionSettings = settings || {};
  startYoutubeTimedTextBridge();
  youtubeTimedTextConfig();
  trackedVideo = pickPrimaryVideo();
  const hasTrack = bindHtml5TextTrack();
  nativeCaptionObserver = new MutationObserver(() => readDomCaption());
  nativeCaptionObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  if (location.hostname.includes('youtube.com')) {
    const cc = document.querySelector('.ytp-subtitles-button');
    if (cc && cc.getAttribute('aria-pressed') !== 'true') cc.click();
  }
  // A player can expose an empty TextTrack. Only select the subtitle path
  // once actual text is available; otherwise tab audio must take over.
  if (lastNativeCaption || readDomCaption()) return { ok: true, provider: hasTrack ? 'html5-texttrack' : 'player-dom' };

  const deadline = Date.now() + (location.hostname.includes('youtube.com') ? 6500 : 2200);
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 200));
    bindHtml5TextTrack();
    if (lastNativeCaption || readDomCaption() || youtubeTimedTextCues.length) {
      return { ok: true, provider: youtubeTimedTextCues.length ? 'youtube-timedtext' : 'detected-caption' };
    }
  }
  stopNativeCaptions();
  return { ok: false };
}

function currentOverlayHost() {
  // When something is in fullscreen, browsers paint a "top layer" above
  // everything else and only descendants of the fullscreen element are visible.
  // Re-parent the overlay there so subtitles survive fullscreen.
  return document.fullscreenElement || document.webkitFullscreenElement || document.documentElement;
}

function ensureOverlay(settings) {
  overlaySettings = { ...overlaySettings, ...settings };
  // If we hold a reference that's still in the DOM, reuse it.
  if (overlayEl && overlayEl.isConnected) {
    const host = currentOverlayHost();
    if (overlayEl.parentNode !== host) host.appendChild(overlayEl);
    applySettings(overlaySettings);
    return overlayEl;
  }
  // Service-worker restarts or stale content-script reloads can leave orphan
  // overlay elements in the DOM that we no longer hold a ref to. Sweep them
  // out before creating a new one — otherwise they stack.
  document.querySelectorAll('#' + OVERLAY_ID).forEach(n => n.remove());
  overlayEl = document.createElement('div');
  overlayEl.id = OVERLAY_ID;
  overlayEl.setAttribute('dir', 'auto');
  sourceEl = document.createElement('span');
  sourceEl.className = 'kami-subs-source';
  textEl = document.createElement('span');
  textEl.className = 'kami-subs-text';
  overlayEl.appendChild(sourceEl);
  overlayEl.appendChild(textEl);
  currentOverlayHost().appendChild(overlayEl);
  applySettings(overlaySettings);
  // Some players replace their containers during playback. Reattach the same
  // card (including its text) instead of writing into a detached DOM node.
  if (!overlayRecoveryObserver) {
    overlayRecoveryObserver = new MutationObserver(() => {
      if (overlayEl && !overlayEl.isConnected) {
        currentOverlayHost().appendChild(overlayEl);
        positionOverlayOverVideo();
      }
    });
    overlayRecoveryObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
  return overlayEl;
}

function relocateForFullscreen() {
  if (!overlayEl) return;
  const host = currentOverlayHost();
  if (overlayEl.parentNode !== host) host.appendChild(overlayEl);
  positionOverlayOverVideo();
}
document.addEventListener('fullscreenchange', relocateForFullscreen);
document.addEventListener('webkitfullscreenchange', relocateForFullscreen);

function applySettings(settings) {
  if (!overlayEl) return;
  const fontSize = settings.fontSize || 28;
  overlayEl.style.setProperty('--kami-font-size', fontSize + 'px');
  const position = settings.position || 'bottom';
  overlayEl.dataset.position = position;
  overlayEl.dataset.display = ['translation', 'bilingual', 'sidebar'].includes(settings.subtitleDisplay)
    ? settings.subtitleDisplay : 'translation';
}

function positionOverlayOverVideo() {
  if (!overlayEl) return;
  // Viewport-anchored positioning works reliably in every layout:
  // tall pages, fullscreen players, iframes, weird custom skins, etc.
  // Trying to follow the video element's bounding box ends up offscreen
  // whenever the player is taller than the viewport or scrolls oddly.
  overlayEl.style.left = '50%';
  overlayEl.style.transform = 'translateX(-50%)';
  overlayEl.style.width = 'min(76vw, 880px)';
  if ((overlayEl.dataset.position || 'bottom') === 'top') {
    overlayEl.style.top = '6vh';
    overlayEl.style.bottom = '';
  } else {
    overlayEl.style.bottom = 'max(72px, 8vh)';
    overlayEl.style.top = '';
  }
}

function trackVideo() {
  untrackVideo();
  trackedVideo = pickPrimaryVideo();
  if (resizeObserver) try { resizeObserver.disconnect(); } catch (e) {}
  if (window.ResizeObserver && trackedVideo) {
    resizeObserver = new ResizeObserver(() => positionOverlayOverVideo());
    resizeObserver.observe(trackedVideo);
  }
  scrollHandler = () => positionOverlayOverVideo();
  window.addEventListener('scroll', scrollHandler, { passive: true });
  window.addEventListener('resize', scrollHandler);
  positionOverlayOverVideo();
}

function untrackVideo() {
  if (resizeObserver) { try { resizeObserver.disconnect(); } catch (e) {} resizeObserver = null; }
  if (scrollHandler) {
    window.removeEventListener('scroll', scrollHandler);
    window.removeEventListener('resize', scrollHandler);
    scrollHandler = null;
  }
  trackedVideo = null;
}

function mount(settings) {
  ensureOverlay(settings);
  trackVideo();
  // Don't reveal the overlay until we actually have text — otherwise the user
  // sees an empty black padded box during the seconds before the first chunk.
}

function unmount() {
  overlayRecoveryObserver?.disconnect();
  overlayRecoveryObserver = null;
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  untrackVideo();
  stopNativeCaptions();
  // Belt-and-suspenders: remove every #kami-subs-overlay in the DOM, not just
  // the one we hold a ref to (defensive against orphans from previous loads).
  document.querySelectorAll('#' + OVERLAY_ID).forEach(n => n.remove());
  overlayEl = null;
  textEl = null;
  sourceEl = null;
}

function setText(text, raw, stage = 'final', provider = '') {
  ensureOverlay(overlaySettings);
  let t = (text || '').trim();
  const source = (raw || '').trim();
  if (!t && !source) {
    // Empty interim recognition must not erase the last readable subtitle.
    return;
  }
  const nextText = t;
  if (textEl.textContent !== nextText) textEl.textContent = nextText;
  if (sourceEl && sourceEl.textContent !== source) sourceEl.textContent = source;
  overlayEl.dataset.stage = !t && source ? 'source' : stage;
  overlayEl.classList.add('kami-visible');
  overlayEl.classList.remove('kami-error');
  positionOverlayOverVideo();
  // Keep the last line readable during model latency and pauses. Stop/unmount
  // clears it explicitly instead of repeatedly fading out between updates.
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
}

function showError(msg) {
  // Diagnostics belong in the control menu, never over the video.
}


chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return;
  switch (msg.type) {
    case 'ping':            sendResponse({ ok: true }); return true;
    case 'media:time':      sendResponse({ mediaTime: mediaTime() }); return true;
    case 'media:seek': {
      (async () => {
        const result = await chrome.runtime.sendMessage({ target: 'background', type: 'full:seek', seconds: Number(msg.seconds) }).catch(() => null);
        if (result?.ok) { sendResponse(result); return; }
        const media = trackedVideo || pickPrimaryVideo();
        if (!media || !Number.isFinite(Number(msg.seconds))) { sendResponse({ ok: false }); return; }
        media.currentTime = Math.max(0, Number(msg.seconds));
        sendResponse({ ok: true, mediaTime: media.currentTime });
      })();
      return true;
    }
    case 'captions:start':
      startNativeCaptions(msg.settings).then(sendResponse);
      return true;
    case 'captions:stop':   stopNativeCaptions(); break;
    case 'overlay:mount':   mount(msg.settings); sendResponse({ ok: true }); return true;
    case 'overlay:settings': overlaySettings = { ...overlaySettings, ...msg.settings }; applySettings(overlaySettings); positionOverlayOverVideo(); sendResponse({ ok: true }); return true;
    case 'overlay:unmount': unmount(); break;
    case 'overlay:text':    setText(msg.text, msg.raw, msg.stage, msg.provider); sendResponse({ ok: true }); return true;
    case 'overlay:clear':   overlayEl?.classList.remove('kami-visible'); sendResponse({ ok: true }); return true;
    case 'overlay:error':   showError(msg.message); sendResponse({ ok: true }); return true;
  }
});

// If the page loads while capture is already active, restore the overlay.
// The background verifies the sender tab; global storage alone would mount a
// live card on every unrelated tab when one course is being captured.
chrome.runtime.sendMessage({ target: 'background', type: 'overlay:resume' }).then(result => {
  if (!result?.active) return;
  mount(result.settings || {});
  if (result.lastOverlay) {
    const line = result.lastOverlay;
    setText(line.text, line.raw, line.stage, line.provider);
  }
}).catch(() => {});

// ---------------------------------------------------------------------------
// Recover saved captions on reopened tabs and playlist navigation. This request
// only reads archives; the background must never start a translation here.
let archiveRestoreBusy = false;
async function tryRestoreVideoArchive() {
  if (archiveRestoreBusy || document.visibilityState === 'hidden' || !document.querySelector('video,audio,iframe')) return;
  archiveRestoreBusy = true;
  try { await chrome.runtime.sendMessage({ target: 'background', type: 'library:restore' }); }
  catch { /* Content may outlive an extension reload. */ }
  finally { archiveRestoreBusy = false; }
}
document.addEventListener('loadedmetadata', tryRestoreVideoArchive, true);
document.addEventListener('play', tryRestoreVideoArchive, true);
document.addEventListener('visibilitychange', tryRestoreVideoArchive);
setTimeout(tryRestoreVideoArchive, 1500);
setInterval(tryRestoreVideoArchive, 10000);

// ---------------------------------------------------------------------------
// Page-level floating control. Chrome owns the toolbar-popup anchor, so this
// is a fixed bottom-right entry point, shared with the toolbar action.
// It lives in a shadow root to avoid inheriting styles from arbitrary sites.
// ---------------------------------------------------------------------------
const FLOATING_HOST_ID = 'quant-scholar-floating-control';

function mountFloatingMenu() {
  if (!document.documentElement) return;
  // Extension reloads invalidate the old isolated world but leave its DOM behind.
  document.getElementById(FLOATING_HOST_ID)?.remove();
  const host = document.createElement('div');
  host.id = FLOATING_HOST_ID;
  host.style.position = 'fixed';
  host.style.zIndex = '2147483646';
  host.style.bottom = 'max(20px, env(safe-area-inset-bottom))';
  host.style.right = 'max(20px, env(safe-area-inset-right))';
  host.style.pointerEvents = 'none';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      *, *::before, *::after { box-sizing:border-box; }
      .shell { position: relative; font: 13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif; color:#edf8fb; pointer-events:none; }
      .launcher { width:48px; height:48px; padding:0; display:grid; place-items:center; border:1px solid #2c3d47; border-radius:15px; color:#80e4d7; background:#101c23; box-shadow:0 4px 14px rgba(0,0,0,.18); cursor:pointer; user-select:none; pointer-events:auto; transition:opacity .2s, border-color .2s; }
      .launcher svg { width:29px; height:29px; fill:none; stroke-width:2.8; stroke-linecap:round; stroke-linejoin:round; }
      .launcher:hover { opacity:1!important; border-color:#68b9ae; }
      .launcher:focus-visible { opacity:1!important; outline:2px solid #68b9ae; outline-offset:3px; }
      .shell.idle .launcher { opacity:.55; }
      .shell.live .launcher { border-color:#68b9ae; }
      .panel { position:absolute; bottom:calc(100% + 20px); right:0; width:min(360px,calc(100vw - 40px - env(safe-area-inset-right))); height:min(700px,calc(100vh - 108px - env(safe-area-inset-bottom) - env(safe-area-inset-top))); height:min(700px,calc(100dvh - 108px - env(safe-area-inset-bottom) - env(safe-area-inset-top))); padding:0; border:1px solid #2c3d47; border-radius:14px; overflow:hidden; background:#101c23; box-shadow:0 12px 32px rgba(0,0,0,.24); pointer-events:auto; }
      .panel[hidden] { display:none; }
      .full-menu { display:block; width:100%; height:100%; border:0; background:#101c23; color-scheme:dark; }
    </style>
    <div class="shell">
      <button class="launcher" type="button" aria-label="打开翻译菜单" aria-expanded="false" aria-controls="translation-menu" title="翻译与学习"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 19.5 18.5 8a5 5 0 0 1 7 7L22 18.5" stroke="#68e6ce"/><path d="M25 12.5 13.5 24a5 5 0 0 1-7-7L10 13.5" stroke="#e0f1ef"/></svg></button>
      <section id="translation-menu" class="panel" hidden aria-label="Quant Scholar 网页翻译控制">
        <iframe class="full-menu" title="Quant Scholar 完整翻译菜单"></iframe>
      </section>
    </div>`;
  document.documentElement.appendChild(host);

  const shell = shadow.querySelector('.shell');
  const launcher = shadow.querySelector('.launcher');
  const panel = shadow.querySelector('.panel');
  const frame = shadow.querySelector('.full-menu');
  const menuUrl = chrome.runtime.getURL('popup/popup.html');
  let idleTimer = null;

  const wake = () => {
    shell.classList.remove('idle');
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (panel.hidden) shell.classList.add('idle');
    }, 4200);
  };
  const setPanelOpen = open => {
    panel.hidden = !open;
    launcher.setAttribute('aria-expanded', String(open));
    launcher.setAttribute('aria-label', open ? '关闭翻译菜单' : '打开翻译菜单');
    frame.src = open ? menuUrl : 'about:blank';
    if (open) refreshStatus();
    wake();
  };
  const refreshStatus = async () => {
    try {
      const result = await chrome.runtime.sendMessage({ target: 'background', type: 'capture:status' });
      const live = Boolean(result?.isCapturing);
      shell.classList.toggle('live', live);
    } catch (_error) { /* service worker may be restarting */ }
  };

  refreshStatus();
  wake();
  launcher.addEventListener('click', () => setPanelOpen(panel.hidden));
  shell.addEventListener('pointerenter', wake);
  setInterval(() => { if (!panel.hidden) refreshStatus(); }, 1800);
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'floating:toggle-menu') {
      setPanelOpen(panel.hidden);
      sendResponse({ ok: true, open: !panel.hidden });
      return true;
    }
    if (message?.type === 'floating:close-menu') {
      setPanelOpen(false);
      sendResponse({ ok: true });
      return true;
    }
  });
}

mountFloatingMenu();
})();
