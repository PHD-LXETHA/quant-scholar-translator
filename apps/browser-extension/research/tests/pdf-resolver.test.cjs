const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadBackground() {
  const noopEvent = { addListener() {} };
  const context = {
    URL,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    setTimeout,
    clearTimeout,
    atob: value => Buffer.from(value, "base64").toString("binary"),
    btoa: value => Buffer.from(value, "binary").toString("base64"),
    crypto: { randomUUID: () => "test" },
    PROFESSIONAL_GLOSSARY_PRESET: [],
    migrateProfessionalGlossary: async () => {},
    formatGlossaryPrompt: () => "",
    isRetryableApiStatus: status => [408,409,425,429,500,502,503,504].includes(Number(status)),
    retryDelayMs: () => 0,
    sleep: async () => {},
    providerNeedsApiKey: provider => !["ollama", "lmstudio"].includes(provider),
    isLikelyUntranslated: (source, translation, targetLanguage) => {
      if (!/(?:中文|chinese)/i.test(targetLanguage || "")) return false;
      const words = String(source).match(/[A-Za-z]{2,}/g) || [];
      const han = (String(translation).match(/[\u3400-\u9fff]/g) || []).length;
      return String(source).length >= 70 && words.length >= 8 && han < 6 && String(translation).replace(/\s+/g, " ").trim() === String(source).replace(/\s+/g, " ").trim();
    },
    isSourcePreservingContent: (source, context = {}) => context.role !== "figure-caption" && /(?:correspondence|corresponding author|e-?mail|orcid)/i.test(String(source)) && /@|https?:\/\//i.test(String(source)),
    chrome: {
      runtime: { id: "test-extension", onInstalled: noopEvent, onMessage: noopEvent },
      extension: { isAllowedFileSchemeAccess: async () => true },
      commands: { onCommand: noopEvent },
      contextMenus: {
        removeAll: async () => {},
        create() {},
        onClicked: noopEvent
      },
      storage: { local: { get: async () => ({}), set: async () => {} } },
      tabs: { query: async () => [], onUpdated: { addListener() {}, removeListener() {} } },
      scripting: { executeScript: async () => [] },
      declarativeNetRequest: { updateSessionRules: async () => {} }
    }
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8").replace(/^import .*?;\s*$/gm, "");
  vm.runInContext(source, context);
  return context;
}

test("Wiley epdf maps to direct PDF endpoints", () => {
  const bg = loadBackground();
  const urls = Array.from(bg.publisherPdfCandidates(new URL("https://advanced.onlinelibrary.wiley.com/doi/epdf/10.1002/adma.201700210")));
  assert.deepEqual(urls, [
    "https://advanced.onlinelibrary.wiley.com/doi/pdfdirect/10.1002/adma.201700210",
    "https://advanced.onlinelibrary.wiley.com/doi/pdf/10.1002/adma.201700210"
  ]);
});

test('PDF direct professional mode rejects a non-subscription engine before sending content', async () => {
  const bg = loadBackground();
  bg.chrome.storage.local.get = async () => ({ provider: 'ollama', endpoint: 'http://localhost/api', model: 'local' });
  bg.fetch = async () => assert.fail('PDF must not silently send text to another engine');
  await assert.rejects(bg.translateBatch(['The variance is finite.'], [], true), /PDF.*直接精译/);
});

test('PDF direct professional mode uses selected Codex bridge without intermediate translation', async () => {
  const bg = loadBackground();
  bg.chrome.storage.local.get = async () => ({ provider: 'codex', endpoint: 'http://127.0.0.1:8765/codex/v1/chat/completions', model: 'codex-subscription' });
  bg.providerNeedsApiKey = () => false;
  let seen;
  bg.translateWithSettings = async (texts, settings) => { seen = { texts, settings }; return ['方差有限。']; };
  const result = await bg.translateBatch(['The variance is finite.'], [], true);
  assert.equal(result[0], '方差有限。');
  assert.equal(seen.texts[0], 'The variance is finite.');
  assert.equal(seen.settings.provider, 'codex');
});

test("discovers citation metadata and embedded PDF links", () => {
  const bg = loadBackground();
  const html = `<!doctype html><meta name="citation_pdf_url" content="/download/paper.pdf?x=1&amp;y=a%2Fb"><iframe src='/reader/epdf/10.1/test'></iframe>`;
  const urls = Array.from(bg.discoverPdfUrls(html, "https://publisher.example/article/1"));
  assert.ok(urls.includes("https://publisher.example/download/paper.pdf?x=1&y=a%2Fb"));
  assert.ok(urls.includes("https://publisher.example/reader/epdf/10.1/test"));
});

test("builds candidates for common publisher readers", () => {
  const bg = loadBackground();
  const cases = [
    ["https://www.sciencedirect.com/science/article/pii/S1234567890", "/pdfft?"],
    ["https://link.springer.com/article/10.1007/s12345-026-00001", "/content/pdf/10.1007/s12345-026-00001.pdf"],
    ["https://www.nature.com/articles/s41560-026-00001", "/articles/s41560-026-00001.pdf"],
    ["https://ieeexplore.ieee.org/document/1234567", "/stampPDF/getPDF.jsp?"]
  ];
  for (const [source, expected] of cases) {
    const urls = Array.from(bg.publisherPdfCandidates(new URL(source)));
    assert.ok(urls.some(url => url.includes(expected)), `${source} should include ${expected}`);
  }
});

test("recognizes a PDF header within the first kilobyte", () => {
  const bg = loadBackground();
  const bytes = new TextEncoder().encode("\n%PDF-1.7\n");
  assert.equal(bg.hasPdfHeader(bytes.buffer), true);
  assert.equal(bg.hasPdfHeader(new TextEncoder().encode("<html></html>").buffer), false);
});

test("reads an allowed local PDF into the viewer cache", async () => {
  const bg = loadBackground();
  const data = new TextEncoder().encode("%PDF-1.7\nlocal").buffer;
  let cached;
  bg.fetch = async url => ({ ok: true, status: 200, url, arrayBuffer: async () => data });
  bg.putPdfCache = async (key, value, url) => { cached = { key, value, url }; };

  const result = await bg.fetchPdfForViewer("file:///C:/Papers/example.pdf");
  assert.equal(result.local, true);
  assert.equal(result.finalUrl, "file:///C:/Papers/example.pdf");
  assert.equal(cached.value.byteLength, data.byteLength);
});

test("explains how to enable local file access when Edge blocks it", async () => {
  const bg = loadBackground();
  bg.chrome.extension.isAllowedFileSchemeAccess = async () => false;
  await assert.rejects(
    bg.fetchPdfForViewer("file:///C:/Papers/example.pdf"),
    error => error.code === "LOCAL_FILE_ACCESS_DENIED" && /允许访问文件 URL/.test(error.message)
  );
});

test("resolves an enhanced-reader HTML shell to the next PDF candidate", async () => {
  const bg = loadBackground();
  const requested = [];
  let cached;
  bg.fetch = async url => {
    requested.push(url);
    if (requested.length === 1) {
      const data = new TextEncoder().encode("<!doctype html><title>Enhanced PDF reader</title>").buffer;
      return { ok: true, status: 200, url, headers: { get: () => "text/html" }, arrayBuffer: async () => data };
    }
    const data = new TextEncoder().encode("%PDF-1.7\nmock").buffer;
    return { ok: true, status: 200, url, headers: { get: () => "application/pdf" }, arrayBuffer: async () => data };
  };
  bg.putPdfCache = async (key, data, url) => { cached = { key, data, url }; };

  const result = await bg.fetchPdfForViewer("https://advanced.onlinelibrary.wiley.com/doi/epdf/10.1002/adma.201700210");
  assert.equal(requested[1], "https://advanced.onlinelibrary.wiley.com/doi/pdfdirect/10.1002/adma.201700210");
  assert.equal(result.finalUrl, requested[1]);
  assert.equal(result.attempts, 2);
  assert.equal(cached.url, requested[1]);
});

test("automatically splits a batch when the model omits every id", async () => {
  const bg = loadBackground();
  const batchSizes = [];
  bg.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const items = JSON.parse(request.messages[1].content).items;
    batchSizes.push(items.length);
    const translations = items.length > 2 ? [] : items.map(item => ({ id: item.id, text: `译:${item.text}` }));
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ translations }) } }] })
    };
  };
  const settings = { prompt: "翻译为{targetLanguage}", targetLanguage: "中文", apiStyle: "chat", provider: "test", endpoint: "https://api.example/v1", apiKey: "test", model: "test" };
  const result = await bg.translateWithSettings(["a", "b", "c", "d"], settings, 0);
  assert.deepEqual(Array.from(result), ["译:a", "译:b", "译:c", "译:d"]);
  assert.deepEqual(batchSizes, [4, 2, 2]);
});

