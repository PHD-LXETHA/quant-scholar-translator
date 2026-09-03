import { isReferenceEntryStart } from "./reference-list.mjs";

function multiply(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
  ];
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function weightedMedian(items) {
  const values = items
    .map(item => ({ value: Number(item?.value), weight: Math.max(0, Number(item?.weight) || 0) }))
    .filter(item => Number.isFinite(item.value) && item.weight > 0)
    .sort((a, b) => a.value - b.value);
  if (!values.length) return 0;
  const midpoint = values.reduce((sum, item) => sum + item.weight, 0) / 2;
  let cumulative = 0;
  for (const item of values) {
    cumulative += item.weight;
    if (cumulative >= midpoint) return item.value;
  }
  return values.at(-1).value;
}

const FIGURE_CAPTION_PATTERN = /^(?:(?:supplementary|supporting)\s+)?(?:fig(?:ure)?\.?|scheme|table|图|表)\s*(?:s(?:upp(?:lementary)?)?[\s.-]*)?[\d一二三四五六七八九十]+[a-z]?(?:[-–]\d+)?(?:[.:：、|\s]|$)/i;

export function isFigureCaptionText(text) {
  return FIGURE_CAPTION_PATTERN.test(String(text || "").trim());
}

export function isTableCaptionText(text) {
  return /^(?:(?:supplementary|supporting)\s+)?(?:table|表)\s*(?:s(?:upp(?:lementary)?)?[\s.-]*)?[\d一二三四五六七八九十]+[a-z]?(?:[-–]\d+)?(?:[.:：、|\s]|$)/i.test(String(text || "").trim());
}

function looksLikeTableGridBlock(block) {
  const text = String(block?.text || "").trim();
  const segmentCount = Math.max(0, ...(block?.lines || []).map(line => line.segments?.length || 0));
  const numericCells = text.match(/(?:^|\s)[−+]?\d+(?:\.\d+)?(?:\s*±\s*\d+(?:\.\d+)?)?(?=\s|$|%)/g) || [];
  const headerCells = text.match(/\b(?:Jsc|Voc|PCE|FF|CE|EE|Rct|Rs|capacity|voltage|current|sample|entry|yield|selectivity)\b/gi) || [];
  const unitCells = text.match(/(?:mA|mAh|V|A|Ω|ohm|cm|g|kg|mol|wt|at)\s*(?:cm|g|kg|mol)?\s*[−-]?\d*|%/gi) || [];
  return segmentCount >= 3 && (numericCells.length >= 2 || headerCells.length >= 2 || unitCells.length >= 2);
}

function isPageFurnitureBlock(block, viewport) {
  const text = String(block?.text || "").replace(/\s+/g, " ").trim();
  const publisherNotice = /(?:downloaded\s+(?:by|on|from)|terms-and-conditions|wiley\s+online\s+library|creative\s+commons\s+license)/i.test(text);
  const outsideContentColumn = block.x >= viewport.width * .94 || block.right <= viewport.width * .06 || block.width >= viewport.width * 1.08;
  if (publisherNotice && outsideContentColumn) return true;
  if (/^How to cite\s*:/i.test(text) || /^©\s*(?:19|20)\d{2}\b/.test(text)) return true;
  if (block.y < viewport.height * .92) return false;
  return /^\d+\s+(?:of|\/)\s+\d+$/i.test(text)
    || /^[A-Za-z][A-Za-z &.-]+,\s*(?:19|20)\d{2}$/i.test(text)
    || /(?:https?:\/\/|doi\.org\/|\bdoi\s*:)/i.test(text);
}

