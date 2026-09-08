const STABLE_FINGERPRINT_ROLES = new Set(["heading", "body", "figure-caption"]);

export function normalizePdfSourceText(value) {
  return String(value || "").normalize("NFKC").replace(/[\u00ad\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim();
}

export function isVolatilePublisherText(value) {
  const text = normalizePdfSourceText(value);
  return /(?:downloaded\s+(?:by|via|from)|authorized\s+user|ip\s+address|accessed\s+on|terms\s+and\s+conditions|for\s+personal\s+use\s+only|institutional\s+access)/i.test(text);
}

export function buildStableDocumentSignature(pages) {
  let meaningfulCharacters = 0;
  const pageParts = (pages || []).map((page, pageIndex) => {
    const parts = (page.blocks || [])
      .filter(block => STABLE_FINGERPRINT_ROLES.has(block.role || "body"))
      .map(block => normalizePdfSourceText(block.text))
      .filter(text => text.length >= 8 && !isVolatilePublisherText(text));
    const text = parts.join(" ");
    meaningfulCharacters += text.length;
    return `${page.number || pageIndex + 1}:${text}`;
  });
  return meaningfulCharacters >= 200 ? `researchlens-semantic-v1|pages:${pageParts.length}|${pageParts.join("\u241e")}` : "";
}

function pageBlocks(page) { return Array.isArray(page) ? page : (page?.blocks || []); }

export function matchCachedTranslations(currentPages, savedPages) {
  const current = (currentPages || []).map(pageBlocks);
  const saved = (savedPages || []).map(pageBlocks);
  const used = new Set(), matches = [], matchedCurrent = new Set();
  const savedId = (pageIndex, blockIndex) => `${pageIndex}:${blockIndex}`;
  const currentId = (pageIndex, blockIndex) => `${pageIndex}:${blockIndex}`;

  function accept(pageIndex, blockIndex, savedPageIndex, savedBlockIndex) {
    const candidate = saved[savedPageIndex]?.[savedBlockIndex];
    if (!candidate?.translation) return false;
    const sid = savedId(savedPageIndex, savedBlockIndex), cid = currentId(pageIndex, blockIndex);
    if (used.has(sid) || matchedCurrent.has(cid)) return false;
    used.add(sid); matchedCurrent.add(cid);
    matches.push({
      pageIndex,
      blockIndex,
      translation: candidate.translation,
      structuredSource: candidate.structuredSource || "",
      structuredTranslation: candidate.structuredTranslation || "",
      structuredUnitId: candidate.structuredUnitId || "",
      structuredAnchor: Boolean(candidate.structuredAnchor),
    });
    return true;
  }

  // Preserve the fastest and safest path for an identical PDF layout.
  for (let pageIndex = 0; pageIndex < current.length; pageIndex += 1) {
    for (let blockIndex = 0; blockIndex < current[pageIndex].length; blockIndex += 1) {
      const source = normalizePdfSourceText(current[pageIndex][blockIndex]?.text);
      const cached = saved[pageIndex]?.[blockIndex];
      if (source && source === normalizePdfSourceText(cached?.source ?? cached?.text)) accept(pageIndex, blockIndex, pageIndex, blockIndex);
    }
  }

  function buildBuckets(pageIndexes) {
    const buckets = new Map();
    for (const savedPageIndex of pageIndexes) {
      for (let savedBlockIndex = 0; savedBlockIndex < (saved[savedPageIndex] || []).length; savedBlockIndex += 1) {
        const item = saved[savedPageIndex][savedBlockIndex], sid = savedId(savedPageIndex, savedBlockIndex);
        if (!item?.translation || used.has(sid)) continue;
        const key = normalizePdfSourceText(item.source ?? item.text); if (!key) continue;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push({ savedPageIndex, savedBlockIndex });
      }
    }
    return buckets;
  }

  function matchFromBuckets(pageIndexes, buckets) {
    for (const pageIndex of pageIndexes) {
      for (let blockIndex = 0; blockIndex < current[pageIndex].length; blockIndex += 1) {
        if (matchedCurrent.has(currentId(pageIndex, blockIndex))) continue;
        const key = normalizePdfSourceText(current[pageIndex][blockIndex]?.text), queue = buckets.get(key);
        while (queue?.length) {
          const candidate = queue.shift();
          if (accept(pageIndex, blockIndex, candidate.savedPageIndex, candidate.savedBlockIndex)) break;
        }
      }
    }
  }

  // An inserted watermark or footer should not shift every later paragraph.
  for (let pageIndex = 0; pageIndex < current.length; pageIndex += 1) matchFromBuckets([pageIndex], buildBuckets([pageIndex]));
  matchFromBuckets(current.map((_, index) => index), buildBuckets(saved.map((_, index) => index)));
  return matches;
}

export function sessionContentSimilarity(currentPages, savedPages) {
  const frequency = pages => {
    const map = new Map(); let characters = 0;
    for (const page of pages || []) for (const block of pageBlocks(page)) {
      const text = normalizePdfSourceText(block?.source ?? block?.text);
      if (text.length < 20 || isVolatilePublisherText(text)) continue;
      const item = map.get(text) || { count: 0, length: text.length };
      item.count += 1; map.set(text, item); characters += text.length;
    }
    return { map, characters };
  };
  const current = frequency(currentPages), saved = frequency(savedPages);
  let matchedCharacters = 0, matchedBlocks = 0;
  for (const [text, item] of current.map) {
    const other = saved.map.get(text); if (!other) continue;
    const count = Math.min(item.count, other.count);
    matchedBlocks += count; matchedCharacters += count * item.length;
  }
  const denominator = current.characters + saved.characters;
  return { score: denominator ? 2 * matchedCharacters / denominator : 0, matchedCharacters, matchedBlocks };
}

export function isCompatibleTranslationSession(similarity) {
  return Boolean(similarity && similarity.score >= 0.72 && similarity.matchedCharacters >= 300 && similarity.matchedBlocks >= 5);
}