test("retries a long paragraph when the model copies the English source", async () => {
  const bg = loadBackground(); let attempts = 0;
  const source = "This stoichiometric design partially replaces ferric ions with copper and titanium while maintaining interfacial stability during high-voltage cycling.";
  bg.fetch = async (_url, options) => {
    attempts += 1;
    const request = JSON.parse(options.body);
    const input = JSON.parse(request.messages[1].content).items[0];
    const text = attempts === 1 ? input.text : "该化学计量设计以铜和钛部分取代铁离子，同时在高电压循环期间保持界面稳定性。";
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ translations: [{ id: "t0", text }] }) } }] }) };
  };
  const settings = { prompt: "翻译为{targetLanguage}", targetLanguage: "中文", apiStyle: "chat", provider: "test", endpoint: "https://api.example/v1", apiKey: "test", model: "test" };
  const result = await bg.translateWithSettings([source], settings, 0);
  assert.equal(result[0], "该化学计量设计以铜和钛部分取代铁离子，同时在高电压循环期间保持界面稳定性。");
  assert.equal(attempts, 2);
});

test("treats persistent untranslated model output as a retryable batch failure", async () => {
  const bg = loadBackground(); let attempts = 0;
  const source = "This long scientific paragraph remains entirely in English even though the requested target language is Chinese, so it must never be counted as a completed translation block.";
  bg.fetch = async (_url, options) => {
    attempts += 1;
    const request = JSON.parse(options.body);
    const userContent = request.messages[1].content;
    if (!userContent.startsWith("{")) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: source } }] }) };
    }
    const input = JSON.parse(userContent).items[0];
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ translations: [{ id: "t0", text: input.text }] }) } }] }) };
  };
  const settings = { prompt: "翻译为{targetLanguage}", targetLanguage: "中文", apiStyle: "chat", provider: "test", endpoint: "https://api.example/v1", apiKey: "test", model: "test" };
  await assert.rejects(() => bg.translateWithSettings([source], settings, 0), error => {
    assert.equal(error.retryable, true);
    assert.equal(error.code, "UNTRANSLATED_OUTPUT");
    return true;
  });
  assert.equal(attempts, 5);
});

