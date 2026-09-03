import { BATTERY_GLOSSARY_PRESET, formatGlossaryPrompt } from "./glossary.mjs";
import { isRetryableApiStatus, retryDelayMs, sleep } from "./api-retry.mjs";
import { providerNeedsApiKey } from "./provider-presets.mjs";
import { isLikelyUntranslated, isSourcePreservingContent } from "./translation-quality.mjs";

const DEFAULTS = {
  provider: "kimi_subscription",
  endpoint: "http://127.0.0.1:8765/kimi/v1/chat/completions",
  apiKey: "",
  model: "kimi-subscription",
  apiStyle: "chat",
  targetLanguage: "简体中文",
  batchChars: 6500,
  glossaryTerms: BATTERY_GLOSSARY_PRESET,
  prompt: `你是 Quant Scholar 专业学术翻译引擎，擅长金融、量化金融、经济学、计量经济学、统计学、数学、计算机科学和跨学科科研论文。将输入内容翻译为{targetLanguage}。
要求：
1. 忠实、准确、简洁，保持论文的逻辑关系与学术语气，不擅自解释、总结或补充结论。
2. 完整保留公式、变量、上下标、单位、数值、百分比、日期、回归系数、显著性标记、证券代码、引用编号、DOI、图表编号和代码标识符。
3. 金融语境区分 return（收益率）、yield（收益率）、duration（久期）等专业含义；统计和计量语境保持 estimator、identification、stationarity 等概念一致。
4. 数学表达式、LaTeX、MathML、代码块和行内代码不得改写；公认缩写首次出现时可补充中文，后续保持缩写。
5. 对存在多种标准译法且会影响理解的术语，首次出现可保留英文原词。
6. 输入中的每段文字都有唯一 id。必须原样返回该 id，不能拆分、合并、增加或删除条目。`
};
const MAX_TRANSLATION_RETRY_DEPTH = 4;
const MAX_UNTRANSLATED_RETRY_DEPTH = 2;
const MAX_TRANSLATION_OUTPUT_TOKENS = 8192;
const KIMI_DEFAULT_MIGRATION_KEY = "quantScholarKimiDefaultV1";

chrome.runtime.onInstalled.addListener(async () => {
  const saved = await chrome.storage.local.get([
    ...Object.keys(DEFAULTS),
    KIMI_DEFAULT_MIGRATION_KEY,
  ]);
  const missing = {};
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (saved[key] === undefined) missing[key] = value;
  }
  const usedPreviousBundledDefault =
    !saved[KIMI_DEFAULT_MIGRATION_KEY] &&
    saved.provider === "deepseek" &&
    saved.endpoint === "https://api.deepseek.com/chat/completions" &&
    (!saved.model || /^deepseek-/i.test(saved.model));
  if (usedPreviousBundledDefault) {
    Object.assign(missing, {
      provider: DEFAULTS.provider,
      endpoint: DEFAULTS.endpoint,
      model: DEFAULTS.model,
      apiStyle: DEFAULTS.apiStyle,
      // Never reuse a credential with a different provider.
      apiKey: "",
    });
  }
  missing[KIMI_DEFAULT_MIGRATION_KEY] = true;
  await chrome.storage.local.set(missing);
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: "researchlens-translate-selection", title: "使用 Quant Scholar 翻译选中文字", contexts: ["selection"] });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "researchlens-translate-selection" || !tab?.id || !info.selectionText?.trim()) return;
  chrome.tabs.sendMessage(tab.id, { type: "QUICK_TRANSLATE_SELECTION", text: info.selectionText.trim() }).catch(() => {});
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-translation") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_TRANSLATION" }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "TRANSLATE_BATCH") {
    translateBatch(message.texts, message.roles).then(
      (translations) => sendResponse({ ok: true, translations }),
      (error) => sendResponse({
        ok: false,
        error: friendlyError(error),
        retryable: Boolean(error?.retryable),
        status: Number(error?.status) || 0,
        code: error?.code || "",
        stage: error?.stage || "batch-json",
        attempts: Array.isArray(error?.attempts) ? error.attempts : [],
        failedIndices: Array.isArray(error?.failedIndices) ? error.failedIndices : [],
        translations: Array.isArray(error?.partialTranslations) ? error.partialTranslations : []
      })
    );
    return true;
  }
  if (message?.type === "FETCH_PDF") {
    fetchPdfForViewer(message.url).then(
      (result) => sendResponse({ ok: true, ...result }),
      (error) => sendResponse({ ok: false, error: friendlyError(error), code: error?.code || "", articleUrl: error?.articleUrl || "" })
    );
    return true;
  }
  return false;
});

const PDF_HEADER_RULE_ID = 41021;
const MAX_PDF_CANDIDATES = 16;
const MAX_DISCOVERY_HTML_BYTES = 2 * 1024 * 1024;

