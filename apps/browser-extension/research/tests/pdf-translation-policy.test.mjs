import assert from "node:assert/strict";
import test from "node:test";
import { applyNativeTranslationPolicy, applyOcrTranslationPolicy, isDataDenseOcrPage, isTranslatablePdfBlock, shouldPreserveOcrBlock, shouldPreserveScientificBlock } from "../pdf-translation-policy.mjs";

test("protects numeric tables and ticker-like cells", () => {
  assert.equal(shouldPreserveOcrBlock({ role:"body", text:"AAPL 202.12 4.31 2.17 8.90", lines:[{}, {}, {}] }), true);
  assert.equal(shouldPreserveOcrBlock({ role:"body", text:"EBITDA" }), true);
  assert.equal(shouldPreserveOcrBlock({ role:"body", text:"The central bank kept rates unchanged after reviewing the latest inflation data." }), false);
});

test("protects equations and code while translating mathematical explanations", () => {
  assert.equal(shouldPreserveScientificBlock({role:"body",text:"dy/dx = 3x^2 + 2x - 1"}),true);
  assert.equal(shouldPreserveScientificBlock({role:"body",text:"∫ x^2 dx = x^3 / 3 + C"}),true);
  assert.equal(shouldPreserveScientificBlock({role:"body",text:"The derivative measures the instantaneous rate of change of a function."}),false);
  const blocks=[{role:"body",text:"y = x^2 + 1"},{role:"body",text:"This parabola opens upward."}];
  assert.equal(applyNativeTranslationPolicy(blocks).preserved,1);
  assert.equal(isTranslatablePdfBlock(blocks[0]),false);
  assert.equal(isTranslatablePdfBlock(blocks[1]),true);
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
