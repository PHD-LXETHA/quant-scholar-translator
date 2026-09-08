const TYPE_LABELS = {
  "academic-paper": "学术论文",
  "research-report": "研究报告",
  newspaper: "报纸",
  magazine: "杂志",
  book: "图书",
  generic: "通用文档",
};

const terminalPunctuation = /[.!?。！？;；:：”’\])}]$/;
const structuralRoles = new Set(["heading", "figure-caption", "caption", "metadata"]);

function clean(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
function sourceName(value) { return clean(value).split(/[\\/]/).at(-1)?.toLowerCase() || ""; }
function textOfPages(pages, limit = 24) {
  return (pages || []).slice(0, limit).flatMap(page => page.blocks || []).map(block => clean(block.text)).join("\n");
}
function count(pattern, text) { return (text.match(pattern) || []).length; }

export function detectColumnBands(blocks, viewport) {
  const width = Math.max(1, Number(viewport?.width) || 1);
  const candidates = (blocks || []).filter(block => clean(block.text).length >= 2 && block.width < width * .72);
  if (!candidates.length) return [];
  const centers = candidates.map(block => ({ center: (block.x + block.right) / 2, block })).sort((a, b) => a.center - b.center);
  const threshold = Math.max(34, width * .105), groups = [];
  for (const item of centers) {
    const group = groups.at(-1);
    if (!group || item.center - group.mean > threshold) groups.push({ items: [item], mean: item.center });
    else { group.items.push(item); group.mean = group.items.reduce((sum, entry) => sum + entry.center, 0) / group.items.length; }
  }
  const substantial = groups.filter(group => group.items.length >= Math.max(2, candidates.length * .06));
  return substantial.slice(0, 4).map(group => ({
    center: group.mean,
    left: Math.min(...group.items.map(item => item.block.x)),
    right: Math.max(...group.items.map(item => item.block.right)),
    count: group.items.length,
  }));
}

export function orderBlocksForDocument(page, profile = {}) {
  const blocks = [...(page?.blocks || [])], viewport = page?.viewport || { width: 1, height: 1 };
  if (blocks.length < 2) return blocks;
  const bands = detectColumnBands(blocks, viewport);
  if (bands.length < 2) return blocks.sort((a, b) => a.y - b.y || a.x - b.x);
  const narrow = blocks.filter(block => block.width < viewport.width * .72);
  const spanning = blocks.filter(block => !narrow.includes(block)).sort((a, b) => a.y - b.y || a.x - b.x);
  const ordered = [], used = new Set();
  const appendRegion = (top, bottom) => {
    const region = narrow.filter(block => !used.has(block) && (block.y + (block.height || 0) / 2) >= top && (block.y + (block.height || 0) / 2) < bottom);
    const localBands = detectColumnBands(region, viewport);
    if (localBands.length < 2) region.sort((a, b) => a.y - b.y || a.x - b.x).forEach(block => { used.add(block); ordered.push(block); });
    else for (const band of localBands) region.filter(block => {
      const center = (block.x + block.right) / 2;
      return band === localBands.reduce((best, candidate) => Math.abs(center - candidate.center) < Math.abs(center - best.center) ? candidate : best, localBands[0]);
    }).sort((a, b) => a.y - b.y || a.x - b.x).forEach(block => { if (!used.has(block)) { used.add(block); ordered.push(block); } });
  };
  let top = -Infinity;
  for (const separator of spanning) {
    appendRegion(top, separator.y + (separator.height || 0) / 2);
    ordered.push(separator); top = separator.y + (separator.height || separator.fontSize || 0) / 2;
  }
  appendRegion(top, Infinity);
  narrow.filter(block => !used.has(block)).sort((a, b) => a.y - b.y || a.x - b.x).forEach(block => ordered.push(block));
  return ordered;
}

export function classifyPdfDocument({ source = "", pages = [], outlineCount = 0, forcedType = "auto" } = {}) {
  const name = sourceName(source), sample = textOfPages(pages), lower = sample.toLowerCase();
  const domain = /calculus|algebra|geometry|topology|analysis|derivative|integral|theorem|微积分|数学|代数|几何/.test(`${name}\n${lower}`) ? "mathematics" : "general";
  if (forcedType && forcedType !== "auto" && TYPE_LABELS[forcedType]) return { ...buildProfile(forcedType, true), domain };
  const pageCount = pages.length;
  const columnCounts = pages.slice(0, 40).map(page => detectColumnBands(page.blocks, page.viewport).length || 1);
  const multiColumnRatio = columnCounts.filter(value => value >= 2).length / Math.max(1, columnCounts.length);
  const threeColumnRatio = columnCounts.filter(value => value >= 3).length / Math.max(1, columnCounts.length);
  const imageRatio = pages.slice(0, 40).filter(page => (page.figureRegions || []).length >= 2).length / Math.max(1, Math.min(40, pageCount));
  const scores = {
    "academic-paper": count(/\babstract\b|\breferences\b|\bdoi\b|\bmethodology\b|\bhypothesi[sz]\b/gi, lower) * 3 + (outlineCount > 3 ? 2 : 0),
    "research-report": count(/investment thesis|price target|risk factors?|disclosures?|analyst certification|估值|投资建议|风险提示|免责声明/gi, sample) * 4,
    newspaper: count(/wall street journal|financial times|newspaper|日报|早报|晚报/gi, `${name}\n${sample.slice(0, 5000)}`) * 6 + multiColumnRatio * 5,
    magazine: count(/businessweek|magazine|economist|weekly|月刊|周刊|杂志/gi, `${name}\n${sample.slice(0, 5000)}`) * 6 + threeColumnRatio * 6 + imageRatio * 2,
    book: count(/table of contents|contents|chapter\s+\d+|preface|foreword|目录|第.{0,4}章/gi, lower) * 2 + (pageCount >= 180 ? 5 : 0) + (outlineCount >= 20 ? 5 : 0),
    generic: 1,
  };
  if (/论文|paper|journal|working paper|ssrn/.test(name)) scores["academic-paper"] += 8;
  if (/研报|research report|strategy|equity research/.test(name)) scores["research-report"] += 9;
  if (/日报|报纸|journal\b|times\b/.test(name)) scores.newspaper += 7;
  if (/杂志|businessweek|economist|magazine/.test(name)) scores.magazine += 9;
  if (/handbook|textbook|book|教程|手册|教材/.test(name)) scores.book += 8;
  const [type, score] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return { ...buildProfile(type, false), domain, confidence: Math.min(.98, Math.max(.45, score / (score + 7))), diagnostics: { pageCount, outlineCount, multiColumnRatio, threeColumnRatio, imageRatio } };
}

function buildProfile(type, forced) {
  const policies = {
    "academic-paper": { preserveEvidence: true, preserveReferences: true, mergeAcrossPages: true, maxUnitChars: 2600 },
    "research-report": { preserveEvidence: true, preserveDisclosures: true, mergeAcrossPages: true, maxUnitChars: 2300 },
    newspaper: { preserveEvidence: true, mergeAcrossPages: false, maxUnitChars: 1700 },
    magazine: { preserveEvidence: true, mergeAcrossPages: false, maxUnitChars: 1900 },
    book: { preserveCode: true, preserveFigures: true, mergeAcrossPages: true, maxUnitChars: 2800 },
    generic: { mergeAcrossPages: false, maxUnitChars: 2200 },
  };
  return { type, label: TYPE_LABELS[type], forced, ...(policies[type] || policies.generic) };
}

function shouldKeepSeparate(block) {
  const text = clean(block?.text);
  return structuralRoles.has(block?.role) || block?.preserveOriginal || block?.role === "reference" || /^(?:references|bibliography|参考文献)\b/i.test(text);
}
function canJoin(previous, next, profile, crossedPage) {
  if (!previous || !next || shouldKeepSeparate(previous) || shouldKeepSeparate(next)) return false;
  if (crossedPage && !profile.mergeAcrossPages) return false;
  if (!crossedPage && Math.abs((previous.x || 0) - (next.x || 0)) > Math.max(58, Math.min(previous.width || 0, next.width || 0) * .55)) return false;
  const a = clean(previous.text), b = clean(next.text);
  if (!a || !b || a.length + b.length > profile.maxUnitChars) return false;
  if (terminalPunctuation.test(a)) return false;
  if (/^[A-Z][A-Z\s\d&-]{4,}$/.test(b) || /^\d+(?:\.\d+)*\s+\p{Lu}/u.test(b)) return false;
  return crossedPage ? /^[a-z(\[“‘]/.test(b) : true;
}

export function buildStructuredTranslationUnits(pages, profile = buildProfile("generic", false), predicate = () => true) {
  const units = [];
  for (const page of pages || []) {
    const ordered = orderBlocksForDocument(page, profile).filter(predicate);
    for (const block of ordered) {
      const previousUnit = units.at(-1), previous = previousUnit?.blocks?.at(-1);
      const crossedPage = Boolean(previousUnit && !previousUnit.pages.includes(page));
      if (previousUnit && canJoin(previous, block, profile, crossedPage) && previousUnit.text.length + clean(block.text).length + 1 <= profile.maxUnitChars) {
        previousUnit.blocks.push(block); if (!previousUnit.pages.includes(page)) previousUnit.pages.push(page);
        previousUnit.text = `${previousUnit.text} ${clean(block.text)}`;
      } else {
        units.push({ id: `qs-pdf-${page.number}-${units.length + 1}`, page, pages: [page], blocks: [block], anchor: block, text: clean(block.text), role: block.role || "body" });
      }
    }
  }
  return units;
}

export function unitHasTranslation(unit) {
  return Boolean(unit?.anchor?.structuredTranslation || (unit?.blocks?.length && unit.blocks.every(block => block.translation)));
}

function splitForMembers(text, members) {
  if (members.length <= 1) return [text];
  const segments = String(text || "").match(/[^。！？.!?]+[。！？.!?]?\s*/g)?.filter(value => value.trim()) || [String(text || "")];
  const totalSource = members.reduce((sum, block) => sum + clean(block.text).length, 0) || members.length;
  const targets = members.map(block => clean(block.text).length / totalSource * String(text || "").length);
  const result = members.map(() => ""); let member = 0, consumed = 0;
  for (const segment of segments) {
    if (member < members.length - 1 && consumed >= targets.slice(0, member + 1).reduce((a, b) => a + b, 0)) member += 1;
    result[member] += segment; consumed += segment.length;
  }
  const joined = String(text || "").trim();
  if (result.every(value => value.trim())) return result.map(value => value.trim());
  let sourceOffset = 0;
  return members.map((block, index) => {
    const nextSourceOffset = sourceOffset + clean(block.text).length;
    const start = Math.round(sourceOffset / totalSource * joined.length);
    const end = index === members.length - 1 ? joined.length : Math.round(nextSourceOffset / totalSource * joined.length);
    sourceOffset = nextSourceOffset;
    return joined.slice(start, Math.max(start + 1, end)).trim() || "…";
  });
}

export function applyStructuredTranslation(unit, translation) {
  const value = clean(translation); if (!value || !unit?.blocks?.length) return false;
  const parts = splitForMembers(value, unit.blocks);
  unit.blocks.forEach((block, index) => {
    block.translation = parts[index] || (index === 0 ? value : "");
    block.structuredUnitId = unit.id; block.structuredAnchor = index === 0;
  });
  unit.anchor.structuredSource = unit.text; unit.anchor.structuredTranslation = value;
  return true;
}

export function documentTypeOptions() { return Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label })); }
