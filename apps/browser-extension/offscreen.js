// Kami Subs — offscreen document
// Captures tab audio via the streamId provided by background.js,
// chunks it into ~3s windows, sends as 16kHz mono PCM over WebSocket to the backend,
// forwards transcripts back to background.js -> content overlay.

let mediaStream = null;
let audioContext = null;
let sourceNode = null;
let processorNode = null;
let passthroughGain = null;
let ws = null;
let settings = null;
let isRunning = false;          // true between start() and stop()
let reconnectAttempts = 0;
let reconnectTimer = null;
let audioDiagnosticTimer = null;
let chunksSent = 0;
let lastAudioAt = 0;
let captureSessionId = null;
let finishFlush = null;
let transcriptDelivery = Promise.resolve();
let stopping = false;
let socketSequence = 0;
let deliveryError = '';
const MAX_RECONNECT_DELAY_MS = 5000;

// We buffer 16kHz mono Float32 samples until we hit CHUNK_SECONDS, then emit a chunk.
// Three seconds give ASR more acoustic context than isolated one-second
// fragments. Text buffering cannot recover words that recognition discarded.
const TARGET_SAMPLE_RATE = 16000;
const CHUNK_SECONDS = 3.0;
const CHUNK_SAMPLES = TARGET_SAMPLE_RATE * CHUNK_SECONDS;
let chunkBuffer = new Float32Array(0);

function concatFloat32(a, b) {
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

// Naive linear-interpolation resampler (input rate -> 16kHz).
// For tighter quality swap in an OfflineAudioContext resample later.
function resampleTo16k(input, inputRate) {
  if (inputRate === TARGET_SAMPLE_RATE) return input;
  const ratio = inputRate / TARGET_SAMPLE_RATE;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, input.length - 1);
    const t = srcIdx - lo;
    out[i] = input[lo] * (1 - t) + input[hi] * t;
  }
  return out;
}

function float32ToInt16(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function scheduleReconnect() {
  if (!isRunning) return;            // user hit Stop; don't reconnect
  if (reconnectTimer) return;        // already scheduled
  reconnectAttempts += 1;
  // Exponential backoff capped at 5s: 250, 500, 1000, 2000, 5000, 5000...
  const delay = Math.min(MAX_RECONNECT_DELAY_MS, 250 * Math.pow(2, reconnectAttempts - 1));
  console.warn('[kami-subs offscreen] WS reconnect in', delay, 'ms (attempt', reconnectAttempts + ')');
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (isRunning) openSocket();
  }, delay);
}

