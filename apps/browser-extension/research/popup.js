const $ = id => document.getElementById(id);
let tab;

init();
async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isWeb = /^https?:/.test(tab?.url || "");
  const localPdf = isLocalPdf(tab?.url || "");
  const enhancedPdfReader = isEnhancedPdfReader(tab?.url || "");
  $("translate").disabled = !isWeb;
  $("pdf").disabled = !(isWeb || localPdf);
  if (localPdf) {
    $("translate").disabled = true;
    $("translate").textContent = "本地 PDF 请使用下方阅读器";
    $("original").disabled = true;
    $("translated").disabled = true;
    $("pdf").classList.remove("secondary");
    $("pdf").classList.add("primary");
    const allowed = await chrome.extension.isAllowedFileSchemeAccess();
    $("pdf").textContent = allowed ? "在 PDF 翻译阅读器中打开" : "打开阅读器并选择本地 PDF";
    setStatus(allowed
      ? "已检测到本地 PDF，可以直接送入科研译镜。"
      : "如需今后一键打开：进入 Edge 扩展管理 → 科研译镜 → 详细信息，开启“允许访问文件 URL”。本次也可在阅读器中重新选择文件。", false, true);
    return;
  }
  if (enhancedPdfReader) {
    $("translate").disabled = true;
    $("translate").textContent = "此页面是论文 PDF 阅读器";
    $("original").disabled = true;
    $("translated").disabled = true;
    $("pdf").textContent = "解析 PDF 并在科研译镜中打开";
    $("pdf").classList.remove("secondary");
    $("pdf").classList.add("primary");
    setStatus("检测到增强型 PDF。请使用绿色按钮，不要翻译阅读器网页。", false, true);
    return;
  }
  try {
    const s = await chrome.tabs.sendMessage(tab.id, { type: "GET_STATUS" });
    if (s?.running) setStatus("翻译正在进行中…");
    else if (s?.count) setStatus(s.translated ? `正在显示译文（${s.count} 段）` : `已缓存译文（${s.count} 段）`);
  } catch {}
}

function isEnhancedPdfReader(value) {
  try {
    const url = new URL(value);
    const path = url.pathname.toLowerCase();
    return /\/doi\/epdf\//.test(path)
      || /\/stamp\/stamp\.jsp$/.test(path)
      || /\/enhanced-reader\//.test(path)
      || /\/pdf-reader\//.test(path);
  } catch { return false; }
}

function isLocalPdf(value) {
  try {
    const url = new URL(value);
    return url.protocol === "file:" && /\.pdf$/i.test(url.pathname);
  } catch { return false; }
}

$("translate").onclick = async () => {
  setStatus("已开始翻译，可关闭此窗口");
  try {
    const result = await chrome.tabs.sendMessage(tab.id, { type: "TRANSLATE_PAGE" });
    setStatus(result?.ok ? `完成：${result.count} 段` : result?.error || "翻译失败", !result?.ok);
  } catch { setStatus("此页面无法注入翻译器，请刷新页面后重试", true); }
};
$("original").onclick = () => send("SHOW_ORIGINAL", "已切换为原文");
$("translated").onclick = () => send("SHOW_TRANSLATION", "已切换为译文");
$("settings").onclick = () => chrome.runtime.openOptionsPage();
$("pdf").onclick = async () => {
  if (isLocalPdf(tab?.url || "")) {
    const allowed = await chrome.extension.isAllowedFileSchemeAccess();
    setStatus(allowed ? "正在读取本地 PDF…" : "正在打开阅读器，请点击顶部“本地 PDF”重新选择文件。", false, !allowed);
    const query = allowed ? `url=${encodeURIComponent(tab.url)}` : "local=select";
    await chrome.tabs.create({ url: chrome.runtime.getURL(`pdf-viewer.html?${query}`) });
    return;
  }
  setStatus("正在识别论文阅读器并寻找 PDF…");
  await chrome.tabs.create({ url: chrome.runtime.getURL(`pdf-viewer.html?url=${encodeURIComponent(tab.url)}`) });
};

async function send(type, message) { try { await chrome.tabs.sendMessage(tab.id, { type }); setStatus(message); } catch { setStatus("当前页面不可用", true); } }
function setStatus(text, error = false, hint = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
  $("status").classList.toggle("hint", hint);
}
