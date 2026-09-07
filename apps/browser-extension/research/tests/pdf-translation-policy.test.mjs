import assert from "node:assert/strict";
import test from "node:test";
import { applyOcrTranslationPolicy, isDataDenseOcrPage, isTranslatablePdfBlock, shouldPreserveOcrBlock } from "../pdf-translation-policy.mjs";

test("protects numeric tables and ticker-like cells", () => {
  assert.equal(shouldPreserveOcrBlock({ role:"body", text:"AAPL 202.12 4.31 2.17 8.90", lines:[{}, {}, {}] }), true);
  assert.equal(shouldPreserveOcrBlock({ role:"body", text:"EBITDA" }), true);
  assert.equal(shouldPreserveOcrBlock({ role:"body", text:"The central bank kept rates unchanged after reviewing the latest inflation data." }), false);
});

test("detects dense market-data pages and keeps only explanatory prose", () => {
  const blocks=Array.from({length:95},(_,index)=>({role:"body",text:`ABC ${index}`}));
  blocks.push({role:"body",text:"Prices and yields are delayed. This table summarizes the latest closing market data for investors."});
  assert.equal(isDataDenseOcrPage(blocks),true);
  const result=applyOcrTranslationPolicy(blocks);
  assert.equal(result.dataDense,true);
  assert.equal(isTranslatablePdfBlock(blocks.at(-1)),true);
  assert.equal(isTranslatablePdfBlock(blocks[0]),false);
});