async function fetchPdfForViewer(url) {
  const source = new URL(String(url));
  if (source.protocol === "file:") return fetchLocalPdfForViewer(source);
  if (!/^https?:$/.test(source.protocol)) throw new Error("只支持 HTTP/HTTPS 论文地址或本地 PDF 文件");
  const queue = uniqueUrls([source.href, ...publisherPdfCandidates(source)]);
  const visited = new Set();
  const failures = [];
  let foundReaderShell = false;
  let publisherChallenge = null;
  try {
    while (queue.length && visited.size < MAX_PDF_CANDIDATES) {
      const candidate = queue.shift();
      if (visited.has(candidate)) continue;
      visited.add(candidate);
      let response;
      try {
        response = await fetchPdfCandidate(candidate, source.href);
      } catch (error) {
        failures.push(error?.message || String(error));
        continue;
      }
      if (!response.ok) {
        failures.push(`HTTP ${response.status}`);
        continue;
      }
      const data = await response.arrayBuffer();
      if (hasPdfHeader(data)) {
        const key = `pdf-${Date.now()}-${crypto.randomUUID()}`;
        const finalUrl = response.url || candidate;
        await putPdfCache(key, data, finalUrl);
        return { key, size: data.byteLength, finalUrl, sourceUrl: source.href, attempts: visited.size };
      }
      if (!data.byteLength) {
        failures.push("返回内容为空");
        continue;
      }
      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      if (contentType.includes("html") || looksLikeHtml(data)) {
        foundReaderShell = true;
        const html = new TextDecoder("utf-8").decode(data.slice(0, MAX_DISCOVERY_HTML_BYTES));
        const discovered = discoverPdfUrls(html, response.url || candidate);
        for (const discoveredUrl of discovered) {
          if (!visited.has(discoveredUrl) && !queue.includes(discoveredUrl)) queue.push(discoveredUrl);
        }
        continue;
      }
      failures.push(`返回了 ${contentType || "未知格式"}`);
    }

    // Try the exact URL first: publisher caches and access tokens are often tied to its query string.
    const bridgeCandidates = uniqueUrls([...visited, ...publisherPdfCandidates(source)])
      .filter(value => isPdfLikeUrl(new URL(value))).slice(0, 6);
    for (const candidate of bridgeCandidates) {
      try {
        const bridged = await fetchPdfThroughPublisherPage(candidate, source);
        if (!hasPdfHeader(bridged.data)) continue;
        const key = `pdf-${Date.now()}-${crypto.randomUUID()}`;
        await putPdfCache(key, bridged.data, bridged.finalUrl);
        return { key, size: bridged.data.byteLength, finalUrl: bridged.finalUrl, sourceUrl: source.href, attempts: visited.size, viaPage: true };
      } catch (error) {
        if (error?.code === "PUBLISHER_CHALLENGE") publisherChallenge = error;
        failures.push(error?.message || String(error));
      }
    }
    if (publisherChallenge) throw publisherChallenge;
    const suffix = failures.length ? `（${failures.at(-1)}）` : "";
    if (foundReaderShell) throw new Error(`已识别论文增强阅读器，但未能取得真实 PDF${suffix}。请确认已登录/已通过校园权限，或先用站点的下载按钮保存 PDF。`);
    throw new Error(`无法取得真实 PDF${suffix}。可能需要登录、校园权限或人机验证。`);
  } finally {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [PDF_HEADER_RULE_ID] }).catch(() => {});
  }
}

async function fetchLocalPdfForViewer(source) {
  const allowed = await chrome.extension.isAllowedFileSchemeAccess();
  if (!allowed) {
    const error = new Error("尚未允许科研译镜读取本地文件。请在 Edge 扩展管理 → 科研译镜 → 详细信息中开启“允许访问文件 URL”，或点击阅读器顶部的“本地 PDF”手动选择文件。");
    error.code = "LOCAL_FILE_ACCESS_DENIED";
    throw error;
  }
  let response;
  try {
    response = await fetch(source.href, { method: "GET", cache: "no-store" });
  } catch {
    const error = new Error("无法读取这个本地 PDF。请确认文件仍在原位置，或点击阅读器顶部的“本地 PDF”重新选择文件。");
    error.code = "LOCAL_FILE_READ_FAILED";
    throw error;
  }
  if (!response.ok) {
    const error = new Error(`无法读取这个本地 PDF（${response.status || "文件访问失败"}）。`);
    error.code = "LOCAL_FILE_READ_FAILED";
    throw error;
  }
  const data = await response.arrayBuffer();
  if (!hasPdfHeader(data)) {
    const error = new Error("当前本地文件不是有效的 PDF，或文件已经损坏。");
    error.code = "INVALID_LOCAL_PDF";
    throw error;
  }
  const key = `pdf-${Date.now()}-${crypto.randomUUID()}`;
  await putPdfCache(key, data, source.href);
  return { key, size: data.byteLength, finalUrl: source.href, sourceUrl: source.href, attempts: 1, local: true };
}

