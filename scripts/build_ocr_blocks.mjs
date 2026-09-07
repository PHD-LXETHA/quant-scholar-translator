import fs from "node:fs";
import { buildOcrTextBlocks, sortBlocksForReading } from "../apps/browser-extension/research/pdf-layout.mjs";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: node build_ocr_blocks.mjs input.ocr.json output.blocks.json");
const audit = JSON.parse(fs.readFileSync(input, "utf8"));
const pages = audit.records.map(record => {
  const width = Number(record.pageWidth);
  const height = Number(record.pageHeight);
  if (!(width > 0 && height > 0)) throw new Error(`Missing page dimensions for page ${record.page}`);
  const viewport = { width, height, scale: 1, transform: [1, 0, 0, -1, 0, height] };
  const blocks = sortBlocksForReading(buildOcrTextBlocks(record.lines, viewport, width, height), viewport, record.page)
    .filter(block => !["artifact", "figure-content"].includes(block.role) && /[A-Za-z]/.test(block.text))
    .map((block, index) => ({
      id: `p${String(record.page).padStart(3, "0")}b${String(index + 1).padStart(3, "0")}`,
      page: record.page,
      role: block.role,
      source: block.text,
      rect: [block.x, block.y, block.right, block.bottom].map(value => Math.round(value * 100) / 100),
      lines: block.lines.map(line => ({
        text: line.text,
        rect: [line.x, line.y, line.right, line.bottom].map(value => Math.round(value * 100) / 100),
      })),
    }));
  return { page: record.page, width, height, blocks };
});
const result = { source: audit.source, pages, blockCount: pages.reduce((sum, page) => sum + page.blocks.length, 0) };
fs.writeFileSync(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ pages: pages.length, blocks: result.blockCount }));