test("preserves successful translations when one item in a batch keeps failing", async () => {
  const bg = loadBackground();
  const failing = "This scientific paragraph remains in English after every retry and must be isolated without discarding successful neighboring translations in the same batch.";
  const successful = "A second scientific paragraph should be translated successfully and retained even when the first item fails validation.";
  bg.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const items = JSON.parse(request.messages[1].content).items;
    const translations = items.map(item => ({ id: item.id, text: item.text === failing ? item.text : "第二段已成功翻译并应当被保留。" }));
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ translations }) } }] }) };
  };
  const settings = { prompt: "翻译为{targetLanguage}", targetLanguage: "中文", apiStyle: "chat", provider: "test", endpoint: "https://api.example/v1", apiKey: "test", model: "test" };
  await assert.rejects(() => bg.translateWithSettings([failing, successful], settings, 0), error => {
    assert.equal(error.retryable, true);
    assert.deepEqual(Array.from(error.partialTranslations), ["", "第二段已成功翻译并应当被保留。"]);
    assert.deepEqual(Array.from(error.failedIndices), [0]);
    return true;
  });
});

test("uses source text for omitted correspondence identifiers without another API request", async () => {
  const bg = loadBackground(); let attempts = 0;
  const source = "Correspondence: Xu-Dong Zhang (xdzhang@example.edu); https://orcid.org/0000-0000-0000-0000";
  bg.fetch = async () => {
    attempts += 1;
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ translations: [] }) } }] }) };
  };
  const settings = { prompt: "翻译为{targetLanguage}", targetLanguage: "中文", apiStyle: "chat", provider: "test", endpoint: "https://api.example/v1", apiKey: "test", model: "test" };
  const result = await bg.translateWithSettings([source], settings, 0, ["metadata"]);
  assert.deepEqual(Array.from(result), [source]);
  assert.equal(attempts, 1);
});