async function fetchPdfThroughPublisherPage(pdfUrl, sourceUrl) {
  const target = new URL(pdfUrl);
  const helperUrl = publisherArticlePage(target) || publisherArticlePage(sourceUrl);
  if (!helperUrl || new URL(helperUrl).origin !== target.origin) throw new Error("没有可用的同站文章页面");
  const tabs = await chrome.tabs.query({});
  const expectedHelper = new URL(helperUrl);
  let helperTab = tabs.find(tab => {
    try {
      const current = new URL(tab.url || "");
      return current.origin === target.origin
        && current.pathname.replace(/\/$/, "") === expectedHelper.pathname.replace(/\/$/, "")
        && /^https?:$/.test(current.protocol)
        && !isPdfLikeUrl(current);
    } catch { return false; }
  });
  let created = false;
  if (!helperTab) {
    helperTab = await chrome.tabs.create({ url: helperUrl, active: false });
    created = true;
  }
  try {
    await waitForTabComplete(helperTab.id, 20000);
    const execution = await chrome.scripting.executeScript({
      target: { tabId: helperTab.id },
      world: "MAIN",
      func: fetchPdfInPageWorld,
      args: [target.href]
    });
    const payload = execution?.[0]?.result;
    if (!payload?.ok) {
      const error = new Error(payload?.error || `站内读取失败（HTTP ${payload?.status || "未知"}）`);
      if (payload?.code === "PUBLISHER_CHALLENGE") {
        error.code = "PUBLISHER_CHALLENGE";
        error.articleUrl = helperUrl;
      }
      throw error;
    }
    const bytes = new Uint8Array(payload.size);
    let offset = 0;
    for (const chunk of payload.chunks) {
      const binary = atob(chunk);
      for (let index = 0; index < binary.length; index++) bytes[offset++] = binary.charCodeAt(index);
    }
    return { data: bytes.buffer, finalUrl: payload.finalUrl || target.href };
  } finally {
    if (created && helperTab?.id) await chrome.tabs.remove(helperTab.id).catch(() => {});
  }
}

function publisherArticlePage(value) {
  const url = value instanceof URL ? value : new URL(value);
  const host = url.hostname.toLowerCase();
  const doi = url.pathname.match(/^\/doi\/(?:epdf|pdfdirect|pdf|full|abs)\/(10\..+)$/i)?.[1];
  if (doi) {
    if (host.endsWith("tandfonline.com")) return new URL(`/doi/full/${doi}`, url.origin).href;
    if (host.endsWith("onlinelibrary.wiley.com") || host.endsWith("pubs.acs.org") || host.endsWith("science.org") || host.endsWith("aip.org")) {
      return new URL(`/doi/${doi}`, url.origin).href;
    }
  }
  const pii = url.pathname.match(/\/science\/article\/pii\/([^/]+)/i)?.[1];
  if (pii && host.endsWith("sciencedirect.com")) return new URL(`/science/article/pii/${pii}`, url.origin).href;
  const springerDoi = url.pathname.match(/^\/content\/pdf\/(10\..+)\.pdf$/i)?.[1];
  if (springerDoi && host === "link.springer.com") return new URL(`/article/${springerDoi}`, url.origin).href;
  if (host.endsWith("nature.com") && /^\/articles\/[^/]+\.pdf$/i.test(url.pathname)) return new URL(url.pathname.replace(/\.pdf$/i, ""), url.origin).href;
  if (host.endsWith("rsc.org") && url.pathname.includes("/content/articlepdf/")) return new URL(url.pathname.replace("/content/articlepdf/", "/content/articlelanding/"), url.origin).href;
  const ieeeNumber = url.searchParams.get("arnumber") || url.pathname.match(/\/document\/(\d+)/)?.[1];
  if (ieeeNumber && host.endsWith("ieee.org")) return new URL(`/document/${ieeeNumber}`, url.origin).href;
  return null;
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("等待出版商文章页面超时")), timeoutMs);
    const listener = (updatedId, changeInfo) => {
      if (updatedId === tabId && changeInfo.status === "complete") finish();
    };
    function finish(error) {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      error ? reject(error) : resolve();
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then(tab => {
      if (tab.status === "complete") finish();
    }).catch(finish);
  });
}

async function fetchPdfInPageWorld(url) {
  try {
    // A PDF already displayed by Edge may be present in the publisher's HTTP cache even
    // when a second XHR is rejected. Reuse that successful response before going to network.
    const requestOptions = [
      { cache: "only-if-cached", mode: "same-origin" },
      { cache: "force-cache", mode: "same-origin" },
      { cache: "default", mode: "same-origin", headers: { Accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.1" } }
    ];
    let response = null, lastError = null, challenged = false;
    for (const options of requestOptions) {
      try {
        response = await fetch(url, { method: "GET", credentials: "include", redirect: "follow", referrer: location.href, ...options });
        challenged ||= response.headers?.get?.("cf-mitigated") === "challenge";
        if (response.ok) break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!response?.ok) {
      if (challenged) return { ok: false, status: response?.status || 403, code: "PUBLISHER_CHALLENGE", error: "ACS 要求先在正常论文页面完成人机验证或机构登录" };
      return { ok: false, status: response?.status || 0, error: response ? `站内请求仍被拒绝（HTTP ${response.status}）` : (lastError?.message || "站内请求失败") };
    }
    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > 40 * 1024 * 1024) return { ok: false, error: "PDF 超过 40 MB，请下载后从本地打开" };
    const data = await response.arrayBuffer();
    if (data.byteLength > 40 * 1024 * 1024) return { ok: false, error: "PDF 超过 40 MB，请下载后从本地打开" };
    const bytes = new Uint8Array(data);
    const head = new TextDecoder("ascii").decode(bytes.slice(0, Math.min(1024, bytes.length)));
    if (!head.includes("%PDF-")) return { ok: false, error: "站内请求返回的仍不是真实 PDF" };
    const chunks = [];
    const chunkSize = 32 * 1024;
    for (let start = 0; start < bytes.length; start += chunkSize) {
      const part = bytes.subarray(start, Math.min(bytes.length, start + chunkSize));
      chunks.push(btoa(String.fromCharCode.apply(null, part)));
    }
    return { ok: true, chunks, size: bytes.length, finalUrl: response.url || url };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

async function fetchPdfCandidate(url, referer) {
  const parsed = new URL(url);
  const escapedUrl = parsed.href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [PDF_HEADER_RULE_ID],
    addRules: [{
      id: PDF_HEADER_RULE_ID,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "Referer", operation: "set", value: safeReferer(referer, parsed.origin) },
          { header: "Origin", operation: "remove" }
        ]
      },
      condition: {
        regexFilter: `^${escapedUrl}$`,
        initiatorDomains: [chrome.runtime.id],
        resourceTypes: ["xmlhttprequest"]
      }
    }]
  });
  return fetch(parsed.href, {
    method: "GET",
    credentials: "include",
    redirect: "follow",
    cache: "no-store",
    headers: { Accept: "application/pdf,application/octet-stream;q=0.9,text/html;q=0.5,*/*;q=0.1" }
  });
}

