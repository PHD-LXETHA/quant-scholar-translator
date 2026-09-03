import assert from "node:assert/strict";
import test from "node:test";
import { isReferenceEntryStart, parseReferenceList } from "../reference-list.mjs";

test("splits a translated references paragraph into numbered entries",()=>{
  const text="参考文献 1. C. Wang, L. Liu, 等, Tuning Local Chemistry, https://doi.org/10.1038/s41467-021-22523-3. 2. K. Zhang, D. Kim, 等, Manganese Based Layered Oxides. 3. X. Song, R. Liu, J. Jin, Unraveling the Mechanism.";
  const parsed=parseReferenceList(text,"References 1. C. Wang. 2. K. Zhang. 3. X. Song.");
  assert.equal(parsed.heading,"参考文献");
  assert.deepEqual(parsed.entries.map(entry=>entry.number),[1,2,3]);
  assert.match(parsed.entries[0].text,/22523-3\.$/);
  assert.match(parsed.entries[1].text,/Manganese Based/);
});

test("recognizes a sequential continuation page without a heading",()=>{
  const parsed=parseReferenceList("12. A. Author, First paper. 13. B. Author, Second paper. 14. C. Author, Third paper.");
  assert.deepEqual(parsed.entries.map(entry=>entry.number),[12,13,14]);
});

test("recognizes two strongly identified references in a continuation block",()=>{
  const text="9. Z. Zheng, X. Li, Y. Wang, et al., Self-Limited Surface Hydration, Energy Storage Materials 74 (2025): 103882, https://doi.org/10.1016/j.ensm.2024.103882. 10. W. Yang, Q. Liu, Q. Yang, et al., Nonequilibrium Evolution Mechanism, Small 20 (2024): e2405982, https://doi.org/10.1002/smll.202405982.";
  const parsed=parseReferenceList(text,text);
  assert.deepEqual(parsed.entries.map(entry=>entry.number),[9,10]);
  assert.match(parsed.entries[0].text,/103882/);
  assert.match(parsed.entries[1].text,/e2405982/);
});

test("does not treat ordinary numbered scientific prose as references",()=>{
  assert.equal(parseReferenceList("The voltage is 3.2 V. The capacity is 125.0 mAh g-1."),null);
});

test("recognizes isolated reference entries without confusing real section headings",()=>{
  assert.equal(isReferenceEntryStart("23. L. Li, J. L. Shen, H. Yang, et al., Advanced Energy Materials 14 (2024): e202400001."),true);
  assert.equal(isReferenceEntryStart("38. W"),true);
  assert.equal(isReferenceEntryStart("[9] Smith, J. R., Journal of Energy Chemistry 2025, https://doi.org/10.1000/test."),true);
  assert.equal(isReferenceEntryStart("3. A General Strategy for Interface Engineering"),false);
  assert.equal(isReferenceEntryStart("3.2. Electrochemical Performance"),false);
});
