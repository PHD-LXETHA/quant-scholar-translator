import assert from "node:assert/strict";
import test from "node:test";
import { splitInlineSection } from "../section-heading.mjs";

test("splits an inline numbered subsection from its translated body", () => {
  const source = "3.2. Electrochemical Performance. After preparation, the cycling stability of the material was evaluated.";
  const translated = "3.2. 电化学性能。制备完成后，评估了材料的循环稳定性。";
  const result = splitInlineSection(source, translated);
  assert.equal(result.heading, "3.2. 电化学性能");
  assert.equal(result.body, "制备完成后，评估了材料的循环稳定性。");
  assert.equal(source.slice(result.sourceBodyStart), "After preparation, the cycling stability of the material was evaluated.");
});

test("supports inline Supporting Information section numbering", () => {
  const result = splitInlineSection(
    "S1. Experimental Procedures. All samples were prepared by solid-state synthesis.",
    "S1. 实验步骤。所有样品均采用固相法制备。"
  );
  assert.equal(result.heading, "S1. 实验步骤");
  assert.match(result.body, /^所有样品/);
});

test("does not split measurements or a heading without following body text", () => {
  assert.equal(splitInlineSection("The cell was charged to 3.2 V before testing.", "电池在测试前充电至 3.2 V。"), null);
  assert.equal(splitInlineSection("3.2. Electrochemical Performance", "3.2. 电化学性能"), null);
});

test("does not turn a numbered reference entry into an inline section heading", () => {
  const source = "23. L. Li, J. L. Shen, H. Yang, et al., Advanced Energy Materials 14 (2024): e202400001, https://doi.org/10.1002/aenm.202400001.";
  const translated = "23. L. Li, J. L. Shen, H. Yang, 等, Advanced Energy Materials 14 (2024)：e202400001，https://doi.org/10.1002/aenm.202400001。";
  assert.equal(splitInlineSection(source, translated), null);
});