function safeReferer(value, fallbackOrigin) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  } catch { return `${fallbackOrigin}/`; }
}

function hasPdfHeader(data) {
  if (data.byteLength < 5) return false;
  const bytes = new Uint8Array(data, 0, Math.min(data.byteLength, 1024));
  const marker = [0x25, 0x50, 0x44, 0x46, 0x2d];
  outer: for (let i = 0; i <= bytes.length - marker.length; i++) {
    for (let j = 0; j < marker.length; j++) if (bytes[i + j] !== marker[j]) continue outer;
    return true;
  }
  return false;
}

function looksLikeHtml(data) {
  const head = new TextDecoder("utf-8").decode(data.slice(0, Math.min(data.byteLength, 512))).trimStart().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html") || head.includes("<head");
}

function publisherPdfCandidates(url) {
  const host = url.hostname.toLowerCase();
  const path = url.pathname;
  const out = [];
  const add = (pathname, search = "") => out.push(new URL(`${pathname}${search}`, url.origin).href);

  const doiRoute = path.match(/^\/doi\/(?:epdf|full|abs|pdfdirect|pdf)?\/?(10\..+)$/i);
  if (doiRoute) {
    const doi = doiRoute[1];
    if (host.endsWith("onlinelibrary.wiley.com")) {
      add(`/doi/pdfdirect/${doi}`);
      add(`/doi/pdf/${doi}`);
    }
    if (host.endsWith("tandfonline.com")) {
      add(`/doi/pdf/${doi}`, "?download=true");
      add(`/doi/pdf/${doi}`);
    }
    if (host.endsWith("pubs.acs.org")) {
      add(`/doi/epdf/${doi}`, url.search);
      add(`/doi/pdf/${doi}`, url.search);
      add(`/doi/pdf/${doi}`, "?download=true");
    }
    if (host.endsWith("science.org") || host.endsWith("aip.org")) add(`/doi/pdf/${doi}`);
  }

  const pii = path.match(/\/science\/article\/pii\/([^/]+)/i)?.[1];
  if (pii && host.endsWith("sciencedirect.com")) add(`/science/article/pii/${pii}/pdfft`, "?isDTMRedir=true&download=true");

  if (host === "link.springer.com") {
    const springerDoi = path.match(/^\/(?:article|chapter)\/(10\..+)$/i)?.[1];
    if (springerDoi) add(`/content/pdf/${springerDoi}.pdf`);
  }

  if (host.endsWith("nature.com") && /^\/articles\/[^/]+\/?$/i.test(path) && !path.endsWith(".pdf")) add(`${path.replace(/\/$/, "")}.pdf`);

  if (host.endsWith("iopscience.iop.org")) {
    const iopDoi = path.match(/^\/article\/(10\..+?)(?:\/meta|\/pdf)?$/i)?.[1];
    if (iopDoi) add(`/article/${iopDoi}/pdf`);
  }

  if (host.endsWith("rsc.org") && path.includes("/content/articlelanding/")) add(path.replace("/content/articlelanding/", "/content/articlepdf/"));

  if (host.endsWith("ieee.org")) {
    const articleNumber = path.match(/\/document\/(\d+)/)?.[1] || url.searchParams.get("arnumber");
    if (articleNumber) add("/stampPDF/getPDF.jsp", `?tp=&arnumber=${encodeURIComponent(articleNumber)}`);
  }

  if (host.endsWith("mdpi.com") && !/\/pdf\/?$/i.test(path)) add(`${path.replace(/\/$/, "")}/pdf`);
  if (host.endsWith("frontiersin.org") && /\/full\/?$/i.test(path)) add(path.replace(/\/full\/?$/i, "/pdf"));
  if (host.endsWith("arxiv.org") && /^\/abs\//i.test(path)) add(path.replace(/^\/abs\//i, "/pdf/") + ".pdf");
  return uniqueUrls(out);
}

function discoverPdfUrls(html, baseUrl) {
  const candidates = [];
  const add = raw => {
    if (!raw) return;
    const value = decodeHtmlEntities(String(raw)).replaceAll("\\/", "/").trim();
    try {
      const url = new URL(value, baseUrl);
      if (!/^https?:$/.test(url.protocol) || !isPdfLikeUrl(url)) return;
      url.hash = "";
      candidates.push(url.href);
    } catch {}
  };

  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const name = htmlAttribute(tag, "name") || htmlAttribute(tag, "property");
    if (/^(citation_pdf_url|wkhealth_pdf_url|pdf_url|og:pdf)$/i.test(name || "")) add(htmlAttribute(tag, "content"));
  }
  for (const tag of html.match(/<(?:a|link|iframe|embed|object)\b[^>]*>/gi) || []) {
    add(htmlAttribute(tag, "href") || htmlAttribute(tag, "src") || htmlAttribute(tag, "data"));
  }
  const urlPattern = /(?:https?:)?(?:\\?\/){2}[^\s"'<>]+|(?:\\?\/)[^\s"'<>]*(?:pdfdirect|articlepdf|pdfft|getPDF\.jsp|\.pdf|\/pdf)[^\s"'<>]*/gi;
  for (const match of html.match(urlPattern) || []) add(match);
  return uniqueUrls(candidates).slice(0, MAX_PDF_CANDIDATES);
}

function htmlAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : "";
}

function decodeHtmlEntities(value) {
  return value.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}

function isPdfLikeUrl(url) {
  const value = `${url.pathname}${url.search}`.toLowerCase();
  if (/\.(?:js|css|png|jpe?g|gif|svg|woff2?)(?:[?#]|$)/i.test(value)) return false;
  return /(?:\.pdf(?:$|[?#])|\/pdf(?:direct)?(?:\/|$|\?)|\/epdf(?:\/|$|\?)|articlepdf|pdfft|getpdf\.jsp|stamp\.jsp)/i.test(value);
}

function uniqueUrls(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    try {
      const href = new URL(value).href;
      if (!seen.has(href)) { seen.add(href); out.push(href); }
    } catch {}
  }
  return out;
}

function openPdfCache() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("researchlens-pdf-cache", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("pdfs", { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开 PDF 临时缓存"));
  });
}

async function putPdfCache(key, data, url) {
  const db = await openPdfCache();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("pdfs", "readwrite");
      transaction.objectStore("pdfs").put({ key, data, url, createdAt: Date.now() });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("无法保存 PDF 临时缓存"));
    });
  } finally { db.close(); }
}

async function translateBatch(texts, roles = []) {
  if (!Array.isArray(texts) || !texts.length) return [];
  const settings = { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
  if (providerNeedsApiKey(settings.provider) && !settings.apiKey) throw new Error("请先在设置中填写该服务商的 API Key");
  if (!settings.endpoint || !settings.model) throw new Error("API 地址和模型不能为空");

  return translateWithSettings(texts, settings, 0, Array.isArray(roles) ? roles : []);
}

async function translateWithSettings(texts, settings, retryDepth, roles = []) {
  const items = texts.map((text, index) => ({ id: `t${index}`, text }));
  const protocol = `\n\n输出协议（优先级最高）：输入格式为 {"items":[{"id":"t0","text":"原文"}]}。只输出一个 JSON 对象，格式必须为 {"translations":[{"id":"t0","text":"译文"}]}。每个输入 id 必须且只能出现一次；id 必须原样复制；即使一句话包含换行或多个句子，也不得拆成多个条目；不得返回输入中不存在的 id。除化学式、缩写、作者名、网址、DOI 和参考文献等应保留内容外，译文必须以${settings.targetLanguage}为主，不得复制整段英文原文充当译文。`;

  const repairInstruction = retryDepth > 0
    ? `\n\n这是自动修复重试。上次输出存在漏项或仍以英文为主。请逐项真正翻译为${settings.targetLanguage}；化学式和缩写可保留，但每个正文条目必须包含清晰的${settings.targetLanguage}表述。`
    : "";
  const system = settings.prompt.replaceAll("{targetLanguage}", settings.targetLanguage) + formatGlossaryPrompt(settings.glossaryTerms) + repairInstruction + protocol;
  const input = JSON.stringify({ items });
  const headers = { "Content-Type": "application/json" };
  let body;
  if (settings.apiStyle === "anthropic") {
    headers["x-api-key"] = settings.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    body = {
      model: settings.model,
      max_tokens: MAX_TRANSLATION_OUTPUT_TOKENS,
      temperature: 0.1,
      system,
      messages: [{ role: "user", content: input }]
    };
  } else if (settings.apiStyle === "responses") {
    headers.Authorization = `Bearer ${settings.apiKey}`;
    body = { model: settings.model, instructions: system, input, temperature: 0.1, max_output_tokens: MAX_TRANSLATION_OUTPUT_TOKENS };
  } else {
    if (providerNeedsApiKey(settings.provider) && settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
    body = {
      model: settings.model,
      temperature: 0.1,
      max_tokens: MAX_TRANSLATION_OUTPUT_TOKENS,
      messages: [{ role: "system", content: system }, { role: "user", content: input }]
    };
    if (settings.provider === "deepseek" || settings.provider === "kimi") {
      if (settings.provider === "deepseek") body.thinking = { type: "disabled" };
      if (settings.provider === "kimi") body.reasoning_effort = "low";
      body.response_format = { type: "json_object" };
    }
  }

  const response = await fetchTranslationApi(settings.endpoint, { method: "POST", headers, body: JSON.stringify(body) });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch (cause) {
    if (response.ok && texts.length > 1 && retryDepth < MAX_TRANSLATION_RETRY_DEPTH) return translateSplitBatch(texts, settings, retryDepth, roles);
    if (response.ok && texts.length === 1) {
      try { return [await translateSingleFallback(texts[0], settings, roles[0] || "")]; }
      catch (fallbackError) { throw mergePartialTranslationError(fallbackError, [""]); }
    }
    const error = new Error(`API 返回的不是 JSON（HTTP ${response.status}）`); error.status=response.status; error.retryable=response.ok||isRetryableApiStatus(response.status); error.code="MALFORMED_API_RESPONSE"; error.partialTranslations=Array(texts.length).fill(""); error.cause=cause; throw error;
  }
  if (!response.ok) {
    const error = new Error(data?.error?.message || data?.detail || `API 请求失败（HTTP ${response.status}）`);
    error.status = response.status; error.retryable = isRetryableApiStatus(response.status); throw error;
  }

  const content = extractTranslationContent(data, settings.apiStyle);
  if (!content) {
    if (texts.length > 1 && retryDepth < MAX_TRANSLATION_RETRY_DEPTH) return translateSplitBatch(texts, settings, retryDepth, roles);
    if (texts.length === 1) {
      try { return [await translateSingleFallback(texts[0], settings, roles[0] || "")]; }
      catch (fallbackError) { throw mergePartialTranslationError(fallbackError, [""]); }
    }
    const error = new Error("API 未返回可用文本，请检查接口类型和模型名"); error.retryable=true; error.code="EMPTY_MODEL_OUTPUT"; error.partialTranslations=Array(texts.length).fill(""); throw error;
  }
  let translations;
  try {
    translations = normalizeTranslations(parseJsonPayload(content), texts.length);
  } catch (cause) {
    if (texts.length > 1 && retryDepth < MAX_TRANSLATION_RETRY_DEPTH) {
      return translateSplitBatch(texts, settings, retryDepth, roles);
    }
    if (texts.length === 1) {
      try { return [await translateSingleFallback(texts[0], settings, roles[0] || "")]; }
      catch (fallbackError) { throw mergePartialTranslationError(fallbackError, [""]); }
    }
    const error = new Error(`模型输出 JSON 不完整或已截断：${cause.message}`);
    error.retryable = true; error.code = "MALFORMED_MODEL_OUTPUT"; error.partialTranslations = Array(texts.length).fill(""); throw error;
  }
  const rejected = [];
  translations.forEach((value, index) => {
    if (value && isLikelyUntranslated(texts[index], value, settings.targetLanguage, { role: roles[index] || "" })) {
      translations[index] = "";
      rejected.push(index);
    }
    if (!translations[index] && isSourcePreservingContent(texts[index], { role: roles[index] || "" })) translations[index] = texts[index];
  });
  const missing = translations.map((value, index) => value ? -1 : index).filter(index => index >= 0);
  const retryLimit = rejected.length ? MAX_UNTRANSLATED_RETRY_DEPTH : MAX_TRANSLATION_RETRY_DEPTH;
  if (missing.length && retryDepth < retryLimit) {
    if (missing.length === texts.length && texts.length > 1) {
      return translateSplitBatch(texts, settings, retryDepth, roles);
    }
    try {
      const retried = await translateWithSettings(missing.map(index => texts[index]), settings, retryDepth + 1, missing.map(index => roles[index] || ""));
      missing.forEach((sourceIndex, retryIndex) => { translations[sourceIndex] = retried[retryIndex]; });
    } catch (error) {
      if (!Array.isArray(error?.partialTranslations)) throw error;
      const partial = normalizePartialTranslations(error.partialTranslations, missing.length);
      missing.forEach((sourceIndex, retryIndex) => { if (partial[retryIndex]) translations[sourceIndex] = partial[retryIndex]; });
      throw mergePartialTranslationError(error, translations);
    }
  }
  const stillMissing = translations.filter(value => !value).length;
  if (stillMissing) {
    if (texts.length === 1) {
      try { return [await translateSingleFallback(texts[0], settings, roles[0] || "")]; }
      catch (fallbackError) { throw mergePartialTranslationError(fallbackError, translations); }
    }
    const reason = rejected.length ? `模型有 ${stillMissing} 段仍返回英文原文或未生成${settings.targetLanguage}` : `模型有 ${stillMissing} 段未按编号返回`;
    const error = new Error(`${reason}，请重试`);
    // A malformed or untranslated model response belongs to this batch only.
    // Let the PDF task continue with later batches and offer a focused retry at the end.
    error.retryable = true;
    error.code = rejected.length ? "UNTRANSLATED_OUTPUT" : "INCOMPLETE_MODEL_OUTPUT";
    error.partialTranslations = translations;
    error.failedIndices = translations.map((value, index) => value ? -1 : index).filter(index => index >= 0);
    throw error;
  }
  return translations;
}

async function translateSplitBatch(texts, settings, retryDepth, roles) {
  const middle = Math.ceil(texts.length / 2);
  const parts = [
    { texts: texts.slice(0, middle), roles: roles.slice(0, middle) },
    { texts: texts.slice(middle), roles: roles.slice(middle) }
  ];
  const combined = [];
  let partialFailure = null;
  for (const part of parts) {
    try {
      combined.push(...await translateWithSettings(part.texts, settings, retryDepth + 1, part.roles));
    } catch (error) {
      if (!Array.isArray(error?.partialTranslations)) throw error;
      combined.push(...normalizePartialTranslations(error.partialTranslations, part.texts.length));
      partialFailure ||= error;
    }
  }
  if (partialFailure) throw mergePartialTranslationError(partialFailure, combined);
  return combined;
}

async function translateSingleFallback(text, settings, role = "") {
  if (isSourcePreservingContent(text, { role })) return text;
  const chunks = splitTranslationChunks(text);
  const attempts = [];
  const recordFailure = (stage, error, code = "") => {
    const entry = {
      stage,
      status: Number(error?.status) || 0,
      code: error?.code || code || "TRANSLATION_FAILED",
      message: friendlyError(error).slice(0, 240)
    };
    attempts.push(entry);
    if (error?.retryable === false) throw attachTranslationDiagnostic(error, stage, attempts);
  };
  const tryPlain = async mode => {
    const stage = mode === "normal" ? "single-plain" : "single-forced";
    try {
      const translation = await requestPlainTranslation(text, settings, mode);
      if (translation && !isLikelyUntranslated(text, translation, settings.targetLanguage, { role })) return translation;
      recordFailure(stage, Object.assign(new Error(`模型仍未生成${settings.targetLanguage}`), { retryable: true }), "UNTRANSLATED_OUTPUT");
    } catch (error) {
      recordFailure(stage, error);
    }
    return "";
  };
  const tryChunks = async () => {
    if (chunks.length <= 1) return "";
    const translatedChunks = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      try {
        const translated = await requestPlainTranslation(chunk, settings, "forced-chunk");
        if (!translated || isLikelyUntranslated(chunk, translated, settings.targetLanguage, { role })) {
          recordFailure(`forced-chunk-${index + 1}/${chunks.length}`, Object.assign(new Error(`第 ${index + 1} 个拆分片段仍未生成${settings.targetLanguage}`), { retryable: true }), "UNTRANSLATED_OUTPUT");
          return "";
        }
        translatedChunks.push(translated);
      } catch (error) {
        recordFailure(`forced-chunk-${index + 1}/${chunks.length}`, error);
        return "";
      }
    }
    const separator = /(?:中文|汉语|简体|繁体|chinese)/i.test(String(settings.targetLanguage || "")) ? "" : " ";
    const combined = translatedChunks.join(separator).trim();
    if (combined && !isLikelyUntranslated(text, combined, settings.targetLanguage, { role })) return combined;
    recordFailure("forced-chunk-combined", Object.assign(new Error(`拆分译文合并后未通过${settings.targetLanguage}校验`), { retryable: true }), "UNTRANSLATED_OUTPUT");
    return "";
  };

  // Very long PDF blocks are the main source of truncated or source-copy model
  // responses. Translate them in bounded pieces before trying whole-block prompts.
  if (chunks.length >= 3) {
    const chunked = await tryChunks();
    if (chunked) return chunked;
  }
  const normal = await tryPlain("normal");
  if (normal) return normal;
  const forced = await tryPlain("forced");
  if (forced) return forced;
  if (chunks.length > 1 && chunks.length < 3) {
    const chunked = await tryChunks();
    if (chunked) return chunked;
  }
  const error = new Error(`模型所有降级阶段均未生成${settings.targetLanguage}`);
  error.retryable = true;
  error.code = "UNTRANSLATED_OUTPUT";
  throw attachTranslationDiagnostic(error, attempts.at(-1)?.stage || "single-fallback", attempts);
}

function attachTranslationDiagnostic(error, stage, attempts) {
  error.stage = error?.stage || stage;
  error.attempts = Array.isArray(attempts) ? [...attempts] : [];
  return error;
}

async function requestPlainTranslation(text, settings, mode = "normal") {
  const forced = mode !== "normal";
  const targetRule = /(?:中文|汉语|简体|繁体|chinese)/i.test(String(settings.targetLanguage || ""))
    ? "输出必须包含自然、完整的中文句子，不得仅返回英文。"
    : `输出必须以${settings.targetLanguage}为主，不得原样返回源语言正文。`;
  const system = forced
    ? `你是科研论文翻译器。把用户提供的英文科研文本完整翻译为${settings.targetLanguage}。${targetRule}忠实保留化学式、变量、单位、引用编号、图表编号、材料名称和公认缩写。不得省略、总结或解释。只输出译文本身，不要 JSON、Markdown或前缀。`
    : settings.prompt.replaceAll("{targetLanguage}", settings.targetLanguage)
      + formatGlossaryPrompt(settings.glossaryTerms)
      + `\n\n只翻译用户提供的这一段，完整保留公式、缩写、编号和专有名词。${targetRule}只输出译文本身，不要 JSON、Markdown、解释或前缀。`;
  const headers = { "Content-Type": "application/json" };
  let body;
  if (settings.apiStyle === "anthropic") {
    headers["x-api-key"] = settings.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    body = { model: settings.model, max_tokens: MAX_TRANSLATION_OUTPUT_TOKENS, temperature: 0.1, system, messages: [{ role: "user", content: text }] };
  } else if (settings.apiStyle === "responses") {
    headers.Authorization = `Bearer ${settings.apiKey}`;
    body = { model: settings.model, instructions: system, input: text, temperature: 0.1, max_output_tokens: MAX_TRANSLATION_OUTPUT_TOKENS };
  } else {
    if (providerNeedsApiKey(settings.provider) && settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
    body = { model: settings.model, temperature: 0.1, max_tokens: MAX_TRANSLATION_OUTPUT_TOKENS, messages: [{ role: "system", content: system }, { role: "user", content: text }] };
    if (settings.provider === "deepseek") body.thinking = { type: "disabled" };
  }
  const response = await fetchTranslationApi(settings.endpoint, { method: "POST", headers, body: JSON.stringify(body) });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); }
  catch { const error = new Error(`API 返回的不是 JSON（HTTP ${response.status}）`); error.status = response.status; error.retryable = response.ok || isRetryableApiStatus(response.status); throw error; }
  if (!response.ok) {
    const error = new Error(data?.error?.message || data?.detail || `API 请求失败（HTTP ${response.status}）`);
    error.status = response.status; error.retryable = isRetryableApiStatus(response.status); throw error;
  }
  const content = extractTranslationContent(data, settings.apiStyle);
  return normalizeSingleTranslation(content);
}

function splitTranslationChunks(value, maximum = 420) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maximum) return [text];
  const sentences = text.match(/[^.!?。！？;；]+(?:[.!?。！？;；]+(?=\s|$)|$)/g)?.map(part => part.trim()).filter(Boolean) || [text];
  const pieces = [];
  for (const sentence of sentences) {
    let remaining = sentence;
    while (remaining.length > maximum) {
      const window = remaining.slice(0, maximum + 1);
      const minimum = Math.floor(maximum * .55);
      const candidates = [window.lastIndexOf(", "), window.lastIndexOf(": "), window.lastIndexOf(" and "), window.lastIndexOf(" but "), window.lastIndexOf(" ")];
      const cut = Math.max(...candidates.filter(index => index >= minimum));
      const end = cut >= minimum ? cut + 1 : maximum;
      pieces.push(remaining.slice(0, end).trim());
      remaining = remaining.slice(end).trim();
    }
    if (remaining) pieces.push(remaining);
  }
  const chunks = [];
  for (const piece of pieces) {
    const previous = chunks.at(-1);
    if (previous && previous.length + 1 + piece.length <= maximum) chunks[chunks.length - 1] = `${previous} ${piece}`;
    else chunks.push(piece);
  }
  return chunks;
}

