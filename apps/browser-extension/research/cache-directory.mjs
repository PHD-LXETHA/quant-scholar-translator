const DB_NAME = "researchlens-cache-directory";
const STORE_NAME = "settings";
const HANDLE_KEY = "active-directory";
const FILE_PREFIX = "researchlens-session-";

function openDirectoryDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开缓存目录设置"));
  });
}

async function directorySetting(mode, operation) {
  const db = await openDirectoryDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("缓存目录设置操作失败"));
    });
  } finally { db.close(); }
}

async function getDirectoryHandle() {
  return directorySetting("readonly", store => store.get(HANDLE_KEY));
}

async function hasPermission(handle, mode = "read") {
  if (!handle) return false;
  try { return await handle.queryPermission({ mode }) === "granted"; }
  catch { return false; }
}

export function externalCacheFileName(key) {
  const safe = String(key || "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 180);
  return `${FILE_PREFIX}${safe || "unknown"}.json`;
}

export function supportsCacheDirectoryPicker() {
  return typeof globalThis.showDirectoryPicker === "function";
}

export async function chooseCacheDirectory() {
  if (!supportsCacheDirectoryPicker()) throw new Error("当前浏览器不支持自定义缓存目录，请升级 Chrome 或 Edge");
  const handle = await globalThis.showDirectoryPicker({ id: "researchlens-cache", mode: "readwrite", startIn: "documents" });
  const permission = await handle.requestPermission({ mode: "readwrite" });
  if (permission !== "granted") throw new Error("没有获得所选目录的读写权限");
  await directorySetting("readwrite", store => store.put(handle, HANDLE_KEY));
  await chrome.storage.local.set({ cacheDirectoryName: handle.name, cacheDirectoryEnabled: true });
  return { name: handle.name, permission: "granted" };
}

export async function clearCacheDirectory() {
  await directorySetting("readwrite", store => store.delete(HANDLE_KEY));
  await chrome.storage.local.set({ cacheDirectoryName: "", cacheDirectoryEnabled: false });
}

export async function getCacheDirectoryInfo() {
  if (!supportsCacheDirectoryPicker()) return { supported: false, configured: false, name: "", permission: "unsupported" };
  const handle = await getDirectoryHandle().catch(() => null);
  if (!handle) return { supported: true, configured: false, name: "", permission: "none" };
  const permission = await handle.queryPermission({ mode: "readwrite" }).catch(() => "prompt");
  return { supported: true, configured: true, name: handle.name || "已选择目录", permission };
}

export async function putExternalTranslationSession(record) {
  const handle = await getDirectoryHandle().catch(() => null);
  if (!await hasPermission(handle, "readwrite")) return false;
  const fileHandle = await handle.getFileHandle(externalCacheFileName(record.key), { create: true });
  const writable = await fileHandle.createWritable();
  try { await writable.write(JSON.stringify(record)); }
  finally { await writable.close(); }
  return true;
}

export async function syncInternalTranslationSessions() {
  if (typeof indexedDB.databases !== "function") return 0;
  const databases = await indexedDB.databases();
  if (!databases.some(database => database.name === "researchlens-reader-state")) return 0;
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("researchlens-reader-state");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法读取现有文献缓存"));
  });
  let sessions = [];
  try {
    if (!db.objectStoreNames.contains("sessions")) return 0;
    sessions = await new Promise((resolve, reject) => {
      const request = db.transaction("sessions", "readonly").objectStore("sessions").getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error("无法读取现有文献缓存"));
    });
  } finally { db.close(); }
  let saved = 0;
  for (const session of sessions) if (await putExternalTranslationSession(session).catch(() => false)) saved += 1;
  return saved;
}

function validSession(value) {
  return value && typeof value.key === "string" && Array.isArray(value.pages) ? value : null;
}

export async function getExternalTranslationSession(key) {
  const handle = await getDirectoryHandle().catch(() => null);
  if (!await hasPermission(handle, "read")) return null;
  try {
    const fileHandle = await handle.getFileHandle(externalCacheFileName(key));
    return validSession(JSON.parse(await (await fileHandle.getFile()).text()));
  } catch { return null; }
}

export async function listExternalTranslationSessions() {
  const handle = await getDirectoryHandle().catch(() => null);
  if (!await hasPermission(handle, "read")) return [];
  const sessions = [];
  try {
    for await (const [name, entry] of handle.entries()) {
      if (entry.kind !== "file" || !name.startsWith(FILE_PREFIX) || !name.endsWith(".json")) continue;
      try {
        const session = validSession(JSON.parse(await (await entry.getFile()).text()));
        if (session) sessions.push(session);
      } catch {}
    }
  } catch {}
  return sessions;
}

export async function deleteExternalDocumentSessions(documentKeys) {
  const handle = await getDirectoryHandle().catch(() => null);
  if (!await hasPermission(handle, "readwrite")) return 0;
  const keys = new Set(Array.isArray(documentKeys) ? documentKeys : [documentKeys]);
  let deleted = 0;
  for (const session of await listExternalTranslationSessions()) {
    const exact = keys.has(session.documentKey) || [...keys].some(key => String(session.key || "").startsWith(`${key}:`));
    if (!exact) continue;
    try { await handle.removeEntry(externalCacheFileName(session.key)); deleted += 1; } catch {}
  }
  return deleted;
}

export async function cleanupExternalTranslationSessions(cutoff) {
  const handle = await getDirectoryHandle().catch(() => null);
  if (!await hasPermission(handle, "readwrite")) return 0;
  let deleted = 0;
  for (const session of await listExternalTranslationSessions()) {
    if ((session.updatedAt || 0) >= cutoff) continue;
    try { await handle.removeEntry(externalCacheFileName(session.key)); deleted += 1; } catch {}
  }
  return deleted;
}
