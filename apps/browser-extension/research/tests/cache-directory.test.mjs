import assert from "node:assert/strict";
import test from "node:test";
import { externalCacheFileName } from "../cache-directory.mjs";

test("creates a stable filesystem-safe filename for an external document session", () => {
  const filename = externalCacheFileName("abc123:def456/model profile");
  assert.equal(filename, "researchlens-session-abc123_def456_model_profile.json");
  assert.ok(!/[\\/:*?\"<>|]/.test(filename));
});