function normalizePartialTranslations(values, count) {
  return Array.from({ length: count }, (_, index) => typeof values?.[index] === "string" ? values[index] : "");
}

function mergePartialTranslationError(cause, translations) {
  const error = new Error(cause?.message || "模型输出不完整，请重试");
  error.retryable = cause?.retryable !== false;
  error.status = Number(cause?.status) || 0;
  error.code = cause?.code || "INCOMPLETE_MODEL_OUTPUT";
  error.stage = cause?.stage || "batch-json";
  error.attempts = Array.isArray(cause?.attempts) ? [...cause.attempts] : [];
  error.partialTranslations = [...translations];
  error.failedIndices = translations.map((value, index) => value ? -1 : index).filter(index => index >= 0);
  return error;
}

async function fetchTranslationApi(endpoint, init, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(endpoint, init);
      if (!isRetryableApiStatus(response.status) || attempt >= maxRetries) return response;
      await sleep(retryDelayMs(attempt, response.headers.get("retry-after")));
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries) {
        error.retryable = true; error.status = 0; throw error;
      }
      await sleep(retryDelayMs(attempt));
    }
  }
  if (lastError) throw lastError;
  throw new Error("API 请求未完成");
}

function extractResponsesText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  return (data.output || []).flatMap(item => item.content || [])
    .filter(item => item.type === "output_text").map(item => item.text).join("");
}

