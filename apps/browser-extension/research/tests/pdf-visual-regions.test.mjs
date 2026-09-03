import assert from "node:assert/strict";
import test from "node:test";
import { availableOverlayHeight, detectVisualRegions } from "../pdf-visual-regions.mjs";

const viewport = { width: 600, height: 800 };
const block = (text, x, y, width, height, role = "body") => ({ text, x, y, width, height, right: x + width, bottom: y + height, role });

test("detects a table below its caption and marks table text as visual content", () => {
  const caption = block("TABLE 2 | Photovoltaic parameters of champion PSCs", 50, 300, 250, 18, "figure-caption");
  const header = block("Jsc (mA cm-2) Voc (V) FF (%) PCE (%)", 50, 330, 250, 16);
  const values = block("4PACz-F 24.60 1.169 74.87 21.53", 50, 350, 250, 42);
  const narrative = block("The following discussion explains how the optimized interface improves photovoltaic performance during continuous operation.", 50, 420, 250, 54);
  const regions = detectVisualRegions([caption, header, values, narrative], viewport, 10);
  assert.equal(regions.length, 1);
  assert.equal(regions[0].kind, "table");
  assert.ok(regions[0].y >= caption.bottom);
  assert.ok(regions[0].y + regions[0].height < narrative.y);
  assert.equal(header.role, "figure-content");
  assert.equal(values.role, "figure-content");
  assert.equal(narrative.role, "body");
});

test("keeps a long full-page table at full width and through the final rows", () => {
  const caption = block("TABLE 1 | Summary of cathode materials, phase transitions, and detailed electrochemical properties of B-modified Na-based cathodes.", 48, 38, 245, 18, "figure-caption");
  const leftHeader = block("Cathode materials", 48, 72, 205, 18);
  const middleColumns = block("Phase transitions Voltage range Electrochemical performance", 260, 72, 225, 18);
  const rightColumns = block("Capacity Retention Refs.", 490, 72, 62, 18);
  const finalLeftRow = block("Na(Ni1/3Fe1/3Mn1/3)O2", 48, 720, 205, 24);
  const finalRightRow = block("84.8% after 100 cycles [156]", 430, 720, 122, 24);
  const regions = detectVisualRegions([caption, leftHeader, middleColumns, rightColumns, finalLeftRow, finalRightRow], viewport, 10);
  assert.equal(regions.length, 1);
  assert.ok(regions[0].width > viewport.width * .9);
  assert.ok(regions[0].y + regions[0].height > 740);
  assert.equal(rightColumns.role, "figure-content");
  assert.equal(finalRightRow.role, "figure-content");
});

test("keeps a one-column table narrow when narrative text occupies the other column", () => {
  const caption = block("TABLE 3. Local refinement results", 50, 250, 230, 18, "figure-caption");
  const values = block("Sample a b c Rwp", 50, 280, 230, 80);
  const parallelNarrative = block("This sufficiently long scientific paragraph continues in the right column beside the compact table and must not be captured as part of it.", 330, 250, 220, 120);
  const followingNarrative = block("The following scientific discussion starts below the compact table and describes the refined crystal structure in detail.", 50, 390, 230, 80);
  const regions = detectVisualRegions([caption, values, parallelNarrative, followingNarrative], viewport, 10);
  assert.equal(regions.length, 1);
  assert.ok(regions[0].width < viewport.width * .55);
  assert.equal(parallelNarrative.role, "body");
});

test("keeps ordinary figures above their captions", () => {
  const narrative = block("This sufficiently long scientific paragraph appears before the figure and describes the experimental mechanism in detail.", 50, 100, 480, 60);
  const panelLabel = block("a b c", 80, 220, 420, 40);
  const caption = block("FIGURE 1. Schematic illustration of the interfacial passivation mechanism.", 50, 340, 480, 20, "figure-caption");
  const regions = detectVisualRegions([narrative, panelLabel, caption], viewport, 10);
  assert.equal(regions.length, 1);
  assert.equal(regions[0].kind, "figure");
  assert.ok(regions[0].y < caption.y);
  assert.equal(panelLabel.role, "figure-content");
});

test("expands a full-width figure whose extracted caption covers only one column", () => {
  const narrative = block("This sufficiently long scientific paragraph introduces the modification strategy before the full-width schematic.", 50, 80, 240, 52);
  const caption = block("FIGURE 5. Schematic illustration of the advantages of boron-modified layered oxide cathodes for sodium-ion batteries.", 50, 620, 250, 34, "figure-caption");
  const regions = detectVisualRegions([narrative, caption], viewport, 10);
  assert.equal(regions.length, 1);
  assert.ok(regions[0].width > viewport.width * .9);
});

