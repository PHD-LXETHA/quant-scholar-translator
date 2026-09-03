import assert from "node:assert/strict";
import test from "node:test";
import { isRetryableApiStatus, retryDelayMs } from "../api-retry.mjs";
import { estimateTranslationUsage, translationProgress } from "../translation-usage.mjs";

test("retries rate limits and transient server failures but not authentication errors", () => {
  for (const status of [408, 429, 500, 502, 503, 504]) assert.equal(isRetryableApiStatus(status), true);
  for (const status of [400, 401, 403, 404]) assert.equal(isRetryableApiStatus(status), false);
});

test("uses Retry-After and bounded exponential delays", () => {
  assert.equal(retryDelayMs(0, "2", 0), 2000);
  assert.equal(retryDelayMs(0, "", 0), 700);
  assert.equal(retryDelayMs(2, "", 0), 2800);
  assert.ok(retryDelayMs(10, "", 1) <= 10000);
});

test("estimates source and repeated prompt token usage", () => {
  const estimate = estimateTranslationUsage({ sourceChars: 7600, promptChars: 1000, batchCount: 2 });
  assert.equal(estimate.sourceChars, 7600);
  assert.equal(estimate.batchCount, 2);
  assert.ok(estimate.inputTokens > 2500);
  assert.ok(estimate.totalTokens > estimate.inputTokens);
});

test("counts completed blocks and pages", () => {
  const progress = translationProgress([
    { blocks: [{ role: "body", translation: "译文" }, { role: "figure-content" }, { role: "artifact" }] },
    { blocks: [{ role: "body", translation: "" }, { role: "caption", translation: "图注" }] }
  ]);
  assert.deepEqual(progress, { total: 3, completed: 2, completedPages: 1, totalPages: 2, percent: 67 });
});