test("falls back to a plain single-item request when JSON retries keep copying a figure caption", async () => {
  const bg = loadBackground(); let attempts = 0;
  const source = "FIGURE 1. Schematic illustration of the sol-gel synthesis and electrochemical testing workflow for the layered oxide cathode material.";
  bg.fetch = async (_url, options) => {
    attempts += 1;
    const request = JSON.parse(options.body);
    const userContent = request.messages[1].content;
    if (userContent.startsWith("{")) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ translations: [{ id: "t0", text: source }] }) } }] }) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "图 1. 层状氧化物正极材料溶胶-凝胶合成及电化学测试流程示意图。" } }] }) };
  };
  const settings = { prompt: "翻译为{targetLanguage}", targetLanguage: "中文", apiStyle: "chat", provider: "test", endpoint: "https://api.example/v1", apiKey: "test", model: "test" };
  const result = await bg.translateWithSettings([source], settings, 0, ["figure-caption"]);
  assert.deepEqual(Array.from(result), ["图 1. 层状氧化物正极材料溶胶-凝胶合成及电化学测试流程示意图。"]);
  assert.equal(attempts, 4);
});

test("recovers a truncated single-item JSON response through the plain fallback", async () => {
  const bg = loadBackground(); let attempts = 0;
  bg.fetch = async (_url, options) => {
    attempts += 1;
    const request = JSON.parse(options.body);
    const userContent = request.messages[1].content;
    const content = userContent.startsWith("{") ? '{"translations":[{"id":"t0","text":"截断' : "已通过纯文本降级请求恢复译文。";
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content } }] }) };
  };
  const settings = { prompt: "翻译为{targetLanguage}", targetLanguage: "中文", apiStyle: "chat", provider: "test", endpoint: "https://api.example/v1", apiKey: "test", model: "test" };
  const result = await bg.translateWithSettings(["A sufficiently long scientific caption or paragraph that needs a valid Chinese translation after malformed JSON output."], settings, 0, ["body"]);
  assert.deepEqual(Array.from(result), ["已通过纯文本降级请求恢复译文。"]);
  assert.equal(attempts, 2);
});

test("splits a long stubborn paragraph into smaller plain-text translation requests", async () => {
  const bg = loadBackground(); let attempts = 0, chunkRequests = 0;
  const sentence = "This extended scientific discussion explains the interfacial interaction, passivation effect, photovoltaic response, charge transport behavior, and operational stability under continuous illumination. ";
  const source = sentence.repeat(5).trim();
  bg.fetch = async (_url, options) => {
    attempts += 1;
    const request = JSON.parse(options.body);
    const userContent = request.messages[1].content;
    if (userContent.startsWith("{")) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ translations: [{ id: "t0", text: source }] }) } }] }) };
    }
    if (userContent === source) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: source } }] }) };
    }
    chunkRequests += 1;
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: `已翻译的科研片段${chunkRequests}。` } }] }) };
  };
  const settings = { prompt: "翻译为{targetLanguage}", targetLanguage: "中文", apiStyle: "chat", provider: "test", endpoint: "https://api.example/v1", apiKey: "test", model: "test" };
  const result = await bg.translateWithSettings([source], settings, 0, ["body"]);
  assert.ok(result[0].startsWith("已翻译的科研片段1。"));
  assert.ok(chunkRequests >= 2);
  assert.equal(attempts, 3 + chunkRequests);
});

test("continues to the forced fallback after a retryable plain-response error", async () => {
  const bg = loadBackground(); let attempts = 0, plainAttempts = 0;
  const source = "This scientific paragraph must be translated even when the first plain-text fallback returns a malformed API response after the numbered JSON retries.";
  bg.fetch = async (_url, options) => {
    attempts += 1;
    const request = JSON.parse(options.body);
    const userContent = request.messages[1].content;
    if (userContent.startsWith("{")) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ translations: [{ id: "t0", text: source }] }) } }] }) };
    }
    plainAttempts += 1;
    if (plainAttempts === 1) return { ok: true, status: 200, text: async () => "malformed outer response" };
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "即使首次纯文本降级返回格式错误，仍必须完成该科研段落的翻译。" } }] }) };
  };
  const settings = { prompt: "翻译为{targetLanguage}", targetLanguage: "中文", apiStyle: "chat", provider: "test", endpoint: "https://api.example/v1", apiKey: "test", model: "test" };
  const result = await bg.translateWithSettings([source], settings, 0, ["body"]);
  assert.deepEqual(Array.from(result), ["即使首次纯文本降级返回格式错误，仍必须完成该科研段落的翻译。"]);
  assert.equal(plainAttempts, 2);
  assert.equal(attempts, 5);
});

