import { QUANT_SCHOLAR_GLOSSARY_PRESET } from "./domain-preset.mjs";

// Removal signatures only: never include these retired defaults in prompts or presets.
const RETIRED_MATERIAL_TERMS = Object.freeze([
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

export const PROFESSIONAL_GLOSSARY_PRESET = QUANT_SCHOLAR_GLOSSARY_PRESET;

export async function migrateProfessionalGlossary(storage) {
  const key = "quantScholarMaterialTermsRemovedV1";
  const saved = await storage.get([key, "glossaryTerms"]);
  if (saved[key]) {
    await upgradeProfessionalGlossary(storage);
    await upgradeProfessionalGlossaryV3(storage);
    await upgradeProfessionalGlossaryV4(storage);
    return upgradeProfessionalGlossaryV5(storage);
  }
  const update = { [key]: true };
  if (Array.isArray(saved.glossaryTerms)) {
    // Match the original pair, not just the word, to preserve user-edited translations.
    const retired = new Set(RETIRED_MATERIAL_TERMS.map(({ source, target }) => `${source.toLowerCase()}\u0000${target}`));
    const cleaned = saved.glossaryTerms.filter(item => {
      const source = String(Array.isArray(item) ? item[0] : item?.source ?? item?.term ?? "").trim().toLowerCase();
      const target = String(Array.isArray(item) ? item[1] : item?.target ?? item?.translation ?? "").trim();
      return !retired.has(`${source}\u0000${target}`);
    });
    if (cleaned.length !== saved.glossaryTerms.length) update.glossaryTerms = cleaned;
  }
  await storage.set(update);
  await upgradeProfessionalGlossary(storage);
  await upgradeProfessionalGlossaryV3(storage);
  await upgradeProfessionalGlossaryV4(storage);
  await upgradeProfessionalGlossaryV5(storage);
}

async function upgradeProfessionalGlossary(storage) {
  const key = 'quantScholarContextualGlossaryV2';
  const saved = await storage.get([key, 'glossaryTerms']);
  if (saved[key]) return;
  const update = { [key]: true };
  // An intentionally empty glossary stays empty. Never overwrite user wording.
  if (Array.isArray(saved.glossaryTerms) && saved.glossaryTerms.length) {
    const terms = normalizeGlossaryTerms(saved.glossaryTerms);
    const existing = new Set(terms.map(item => item.source.toLowerCase()));
    const enhanced = saved.glossaryTerms.map(raw => {
      const item = normalizeGlossaryTerms([raw])[0];
      if (!item) return raw;
      const preset = PROFESSIONAL_GLOSSARY_PRESET.find(p => p.source.toLowerCase() === item.source.toLowerCase() && p.target === item.target && (!item.domain || p.domain === item.domain));
      return preset ? { ...preset, ...(Array.isArray(raw) ? {} : raw), ...item } : raw;
    });
    update.glossaryTerms = [...enhanced, ...PROFESSIONAL_GLOSSARY_PRESET.filter(p => !existing.has(p.source.toLowerCase()))];
  }
  await storage.set(update);
}

async function upgradeProfessionalGlossaryV3(storage) {
  return mergeMissingProfessionalDefaults(storage, 'quantScholarContextualGlossaryV3');
}

async function upgradeProfessionalGlossaryV4(storage) {
  return mergeMissingProfessionalDefaults(storage, 'quantScholarContextualGlossaryV4');
}

async function upgradeProfessionalGlossaryV5(storage) {
  return mergeMissingProfessionalDefaults(storage, 'quantScholarContextualGlossaryV5');
}

async function mergeMissingProfessionalDefaults(storage, key) {
  const saved = await storage.get([key, 'glossaryTerms']);
  if (saved[key]) return;
  const update = { [key]: true };
  // Preserve generic user terms as an override for every built-in sense. For
  // domain-qualified terms, merge by source+domain so conflicting legitimate
  // senses such as statistics/mathematics "power" are not silently dropped.
  if (Array.isArray(saved.glossaryTerms) && saved.glossaryTerms.length) {
    const normalized = normalizeGlossaryTerms(saved.glossaryTerms);
    const generic = new Set(normalized.filter(item => !item.domain).map(item => normalizeTerm(item.source)));
    const qualified = new Set(normalized.filter(item => item.domain).map(item => `${normalizeTerm(item.source)}\0${item.domain}`));
    const additions = PROFESSIONAL_GLOSSARY_PRESET.filter(item => {
      const source = normalizeTerm(item.source);
      return !generic.has(source) && !qualified.has(`${source}\0${item.domain}`);
    });
    if (additions.length) update.glossaryTerms = [...saved.glossaryTerms, ...additions];
  }
  await storage.set(update);
}

export function normalizeGlossaryTerms(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    const source = String(Array.isArray(item) ? item[0] : item?.source ?? item?.term ?? "").trim();
    const target = String(Array.isArray(item) ? item[1] : item?.target ?? item?.translation ?? "").trim();
    if (!source || !target) continue;
    const domain = !Array.isArray(item) && typeof item?.domain === 'string' ? item.domain.trim() : '';
    const key = `${source.toLowerCase()}\u0000${domain}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = { source, target };
    if (domain) entry.domain = domain;
    if (!Array.isArray(item) && typeof item?.note === 'string' && item.note.trim()) entry.note = item.note.trim();
    if (!Array.isArray(item) && Array.isArray(item?.aliases)) {
      const aliases = [...new Set(item.aliases.filter(a => typeof a === 'string' && a.trim()).map(a => a.trim()))];
      if (aliases.length) entry.aliases = aliases;
    }
    if (!Array.isArray(item) && item?.requiresContext === true) entry.requiresContext = true;
    result.push(entry);
  }
  if (result.length > 5000) throw new Error('术语超过 5000 条，请拆分导入；未静默丢弃词条');
  return result;
}

export function normalizeTerm(value) {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/’/g, "'").replace(/[-–—‑]/g, ' ').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function selectGlossaryTerms(value, text, limit = 60) {
  const terms = normalizeGlossaryTerms(value);
  if (!String(text || '').trim()) return terms.slice(0, limit);
  const input = normalizeTerm(text);
  const ranked = terms.map((item, index) => {
    const matches = [item.source, ...(item.aliases || [])].map(normalizeTerm).filter(term => {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return term && new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`).test(input);
    });
    const score = Math.max(0, ...matches.map(term => term.length));
    return { item, index, score, matches };
  }).filter(row => row.score).sort((a, b) => b.score - a.score || a.index - b.index);
  // Generic user overrides take precedence over domain-qualified defaults.
  const overrides = new Set(ranked.filter(r => !r.item.domain).map(r => normalizeTerm(r.item.source)));
  const filtered = ranked.filter(r => !r.item.domain || !overrides.has(normalizeTerm(r.item.source)));
  const aliasGroups = new Map();
  for (const row of filtered) {
    for (const key of row.matches) {
      if (!aliasGroups.has(key)) aliasGroups.set(key, []);
      aliasGroups.get(key).push(row);
    }
  }
  const domainEvidence = new Map();
  for (const row of filtered) {
    if (!row.item.domain) continue;
    domainEvidence.set(row.item.domain, (domainEvidence.get(row.item.domain) || 0) + row.score);
  }
  const allowed = new Set(filtered);
  for (const row of filtered) {
    if (!row.item.requiresContext || !row.item.domain) continue;
    // A short, polysemous term such as "duration" is safe only when another
    // matched term independently establishes the same professional domain.
    const independentEvidence = (domainEvidence.get(row.item.domain) || 0) - row.score;
    if (independentEvidence <= 0) allowed.delete(row);
  }
  for (const rows of aliasGroups.values()) {
    const targets = new Set(rows.map(row => row.item.target));
    if (targets.size <= 1 || rows.some(row => !row.item.domain)) continue;
    const scores = rows.map(row => domainEvidence.get(row.item.domain) || 0);
    const best = Math.max(...scores);
    if (scores.filter(score => score === best).length === 1) {
      const winner = rows[scores.indexOf(best)];
      rows.filter(row => row !== winner).forEach(row => allowed.delete(row));
    } else rows.forEach(row => allowed.delete(row));
    // A tie means the surrounding text cannot disambiguate safely. Omit both
    // hints and let the translation model retain or infer the source sense.
  }
  return filtered.filter(row => allowed.has(row)).slice(0, limit).map(row => row.item);
}