function openSocket() {
  chrome.runtime.sendMessage({ target: 'background', type: 'ws:state', state: 'connecting' });
  const url = (settings && settings.backendUrl) || 'ws://127.0.0.1:8765/ws';
  const socket = new WebSocket(url);
  const sessionId = captureSessionId;
  const streamId = ++socketSequence;
  ws = socket;
  socket.binaryType = 'arraybuffer';

  socket.addEventListener('open', () => {
    if (!isRunning || ws !== socket) return;
    reconnectAttempts = 0;
    ws.send(JSON.stringify({
      type: 'config',
      sampleRate: TARGET_SAMPLE_RATE,
      sourceLang: (settings && settings.sourceLang) || 'auto',
      targetLang: (settings && settings.targetLang) || 'zh',
      task: 'transcribe', // Keep the original language; the chosen model translates it.
      domain: (settings && settings.domain) || 'auto',
      translator: (settings && settings.translator) || 'kimi_subscription',
      translationMode: (settings && settings.translationMode) || 'professional'
    }));
    chrome.runtime.sendMessage({ target: 'background', type: 'ws:state', state: 'connected' });
    sendChunkIfReady();
  });

  socket.addEventListener('message', (evt) => {
    if (!isRunning || ws !== socket) return;
    try {
      const data = JSON.parse(evt.data);
      if (data.type === 'transcript') {
        transcriptDelivery = transcriptDelivery.catch(() => {}).then(() => chrome.runtime.sendMessage({
          target: 'background',
          type: 'transcript',
          sessionId,
          text: data.text,
          raw: data.raw || '',
          detectedLang: data.detectedLang || 'auto',
          chunkId: data.chunkId,
          recordId: `${sessionId}:audio:${streamId}:${data.chunkId}`,
          isFinal: !!data.isFinal,
          stage: data.stage || (data.isFinal ? 'final' : 'source'),
          provider: data.provider || ''
        })).then(result => {
          if (result?.ok === false) { deliveryError = result.error || '部分识别记录未能保存，请检查扩展存储空间'; }
        }).catch(error => { deliveryError = '学习记录传递失败：' + error.message; });
      } else if (data.type === 'flushed') {
        transcriptDelivery.then(() => finishFlush?.());
      } else if (data.type === 'error') {
        chrome.runtime.sendMessage({
          target: 'background',
          type: 'backend:error',
          message: data.message
        });
      }
    } catch (e) {
      console.warn('[kami-subs offscreen] bad ws msg', e);
    }
  });

  socket.addEventListener('error', () => {
    if (!isRunning || ws !== socket) return;
    chrome.runtime.sendMessage({ target: 'background', type: 'ws:state', state: 'error' });
    // Don't spam the overlay with errors on transient drops — only the initial
    // connect failure should surface as user-visible. After we've succeeded
    // once (reconnectAttempts started at 0 and got bumped here), reconnect
    // silently in the background.
    if (reconnectAttempts === 0) {
      chrome.runtime.sendMessage({
        target: 'background',
        type: 'backend:error',
        message: '无法连接音频识别服务，请检查本地服务是否运行及服务地址：' + url
      });
    }
  });

  socket.addEventListener('close', () => {
    if (!isRunning || ws !== socket) return;
    chrome.runtime.sendMessage({ target: 'background', type: 'ws:state', state: 'closed' });
    // If we're still supposed to be running, try to come back. The server
    // session can die without the process dying (one bad chunk → WS closes
    // but uvicorn keeps listening). Reconnect re-attaches to the same server.
    scheduleReconnect();
  });
}

function sendChunkIfReady() {
  // Do not consume the buffer before a usable socket exists.
  while (chunkBuffer.length >= CHUNK_SAMPLES && ws?.readyState === WebSocket.OPEN) {
    const chunk = chunkBuffer.slice(0, CHUNK_SAMPLES);
    chunkBuffer = chunkBuffer.slice(CHUNK_SAMPLES);
    const pcm16 = float32ToInt16(chunk);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(pcm16.buffer);
      chunksSent += 1;
    }
  }
}

