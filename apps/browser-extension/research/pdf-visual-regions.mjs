import { isTableCaptionText } from "./pdf-layout.mjs";

function horizontalOverlap(left, right, block) {
  return Math.max(0, Math.min(right, block.right) - Math.max(left, block.x));
}

function verticalOverlap(top, bottom, block) {
  return Math.max(0, Math.min(bottom, block.bottom) - Math.max(top, block.y));
}

function looksLikeNarrativeBlock(block) {
  const text = String(block?.text || "");
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  const digits = (text.match(/\d/g) || []).length;
  const words = (text.match(/[A-Za-z]{2,}/g) || []).length;
  return text.length >= 72 && words >= 9 && letters >= Math.max(24, digits * 1.8);
}

function isPeripheralBlock(block) {
  return ["metadata", "caption", "artifact"].includes(block?.role);
}

function isOutsideColumn(left, right, block) {
  return horizontalOverlap(left, right, block) < Math.min(right - left, block.width) * .16;
}

function markRegionContent(blocks, region) {
  for (const block of blocks) {
    if (block === region.caption || block.role === "figure-caption") continue;
    const centerX = (block.x + block.right) / 2;
    const centerY = (block.y + block.bottom) / 2;
    const centerInside = centerX >= region.x && centerX <= region.x + region.width
      && centerY >= region.y && centerY <= region.y + region.height;
    const overlapX = horizontalOverlap(region.x, region.x + region.width, block);
    const overlapY = verticalOverlap(region.y, region.y + region.height, block);
    const substantialIntersection = overlapX >= Math.min(region.width, block.width) * .42
      && overlapY >= Math.min(region.height, block.height) * .42
      && overlapX * overlapY >= Math.max(1, block.width * block.height) * .24;
    if (centerInside || substantialIntersection) {
      block.role = "figure-content";
    }
  }
}

export function availableOverlayHeight(block, blocks, regions = []) {
  const original = Math.max(block.height + 3, block.lineHeight * 1.05);
  let nextBoundary = Infinity;
  for (const other of blocks) {
    if (other === block || other.y <= block.y) continue;
    const overlap = horizontalOverlap(block.x, block.right, other);
    if (overlap < Math.min(block.width, other.width) * .25) continue;
    nextBoundary = Math.min(nextBoundary, other.y);
  }
  for (const region of regions) {
    if (region.y <= block.y + 2) continue;
    const overlap = horizontalOverlap(region.x, region.x + region.width, block);
    if (overlap < Math.min(region.width, block.width) * .2) continue;
    nextBoundary = Math.min(nextBoundary, region.y);
  }
  if (!Number.isFinite(nextBoundary)) return original;
  return Math.max(5, Math.min(nextBoundary - block.y - 2, Math.max(original, block.height * 3.2)));
}

function detectTableRegion(caption, blocks, viewport, bodySize) {
  const padding = bodySize * 1.05;
  let left = Math.max(viewport.width * .035, caption.x - padding);
  let right = Math.min(viewport.width * .965, caption.right + padding);
  const initialLeft = left;
  const initialRight = right;
  const below = blocks.filter(block => block !== caption && block.role !== "figure-caption" && block.y >= caption.bottom - bodySize * .2);
  const overlapsColumn = block => horizontalOverlap(left, right, block) >= Math.min(right - left, block.width) * .2;
  const nextNarrative = below.filter(block => overlapsColumn(block) && block.role === "body" && looksLikeNarrativeBlock(block)).sort((a, b) => a.y - b.y)[0];
  const pageBottom = viewport.height * .95;
  let lowerLimit = Math.min(pageBottom, nextNarrative ? nextNarrative.y - bodySize * .55 : pageBottom);
  const tableBlocks = below.filter(block => block.y < lowerLimit && !isPeripheralBlock(block) && !looksLikeNarrativeBlock(block));
  if (tableBlocks.length) {
    left = Math.max(viewport.width * .025, Math.min(left, ...tableBlocks.map(block => block.x - padding * .45)));
    right = Math.min(viewport.width * .975, Math.max(right, ...tableBlocks.map(block => block.right + padding * .45)));
  }
  const top = Math.max(caption.bottom + bodySize * .15, caption.y + bodySize);
  const parallelNarrative = below.some(block => block.y < lowerLimit
    && block.bottom > top
    && block.role === "body"
    && looksLikeNarrativeBlock(block)
    && isOutsideColumn(initialLeft, initialRight, block));
  const tableSpan = tableBlocks.length
    ? Math.max(...tableBlocks.map(block => block.right)) - Math.min(...tableBlocks.map(block => block.x))
    : 0;
  const likelyFullWidth = tableSpan >= viewport.width * .58
    || (!parallelNarrative && (caption.width >= viewport.width * .4 || caption.text.length >= 48));
  if (likelyFullWidth) {
    left = Math.min(left, viewport.width * .025);
    right = Math.max(right, viewport.width * .975);
  }
  if (!nextNarrative && tableBlocks.length >= 3) {
    const contentBottom = Math.max(...tableBlocks.map(block => block.bottom));
    if (contentBottom < pageBottom - bodySize * 3) {
      lowerLimit = Math.min(pageBottom, contentBottom + padding * 1.4);
    }
  }
  // Numeric-only PDF table rows are often omitted from the text block list. Cropping
  // through the next narrative block preserves the complete rendered table.
  const bottom = lowerLimit;
  const region = { kind: "table", x: left, y: top, width: right - left, height: bottom - top, caption, dataUrl: "" };
  return region.width >= viewport.width * .18 && region.height >= bodySize * 2.2 ? region : null;
}