test("uses a minimal forced prompt when the configured prompt keeps a paragraph in English", async () => {
  const bg = loadBackground(); let attempts = 0;
  const source = "Previous research has traditionally focused on interfacial reconstruction, charge compensation, and failure mechanisms under repeated electrochemical cycling conditions.";
  bg.fetch = async (_url, options) => {
    attempts += 1;
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const userContent = request.messages[1].content;
    if (userContent.startsWith("{")) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ translations: [{ id: "t0", text: source }] }) } }] }) };
    }
    const content = system.includes("CONFLICTING_CUSTOM_PROMPT") ? source : "以往研究通常聚焦于反复电化学循环条件下的界面重构、电荷补偿和失效机制。";
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content } }] }) };
  };
  const settings = { prompt: "CONFLICTING_CUSTOM_PROMPT 翻译为{targetLanguage}", targetLanguage: "中文", apiStyle: "chat", provider: "test", endpoint: "https://api.example/v1", apiKey: "test", model: "test" };
  const result = await bg.translateWithSettings([source], settings, 0, ["body"]);
  assert.deepEqual(Array.from(result), ["以往研究通常聚焦于反复电化学循环条件下的界面重构、电荷补偿和失效机制。"]);
  assert.equal(attempts, 5);
});

test("uses native Anthropic Messages headers and response format", async () => {
  const bg = loadBackground(); let captured;
  bg.fetch = async (_url, options) => {
    captured = options;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ translations: [{ id: "t0", text: "层状氧化物" }] }) }] })
    };
  };
  const settings = { prompt: "翻译为{targetLanguage}", targetLanguage: "中文", apiStyle: "anthropic", provider: "anthropic", endpoint: "https://api.anthropic.com/v1/messages", apiKey: "anthropic-test-key", model: "claude-test", glossaryTerms: [] };
  const result = await bg.translateWithSettings(["layered oxide"], settings, 0);
  const request = JSON.parse(captured.body);
  assert.deepEqual(Array.from(result), ["层状氧化物"]);
  assert.equal(captured.headers["x-api-key"], "anthropic-test-key");
  assert.equal(captured.headers["anthropic-version"], "2023-06-01");
  assert.equal(captured.headers.Authorization, undefined);
  assert.equal(request.messages[0].role, "user");
  assert.ok(request.system.includes("输出协议"));
});

test("does not attach an API key header to a local Ollama request", async () => {
  const bg = loadBackground(); let captured;
  bg.fetch = async (_url, options) => {
    captured = options;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ translations: [{ id: "t0", text: "译文" }] }) } }] })
    };
  };
  const settings = { prompt: "翻译为{targetLanguage}", targetLanguage: "中文", apiStyle: "chat", provider: "ollama", endpoint: "http://localhost:11434/v1/chat/completions", apiKey: "should-not-be-sent", model: "local-test", glossaryTerms: [] };
  const result = await bg.translateWithSettings(["text"], settings, 0);
  assert.deepEqual(Array.from(result), ["译文"]);
  assert.equal(captured.headers.Authorization, undefined);
});

test("retries a transient API response before returning success", async () => {
  const bg = loadBackground(); let attempts = 0;
  bg.fetch = async () => {
    attempts += 1;
    if (attempts === 1) return { ok: false, status: 429, headers: { get: () => "0" } };
    return { ok: true, status: 200, headers: { get: () => null } };
  };
  const response = await bg.fetchTranslationApi("https://api.example/v1", {}, 3);
  assert.equal(response.status, 200);
  assert.equal(attempts, 2);
});

test("maps ACS PDF URLs to a same-origin article helper page", () => {
  const bg = loadBackground();
  assert.equal(
    bg.publisherArticlePage("https://pubs.acs.org/doi/pdf/10.1021/acsami.2c12098?ref=article_openPDF"),
    "https://pubs.acs.org/doi/10.1021/acsami.2c12098"
  );
  const candidates = Array.from(bg.publisherPdfCandidates(new URL("https://pubs.acs.org/doi/pdf/10.1021/acsami.2c12098?ref=article_openPDF")));
  assert.equal(candidates[0], "https://pubs.acs.org/doi/epdf/10.1021/acsami.2c12098?ref=article_openPDF");
  assert.ok(candidates.includes("https://pubs.acs.org/doi/pdf/10.1021/acsami.2c12098?download=true"));
});

