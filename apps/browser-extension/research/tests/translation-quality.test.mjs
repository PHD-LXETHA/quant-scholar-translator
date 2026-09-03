import assert from "node:assert/strict";
import test from "node:test";
import { isLikelyUntranslated, isSourcePreservingContent, translationQuality } from "../translation-quality.mjs";

const source = "This stoichiometric design partially replaces ferric ions with equimolar copper and titanium, yielding a layered cathode that maintains interfacial stability during high-voltage cycling.";

test("rejects a long English paragraph copied as its translation", () => {
  assert.equal(isLikelyUntranslated(source, source, "简体中文"), true);
  assert.equal(translationQuality(source, source, "简体中文").reason, "source-copy");
});

test("rejects an English paraphrase when Chinese is requested", () => {
  const paraphrase = "The proposed composition substitutes iron with copper and titanium and preserves a stable interface throughout operation at high voltage.";
  assert.equal(isLikelyUntranslated(source, paraphrase, "中文"), true);
});

test("accepts a Chinese scientific translation containing formulas and abbreviations", () => {
  const translated = "该化学计量设计以等摩尔 Cu2+ 和 Ti4+ 部分取代 Fe3+，从而获得在高电压循环期间保持界面稳定的 O3 型层状正极。";
  assert.equal(isLikelyUntranslated(source, translated, "简体中文"), false);
});

test("accepts Chinese text that preserves a subset of English scientific terms", () => {
  const technicalSource = "Based on the frontier molecular orbital theory, the redox stability of salts, solvents, and additives is predicted by density functional theory (DFT). Sodium perchlorate (NaClO4), tetrabutylammonium perchlorate (TBAClO4), lowest unoccupied molecular orbital (LUMO), DOL/DME, NDDT, VC, and binding energy in eV are compared to clarify the solvation structure.";
  const translated = "基于 frontier molecular orbital theory，采用 density functional theory (DFT) 预测盐、溶剂和添加剂的氧化还原稳定性。比较 sodium perchlorate (NaClO4)、tetrabutylammonium perchlorate (TBAClO4)、lowest unoccupied molecular orbital (LUMO)、DOL/DME、NDDT、VC 以及以 eV 表示的 binding energy，从而阐明溶剂化结构。";
  assert.equal(isLikelyUntranslated(technicalSource, translated, "简体中文"), false);
});

test("does not flag URLs, DOI labels, short metadata or reference lists", () => {
  assert.equal(isLikelyUntranslated("https://pubs.acs.org/journal/aelccp", "https://pubs.acs.org/journal/aelccp", "中文"), false);
  assert.equal(isLikelyUntranslated("Letter", "Letter", "中文"), false);
  const references = "References 1. A. Author, Journal 2024, https://doi.org/10.1000/a. 2. B. Author, Journal 2025, https://doi.org/10.1000/b.";
  assert.equal(isLikelyUntranslated(references, references, "中文"), false);
});

test("does not reject publisher notices, affiliations or metadata roles", () => {
  const notice = "Downloaded from Wiley Online Library under the applicable Creative Commons license and terms-and-conditions for open access articles.";
  assert.equal(isLikelyUntranslated(notice, notice, "中文"), false);
  assert.equal(isLikelyUntranslated(source, source, "中文", { role: "metadata" }), false);
  const affiliation = "School of Materials Science and Engineering, Example University; National Laboratory for Energy Chemistry, Research Institute of Advanced Materials.";
  assert.equal(isLikelyUntranslated(affiliation, affiliation, "中文"), false);
});

test("still validates long figure captions", () => {
  const caption = "Figure 4. Electrochemical performance of the layered oxide cathode at different current densities and temperatures during prolonged cycling.";
  assert.equal(isLikelyUntranslated(caption, caption, "简体中文", { role: "figure-caption" }), true);
});

test("preserves correspondence identifiers but never treats figure captions as identifiers", () => {
  const correspondence = "Correspondence: Xu-Dong Zhang (xdzhang@example.edu); https://orcid.org/0000-0000-0000-0000";
  assert.equal(isSourcePreservingContent(correspondence, { role: "metadata" }), true);
  assert.equal(isSourcePreservingContent("FIGURE 1. Schematic illustration of the sol-gel synthesis and electrochemical testing workflow.", { role: "figure-caption" }), false);
});
