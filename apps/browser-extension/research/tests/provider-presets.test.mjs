import assert from "node:assert/strict";
import test from "node:test";
import { PROVIDER_PRESETS, getProviderPreset, providerNeedsApiKey } from "../provider-presets.mjs";

test("includes mainstream domestic, international and local providers", () => {
  const names = Object.keys(PROVIDER_PRESETS);
  assert.equal(names.length, 22);
  for (const name of ["codex", "kimi_subscription", "deepseek", "qwen", "kimi", "zhipu", "doubao", "hunyuan", "qianfan", "minimax", "siliconflow", "ai302", "openai", "anthropic", "gemini", "openrouter", "mistral", "groq", "xai", "ollama", "lmstudio", "custom"]) {
    assert.ok(names.includes(name), `missing ${name}`);
  }
});

test("uses the expected native and compatible API styles", () => {
  assert.equal(getProviderPreset("openai").apiStyle, "responses");
  assert.equal(getProviderPreset("anthropic").apiStyle, "anthropic");
  assert.equal(getProviderPreset("gemini").apiStyle, "chat");
  assert.match(getProviderPreset("deepseek").endpoint, /^https:\/\/api\.deepseek\.com\//);
  assert.match(getProviderPreset("gemini").endpoint, /\/openai\/chat\/completions$/);
  assert.match(getProviderPreset("qwen").endpoint, /compatible-mode\/v1\/chat\/completions$/);
  assert.equal(getProviderPreset("doubao").apiStyle, "responses");
  assert.match(getProviderPreset("hunyuan").endpoint, /\/v1\/chat\/completions$/);
  assert.match(getProviderPreset("qianfan").endpoint, /\/v2\/chat\/completions$/);
  assert.match(getProviderPreset("minimax").endpoint, /\/v1\/chat\/completions$/);
  assert.match(getProviderPreset("xai").endpoint, /^https:\/\/api\.x\.ai\//);
});

test("local model presets do not require or transmit a cloud key", () => {
  assert.equal(providerNeedsApiKey("codex"), false);
  assert.equal(providerNeedsApiKey("kimi_subscription"), false);
  assert.equal(providerNeedsApiKey("ollama"), false);
  assert.equal(providerNeedsApiKey("lmstudio"), false);
  assert.equal(providerNeedsApiKey("deepseek"), true);
  assert.match(getProviderPreset("ollama").endpoint, /^http:\/\/localhost:11434\//);
  assert.match(getProviderPreset("lmstudio").endpoint, /^http:\/\/localhost:1234\//);
  assert.match(getProviderPreset("kimi_subscription").endpoint, /127\.0\.0\.1:8765\/kimi\/v1/);
});

test("unknown providers fall back to the editable custom preset", () => {
  assert.equal(getProviderPreset("unknown"), PROVIDER_PRESETS.custom);
});