test("reassembles PDF bytes fetched inside an existing publisher page", async () => {
  const bg = loadBackground();
  const bytes = Buffer.from("%PDF-1.7\ninside-page");
  bg.chrome.tabs.query = async () => [
    { id: 3, url: "https://pubs.acs.org/doi/10.1021/unrelated.1", status: "complete" },
    { id: 7, url: "https://pubs.acs.org/doi/10.1021/acsami.2c12098", status: "complete" }
  ];
  bg.chrome.tabs.get = async () => ({ id: 7, status: "complete" });
  let executedTabId;
  bg.chrome.scripting.executeScript = async options => { executedTabId = options.target.tabId; return [{ result: { ok: true, chunks: [bytes.toString("base64")], size: bytes.length, finalUrl: "https://pubs.acs.org/doi/pdf/10.1021/acsami.2c12098" } }]; };
  const result = await bg.fetchPdfThroughPublisherPage(
    "https://pubs.acs.org/doi/pdf/10.1021/acsami.2c12098",
    new URL("https://pubs.acs.org/doi/pdf/10.1021/acsami.2c12098")
  );
  assert.equal(Buffer.from(result.data).toString(), bytes.toString());
  assert.equal(executedTabId, 7);
});

test("checks the same-origin browser cache before issuing another publisher request", async () => {
  const bg = loadBackground();
  const calls = [];
  bg.location = { href: "https://pubs.acs.org/doi/10.1021/acsami.2c12098" };
  bg.fetch = async (_url, options) => {
    calls.push(options);
    return {
      ok: true,
      status: 200,
      url: "https://pubs.acs.org/doi/pdf/10.1021/acsami.2c12098",
      headers: { get: () => null },
      arrayBuffer: async () => new TextEncoder().encode("%PDF-1.7\ncached").buffer
    };
  };
  const result = await bg.fetchPdfInPageWorld("https://pubs.acs.org/doi/pdf/10.1021/acsami.2c12098");
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cache, "only-if-cached");
  assert.equal(calls[0].mode, "same-origin");
});

test("reports a Cloudflare publisher challenge separately from an ordinary 403", async () => {
  const bg = loadBackground();
  bg.location = { href: "https://pubs.acs.org/doi/10.1021/acsami.2c12098" };
  bg.fetch = async () => ({ ok: false, status: 403, headers: { get: name => name === "cf-mitigated" ? "challenge" : null } });
  const result = await bg.fetchPdfInPageWorld("https://pubs.acs.org/doi/pdf/10.1021/acsami.2c12098");
  assert.equal(result.ok, false);
  assert.equal(result.code, "PUBLISHER_CHALLENGE");
  assert.match(result.error, /人机验证/);
});

test("propagates the exact ACS article URL needed to complete a challenge", async () => {
  const bg = loadBackground();
  bg.chrome.tabs.query = async () => [{ id: 7, url: "https://pubs.acs.org/doi/10.1021/acsami.2c12098", status: "complete" }];
  bg.chrome.tabs.get = async () => ({ id: 7, status: "complete" });
  bg.chrome.scripting.executeScript = async () => [{ result: { ok: false, status: 403, code: "PUBLISHER_CHALLENGE", error: "challenge" } }];
  await assert.rejects(
    () => bg.fetchPdfThroughPublisherPage("https://pubs.acs.org/doi/pdf/10.1021/acsami.2c12098", new URL("https://pubs.acs.org/doi/pdf/10.1021/acsami.2c12098")),
    error => error.code === "PUBLISHER_CHALLENGE" && error.articleUrl === "https://pubs.acs.org/doi/10.1021/acsami.2c12098"
  );
});

test("tries the exact ACS URL with its access query before canonical bridge URLs", async () => {
  const bg = loadBackground();
  const source = "https://pubs.acs.org/doi/pdf/10.1021/acsami.2c12098?ref=article_openPDF";
  const bridged = [];
  bg.fetchPdfCandidate = async () => ({ ok: false, status: 403 });
  bg.fetchPdfThroughPublisherPage = async url => {
    bridged.push(url);
    return { data: new TextEncoder().encode("%PDF-1.7\ncache").buffer, finalUrl: url };
  };
  bg.putPdfCache = async () => {};
  const result = await bg.fetchPdfForViewer(source);
  assert.equal(bridged[0], source);
  assert.equal(result.viaPage, true);
});