function extractTranslationContent(data, apiStyle) {
  if (apiStyle === "responses") return extractResponsesText(data);
  if (apiStyle === "anthropic") return (data?.content || []).filter(item => item?.type === "text").map(item => item.text || "").join("");
  return data?.choices?.[0]?.message?.content;
}

function normalizeSingleTranslation(content) {
  const cleaned = String(content || "").trim().replace(/^```(?:json|text|markdown)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (!cleaned) return "";
  try {
    const parsed = parseJsonPayload(cleaned);
    if (typeof parsed === "string") return parsed.trim();
    const normalized = normalizeTranslations(parsed, 1)[0];
    if (normalized) return normalized.trim();
  } catch {}
  return cleaned;
}

function parseJsonPayload(content) {
  const cleaned = String(content).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {}
  const objectStart = cleaned.indexOf("{");
  const objectEnd = cleaned.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) return JSON.parse(cleaned.slice(objectStart, objectEnd + 1));
  const start = cleaned.indexOf("["); const end = cleaned.lastIndexOf("]");
  if (start >= 0 && end > start) {
    return JSON.parse(cleaned.slice(start, end + 1));
  }
  throw new Error("无法解析模型输出；请让模型只返回 JSON 对象");
}

function normalizeTranslations(payload, count) {
  const result = Array(count).fill("");
  const values = Array.isArray(payload) ? payload : payload?.translations;
  if (Array.isArray(values) && values.every(value => typeof value === "string")) {
    if (values.length === count) return values;
    return result;
  }
  if (Array.isArray(values)) {
    for (const item of values) {
      const match = String(item?.id || "").match(/^t(\d+)$/);
      const index = match ? Number(match[1]) : -1;
      if (index >= 0 && index < count && typeof item?.text === "string" && item.text.trim()) result[index] = item.text;
    }
  } else if (values && typeof values === "object") {
    for (let index = 0; index < count; index++) {
      const value = values[`t${index}`];
      if (typeof value === "string" && value.trim()) result[index] = value;
    }
  }
  return result;
}

function friendlyError(error) {
  if (String(error?.message).includes("Failed to fetch")) return "无法连接 API。请检查地址、网络以及接口是否允许访问。";
  return error?.message || String(error);
}
