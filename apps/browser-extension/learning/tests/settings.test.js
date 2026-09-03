const test = require("node:test");
const assert = require("node:assert/strict");

const settings = require("../settings.js");

test("Kimi membership is the default without API credentials", () => {
  const normalized = settings.normalize({
    provider: "unexpected",
    aiApiKey: "  example-key  ",
    aiBaseUrl: "https://api.example.com/v1",
    aiModel: "example-model",
  });

  assert.equal(normalized.provider, "kimi_subscription");
  assert.equal(normalized.aiBaseUrl, "http://127.0.0.1:8765/kimi/v1");
  assert.equal(normalized.aiModel, "kimi-subscription");
  assert.equal(normalized.aiApiKey, "");
  assert.deepEqual(Object.keys(normalized).sort(), [
    "aiApiKey",
    "aiBaseUrl",
    "aiModel",
    "provider",
  ]);
  assert.equal(
    settings.chatCompletionsUrl(),
    "http://127.0.0.1:8765/kimi/v1/chat/completions",
  );
});

test("legacy custom migration clears only the AI key and is idempotent", () => {
  const legacy = {
    provider: "custom",
    aiApiKey: "custom-secret",
    aiBaseUrl: "https://api.example.com/v1",
    aiModel: "example-model",
  };
  const first = settings.migrateLegacyCustom(legacy);

  assert.equal(first.migrated, true);
  assert.equal(first.settings.provider, "kimi_subscription");
  assert.equal(first.settings.aiBaseUrl, settings.DEFAULTS.aiBaseUrl);
  assert.equal(first.settings.aiModel, settings.DEFAULTS.aiModel);
  assert.equal(first.settings.aiApiKey, "");

  const second = settings.migrateLegacyCustom(first.settings);
  assert.equal(second.migrated, false);
  assert.deepEqual(second.settings, first.settings);

  const configuredKimi = settings.normalize({
    provider: "kimi_api",
    aiApiKey: "new-kimi-key",
  });
  assert.equal(configuredKimi.provider, "kimi_api");
  assert.equal(configuredKimi.aiApiKey, "new-kimi-key");
});

test("Codex and Kimi membership use local no-key endpoints", () => {
  for (const provider of ["codex", "kimi_subscription"]) {
    const normalized = settings.normalize({ provider, aiApiKey: "must-not-survive" });
    assert.equal(normalized.provider, provider);
    assert.equal(normalized.aiApiKey, "");
    assert.match(normalized.aiBaseUrl, /^http:\/\/127\.0\.0\.1:8765\//);
  }
});

test("YouTube identifiers are canonicalized for local session matching", () => {
  assert.equal(
    settings.canonicalYouTubeUrl("ydTeb_I0b94"),
    "https://www.youtube.com/watch?v=ydTeb_I0b94",
  );
  assert.throws(
    () => settings.canonicalYouTubeUrl('"><script>'),
    /Invalid YouTube video ID/,
  );
});
