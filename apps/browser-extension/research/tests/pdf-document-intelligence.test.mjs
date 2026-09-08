import test from "node:test";
import assert from "node:assert/strict";
import { applyStructuredTranslation, buildStructuredTranslationUnits, classifyPdfDocument, detectColumnBands, orderBlocksForDocument, unitHasTranslation } from "../pdf-document-intelligence.mjs";

const viewport = { width: 900, height: 1200 };
const block = (text, x, y, width = 230, role = "body") => ({ text, x, y, width, right: x + width, height: 18, fontSize: 10, role });
const page = (number, blocks, figureRegions = []) => ({ number, blocks, viewport, figureRegions });

test("detects and orders three-column magazine pages", () => {
  const blocks = [
    block("Left one", 40, 120), block("Left two", 40, 180),
    block("Middle one", 335, 80), block("Middle two", 335, 160),
    block("Right one", 630, 100), block("Right two", 630, 150),
  ];
  assert.equal(detectColumnBands(blocks, viewport).length, 3);
  assert.deepEqual(orderBlocksForDocument(page(8, blocks)).map(item => item.text), ["Left one", "Left two", "Middle one", "Middle two", "Right one", "Right two"]);
});

test("a full-width section heading interrupts columns at its visual position", () => {
  const blocks=[block("Left before",40,80),block("Right before",630,90),block("2 Results",40,300,820,"heading"),block("Left after",40,350),block("Right after",630,360)];
  assert.deepEqual(orderBlocksForDocument(page(2,blocks)).map(item=>item.text),["Left before","Right before","2 Results","Left after","Right after"]);
});

test("classifies paper, report, book, newspaper, and magazine without external runtime", () => {
  const one = text => [page(1, [block(text, 40, 80, 780)])];
  assert.equal(classifyPdfDocument({ source: "factor-paper.pdf", pages: one("Abstract Methodology Hypothesis References DOI") }).type, "academic-paper");
  assert.equal(classifyPdfDocument({ source: "equity-research-report.pdf", pages: one("Investment thesis Price target Risk factors Analyst certification Disclosures") }).type, "research-report");
  assert.equal(classifyPdfDocument({ source: "Data Science Handbook.pdf", pages: one("Table of Contents Chapter 1"), outlineCount: 40 }).type, "book");
  assert.deepEqual(classifyPdfDocument({ source: "Schaums Outlines Calculus.pdf", pages: one("Chapter 10 Rules for Differentiating Functions"), outlineCount: 2 }).domain, "mathematics");
  assert.equal(classifyPdfDocument({ source: "WSJ daily newspaper.pdf", pages: one("Wall Street Journal") }).type, "newspaper");
  assert.equal(classifyPdfDocument({ source: "Bloomberg Businessweek magazine.pdf", pages: one("Businessweek") }).type, "magazine");
});

test("merges paragraph fragments but protects headings and structured regions", () => {
  const heading = block("1 Introduction", 40, 40, 780, "heading");
  const first = block("Asset returns are not", 40, 100, 360);
  const second = block("normally distributed.", 40, 125, 360);
  const caption = block("Figure 1. Return distribution", 40, 300, 360, "figure-caption");
  const units = buildStructuredTranslationUnits([page(1, [heading, first, second, caption])], classifyPdfDocument({ forcedType: "academic-paper" }));
  assert.equal(units.length, 3);
  assert.equal(units[1].text, "Asset returns are not normally distributed.");
  assert.deepEqual(units[1].blocks, [first, second]);
});

test("does not merge the end of one column into the next column", () => {
  const left=block("A paragraph continues",40,900,230);
  const right=block("Another column begins",630,80,230);
  const units=buildStructuredTranslationUnits([page(2,[left,right])],classifyPdfDocument({forcedType:"magazine"}));
  assert.equal(units.length,2);
});

test("stores one semantic translation and fills every layout block", () => {
  const members = [block("Expected return is", 40, 100), block("time varying.", 40, 125)];
  const [unit] = buildStructuredTranslationUnits([page(1, members)], classifyPdfDocument({ forcedType: "academic-paper" }));
  assert.equal(applyStructuredTranslation(unit, "预期收益率会随时间变化。"), true);
  assert.equal(unit.anchor.structuredTranslation, "预期收益率会随时间变化。");
  assert.equal(unitHasTranslation(unit), true);
  assert.ok(members.every(item => item.translation));
  assert.equal(members.filter(item => item.structuredAnchor).length, 1);
});