export function formatGlossaryPrompt(value, text = '') {
  const terms = selectGlossaryTerms(value, text);
  if (!terms.length) return "";
  const lines = terms.map(({ source, target, note, domain, aliases }) => `- ${source} => ${target}${domain ? ` [${domain}]` : ''}${note ? `；语境：${note}` : ''}${aliases?.length ? `；别名：${aliases.join(' / ')}` : ''}`);
  // Whole entries only, with a bounded prompt rather than a full-dictionary dump.
  const bounded = []; let chars = 0;
  for (const line of lines) { if (chars + line.length > 10000) break; bounded.push(line); chars += line.length; }
  return `\n\n用户术语表（按原文语境使用，不做机械替换；同词不同领域时结合上下文选择，歧义无法确定时保留英文；不得改写代码、公式或变量）：\n${bounded.join('\n')}`;
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
  const header = rows.length && /^(source|term|英文|原文)$/i.test(rows[0][0]?.trim()) ? rows.shift().map(cell => cell.trim().toLowerCase()) : null;
  const column = (name, position) => header ? header.indexOf(name) : position;
  return normalizeGlossaryTerms(rows.map(row => {
    let aliases = [];
    const aliasText = row[column('aliases', 4)];
    if (aliasText?.trim()) {
      try { aliases = JSON.parse(aliasText); } catch { aliases = aliasText.split('|'); }
    }
    const contextValue = row[column('requirescontext', 5)];
    return {
      source: row[0], target: row[1], domain: row[column('domain', 2)], note: row[column('note', 3)], aliases,
      requiresContext: /^(1|true|yes)$/i.test(String(contextValue || '').trim())
    };
  }));
}

function csvCell(value) { return `"${String(value).replaceAll('"', '""')}"`; }
export function glossaryToCsv(value) {
  const lines = ["source,target,domain,note,aliases,requiresContext", ...normalizeGlossaryTerms(value).map(item => [item.source, item.target, item.domain || '', item.note || '', item.aliases?.length ? JSON.stringify(item.aliases) : '', item.requiresContext === true ? 'true' : ''].map(csvCell).join(','))];
  return `\uFEFF${lines.join("\r\n")}`;
}
export function glossaryToJson(value) { return JSON.stringify({ version: 2, terms: normalizeGlossaryTerms(value) }, null, 2); }
