import {
  PROFESSIONAL_GLOSSARY_PRESET,
  migrateProfessionalGlossary,
  glossaryToCsv,
  glossaryToJson,
  normalizeGlossaryTerms,
  parseGlossaryText
} from "./glossary.mjs";
import { getProviderPreset, providerNeedsApiKey } from "./provider-presets.mjs";
import { chooseCacheDirectory, clearCacheDirectory, getCacheDirectoryInfo, syncInternalTranslationSessions } from "./cache-directory.mjs";

const ids = ["provider", "apiStyle", "endpoint", "apiKey", "model", "targetLanguage", "prompt"];
const $ = id => document.getElementById(id);
const body = $("glossary-body");
let providerKeys = {};
let activeProvider = "kimi_subscription";

await load();

async function load() {
  await migrateProfessionalGlossary(chrome.storage.local);
  const data = await chrome.storage.local.get([...ids, "providerKeys", "glossaryTerms"]);
  for (const id of ids) if (data[id] !== undefined) $(id).value = data[id];
  providerKeys = data.providerKeys && typeof data.providerKeys === "object" ? { ...data.providerKeys } : {};
  activeProvider = $("provider").value || "kimi_subscription";
  if (data.apiKey && !providerKeys[activeProvider]) providerKeys[activeProvider] = data.apiKey;
  $("apiKey").value = providerKeys[activeProvider] || "";
  renderProviderHelp();
  renderGlossary(normalizeGlossaryTerms(data.glossaryTerms));
  await renderCacheDirectory();
}

async function renderCacheDirectory() {
  const info = await getCacheDirectoryInfo();
  const choose = $("choose-cache-directory"), clear = $("clear-cache-directory");
  choose.disabled = !info.supported; clear.disabled = !info.configured;
  if (!info.supported) $("cache-directory-status").textContent = "当前浏览器不支持自定义目录，将继续使用浏览器内部缓存。";
  else if (!info.configured) $("cache-directory-status").textContent = "当前：浏览器内部缓存。可选择一个文件夹作为同步缓存目录。";
  else if (info.permission === "granted") $("cache-directory-status").textContent = `当前同步目录：${info.name}`;
  else $("cache-directory-status").textContent = `已配置目录：${info.name}，但浏览器需要重新授权；点击“选择或更换目录”。`;
}

$("choose-cache-directory").onclick = async () => {
  try { const info = await chooseCacheDirectory(); const count=await syncInternalTranslationSessions(); status(`缓存目录已改为：${info.name}；已同步 ${count} 篇现有缓存`); }
  catch (error) { if (error?.name !== "AbortError") status(`缓存目录设置失败：${error.message}`, true); }
  await renderCacheDirectory();
};

$("clear-cache-directory").onclick = async () => {
  await clearCacheDirectory(); await renderCacheDirectory(); status("已停用自定义目录，浏览器内部缓存不受影响");
};

function createTermRow(term = { source: "", target: "" }) {
  const row = document.createElement("tr");
  row.glossaryMetadata = { ...term };
  const sourceCell = document.createElement("td"), targetCell = document.createElement("td"), actionCell = document.createElement("td");
  const source = document.createElement("input"), target = document.createElement("input"), remove = document.createElement("button");
  source.className = "term-source"; source.placeholder = "例如 unbiased estimator"; source.value = term.source || ""; source.setAttribute("aria-label", "英文原词或缩写");
  target.className = "term-target"; target.placeholder = "例如 无偏估计量"; target.value = term.target || ""; target.setAttribute("aria-label", "标准译法或保留要求");
  source.oninput = target.oninput = updateGlossaryCount;
  remove.className = "remove-term"; remove.type = "button"; remove.textContent = "×"; remove.title = "删除此术语"; remove.setAttribute("aria-label", `删除术语 ${term.source || "空白行"}`);
  remove.onclick = () => { row.remove(); updateGlossaryCount(); };
  const aliases = document.createElement('input'), note = document.createElement('input');
  aliases.className = 'term-aliases'; aliases.value = (term.aliases || []).join(' | '); aliases.placeholder = '简称 / 别名（用 | 分隔）'; aliases.setAttribute('aria-label', '术语别名');
  note.className = 'term-note'; note.value = term.note || ''; note.placeholder = '语境与易混淆说明'; note.setAttribute('aria-label', '术语语境说明');
  if (term.domain) { source.title = `专业领域：${term.domain}`; }
  sourceCell.append(source, aliases); targetCell.append(target, note); actionCell.append(remove); row.append(sourceCell, targetCell, actionCell);
  return row;
}

function renderGlossary(terms) {
  body.replaceChildren(...terms.map(createTermRow));
  updateGlossaryCount();
}

function collectGlossary() {
  return normalizeGlossaryTerms([...body.rows].map(row => ({
    ...row.glossaryMetadata,
    source: row.querySelector(".term-source").value,
    target: row.querySelector(".term-target").value,
    note: row.querySelector('.term-note').value,
    aliases: row.querySelector('.term-aliases').value.split('|').map(s => s.trim()).filter(Boolean),
  })));
}

