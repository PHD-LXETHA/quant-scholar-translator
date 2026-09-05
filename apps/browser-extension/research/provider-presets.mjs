export const PROVIDER_PRESETS = Object.freeze({
  codex: { label: "Codex（ChatGPT 套餐）", apiStyle: "chat", endpoint: "http://127.0.0.1:8765/codex/v1/chat/completions", model: "codex-subscription", group: "套餐模式", keyRequired: false, note: "使用本机 Codex CLI 的 ChatGPT 套餐额度，不使用 OpenAI API Key。首次使用或凭据失效时运行稳定命令 codex login；正常重启服务无需重登。适合精译、论文和知识整理。" },
  kimi_subscription: { label: "Kimi（会员套餐）", apiStyle: "chat", endpoint: "http://127.0.0.1:8765/kimi/v1/chat/completions", model: "kimi-subscription", group: "套餐模式", keyRequired: false, note: "使用本机 Kimi Code CLI 的会员额度，不使用开放平台 API Key。请先运行 kimi login 并启动本地服务；如不希望产生套餐外费用，请在 Kimi 账户中关闭 Extra Usage。" },
  deepseek: { label: "DeepSeek", apiStyle: "chat", endpoint: "https://api.deepseek.com/chat/completions", model: "deepseek-v4-flash", group: "国内云端", keyRequired: true },
  qwen: { label: "阿里云百炼 / 通义千问", apiStyle: "chat", endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", model: "qwen-plus", group: "国内云端", keyRequired: true, note: "北京地域通用兼容地址；工作空间专属地址可在下方手动替换。" },
  kimi: { label: "Kimi / Moonshot", apiStyle: "chat", endpoint: "https://api.moonshot.cn/v1/chat/completions", model: "kimi-k3", group: "国内云端", keyRequired: true, note: "Quant Scholar 默认服务；Kimi 官方当前推荐从 K3 开始。" },
  zhipu: { label: "智谱 GLM", apiStyle: "chat", endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions", model: "glm-5.1", group: "国内云端", keyRequired: true },
  doubao: { label: "火山方舟 / 豆包", apiStyle: "responses", endpoint: "https://ark.cn-beijing.volces.com/api/v3/responses", model: "doubao-seed-2-0-lite-260215", group: "国内云端", keyRequired: true, note: "使用火山方舟官方 Responses 接口；模型名可换成控制台中已开通的模型或推理接入点 ID。" },
  hunyuan: { label: "腾讯混元", apiStyle: "chat", endpoint: "https://api.hunyuan.cloud.tencent.com/v1/chat/completions", model: "hunyuan-turbos-latest", group: "国内云端", keyRequired: true },
  qianfan: { label: "百度千帆", apiStyle: "chat", endpoint: "https://qianfan.baidubce.com/v2/chat/completions", model: "ernie-4.5-turbo-128k", group: "国内云端", keyRequired: true, note: "使用百度千帆 V2 OpenAI 兼容接口；API Key 通常以 bce-v3/ 开头。" },
  minimax: { label: "MiniMax", apiStyle: "chat", endpoint: "https://api.minimaxi.com/v1/chat/completions", model: "MiniMax-M2.7", group: "国内云端", keyRequired: true },
  siliconflow: { label: "硅基流动 SiliconFlow", apiStyle: "chat", endpoint: "https://api.siliconflow.cn/v1/chat/completions", model: "deepseek-ai/DeepSeek-V4-Flash", group: "国内云端", keyRequired: true },
  ai302: { label: "302.AI 聚合接口", apiStyle: "chat", endpoint: "https://api.302.ai/v1/chat/completions", model: "gpt-4o-mini", group: "国内云端", keyRequired: true, note: "302.AI 可通过同一接口使用多家模型；请把模型名改为账户中实际可用的模型。" },
  openai: { label: "OpenAI", apiStyle: "responses", endpoint: "https://api.openai.com/v1/responses", model: "gpt-4.1-mini", group: "国际云端", keyRequired: true },
  anthropic: { label: "Anthropic Claude", apiStyle: "anthropic", endpoint: "https://api.anthropic.com/v1/messages", model: "claude-sonnet-5", group: "国际云端", keyRequired: true },
  gemini: { label: "Google Gemini", apiStyle: "chat", endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", model: "gemini-3.5-flash", group: "国际云端", keyRequired: true, note: "使用 Google 官方 OpenAI 兼容接口。" },
  openrouter: { label: "OpenRouter", apiStyle: "chat", endpoint: "https://openrouter.ai/api/v1/chat/completions", model: "~openai/gpt-latest", group: "国际云端", keyRequired: true, note: "模型名可替换为 OpenRouter 模型目录中的任意 slug。" },
  mistral: { label: "Mistral AI", apiStyle: "chat", endpoint: "https://api.mistral.ai/v1/chat/completions", model: "mistral-small-latest", group: "国际云端", keyRequired: true },
  groq: { label: "Groq", apiStyle: "chat", endpoint: "https://api.groq.com/openai/v1/chat/completions", model: "llama-3.3-70b-versatile", group: "国际云端", keyRequired: true },
  xai: { label: "xAI / Grok", apiStyle: "chat", endpoint: "https://api.x.ai/v1/chat/completions", model: "grok-4.5", group: "国际云端", keyRequired: true },
  ollama: { label: "Ollama（本机）", apiStyle: "chat", endpoint: "http://localhost:11434/v1/chat/completions", model: "gpt-oss:20b", group: "本地模型", keyRequired: false, note: "请先启动 Ollama，并把模型名改成电脑中已经下载的模型。" },
  lmstudio: { label: "LM Studio（本机）", apiStyle: "chat", endpoint: "http://localhost:1234/v1/chat/completions", model: "model-identifier", group: "本地模型", keyRequired: false, note: "请先在 LM Studio 的 Developer 页面启动服务器，并填写已加载模型的 ID。" },
  custom: { label: "其他 OpenAI 兼容接口", apiStyle: "chat", endpoint: "", model: "", group: "自定义", keyRequired: true, note: "填写服务商给出的完整 Chat Completions 地址和模型名。" }
});

export function getProviderPreset(provider) { return PROVIDER_PRESETS[provider] || PROVIDER_PRESETS.custom; }
export function providerNeedsApiKey(provider) { return getProviderPreset(provider).keyRequired !== false; }
