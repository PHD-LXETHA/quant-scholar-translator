const EXCLUDED_ROLES = new Set(["figure-content", "artifact"]);

function textOf(block) {
  return String(block?.text || block?.source || "").replace(/\s+/g, " ").trim();
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function isDataDenseOcrPage(blocks = []) {
  const readable = blocks.map(textOf).filter(Boolean);
  return readable.length >= 90 && median(readable.map(text => text.length)) <= 30;
}

export function shouldPreserveOcrBlock(block, { dataDense = false } = {}) {
  if (EXCLUDED_ROLES.has(block?.role)) return true;
  const text = textOf(block);
  if (text.length < 2 || !/[A-Za-z]/.test(text)) return true;
  const compact = text.replace(/\s+/g, "");
  const words = text.match(/[A-Za-z][A-Za-z'’-]*/g) || [];
  const numbers = text.match(/[-+]?\d+(?:[.,]\d+)*(?:%|x)?/gi) || [];
  const digits = [...compact].filter(character => /\d/.test(character)).length;
  const alpha = [...compact].filter(character => /[A-Za-z]/.test(character)).length;
  const lines = Array.isArray(block?.lines) ? block.lines : [];
  const averageLine = compact.length / Math.max(1, lines.length);
  const numericTable = numbers.length >= 4 && (
    digits / Math.max(1, compact.length) >= 0.12 || (lines.length >= 3 && averageLine < 36)
  );
  const tickerLike = words.length <= 4 && text.length <= 24 && text.toUpperCase() === text;
  if (numericTable || tickerLike || alpha / Math.max(1, compact.length) < 0.35) return true;
  if (!dataDense) return false;
  const punctuation = (text.match(/[.!?;:]/g) || []).length;
  return !(text.length >= 72 && words.length >= 8 && punctuation >= 1);
}

export function applyOcrTranslationPolicy(blocks = []) {
  const dataDense = isDataDenseOcrPage(blocks);
  let preserved = 0;
  for (const block of blocks) {
    block.preserveOriginal = shouldPreserveOcrBlock(block, { dataDense });
    if (block.preserveOriginal) preserved += 1;
  }
  return { dataDense, preserved, translated: blocks.length - preserved };
}

export function isTranslatablePdfBlock(block) {
  return Boolean(block) && !block.preserveOriginal && !EXCLUDED_ROLES.has(block.role);
}
