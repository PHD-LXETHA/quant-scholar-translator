import assert from "node:assert/strict";
import test from "node:test";
import { scientificRuns } from "../scientific-text.mjs";

const compact = text => scientificRuns(text).map(run => `${run.script || "text"}:${run.text}`);

test("restores subscripts in battery-material formulas", () => {
  assert.deepEqual(compact("Cu@In2O3@Li 与 NaNi0.5Mn0.5O2"), [
    "text:Cu@In", "sub:2", "text:O", "sub:3", "text:@Li 与 NaNi", "sub:0.5", "text:Mn", "sub:0.5", "text:O", "sub:2"
  ]);
});

test("restores ion charges and unit exponents as superscripts", () => {
  assert.deepEqual(compact("Ni2+/Ni4+，1 mA cm−2，125 mAh g−1"), [
    "text:Ni", "sup:2+", "text:/Ni", "sup:4+", "text:，1 mA cm", "sup:−2", "text:，125 mAh g", "sup:−1"
  ]);
});

test("does not turn ordinary battery abbreviations into formulas", () => {
  assert.deepEqual(compact("NCM90、TOF-SIMS、DOD 和 H1→M→H2"), ["text:NCM90、TOF-SIMS、DOD 和 H1→M→H2"]);
});
