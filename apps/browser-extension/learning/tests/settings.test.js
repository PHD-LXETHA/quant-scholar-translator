const test = require("node:test");
const assert = require("node:assert/strict");

const settings = require("../settings.js");

test("Kimi defaults use K3 without transcript-service credentials", () => {
  const normalized = settings.normalize({
    provider: "unexpected",
    aiApiKey: "  example-key  ",
    aiBaseUrl: "https://api.example.com/v1",
    aiModel: "example-model",
  });

  assert.equal(normalized.provider, "kimi");
  assert.equal(normalized.aiBaseUrl, "https://api.moonshot.cn/v1");
  assert.equal(normalized.aiModel, "kimi-k3");
  assert.equal(normalized.aiApiKey, "");
  assert.deepEqual(Object.keys(normalized).sort(), [
    "aiApiKey",
    "aiBaseUrl",
    "aiModel",
    "provider",
  ]);
  assert.equal(
    settings.chatCompletionsUrl(),
    "https://api.moonshot.cn/v1/chat/completions",
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
  assert.equal(first.settings.provider, "kimi");
  assert.equal(first.settings.aiBaseUrl, settings.DEFAULTS.aiBaseUrl);
  assert.equal(first.settings.aiModel, settings.DEFAULTS.aiModel);
  assert.equal(first.settings.aiApiKey, "");

  const second = settings.migrateLegacyCustom(first.settings);
  assert.equal(second.migrated, false);
  assert.deepEqual(second.settings, first.settings);

  const configuredKimi = settings.normalize({
    ...first.settings,
    aiApiKey: "new-kimi-key",
  });
  assert.equal(configuredKimi.aiApiKey, "new-kimi-key");
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
