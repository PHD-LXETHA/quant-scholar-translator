# Quant Scholar Translator 0.5.0

作者：**LX.COCOSCENT**（GitHub：**PHD-LXETHA**）

## 新增

- 增加 **Codex 套餐**与 **Kimi 套餐**两个主选项，覆盖视频、网页、PDF 阅读器和学习工作台。
- Codex 通过官方 CLI 的 ChatGPT 登录工作；Kimi 通过官方 Kimi Code OAuth 登录工作，两者都无需在扩展中保存 API Key。
- 本地服务新增兼容 Chat Completions 的 `/codex/v1/chat/completions` 与 `/kimi/v1/chat/completions` 接口。
- 增加套餐登录状态检测与明确的计费模式标记。

## 安全与计费边界

- 项目不读取、复制或保存 Codex/Kimi 的登录凭据。
- 套餐调用在隔离的临时工作目录中执行，并阻止项目文件访问提示。
- 套餐模式会移除进程环境中的平台 API Key，避免静默切换到按量 API。
- Codex 只有在官方状态明确显示 ChatGPT 登录时才运行；Kimi 只有检测到 `managed:kimi-code` 与 `source=oauth` 时才运行。
- Kimi 会员额度与 Kimi Code 共用；如账户开启 Extra Usage，额度耗尽后仍可能扣除额外余额。

## 使用建议

- 逐句实时字幕：优先使用 NLLB 本地翻译，延迟更稳定。
- 论文、PDF、技术段落、摘要和知识整理：选择 Codex 套餐或 Kimi 套餐进行精译。
- Kimi/OpenAI 兼容 API 仍保留在高级设置，供需要固定模型或自动化吞吐时使用。
