# Source and license audit

## 已纳入

- `Kami Subs`，提交 `b8b276e`，MIT：音频捕获、Offscreen Document、WebSocket、字幕浮层和本地 faster-whisper 服务。
- `YT Dual Subs`，提交 `981df0b`，MIT：抽取页面主世界 timedtext 请求监听与 JSON3 字幕解析，运行文件为 `apps/browser-extension/youtube/timedtext-sniffer.js`；翻译与界面已改接本项目。
- 用户提供的 `YouTube Digest 1.1.5`，MIT：抽取学习侧栏、语义分段、时间戳回跳、摘要、解释、笔记和缓存；已改造成任意网页视频共享的学习工作区。
- `ResearchLens Translator`，提交 `8e558c0`，MIT：抽取网页结构化翻译、划词翻译、PDF.js 阅读器、重试与翻译质量校验；已使用本项目品牌和 137 条专业术语预设。
- `PDF.js`（随 ResearchLens 快照），Apache-2.0：用于浏览器内 PDF 阅读与文本层。
- `WhisperLiveKit`，提交 `334b338a`：仅参考稳定前缀和重叠去重思想，运行实现已经重写在统一库中；上游源码快照不进入 0.4 成品包。未接入具有额外非商用条款的 SimulStreaming 后端。
- `BabelDOC 0.6.4`，AGPL-3.0：0.4 成品不保留其源码仓库，只通过统一 PDF 接口调用本机环境中单独安装的运行包。

## 许可证边界

- 根目录原创代码为 MIT；各上游目录继续受各自许可证约束。
- BabelDOC 是可选运行组件，不属于本项目原创库；安装和使用仍受 AGPL-3.0 约束。
- NLLB-200 模型为 CC-BY-NC-4.0，只适合当前个人/非商用场景；商业化时应替换模型或取得许可。

## 规则

- 上游仓库、审计快照、旧 `services`/`engines`/`packages` 结构均不进入 0.4 成品包；Python 运行入口统一为 `quant_scholar_translator`。
- 每次抽取代码都记录来源文件、提交和修改说明。
- MIT 版权文本随分发包保留。
- 未明确许可证的仓库只用于功能调研，不复制代码。
