// Kami Subs — content script
// Mounts a subtitle overlay anchored over the most likely active video element.

const OVERLAY_ID = 'kami-subs-overlay';
const MAX_VISIBLE_CHARS = 180;
// Clear the overlay this long after the last transcript update. While someone's
// talking, updates land ~every second and keep resetting this timer, so the
// line stays put; it only fades once speech actually stops for a few seconds.
const CLEAR_AFTER_MS = 4000;

let overlayEl = null;
let textEl = null;
let sourceEl = null;
let hideTimer = null;
let trackedVideo = null;
let resizeObserver = null;
let scrollHandler = null;
let nativeCaptionObserver = null;
let nativeTrackBindings = [];
let lastNativeCaption = '';
let nativeCaptionSettings = {};
let domCaptionTimer = null;
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
  const nodes = CAPTION_SELECTORS.flatMap(selector => Array.from(document.querySelectorAll(selector)));
  const visible = nodes.filter(node => {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  });
  const value = visible.map(node => node.textContent || '').join(' ').replace(/\s+/g, ' ').trim();
  if (value && value !== lastNativeCaption) {
    if (domCaptionTimer) clearTimeout(domCaptionTimer);
    domCaptionTimer = setTimeout(() => {
      emitNativeCaption(value, location.hostname.includes('youtube.com') ? 'youtube-dom' : 'player-dom');
      domCaptionTimer = null;
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
  if (hasTrack || readDomCaption()) return { ok: true, provider: hasTrack ? 'html5-texttrack' : 'player-dom' };

  const deadline = Date.now() + (location.hostname.includes('youtube.com') ? 6500 : 2200);
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 200));
    if (bindHtml5TextTrack() || readDomCaption() || youtubeTimedTextCues.length) {
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
  // If we hold a reference that's still in the DOM, reuse it.
  if (overlayEl && overlayEl.isConnected) {
    const host = currentOverlayHost();
    if (overlayEl.parentNode !== host) host.appendChild(overlayEl);
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
  applySettings(settings || {});
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
}

function positionOverlayOverVideo() {
  if (!overlayEl) return;
  // Viewport-anchored positioning works reliably in every layout:
  // tall pages, fullscreen players, iframes, weird custom skins, etc.
  // Trying to follow the video element's bounding box ends up offscreen
  // whenever the player is taller than the viewport or scrolls oddly.
  overlayEl.style.left = '50%';
  overlayEl.style.transform = 'translateX(-50%)';
  overlayEl.style.width = 'min(86vw, 1200px)';
  if ((overlayEl.dataset.position || 'bottom') === 'top') {
    overlayEl.style.top = '6vh';
    overlayEl.style.bottom = '';
  } else {
    overlayEl.style.bottom = '8vh';
    overlayEl.style.top = '';
  }
}

function trackVideo() {
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

function setText(text, raw) {
  if (!overlayEl) ensureOverlay({});
  let t = (text || '').trim();
  if (!t) {
    // Empty transcript — hide instead of showing a blank black box.
    overlayEl.classList.remove('kami-visible');
    textEl.textContent = '';
    if (sourceEl) sourceEl.textContent = '';
    return;
  }
  if (t.length > MAX_VISIBLE_CHARS) t = '…' + t.slice(-MAX_VISIBLE_CHARS);
  textEl.textContent = t;
  if (sourceEl) sourceEl.textContent = (raw || '').trim();
  overlayEl.classList.add('kami-visible');
  positionOverlayOverVideo();
  // Reset the idle clear-timer on every update. The line persists through the
  // gaps between chunks but disappears once speech stops for CLEAR_AFTER_MS.
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (overlayEl) {
      overlayEl.classList.remove('kami-visible');
      if (textEl) textEl.textContent = '';
    }
    hideTimer = null;
  }, CLEAR_AFTER_MS);
}

function showError(msg) {
  if (!overlayEl) ensureOverlay({});
  textEl.textContent = '⚠ ' + msg;
  overlayEl.classList.add('kami-visible', 'kami-error');
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (overlayEl) overlayEl.classList.remove('kami-error');
  }, 4000);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return;
  switch (msg.type) {
    case 'ping':            sendResponse({ ok: true }); return true;
    case 'media:time':      sendResponse({ mediaTime: mediaTime() }); return true;
    case 'media:seek': {
      const media = trackedVideo || pickPrimaryVideo();
      if (!media || !Number.isFinite(Number(msg.seconds))) {
        sendResponse({ ok: false });
        return true;
      }
      media.currentTime = Math.max(0, Number(msg.seconds));
      sendResponse({ ok: true, mediaTime: media.currentTime });
      return true;
    }
    case 'captions:start':
      startNativeCaptions(msg.settings).then(sendResponse);
      return true;
    case 'captions:stop':   stopNativeCaptions(); break;
    case 'overlay:mount':   mount(msg.settings); break;
    case 'overlay:unmount': unmount(); break;
    case 'overlay:text':    setText(msg.text, msg.raw); break;
    case 'overlay:error':   showError(msg.message); break;
  }
});

// If the page loads while capture is already active, restore the overlay.
chrome.storage.local.get(['isCapturing', 'activeTabId', 'settings'], (s) => {
  if (s && s.isCapturing) mount(s.settings || {});
});
