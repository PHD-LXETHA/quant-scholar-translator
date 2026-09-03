import assert from "node:assert/strict";
import test from "node:test";
import { buildStableDocumentSignature, isCompatibleTranslationSession, matchCachedTranslations, sessionContentSimilarity } from "../pdf-session-cache.mjs";

const body = text => ({ role: "body", text });

test("semantic fingerprint ignores volatile publisher access text", () => {
  const article = [
    { number: 1, blocks: [body("A sufficiently long scientific abstract about sodium-ion layered oxide cathodes and oxygen redox chemistry."), { role: "caption", text: "Downloaded by Example University on 14 July 2026" }, body("The electrochemical mechanism remains stable during repeated sodium extraction and insertion cycles.")] },
    { number: 2, blocks: [body("Operando X-ray diffraction reveals a reversible P2 to O2 phase transition with limited voltage hysteresis."), body("Microscopy confirms that transition-metal migration is suppressed at the reconstructed surface interface.")] }
  ];
  const refreshed = structuredClone(article);
  refreshed[0].blocks[1].text = "Downloaded by Example University on 15 July 2026 from IP address 10.0.0.2";
  assert.equal(buildStableDocumentSignature(article), buildStableDocumentSignature(refreshed));
});

test("restores translations by source text when an inserted block shifts indexes", () => {
  const saved = [[
    { source: "First scientific paragraph", translation: "第一段" },
    { source: "Second scientific paragraph", translation: "第二段" },
    { source: "Third scientific paragraph", translation: "第三段" }
  ]];
  const current = [{ blocks: [body("New publisher watermark"), body("First  scientific paragraph"), body("Second scientific paragraph"), body("Third scientific paragraph")] }];
  const matches = matchCachedTranslations(current, saved);
  assert.deepEqual(matches.map(item => [item.blockIndex, item.translation]), [[1, "第一段"], [2, "第二段"], [3, "第三段"]]);
});

test("recognizes a legacy raw-byte session for the same article content", () => {
  const texts = [
    "Sodium-ion batteries are attractive candidates for large-scale stationary energy storage applications.",
    "Layered transition-metal oxides exhibit high theoretical capacities and tunable redox chemistry.",
    "Operando diffraction identifies a reversible structural transition during sodium extraction.",
    "Surface reconstruction and oxygen loss are effectively suppressed by the proposed coating strategy.",
    "The optimized electrode maintains excellent capacity retention over hundreds of charge-discharge cycles.",
    "These results provide a practical route toward high-energy and long-life sodium-ion cathode materials."
  ];
  const current = [{ blocks: texts.map(body) }];
  const saved = [texts.map((source, index) => ({ source, translation: `译文${index + 1}` }))];
  saved[0].splice(2, 0, { source: "Downloaded via institutional access on another date", translation: "" });
  const similarity = sessionContentSimilarity(current, saved);
  assert.ok(similarity.score > 0.9);
  assert.equal(isCompatibleTranslationSession(similarity), true);
});

test("does not reuse a cache from a different paper", () => {
  const first = [{ blocks: Array.from({ length: 6 }, (_, index) => body(`Sodium layered oxide scientific paragraph number ${index} with electrochemical measurements and structural analysis.`)) }];
  const second = [{ blocks: Array.from({ length: 6 }, (_, index) => ({ source: `Unrelated polymer synthesis paragraph number ${index} with optical spectroscopy and mechanical testing.`, translation: "译文" })) }];
  assert.equal(isCompatibleTranslationSession(sessionContentSimilarity(first, second)), false);
});
