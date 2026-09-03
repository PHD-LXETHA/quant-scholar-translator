import assert from "node:assert/strict";
import test from "node:test";
import {
  BATTERY_GLOSSARY_PRESET,
  formatGlossaryPrompt,
  glossaryToCsv,
  glossaryToJson,
  normalizeGlossaryTerms,
  parseGlossaryText
} from "../glossary.mjs";

test("normalizes and de-duplicates glossary terms case-insensitively", () => {
  assert.deepEqual(normalizeGlossaryTerms([
    { source: " oxygen redox ", target: " 氧氧化还原 " },
    { source: "OXYGEN REDOX", target: "重复" },
    { source: "", target: "无效" }
  ]), [{ source: "oxygen redox", target: "氧氧化还原" }]);
});

test("round-trips glossary JSON and quoted CSV", () => {
  const terms = [{ source: "Na, Li", target: "钠、锂" }, { source: 'term "A"', target: "译法" }];
  assert.deepEqual(parseGlossaryText(glossaryToJson(terms), ".json"), terms);
  assert.deepEqual(parseGlossaryText(glossaryToCsv(terms), ".csv"), terms);
});

test("formats glossary as an explicit high-priority prompt section", () => {
  const prompt = formatGlossaryPrompt([{ source: "layered oxide", target: "层状氧化物" }]);
  assert.match(prompt, /用户术语表/);
  assert.match(prompt, /layered oxide => 层状氧化物/);
  assert.ok(BATTERY_GLOSSARY_PRESET.length >= 25);
});
