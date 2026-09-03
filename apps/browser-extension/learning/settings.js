/**
 * Shared, non-secret configuration helpers.
 *
 * API keys are stored in chrome.storage.local by options.js. This file contains
 * defaults and validation only, so it is safe to publish.
 */
var YTD_SETTINGS = (() => {
  const STORAGE_KEY = "ytd_settings";
  const DEFAULTS = Object.freeze({
    provider: "kimi_subscription",
    aiApiKey: "",
    aiBaseUrl: "http://127.0.0.1:8765/kimi/v1",
    aiModel: "kimi-subscription",
  });
  const PROVIDERS = Object.freeze({
    kimi_subscription: Object.freeze({
      provider: "kimi_subscription",
      aiBaseUrl: "http://127.0.0.1:8765/kimi/v1",
      aiModel: "kimi-subscription",
      keyRequired: false,
    }),
    codex: Object.freeze({
      provider: "codex",
      aiBaseUrl: "http://127.0.0.1:8765/codex/v1",
      aiModel: "codex-subscription",
      keyRequired: false,
    }),
    kimi_api: Object.freeze({
      provider: "kimi_api",
      aiBaseUrl: "https://api.moonshot.cn/v1",
      aiModel: "kimi-k3",
      keyRequired: true,
    }),
  });

  function isLegacyProvider(input) {
    return !!input && input.provider && input.provider !== "kimi" && !PROVIDERS[input.provider];
  }

  function normalize(input = {}) {
    const requested = input.provider === "kimi" ? "kimi_api" : input.provider;
    const provider = PROVIDERS[requested] ? requested : DEFAULTS.provider;
    const preset = PROVIDERS[provider];
    return {
      provider,
      aiApiKey: isLegacyProvider(input) || !preset.keyRequired
        ? ""
        : typeof input.aiApiKey === "string"
          ? input.aiApiKey.trim()
          : "",
      aiBaseUrl: preset.aiBaseUrl,
      aiModel: preset.aiModel,
    };
  }

  function migrateLegacyCustom(input = {}) {
    return {
      settings: normalize(input),
      migrated: isLegacyProvider(input),
    };
  }

  function chatCompletionsUrl(settings = DEFAULTS) {
    return `${settings.aiBaseUrl}/chat/completions`;
  }

  function canonicalYouTubeUrl(videoId) {
    const normalized = String(videoId || "").trim();
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(normalized)) {
      throw new Error("Invalid YouTube video ID.");
    }
    return `https://www.youtube.com/watch?v=${normalized}`;
  }

  return {
    STORAGE_KEY,
    DEFAULTS,
    PROVIDERS,
    isLegacyProvider,
    normalize,
    migrateLegacyCustom,
    chatCompletionsUrl,
    canonicalYouTubeUrl,
  };
})();

globalThis.YTD_SETTINGS = YTD_SETTINGS;

if (typeof module !== "undefined" && module.exports) {
  module.exports = YTD_SETTINGS;
}