function looksLikeCompactTitleHeading(block, bodySize) {
  const text = String(block?.text || "").trim();
  if (!text || text.length > 120 || block.lines.length > 3 || /[.!?;:]$/.test(text)) return false;
  if (block.fontSize < bodySize * 1.055) return false;
  const words = text.match(/[A-Za-z][A-Za-z'-]*/g) || [];
  if (!words.length || words.length > 14) return false;
  const insignificant = /^(?:a|an|and|as|at|by|for|from|in|into|of|on|or|the|to|via|with)$/i;
  const significant = words.filter(word => !insignificant.test(word));
  if (!significant.length) return false;
  const titleWords = significant.filter(word => /^[A-Z][A-Za-z'-]*$/.test(word) || /^[A-Z]{2,}$/.test(word));
  return titleWords.length / significant.length >= .65;
}

function semanticHeadingLevel(text) {
  const value=String(text||"").trim();
  if(isReferenceEntryStart(value))return 0;
  const numbered=value.match(/^(S?\d+(?:\.\d+)*\.?)\s+/i);
  if(numbered){
    if(/^S/i.test(numbered[1]))return 2;
    return numbered[1].replace(/\.$/,"").split(".").length>=2?3:2;
  }
  return /^(?:abstract|introduction|experimental|methods?|results?(?: and discussion)?|discussion|conclusions?|supporting information|acknowledg(?:e)?ments?|references?)\b/i.test(value)?2:0;
}

function isStandaloneSemanticHeading(block) {
  if(block.lines.length>2||block.text.length>150)return false;
  const value=block.text.trim();
  if(isReferenceEntryStart(value))return false;
  const numbered=/^(?:(?:S\d+[a-z]?\.?)|(?:\d+(?:\.\d+)+\.?)|(?:\d+\.))\s+\S/i.test(value);
  return numbered||semanticHeadingLevel(value)>0;
}

function tokenFromItem(item, viewport) {
  const text = item.str?.trim();
  if (!text) return null;
  const tx = multiply(viewport.transform, item.transform);
  const fontSize = Math.max(6, Math.hypot(tx[2], tx[3]));
  const baseline = tx[5];
  const width = Math.max(1, Math.abs(item.width * viewport.scale));
  return {
    text,
    x: tx[4],
    right: tx[4] + width,
    width,
    baseline,
    y: baseline - fontSize,
    bottom: baseline + fontSize * 0.12,
    fontSize,
    hasEOL: Boolean(item.hasEOL)
  };
}

function deduplicatePositionedTokens(tokens) {
  const seen = new Set();
  return tokens.filter(token => {
    const key = [token.text, Math.round(token.x), Math.round(token.baseline), Math.round(token.width)].join("\u241f");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function removeOverlappingDuplicateBlocks(blocks) {
  const normalized = block => String(block.text || "").normalize("NFKC").replace(/[^A-Za-z0-9\u3400-\u9fff]+/g, "").toLowerCase();
  const removed = new Set();
  for (let shorterIndex = 0; shorterIndex < blocks.length; shorterIndex += 1) {
    const shorter = blocks[shorterIndex], shortText = normalized(shorter);
    if (shortText.length < 80) continue;
    for (let longerIndex = 0; longerIndex < blocks.length; longerIndex += 1) {
      if (shorterIndex === longerIndex) continue;
      const longer = blocks[longerIndex], longText = normalized(longer);
      if (longText.length < shortText.length || !longText.includes(shortText)) continue;
      const overlapX = Math.max(0, Math.min(shorter.right, longer.right) - Math.max(shorter.x, longer.x));
      const overlapY = Math.max(0, Math.min(shorter.bottom, longer.bottom) - Math.max(shorter.y, longer.y));
      const overlapArea = overlapX * overlapY;
      const shorterArea = Math.max(1, shorter.width * shorter.height);
      const matchingLines = shorter.lines.filter(line => longer.lines.some(other => Math.abs(line.baseline - other.baseline) <= 1.2)).length;
      if (overlapArea / shorterArea >= 0.45 || matchingLines / Math.max(1, shorter.lines.length) >= 0.65) {
        removed.add(shorterIndex);
        break;
      }
    }
  }
  return blocks.filter((_, index) => !removed.has(index));
}

function makeLine(tokens) {
  const parts = [...tokens].sort((a, b) => a.x - b.x);
  let text = "";
  let previous = null;
  const segments = [];
  for (const part of parts) {
    const gap = previous ? part.x - previous.right : 0;
    const separator = previous && gap > Math.max(1.2, Math.min(previous.fontSize, part.fontSize) * 0.14) ? " " : "";
    text += separator;
    const start = text.length;
    text += part.text;
    segments.push({ ...part, start, end: text.length });
    previous = part;
  }
  const y = Math.min(...parts.map(part => part.y));
  const bottom = Math.max(...parts.map(part => part.bottom));
  const x = Math.min(...parts.map(part => part.x));
  const right = Math.max(...parts.map(part => part.right));
  return {
    text: text.replace(/\s+/g, " ").trim(),
    x,
    right,
    width: right - x,
    y,
    bottom,
    height: bottom - y,
    baseline: median(parts.map(part => part.baseline)),
    fontSize: weightedMedian(parts.map(part => ({ value: part.fontSize, weight: Math.max(part.width, part.text.length) }))),
    segments
  };
}

function splitBandIntoLines(tokens, pageWidth) {
  const sorted = [...tokens].sort((a, b) => a.x - b.x);
  const lines = [];
  let current = [];
  let right = -Infinity;
  for (const token of sorted) {
    const typicalSize = median((current.length ? current : [token]).map(part => part.fontSize));
    const gap = token.x - right;
    const projectedWidth = current.length ? token.right - current[0].x : token.width;
    const splitGap = Math.max(12, typicalSize * 1.65);
    const forcedByWidth = current.length && projectedWidth > pageWidth * 0.62 && gap > typicalSize * 0.7;
    const previousEnded = current.at(-1)?.hasEOL;
    if (current.length && (gap > splitGap || forcedByWidth || previousEnded)) {
      lines.push(makeLine(current));
      current = [];
    }
    current.push(token);
    right = Math.max(right, token.right);
  }
  if (current.length) lines.push(makeLine(current));
  return lines;
}

function joinBlockText(previous, next) {
  if (/[-‐‑‒–]$/.test(previous) && /^[a-z]/.test(next)) return previous.slice(0, -1) + next;
  return `${previous} ${next}`;
}

function canAppend(block, line, pageWidth) {
  const last = block.lines.at(-1);
  const size = Math.max(6, median([last.fontSize, line.fontSize]));
  const verticalGap = line.y - last.bottom;
  if (verticalGap < -size * 0.3 || verticalGap > size * 1.05) return false;
  const fontRatio = Math.max(last.fontSize, line.fontSize) / Math.max(1, Math.min(last.fontSize, line.fontSize));
  if (fontRatio > 1.38) return false;
  const overlap = Math.max(0, Math.min(last.right, line.right) - Math.max(last.x, line.x));
  const overlapRatio = overlap / Math.max(1, Math.min(last.width, line.width));
  const aligned = Math.abs(line.x - last.x) <= size * 1.6 || Math.abs(line.right - last.right) <= size * 1.8;
  if (!aligned && overlapRatio < 0.58) return false;
  const blockSpansPage = block.width > pageWidth * 0.68;
  const lineSpansPage = line.width > pageWidth * 0.68;
  const spanningContinuation = blockSpansPage && !lineSpansPage
    && Math.abs(line.x - block.x) <= size * 1.6
    && verticalGap <= size * .65
    && !/[.!?]["')\]]?$/.test(block.text);
  if (blockSpansPage !== lineSpansPage && block.lines.length > 1 && !spanningContinuation) return false;
  const isNewIndentedParagraph = block.lines.length >= 2
    && line.x > block.x + size * 0.9
    && last.x <= block.x + size * 0.45;
  return !isNewIndentedParagraph;
}

function appendLine(block, line) {
  block.lines.push(line);
  block.text = joinBlockText(block.text, line.text);
  block.x = Math.min(block.x, line.x);
  block.right = Math.max(block.right, line.right);
  block.y = Math.min(block.y, line.y);
  block.bottom = Math.max(block.bottom, line.bottom);
  block.width = block.right - block.x;
  block.height = block.bottom - block.y;
  block.fontSize = median(block.lines.map(item => item.fontSize));
}

function newBlock(line) {
  return {
    text: line.text,
    lines: [line],
    x: line.x,
    right: line.right,
    y: line.y,
    bottom: line.bottom,
    width: line.width,
    height: line.height,
    fontSize: line.fontSize,
    translation: ""
  };
}

function mergeHeadingBlocks(blocks, bodySize, pageWidth) {
  const ordered = [...blocks].sort((a, b) => a.y - b.y || a.x - b.x);
  for (let index = 0; index < ordered.length - 1; index++) {
    const block = ordered[index];
    const next = ordered[index + 1];
    if (!blocks.includes(block) || !blocks.includes(next)) continue;
    if (block.fontSize < bodySize * 1.28 || next.fontSize < bodySize * 1.28) continue;
    const ratio = Math.max(block.fontSize, next.fontSize) / Math.max(1, Math.min(block.fontSize, next.fontSize));
    const gap = next.y - block.bottom;
    const aligned = Math.abs(block.x - next.x) < Math.max(block.fontSize, next.fontSize) * 1.8;
    const sameSpan = (block.width > pageWidth * 0.55) === (next.width > pageWidth * 0.55);
    if (ratio > 1.35 || gap < -block.fontSize * 0.3 || gap > block.fontSize * 1.5 || !aligned || !sameSpan) continue;
    for (const line of next.lines) appendLine(block, line);
    const position = blocks.indexOf(next);
    if (position >= 0) blocks.splice(position, 1);
  }
}

function mergeCompactHeadingBlocks(blocks, bodySize, pageWidth) {
  const seeds = [...blocks].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const seed of seeds) {
    if (!blocks.includes(seed) || isStandaloneSemanticHeading(seed) || !looksLikeCompactTitleHeading(seed, bodySize)) continue;
    const seedCenter = (seed.x + seed.right) / 2;
    const candidates = blocks.filter(candidate => {
      if (candidate === seed || isStandaloneSemanticHeading(candidate) || !looksLikeCompactTitleHeading(candidate, bodySize)) return false;
      const gap = candidate.y - seed.bottom;
      if (gap < -bodySize * .2 || gap > Math.max(seed.fontSize, candidate.fontSize) * 1.15) return false;
      const candidateCenter = (candidate.x + candidate.right) / 2;
      if ((seedCenter < pageWidth / 2) !== (candidateCenter < pageWidth / 2)) return false;
      const ratio = Math.max(seed.fontSize, candidate.fontSize) / Math.max(1, Math.min(seed.fontSize, candidate.fontSize));
      if (ratio > 1.12) return false;
      const overlap = Math.max(0, Math.min(seed.right, candidate.right) - Math.max(seed.x, candidate.x));
      return Math.abs(candidate.x - seed.x) <= seed.fontSize * 4 || overlap >= Math.min(seed.width, candidate.width) * .5;
    }).sort((a, b) => a.y - b.y || Math.abs(a.x - seed.x) - Math.abs(b.x - seed.x));
    if (!candidates.length) continue;
    const candidate = candidates[0];
    rebuildBlockFromLines(seed, [...seed.lines, ...candidate.lines]);
    blocks.splice(blocks.indexOf(candidate), 1);
  }
}

function mergeLineFragments(lines) {
  const bands = [];
  for (const line of [...lines].sort((a, b) => a.baseline - b.baseline || a.x - b.x)) {
    let band = bands.find(candidate => Math.abs(candidate.baseline - line.baseline) <= Math.max(2.2, Math.max(candidate.fontSize, line.fontSize) * 0.38));
    if (!band) {
      band = { baseline: line.baseline, fontSize: line.fontSize, lines: [] };
      bands.push(band);
    }
    band.lines.push(line);
    band.baseline = median(band.lines.map(item => item.baseline));
    band.fontSize = median(band.lines.map(item => item.fontSize));
  }
  return bands.map(band => {
    const parts = band.lines.sort((a, b) => a.x - b.x);
    const x = Math.min(...parts.map(part => part.x));
    const right = Math.max(...parts.map(part => part.right));
    const y = Math.min(...parts.map(part => part.y));
    const bottom = Math.max(...parts.map(part => part.bottom));
    let text = "";
    const segments = [];
    for (const part of parts) {
      if (text) text += " ";
      const offset = text.length;
      text += part.text;
      for (const segment of part.segments || []) segments.push({ ...segment, start: offset + segment.start, end: offset + segment.end });
    }
    return {
      text: text.replace(/\s+/g, " ").trim(),
      x,
      right,
      width: right - x,
      y,
      bottom,
      height: bottom - y,
      baseline: band.baseline,
      fontSize: band.fontSize,
      segments
    };
  }).sort((a, b) => a.y - b.y || a.x - b.x);
}

function rebuildBlockFromLines(block, lines) {
  const merged = mergeLineFragments(lines);
  block.lines = merged;
  block.text = merged.reduce((text, line) => text ? joinBlockText(text, line.text) : line.text, "");
  block.x = Math.min(...merged.map(line => line.x));
  block.right = Math.max(...merged.map(line => line.right));
  block.y = Math.min(...merged.map(line => line.y));
  block.bottom = Math.max(...merged.map(line => line.bottom));
  block.width = block.right - block.x;
  block.height = block.bottom - block.y;
  block.fontSize = median(merged.map(line => line.fontSize));
}

function mergeFigureCaptionBlocks(blocks, bodySize, pageWidth) {
  const seeds = [...blocks].filter(block => isFigureCaptionText(block.text)).sort((a, b) => a.y - b.y || a.x - b.x);
  for (const seed of seeds) {
    if (!blocks.includes(seed)) continue;
    const members = [seed];
    while (members.length < 18) {
      const allLines = members.flatMap(block => block.lines);
      const mergedLines = mergeLineFragments(allLines);
      const lastLine = mergedLines.at(-1);
      const mergedText = mergedLines.map(line => line.text).join(" ").trim();
      const candidates = blocks.filter(candidate => {
        if (members.includes(candidate) || isFigureCaptionText(candidate.text)) return false;
        if (isTableCaptionText(seed.text) && looksLikeTableGridBlock(candidate)) return false;
        const candidateLines = [...candidate.lines].sort((a, b) => a.y - b.y || a.x - b.x);
        const firstLine = candidateLines[0];
        const sameRow = mergedLines.some(line => Math.abs(line.baseline - firstLine.baseline) <= Math.max(2.2, seed.fontSize * 0.4));
        const panelContinuation = /^\([a-z](?:\s*[-–—]\s*[a-z])?\)\s*/i.test(candidate.text.trim());
        const bareFigureLabel = /^(?:(?:supplementary|supporting)\s+)?(?:fig(?:ure)?\.?|scheme|图)\s*(?:s[\s.-]*)?\d+[a-z]?[.:：|]?$/i.test(seed.text.trim());
        // Wiley can encode "FIGURE N" and a long, multi-line "(a) ..." caption as
        // overlapping blocks. Some captions start with a description before listing
        // panels, so a bare label plus a shared baseline is the stronger signal.
        const longSameRowCaption = sameRow && (panelContinuation || bareFigureLabel) && candidate.lines.length <= 12;
        if (isStandaloneSemanticHeading(candidate)
          || (candidate.lines.length > 4 && !longSameRowCaption)
          || candidate.fontSize < seed.fontSize * 0.62
          || candidate.fontSize > Math.max(seed.fontSize * 1.18, bodySize * 1.04)) return false;
        if (sameRow) {
          const row = mergedLines.find(line => Math.abs(line.baseline - firstLine.baseline) <= Math.max(2.2, seed.fontSize * 0.4));
          const gap = Math.max(0, Math.max(firstLine.x - row.right, row.x - firstLine.right));
          return gap <= Math.max(seed.fontSize * 3, pageWidth * 0.14);
        }
        const verticalGap = firstLine.y - lastLine.bottom;
        const maximumGap = Math.max(seed.fontSize * 2.6, bodySize * 1.9);
        if (verticalGap < -seed.fontSize * 0.25 || verticalGap > maximumGap) return false;
        const overlap = Math.max(0, Math.min(seed.right, candidate.right) - Math.max(seed.x, candidate.x));
        const aligned = Math.abs(candidate.x - seed.x) <= pageWidth * 0.09 || overlap >= Math.min(seed.width, candidate.width) * 0.42;
        if (!aligned) return false;
        const value = candidate.text.trim();
        const lowerCaseContinuation = /^[a-z]/.test(value);
        const acronymContinuation = /^[A-Z0-9]{1,10}(?:[\/-][A-Z0-9]{1,10})+[).,;:]?/i.test(value);
        const previousOpen = !/[.!?]["')\]]?$/.test(mergedText)
          || /\b(?:and|or|of|the|with|to|for|in|at|on|from|using|between|into|under|emphasize)$/i.test(mergedText);
        const compactGap = verticalGap <= Math.max(seed.fontSize * 1.45, bodySize * 1.12);
        return compactGap || panelContinuation || lowerCaseContinuation || acronymContinuation || previousOpen;
      }).sort((a, b) => a.y - b.y || a.x - b.x);
      if (!candidates.length) break;
      members.push(candidates[0]);
    }
    if (members.length === 1) continue;
    rebuildBlockFromLines(seed, members.flatMap(block => block.lines));
    for (const member of members.slice(1)) {
      const position = blocks.indexOf(member);
      if (position >= 0) blocks.splice(position, 1);
    }
  }
}

function splitTableGridFromCaptions(blocks) {
  for (const caption of [...blocks]) {
    if (!isTableCaptionText(caption.text) || caption.lines.length < 2) continue;
    const gridStart = caption.lines.findIndex((line, index) => index > 0 && looksLikeTableGridBlock({ text: line.text, lines: [line] }));
    if (gridStart < 0) continue;
    const captionLines = caption.lines.slice(0, gridStart);
    const gridLines = caption.lines.slice(gridStart);
    rebuildBlockFromLines(caption, captionLines);
    const grid = newBlock(gridLines[0]);
    for (const line of gridLines.slice(1)) appendLine(grid, line);
    const position = blocks.indexOf(caption);
    blocks.splice(position + 1, 0, grid);
  }
}

export function buildTextBlocks(items, viewport) {
  const tokens = deduplicatePositionedTokens(items.map(item => tokenFromItem(item, viewport)).filter(Boolean));
  tokens.sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  const bands = [];
  for (const token of tokens) {
    let band = bands.find(candidate => Math.abs(candidate.baseline - token.baseline) <= Math.max(2.5, Math.max(candidate.fontSize, token.fontSize) * 0.48));
    if (!band) {
      band = { baseline: token.baseline, fontSize: token.fontSize, tokens: [] };
      bands.push(band);
    }
    band.tokens.push(token);
    band.baseline = median(band.tokens.map(item => item.baseline));
    band.fontSize = median(band.tokens.map(item => item.fontSize));
  }

  const lines = bands.flatMap(band => splitBandIntoLines(band.tokens, viewport.width))
    .filter(line => line.text.length > 1 && !/^[\d\s.,;:()\[\]{}+\-–—=<>/%°×·|]+$/.test(line.text))
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const blocks = [];
  for (const line of lines) {
    const candidates = blocks.filter(block => canAppend(block, line, viewport.width));
    candidates.sort((a, b) => {
      const aLast = a.lines.at(-1); const bLast = b.lines.at(-1);
      return (line.y - aLast.bottom) - (line.y - bLast.bottom)
        || Math.abs(line.x - aLast.x) - Math.abs(line.x - bLast.x);
    });
    if (candidates.length) appendLine(candidates[0], line);
    else blocks.push(newBlock(line));
  }

  const multilineBlocks = blocks.filter(block => block.lines.length > 1);
  const preliminaryBodySize = weightedMedian(multilineBlocks.map(block => ({ value: block.fontSize, weight: Math.min(1200, Math.max(20, block.text.length)) })))
    || median(blocks.map(block => block.fontSize)) || 10;
  // Large multi-line paper titles must not pull the body baseline upwards on sparse first pages.
  const bodyCandidates = multilineBlocks.filter(block => block.fontSize <= preliminaryBodySize * 1.18);
  const bodySize = weightedMedian(bodyCandidates.map(block => ({ value: block.fontSize, weight: Math.min(1200, Math.max(20, block.text.length)) }))) || preliminaryBodySize;
  mergeHeadingBlocks(blocks, bodySize, viewport.width);
  mergeCompactHeadingBlocks(blocks, bodySize, viewport.width);
  mergeFigureCaptionBlocks(blocks, bodySize, viewport.width);
  splitTableGridFromCaptions(blocks);
  const uniqueBlocks = removeOverlappingDuplicateBlocks(blocks);
  for (const block of uniqueBlocks) {
    const isFigureCaption = isFigureCaptionText(block.text);
    const isReferenceEntry = isReferenceEntryStart(block.text);
    const semanticLevel=isStandaloneSemanticHeading(block)?semanticHeadingLevel(block.text):0;
    const compactTitleHeading = looksLikeCompactTitleHeading(block, bodySize);
    block.role = isFigureCaption ? "figure-caption"
      : isReferenceEntry ? "body"
      : (semanticLevel || compactTitleHeading || block.fontSize > bodySize * 1.28) ? "heading"
        : block.fontSize < bodySize * 0.8 ? "caption" : "body";
    if (block.role !== "heading") block.headingLevel = 0;
    else if (semanticLevel) block.headingLevel = semanticLevel;
    else if (compactTitleHeading) block.headingLevel = 3;
    else if (block.fontSize >= bodySize * 1.85) block.headingLevel = 1;
    else if (block.fontSize >= bodySize * 1.48) block.headingLevel = 2;
    else block.headingLevel = 3;
    block.lineHeight = block.lines.length > 1
      ? median(block.lines.slice(1).map((line, index) => line.baseline - block.lines[index].baseline))
      : block.fontSize * 1.18;
    if (isPageFurnitureBlock(block, viewport)) block.role = "artifact";
  }
  const mainTitle = uniqueBlocks.filter(block => block.role === "heading" && block.headingLevel === 1).sort((a, b) => a.y - b.y)[0];
  if (mainTitle) {
    const metadataBottom = viewport.height * 0.34;
    for (const block of uniqueBlocks) {
      const compact = block.lines.length <= 2 && block.text.length < 240;
      const compactNonSemanticHeading = block.role === "heading" && block.headingLevel === 3 && !isStandaloneSemanticHeading(block);
      if ((block.role === "body" || compactNonSemanticHeading) && compact && block.y > mainTitle.bottom && block.y < metadataBottom) {
        block.role = "metadata";
        block.headingLevel = 0;
      }
    }
  }
  return uniqueBlocks;
}

export function sortBlocksForReading(blocks, viewport, pageNumber = 2) {
  const copy = [...blocks];
  if (pageNumber === 1) {
    const lateSection = copy.filter(block => block.role === "heading"
      && semanticHeadingLevel(block.text) >= 2
      && block.y >= viewport.height * .45)
      .sort((a, b) => b.y - a.y)[0];
    if (!lateSection) return copy.sort((a, b) => a.y - b.y || a.x - b.x);
    const prefix = copy.filter(block => block === lateSection || block.y < lateSection.y).sort((a, b) => a.y - b.y || a.x - b.x);
    const tail = copy.filter(block => !prefix.includes(block));
    const columns = tail.filter(block => block.width <= viewport.width * .68);
    const wide = tail.filter(block => !columns.includes(block)).sort((a, b) => a.y - b.y || a.x - b.x);
    const left = columns.filter(block => (block.x + block.right) / 2 < viewport.width / 2).sort((a, b) => a.y - b.y || a.x - b.x);
    const right = columns.filter(block => !left.includes(block)).sort((a, b) => a.y - b.y || a.x - b.x);
    return [...prefix, ...left, ...right, ...wide];
  }
  const spanning = copy.filter(block => block.width > viewport.width * 0.68);
  const columns = copy.filter(block => block.width <= viewport.width * 0.68);
  if (!columns.length) return copy.sort((a, b) => a.y - b.y || a.x - b.x);
  const firstColumnY = Math.min(...columns.map(block => block.y));
  const headers = spanning.filter(block => block.y <= firstColumnY + block.fontSize).sort((a, b) => a.y - b.y);
  const footers = spanning.filter(block => !headers.includes(block)).sort((a, b) => a.y - b.y);
  const left = columns.filter(block => (block.x + block.right) / 2 < viewport.width / 2).sort((a, b) => a.y - b.y || a.x - b.x);
  const right = columns.filter(block => !left.includes(block)).sort((a, b) => a.y - b.y || a.x - b.x);
  return [...headers, ...left, ...right, ...footers];
}
