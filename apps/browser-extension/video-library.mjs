// Per-video recovery is separate from model execution. Loading never translates.
export function normalizeSignature(value) {
  try {
    const parts = JSON.parse(value);
    if (!Array.isArray(parts) || parts.length !== 6 || parts[0] !== 'cue-alignment-v2') return value;
    if (parts[5] === 'codex') parts[5] = 'codex_subscription';
    return JSON.stringify(parts);
  } catch { return value; }
}

export async function archiveKey(url, identity, signature) {
  const page = new URL(url);
  if (!['http:', 'https:'].includes(page.protocol) || page.username || page.password || !identity || /^(blob:|data:)/i.test(identity))
    throw new Error('播放器缺少稳定视频编号，暂不能自动恢复存档');
  const value = JSON.stringify([page.origin, identity, normalizeSignature(signature)]);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function matchingArchive(session, url, identity, signature, duration) {
  try {
    return new URL(session.url).origin === new URL(url).origin && session.full?.identity === identity
      && normalizeSignature(session.full.signature) === normalizeSignature(signature)
      && Number.isFinite(session.full.duration) && Math.abs(session.full.duration - duration) <= 2
      && session.segments?.length > 0 && session.segments.length <= 8000
      && session.segments.every(s => s.timingVersion === 2 && typeof s.source === 'string'
        && typeof s.translation === 'string' && Number.isFinite(s.mediaTime) && Number.isFinite(s.end)
        && s.mediaTime >= 0 && s.end > s.mediaTime && s.end <= duration + 5);
  } catch { return false; }
}

const translated = session => session.segments.filter(s => s.translation.trim()).length;
const clone = value => JSON.parse(JSON.stringify(value));

export async function lookupArchive({ url, identity, signature, duration }, chromeApi, endpoint, fetcher = fetch) {
  if (!chromeApi?.storage?.local?.get) return null;
  let key;
  try { key = await archiveKey(url, identity, signature); } catch { return null; }
  const storageKey = 'videoArchive:' + key;
  const stored = await chromeApi.storage.local.get([storageKey, 'currentLearningSession']);
  let candidates = [stored[storageKey], stored.currentLearningSession].filter(s => matchingArchive(s, url, identity, signature, duration));
  if (!candidates.length) {
    // Lazy migration of archives written by earlier versions. Never delete them.
    const all = await chromeApi.storage.local.get(null);
    candidates = Object.entries(all).filter(([name, s]) => name.startsWith('learningArchive:') && matchingArchive(s, url, identity, signature, duration)).map(([, s]) => s);
  }
  if (candidates.length) {
    const found = candidates.sort((a, b) => translated(b) - translated(a))[0];
    await chromeApi.storage.local.set({ [storageKey]: found });
    return clone(found);
  }
  try {
    const response = await fetcher(`${endpoint}/library/videos/lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, identity, signature, duration }), signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    const { session } = await response.json();
    if (!matchingArchive(session, url, identity, signature, duration)) return null;
    await chromeApi.storage.local.set({ [storageKey]: session });
    return clone(session);
  } catch { return null; } // Browser cache still works when the local server is off.
}

export async function saveArchive(session, chromeApi, endpoint, fetcher = fetch) {
  if (!session?.full || !session.segments?.length) return null;
  const snapshot = clone(session);
  const key = await archiveKey(snapshot.url, snapshot.full.identity, snapshot.full.signature);
  snapshot.full.signature = normalizeSignature(snapshot.full.signature);
  // Include pending request IDs in browser recovery, but never in the document.
  await chromeApi.storage.local.set({ ['videoArchive:' + key]: snapshot });
  delete snapshot.full.pending;
  const response = await fetcher(`${endpoint}/library/videos/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot), signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`字幕已缓存，本地 MD 保存失败（HTTP ${response.status}）；请启动更新后的服务后重试保存`);
  const result = await response.json();
  if (!result.ok || typeof result.path !== 'string') throw new Error('字幕已缓存，本地服务未确认 MD 保存成功');
  return result;
}

export function restoredSession(saved, tab, frameId) {
  const session = clone(saved);
  session.url = tab.url;
  session.full = { ...session.full, tabId: tab.id, frameId,
    status: session.segments.every(s => s.translation.trim()) ? 'complete' : 'paused',
    preparationPaused: true, syncEnabled: true, restored: true, error: '', nextPollAt: 0 };
  delete session.full.engineCheckedAt;
  delete session.full.jobId;
  return session;
}