test("does not expand a one-column figure across parallel narrative text", () => {
  const leftNarrative = block("This sufficiently long scientific paragraph introduces the compact microscopy image in the left column.", 50, 80, 240, 52);
  const parallelNarrative = block("This sufficiently long scientific paragraph continues through the right column beside the compact figure and must remain ordinary text.", 330, 150, 220, 260);
  const caption = block("FIGURE 6. Representative particle morphology after cycling and elemental mapping results.", 50, 430, 240, 34, "figure-caption");
  const regions = detectVisualRegions([leftNarrative, parallelNarrative, caption], viewport, 10);
  assert.equal(regions.length, 1);
  assert.ok(regions[0].width < viewport.width * .55);
  assert.equal(parallelNarrative.role, "body");
});

test("keeps a tall full-page Wiley figure instead of clipping it to 66 percent page height", () => {
  const journalViewport = { width: 980, height: 1231.7 };
  const caption = block("FIGURE 2 | XRD, XPS, XANES, EXAFS, and wavelet-transform analysis.", 83.1, 923.7, 813.8, 46, "figure-caption");
  const regions = detectVisualRegions([caption], journalViewport, 12.6);
  assert.equal(regions.length, 1);
  assert.ok(regions[0].y <= journalViewport.height * .05);
  assert.ok(regions[0].height > 850);
  assert.ok(regions[0].y + regions[0].height < caption.y);
});

test("detects a full-width figure after its split Wiley caption has been merged", () => {
  const journalViewport = { width: 980, height: 1231.7 };
  const caption = block("FIGURE 4 (a) The CV curves. (b-k) Electrochemical performance and full-cell results.", 83.1, 686.5, 782.1, 58, "figure-caption");
  const regions = detectVisualRegions([caption], journalViewport, 12.6);
  assert.equal(regions.length, 1);
  assert.equal(regions[0].kind, "figure");
  assert.ok(regions[0].width > journalViewport.width * .9);
  assert.ok(regions[0].height > 590);
});

test("detects the RNFS full-page figure above a descriptive Figure 2 caption", () => {
  const journalViewport = { width: 949.04, height: 1239.02 };
  const caption = block("FIGURE 2 Electrochemical characteristics of RNFS and NFS electrodes and cycling performance.", 83.1, 649.5, 782.1, 86.2, "figure-caption");
  const narrative = block("The following scientific discussion compares electrochemical performance after the figure caption.", 83.1, 770.1, 377.9, 370.7);
  const regions = detectVisualRegions([caption, narrative], journalViewport, 13.9);
  assert.equal(regions.length, 1);
  assert.ok(regions[0].y <= journalViewport.height * .05);
  assert.ok(regions[0].height > 590);
  assert.ok(regions[0].width > journalViewport.width * .9);
});

test("marks a block that substantially intersects a figure even when its center is outside", () => {
  const narrative = block("This scientific paragraph establishes the context immediately before a large multipanel figure in the article.", 50, 80, 480, 50);
  const partialPanelLabel = block("a b c d", 80, 180, 420, 70);
  const caption = block("FIGURE 2. Structural characterization and electrochemical response of all prepared samples.", 50, 225, 480, 20, "figure-caption");
  detectVisualRegions([narrative, partialPanelLabel, caption], viewport, 10);
  assert.equal(partialPanelLabel.role, "figure-content");
});

test("uses a horizontally intersecting figure as a hard overlay boundary", () => {
  const source = { ...block("A translated paragraph above the figure", 50, 100, 240, 45), lineHeight: 14 };
  const distantText = block("The next paragraph appears below the figure", 50, 500, 240, 45);
  const figure = { kind: "figure", x: 40, y: 190, width: 520, height: 250 };
  assert.equal(availableOverlayHeight(source, [source, distantText], [figure]), 88);
});

test("ignores a figure in the other column when sizing an overlay", () => {
  const source = { ...block("Left-column text", 50, 100, 220, 45), lineHeight: 14 };
  const figure = { kind: "figure", x: 330, y: 150, width: 220, height: 250 };
  assert.equal(availableOverlayHeight(source, [source], [figure]), 48);
});