function detectFigureRegion(caption, blocks, viewport, bodySize) {
  const spanning = caption.width > viewport.width * .55;
  const padding = bodySize * (spanning ? 1.2 : .8);
  let left = Math.max(0, spanning ? Math.min(caption.x - padding, viewport.width * .045) : caption.x - padding);
  let right = Math.min(viewport.width, spanning ? Math.max(caption.right + padding, viewport.width * .955) : caption.right + padding);
  const initialLeft = left;
  const initialRight = right;
  const narrative = blocks.filter(block => {
    if (block === caption || block.bottom >= caption.y - bodySize * .7 || block.role === "figure-caption" || block.role === "caption") return false;
    const overlap = horizontalOverlap(left, right, block);
    if (overlap < Math.min(right - left, block.width) * .22) return false;
    return block.role === "body" && looksLikeNarrativeBlock(block);
  }).sort((a, b) => b.bottom - a.bottom);
  const previous = narrative[0];
  const pageTopMargin = Math.max(8, Math.min(viewport.height * .04, bodySize * 5));
  // Full-page figures often have no narrative block above them. Starting from a
  // page margin preserves tall figures; deriving the top from the caption clipped
  // every such figure to the same fixed fraction of the page.
  let top = previous ? previous.bottom + bodySize * .9 : pageTopMargin;
  top = Math.max(8, Math.min(top, caption.y - bodySize * 3));
  const parallelNarrative = blocks.some(block => block !== caption
    && block.y < caption.y - bodySize * .7
    && block.bottom > top + bodySize * .2
    && block.role === "body"
    && looksLikeNarrativeBlock(block)
    && isOutsideColumn(initialLeft, initialRight, block));
  const visualBlocks = blocks.filter(block => block !== caption
    && block.y < caption.y
    && block.bottom > top
    && block.role !== "figure-caption"
    && !isPeripheralBlock(block)
    && !looksLikeNarrativeBlock(block));
  const visualSpan = visualBlocks.length
    ? Math.max(...visualBlocks.map(block => block.right)) - Math.min(...visualBlocks.map(block => block.x))
    : 0;
  const likelyFullWidth = spanning
    || visualSpan >= viewport.width * .58
    || (!parallelNarrative && (caption.width >= viewport.width * .34 || caption.text.length >= 48));
  if (likelyFullWidth) {
    left = Math.min(left, viewport.width * .045);
    right = Math.max(right, viewport.width * .955);
  } else if (visualBlocks.length) {
    left = Math.max(0, Math.min(left, ...visualBlocks.map(block => block.x - padding * .4)));
    right = Math.min(viewport.width, Math.max(right, ...visualBlocks.map(block => block.right + padding * .4)));
  }
  const region = { kind: "figure", x: left, y: top, width: right - left, height: caption.y - top - bodySize * .35, caption, dataUrl: "" };
  return region.width >= viewport.width * .2 && region.height >= bodySize * 4 ? region : null;
}

export function detectVisualRegions(blocks, viewport, bodySize) {
  const captions = blocks.filter(block => block.role === "figure-caption").sort((a, b) => a.y - b.y || a.x - b.x);
  const regions = [];
  for (const caption of captions) {
    const region = isTableCaptionText(caption.text)
      ? detectTableRegion(caption, blocks, viewport, bodySize)
      : detectFigureRegion(caption, blocks, viewport, bodySize);
    if (!region) continue;
    regions.push(region);
    markRegionContent(blocks, region);
  }
  return regions;
}