async function start(streamId, incomingSettings, sessionId) {
  if (isRunning) throw new Error('音频采集已在运行');
  captureSessionId = sessionId;
  settings = incomingSettings || {};
  isRunning = true;
  stopping = false;
  transcriptDelivery = Promise.resolve();
  deliveryError = '';
  reconnectAttempts = 0;
  chunksSent = 0;
  lastAudioAt = 0;
  chrome.runtime.sendMessage({ target: 'background', type: 'ws:state', state: 'connecting' });

  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    },
    video: false
  });

  audioContext = new AudioContext();
  if (audioContext.state === 'suspended') await audioContext.resume();
  sourceNode = audioContext.createMediaStreamSource(mediaStream);

  // Keep the user hearing the tab audio (capture mutes the tab by default).
  passthroughGain = audioContext.createGain();
  passthroughGain.gain.value = 1.0;
  sourceNode.connect(passthroughGain).connect(audioContext.destination);

  // Mono mixdown + buffer for chunked send.
  // ScriptProcessorNode is deprecated but works reliably in offscreen contexts
  // without requiring an extra worklet file. Swap to AudioWorklet later if needed.
  processorNode = audioContext.createScriptProcessor(4096, 2, 1);
  processorNode.onaudioprocess = (e) => {
    if (stopping) return;
    const inBuf = e.inputBuffer;
    const ch0 = inBuf.getChannelData(0);
    const ch1 = inBuf.numberOfChannels > 1 ? inBuf.getChannelData(1) : ch0;
    const mono = new Float32Array(ch0.length);
    let peak = 0;
    for (let i = 0; i < ch0.length; i++) { mono[i] = (ch0[i] + ch1[i]) * 0.5; peak = Math.max(peak, Math.abs(mono[i])); }
    if (peak > 0.002) lastAudioAt = Date.now();
    const resampled = resampleTo16k(mono, audioContext.sampleRate);
    chunkBuffer = concatFloat32(chunkBuffer, resampled);
    sendChunkIfReady();
  };
  sourceNode.connect(processorNode);
  // Connect processor to destination with zero gain to keep it running without double audio.
  const sink = audioContext.createGain();
  sink.gain.value = 0;
  processorNode.connect(sink).connect(audioContext.destination);

  openSocket();
  audioDiagnosticTimer = setInterval(() => {
    chrome.runtime.sendMessage({ target: 'background', type: 'capture:audio', chunksSent, lastAudioAt, audioState: audioContext?.state || 'closed' }).catch(() => {});
  }, 1500);
}

async function stop() {
  stopping = true;
  // Release capture immediately, but keep the socket alive long enough to
  // submit the final partial chunk and persist queued source/translation pairs.
  try { if (processorNode) processorNode.disconnect(); } catch (e) {}
  try { if (mediaStream) mediaStream.getTracks().forEach(t => t.stop()); } catch (e) {}
  let drainError = '';
  if (isRunning && ws && ws.readyState === WebSocket.OPEN) {
    if (chunkBuffer.length) { ws.send(float32ToInt16(chunkBuffer).buffer); chunkBuffer = new Float32Array(0); }
    await new Promise(resolve => {
      const timer = setTimeout(() => { drainError = '停止时处理超时，部分音频可能未识别完成；请保留右栏待补译原文，并暂停视频后检查。'; finishFlush = null; resolve(); }, 180000);
      finishFlush = () => { clearTimeout(timer); finishFlush = null; resolve(); };
      ws.send(JSON.stringify({ type: 'flush' }));
    });
  } else if (chunkBuffer.length) {
    drainError = '连接中断，缓存音频尚未识别。此次记录不完整，请重播中断部分。';
  }
  // Flip this FIRST so the WS close handler doesn't schedule a reconnect
  // against a deliberate teardown.
  isRunning = false;
  if (audioDiagnosticTimer) { clearInterval(audioDiagnosticTimer); audioDiagnosticTimer = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  reconnectAttempts = 0;

  try { if (processorNode) processorNode.disconnect(); } catch (e) {}
  try { if (sourceNode) sourceNode.disconnect(); } catch (e) {}
  try { if (passthroughGain) passthroughGain.disconnect(); } catch (e) {}
  try { if (audioContext) await audioContext.close(); } catch (e) {}
  try { if (mediaStream) mediaStream.getTracks().forEach(t => t.stop()); } catch (e) {}
  try { if (ws) { const socket = ws; ws = null; socket.close(); } } catch (e) {}

  mediaStream = null;
  audioContext = null;
  sourceNode = null;
  processorNode = null;
  passthroughGain = null;
  ws = null;
  chunkBuffer = new Float32Array(0);
  return drainError || deliveryError;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;
  (async () => {
    try {
      if (msg.type === 'start') {
        await start(msg.streamId, msg.settings, msg.sessionId);
        sendResponse({ ok: true });
      } else if (msg.type === 'stop') {
        const warning = await stop();
        sendResponse({ ok: true, warning });
      }
    } catch (err) {
      await stop();
      console.error('[kami-subs offscreen]', err);
      sendResponse({ ok: false, error: String(err) });
    }
  })();
  return true;
});