function updateGlossaryCount() {
  const count = collectGlossary().length;
  $("glossary-count").textContent = `${count} 条`;
  $("glossary-empty").classList.toggle("visible", body.rows.length === 0);
}

$("provider").onchange = () => {
  providerKeys[activeProvider] = $("apiKey").value.trim();
  activeProvider = $("provider").value;
  const preset = getProviderPreset(activeProvider);
  for (const key of ["apiStyle", "endpoint", "model"]) $(key).value = preset[key] || "";
  $("apiKey").value = providerKeys[activeProvider] || "";
  renderProviderHelp();
  status(providerNeedsApiKey(activeProvider)
    ? "已填入预设，请填写该服务商的 API Key 后测试"
    : activeProvider === "codex" || activeProvider === "kimi_subscription"
      ? `已选择套餐模式：请确认本地服务已启动，并已运行 ${activeProvider === "codex" ? "codex login" : "kimi login"}`
      : "已填入本地接口预设，请确认本地模型服务已经启动");
};

$("add-term").onclick = () => {
  const row = createTermRow(); body.append(row); updateGlossaryCount(); row.querySelector(".term-source").focus();
};

$("professional-preset").onclick = () => {
  const before = collectGlossary();
  const merged = normalizeGlossaryTerms([...before, ...PROFESSIONAL_GLOSSARY_PRESET]);
  renderGlossary(merged); status(`已加入 Quant Scholar 专业预置，新增 ${merged.length - before.length} 条`);
};

$("import-glossary").onclick = () => $("glossary-file").click();
$("glossary-file").onchange = async event => {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    const imported = parseGlossaryText(await file.text(), file.name);
    if (!imported.length) throw new Error("文件中没有找到完整的原词和译法");
    const before = collectGlossary(), merged = normalizeGlossaryTerms([...before, ...imported]);
    renderGlossary(merged); status(`已导入 ${imported.length} 条，新增 ${merged.length - before.length} 条；点击“保存设置”后生效`);
  } catch (error) { status(`导入失败：${error.message}`, true); }
  event.target.value = "";
};

$("export-glossary-json").onclick = () => download("Quant-Scholar-术语表.json", glossaryToJson(collectGlossary()), "application/json");
$("export-glossary-csv").onclick = () => download("Quant-Scholar-术语表.csv", glossaryToCsv(collectGlossary()), "text/csv;charset=utf-8");

async function saveSettings() {
  activeProvider = $("provider").value;
  providerKeys[activeProvider] = $("apiKey").value.trim();
  const data = Object.fromEntries(ids.map(id => [id, $(id).value.trim()]));
  data.providerKeys = providerKeys;
  data.glossaryTerms = collectGlossary();
  await chrome.storage.local.set(data);
  renderGlossary(data.glossaryTerms);
  status(`设置已保存，术语表 ${data.glossaryTerms.length} 条`);
}

$("save").onclick = saveSettings;
$("test").onclick = async () => {
  await saveSettings(); status("正在测试…");
  const result = await chrome.runtime.sendMessage({ type: "TRANSLATE_BATCH", texts: ["The unbiased estimator has lower variance under these assumptions."] });
  status(result?.ok ? `连接成功：${result.translations[0]}` : result?.error || "连接失败", !result?.ok);
};
$("reveal").onclick = () => { const input = $("apiKey"); input.type = input.type === "password" ? "text" : "password"; $("reveal").textContent = input.type === "password" ? "显示" : "隐藏"; };

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); status(`已导出 ${collectGlossary().length} 条术语`);
}
function renderProviderHelp() {
  const preset = getProviderPreset($("provider").value);
  $("provider-note").textContent = preset.note || "已预设官方接口地址和推荐模型；模型名可按账号实际可用模型修改。";
  const needsKey = providerNeedsApiKey($("provider").value);
  $("apiKey").disabled = !needsKey;
  $("reveal").disabled = !needsKey;
  $("apiKey").placeholder = needsKey ? "填写该服务商的 API Key" : "无需 API Key";
  $("api-key-note").textContent = needsKey
    ? "密钥只保存在本机；不同服务商会分别记忆各自的密钥。"
    : $("provider").value === "codex"
      ? "Codex 套餐模式只使用官方 CLI 的 ChatGPT 登录；检测到 API Key 登录时会主动停止，避免另行计费。"
      : $("provider").value === "kimi_subscription"
        ? "Kimi 套餐模式只使用官方 Kimi Code OAuth 登录；如需杜绝套餐外费用，请在 Kimi 账户中关闭 Extra Usage。"
      : "本地接口不会附带云端 API Key；请先启动本地模型服务器。";
}
function status(text, error = false) { $("status").textContent = text; $("status").classList.toggle("error", error); }
