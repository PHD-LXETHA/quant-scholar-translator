import { QUANT_SCHOLAR_GLOSSARY_PRESET } from "./domain-preset.mjs";

const LEGACY_BATTERY_GLOSSARY_PRESET = Object.freeze([
  ["layered oxide", "层状氧化物"],
  ["rock-salt phase", "岩盐相"],
  ["spinel phase", "尖晶石相"],
  ["cation mixing", "阳离子混排"],
  ["cation ordering", "阳离子有序化"],
  ["oxygen redox", "氧氧化还原"],
  ["anionic redox", "阴离子氧化还原"],
  ["lattice oxygen", "晶格氧"],
  ["oxygen vacancy", "氧空位"],
  ["oxygen ligand hole", "氧配体空穴"],
  ["transition-metal migration", "过渡金属迁移"],
  ["slab gliding", "层板滑移"],
  ["surface reconstruction", "表面重构"],
  ["interfacial reconstruction", "界面重构"],
  ["voltage hysteresis", "电压滞后"],
  ["voltage decay", "电压衰减"],
  ["capacity retention", "容量保持率"],
  ["rate capability", "倍率性能"],
  ["Coulombic efficiency", "库仑效率"],
  ["desodiation", "脱钠"],
  ["sodiation", "嵌钠"],
  ["delithiation", "脱锂"],
  ["lithiation", "嵌锂"],
  ["solid-solution reaction", "固溶反应"],
  ["two-phase reaction", "两相反应"],
  ["Jahn–Teller distortion", "Jahn–Teller 畸变"],
  ["state of charge", "荷电状态"],
  ["SEI", "SEI（保留缩写）"],
  ["CEI", "CEI（保留缩写）"],
  ["O3 / P2 / P3 / O2", "保持原样，不翻译"]
].map(([source, target]) => Object.freeze({ source, target })));

export const BATTERY_GLOSSARY_PRESET = Object.freeze([
  ...QUANT_SCHOLAR_GLOSSARY_PRESET,
  ...LEGACY_BATTERY_GLOSSARY_PRESET
]);
export const PROFESSIONAL_GLOSSARY_PRESET = BATTERY_GLOSSARY_PRESET;

export function normalizeGlossaryTerms(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    const source = String(Array.isArray(item) ? item[0] : item?.source ?? item?.term ?? "").trim();
    const target = String(Array.isArray(item) ? item[1] : item?.target ?? item?.translation ?? "").trim();
    if (!source || !target) continue;
    const key = source.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ source, target });
  }
  return result.slice(0, 500);
}

export function formatGlossaryPrompt(value) {
  const terms = normalizeGlossaryTerms(value);
  if (!terms.length) return "";
  return `\n\n用户术语表（优先于一般译法；化学式、缩写和符号按右栏要求处理）：\n${terms.map(({ source, target }) => `- ${source} => ${target}`).join("\n")}`;
}

function parseCsvRows(text) {
  const rows = []; let row = []; let cell = ""; let quoted = false;
  const input = String(text).replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (char !== "\r") cell += char;
  }
  row.push(cell); if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

export function parseGlossaryText(text, format = "") {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const isJson = /json/i.test(format) || /^[\[{]/.test(raw);
  if (isJson) {
    const parsed = JSON.parse(raw);
    return normalizeGlossaryTerms(Array.isArray(parsed) ? parsed : parsed?.terms ?? parsed?.glossaryTerms);
  }
  const rows = parseCsvRows(raw);
  if (rows.length && /^(source|term|英文|原文)$/i.test(rows[0][0]?.trim())) rows.shift();
  return normalizeGlossaryTerms(rows.map(row => ({ source: row[0], target: row[1] })));
}

function csvCell(value) { return `"${String(value).replaceAll('"', '""')}"`; }
export function glossaryToCsv(value) {
  const lines = ["source,target", ...normalizeGlossaryTerms(value).map(item => `${csvCell(item.source)},${csvCell(item.target)}`)];
  return `\uFEFF${lines.join("\r\n")}`;
}
export function glossaryToJson(value) { return JSON.stringify({ version: 1, terms: normalizeGlossaryTerms(value) }, null, 2); }
