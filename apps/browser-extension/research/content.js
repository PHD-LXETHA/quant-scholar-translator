(() => {
  if (window.__researchTranslatorLoaded) return;
  window.__researchTranslatorLoaded = true;

  const state = { records: [], translated: false, running: false, cancelled: false, progress: null, quickText: "", quickHost: null, quickShadow: null };
  document.querySelector(".rt-hud")?.remove();
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION", "CODE", "PRE", "KBD", "SAMP", "SVG", "MATH", "CANVAS"]);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "RESEARCH_PING") { sendResponse({ ok: true }); return; }
    if (message?.type === "GET_PAGE_KNOWLEDGE") {
      sendResponse({ ok: true, running: state.running, title: document.title, url: location.href,
        segments: state.running ? [] : state.records.filter(record => record.translated && ownsRecord(record)).map(record => ({ source: record.original, translation: record.translated })) });
      return;
    }
    if (message?.type === "TRANSLATE_PAGE") {
      translatePage().then(sendResponse); return true;
    }
    if (message?.type === "SHOW_ORIGINAL") { showOriginal(); sendResponse({ ok: true }); }
    if (message?.type === "SHOW_TRANSLATION") { showTranslation(); sendResponse({ ok: true }); }
    if (message?.type === "TOGGLE_TRANSLATION") {
      if (state.running) { sendResponse({ ok: false, error: "网页翻译正在进行，请完成后再切换" }); return; }
      if (!state.records.length) { sendResponse({ ok: false, error: "此页尚无译文，请先点击“翻译当前网页”" }); return; }
      state.translated ? showOriginal() : showTranslation();
      sendResponse({ ok: true, translated: state.translated, count: state.records.length });
    }
    if (message?.type === "GET_STATUS") sendResponse({ ok: true, running: state.running, cancelled: state.cancelled, translated: state.translated, count: state.records.length, progress: state.progress });
    if (message?.type === "CANCEL_PAGE_TRANSLATION") {
      state.cancelled = state.running;
      sendResponse({ ok: true, running: state.running });
    }
    if (message?.type === "QUICK_TRANSLATE_SELECTION") { quickTranslate(message.text, null); sendResponse({ ok: true }); }
  });

  document.addEventListener("mouseup", event => {
    if (state.quickHost?.contains(event.target)) return;
    setTimeout(showQuickTranslateTrigger, 20);
  });
  document.addEventListener("keyup", event => {
    const key = typeof event?.key === "string" ? event.key : "";
    if (key.startsWith("Arrow") || key === "Shift") setTimeout(showQuickTranslateTrigger, 20);
  });
  document.addEventListener("mousedown", event => {
    if (state.quickHost && event.target !== state.quickHost && !state.quickHost.contains(event.target)) hideQuickTranslateTrigger();
  });
  window.addEventListener("scroll", hideQuickTranslateTrigger, { passive: true });

  async function translatePage() {
    if (state.running) return { ok: false, error: "翻译正在进行中" };
    state.records = state.records.filter(ownsRecord);
    if (state.records.length) { showTranslation(); return { ok: true, count: state.records.length }; }
    state.running = true; state.cancelled = false;
    state.progress = { started: Date.now(), finished: null, done: 0, total: 0, error: "" };
    const nodes = collectTextNodes();
    if (!nodes.length) { state.running = false; state.progress.error = "此页面没有找到可翻译正文"; state.progress.finished = Date.now(); return { ok: false, error: state.progress.error }; }
    // Return the first reading-sized block sooner; keep later requests large
    // to avoid repeated CLI startup overhead. Never split an individual text node.
    const batches = makeBatches(nodes, 6000, 45, 1600, 12);
    state.progress.total = batches.length;
    try {
      let done = 0;
      for (const batch of batches) {
        if (state.cancelled) throw new Error("已取消");
        // Identical text within the same request shares the same context.
        // Do not reuse translations across different batches or documents.
        const texts = [...new Set(batch.map(x => x.original))];
        const result = await chrome.runtime.sendMessage({ type: "TRANSLATE_BATCH", texts });
        if (state.cancelled) throw new Error("已取消，已恢复原文");
        if (!result?.ok) throw new Error(result?.error || "翻译失败");
        if (!Array.isArray(result.translations) || result.translations.length !== texts.length || result.translations.some(text => typeof text !== "string" || !text.trim())) throw new Error("翻译结果不完整，已恢复原文，请重试");
        const translations = new Map(texts.map((text, index) => [text, result.translations[index]]));
        batch.forEach(record => {
          record.translated = translations.get(record.original);
          if (record.node.isConnected && record.node.nodeValue === record.original) {
            record.node.nodeValue = record.translated;
            state.records.push(record);
          }
        });
        done += 1; state.progress.done = done;
      }
      state.translated = true;
      return { ok: true, count: state.records.length };
    } catch (error) {
      showOriginal();
      state.records = [];
      state.translated = false;
      state.progress.error = error.message; return { ok: false, error: error.message };
    } finally { state.running = false; state.progress.finished = Date.now(); }
  }

  function collectTextNodes() {
    const root = document.querySelector("article, main, [role='main']") || document.body;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        const text = node.nodeValue?.trim();
        if (!parent || !text || text.length < 2 || SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (parent.closest("[contenteditable]:not([contenteditable='false']), .rt-hud, .rt-quick-host, #quant-scholar-floating-control, #kami-subs-overlay, [aria-hidden='true'], code, pre, math, svg")) return NodeFilter.FILTER_REJECT;
        if (/^[\d\s.,;:()[\]{}+\-–—=<>/%°×·|]+$/.test(text)) return NodeFilter.FILTER_REJECT;
        if (isInvisible(parent)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const records = []; let node;
    while ((node = walker.nextNode())) records.push({ node, original: node.nodeValue, translated: "" });
    return records;
  }

  function isInvisible(element) {
    const style = getComputedStyle(element);
    return style.display === "none" || style.visibility === "hidden" || element.getClientRects().length === 0;
  }

  function makeBatches(records, limit, maxItems, firstLimit = limit, firstMaxItems = maxItems) {
    const batches = []; let batch = []; let size = 0;
    for (const record of records) {
      const length = record.original.length + 8;
      const charLimit = batches.length ? limit : firstLimit;
      const itemLimit = batches.length ? maxItems : firstMaxItems;
      if (batch.length && (size + length > charLimit || batch.length >= itemLimit)) { batches.push(batch); batch = []; size = 0; }
      batch.push(record); size += length;
    }
    if (batch.length) batches.push(batch);
    return batches;
  }

  function ownsRecord(record) {
    return record.node.isConnected && (record.node.nodeValue === record.original || record.node.nodeValue === record.translated);
  }
  function showOriginal() {
    for (const record of state.records) if (record.node.isConnected && record.node.nodeValue === record.translated) record.node.nodeValue = record.original;
    state.translated = false;
  }
  function showTranslation() {
    for (const record of state.records) if (record.node.isConnected && record.node.nodeValue === record.original && record.translated) record.node.nodeValue = record.translated;
    state.translated = true;
  }

  function ensureQuickTranslateUi() {
    if (state.quickHost?.isConnected) return state.quickShadow;
    const host = document.createElement("div"); host.className = "rt-quick-host"; host.style.cssText = "all:initial;position:fixed;left:0;top:0;z-index:2147483647";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>
      :host{all:initial}.trigger{position:fixed;display:none;width:34px;height:34px;border:0;border-radius:10px;color:#fff;background:#08735d;box-shadow:0 6px 22px rgba(13,62,50,.28);font:700 15px/1 system-ui;cursor:pointer}.card{position:fixed;display:none;width:min(420px,calc(100vw - 24px));max-height:min(430px,70vh);border:1px solid #bdd5ce;border-radius:14px;color:#173d35;background:#fbfefc;box-shadow:0 16px 48px rgba(16,55,45,.26);font:14px/1.62 system-ui,"Microsoft YaHei",sans-serif;overflow:hidden}.head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;color:#fff;background:#08735d}.head strong{font-size:14px}.head button{border:0;color:#fff;background:transparent;font-size:20px;cursor:pointer}.body{max-height:330px;padding:12px 14px;overflow:auto}.source{margin:0 0 10px;padding:9px 10px;border-radius:8px;color:#536b65;background:#edf4f2;font-size:12px;white-space:pre-wrap}.translation{margin:0;white-space:pre-wrap;user-select:text}.status{color:#60756f}.error{color:#9b2e2e}.actions{display:flex;justify-content:flex-end;gap:8px;padding:9px 12px;border-top:1px solid #dce7e3}.actions button{border:1px solid #b9cec8;border-radius:7px;padding:6px 10px;color:#245045;background:#fff;cursor:pointer}
    </style><button class="trigger" type="button" title="翻译选中文字">译</button><section class="card"><div class="head"><strong>科研译镜 · 划词翻译</strong><button class="close" type="button" aria-label="关闭">×</button></div><div class="body"><p class="source"></p><p class="translation status">正在翻译…</p></div><div class="actions"><button class="copy" type="button">复制译文</button></div></section>`;
    shadow.querySelector(".trigger").addEventListener("mousedown", event => event.preventDefault());
    shadow.querySelector(".trigger").onclick = () => quickTranslate(state.quickText, currentSelectionRect());
    shadow.querySelector(".close").onclick = hideQuickTranslateCard;
    shadow.querySelector(".copy").onclick = async event => {
      const text = shadow.querySelector(".translation").textContent;
      if (!text || shadow.querySelector(".translation").classList.contains("status")) return;
      try { await navigator.clipboard.writeText(text); event.currentTarget.textContent = "已复制"; setTimeout(() => event.currentTarget.textContent = "复制译文", 1200); } catch { event.currentTarget.textContent = "复制失败"; }
    };
    document.documentElement.append(host); state.quickHost = host; state.quickShadow = shadow; return shadow;
  }

  function currentSelectionRect() {
    const selection = getSelection(); if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    return selection.getRangeAt(0).getBoundingClientRect();
  }

  function showQuickTranslateTrigger() {
    const selection = getSelection(), text = selection?.toString().trim();
    if (!text || text.length < 2 || selection.rangeCount < 1) return hideQuickTranslateTrigger();
    const anchor = selection.anchorNode?.parentElement; if (anchor?.closest?.("input,textarea,[contenteditable='true'],.rt-hud")) return hideQuickTranslateTrigger();
    state.quickText = text; const rect = currentSelectionRect(); if (!rect || (!rect.width && !rect.height)) return;
    const shadow = ensureQuickTranslateUi(), button = shadow.querySelector(".trigger");
    button.style.left = `${Math.max(8, Math.min(innerWidth - 42, rect.right + 6))}px`; button.style.top = `${Math.max(8, Math.min(innerHeight - 42, rect.bottom + 6))}px`; button.style.display = "block";
  }

  function hideQuickTranslateTrigger() { state.quickShadow?.querySelector(".trigger")?.style.setProperty("display", "none"); }
  function hideQuickTranslateCard() { state.quickShadow?.querySelector(".card")?.style.setProperty("display", "none"); }

  async function quickTranslate(rawText, rect) {
    const text = String(rawText || "").trim(); if (!text) return;
    const shadow = ensureQuickTranslateUi(), card = shadow.querySelector(".card"), translation = shadow.querySelector(".translation");
    hideQuickTranslateTrigger(); shadow.querySelector(".source").textContent = text.length > 1600 ? `${text.slice(0, 1600)}…` : text;
    translation.textContent = text.length > 8000 ? "选中文字过长，请缩小选择范围后重试。" : "正在翻译…"; translation.className = text.length > 8000 ? "translation error" : "translation status";
    const anchor = rect && Number.isFinite(rect.left) ? rect : { left: innerWidth / 2 - 210, bottom: innerHeight / 2 - 80 };
    card.style.left = `${Math.max(8, Math.min(innerWidth - 432, anchor.left))}px`; card.style.top = `${Math.max(8, Math.min(innerHeight - 360, anchor.bottom + 10))}px`; card.style.display = "block";
    if (text.length > 8000) return;
    try {
      const result = await chrome.runtime.sendMessage({ type: "TRANSLATE_BATCH", texts: [text] }); if (!result?.ok) throw new Error(result?.error || "翻译失败");
      translation.textContent = result.translations[0]; translation.className = "translation";
    } catch (error) { translation.textContent = error.message || "翻译失败"; translation.className = "translation error"; }
  }
})();
