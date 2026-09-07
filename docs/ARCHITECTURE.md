# Architecture

## 统一学习数据流

```text
网页视频 ─┬─ 已有字幕适配器 ─────────┐
         └─ tabCapture → Whisper ───┤
网页正文 ───── DOM 分段与结构保留 ────┤
科研 PDF ──── 独立 PDF 引擎适配器 ────┤
                                     ▼
                     领域识别 → 专业术语与符号保护
                                     ▼
                         翻译 → 校验 → 双语呈现
                                     ▼
                      LearningSession 统一数据模型
                                     ▼
                    Markdown / JSON / SRT / 工作台 API
```

## 组件优势与归属

| 能力 | 采用来源 | 集成策略 |
|---|---|---|
| 任意非 DRM 标签页音频 | Kami Subs | 已作为所有网页播放器的实时底座抽取 |
| HTML5 / 常见播放器原字幕 | 本项目 + YT Dual Subs 思路 | 已接入；可读字幕优先，无字幕自动回退 ASR |
| YouTube 原字幕和整句重组 | YT Dual Subs | 已抽取 timedtext/JSON3 轨道监听，直接进入统一翻译管线 |
| 摘要、时间戳、解释、笔记 | YouTube Digest | 已转译为通用学习侧栏，非 YouTube 页面也能使用 |
| 网页/PDF 交互阅读 | ResearchLens + PDF.js | 已作为同一扩展内部模块运行 |
| 复杂论文 PDF 重建 | 统一 PDF 接口 | 可选调用环境中安装的 BabelDOC 0.6.4，不保留其源码仓库 |
| 扫描版 PDF OCR | 本地 OCR 接口 | RapidOCR + ONNX Runtime 逐页识别，图像不发送到第三方 OCR 服务 |
| 实时假设稳定 | WhisperLiveKit 思路 | 已重写为边界去重模块并接入 faster-whisper |
| 专业术语与符号保护 | 本项目 | 已建立首版模块 |
| TBX/TMX | 行业标准 | 后续导入导出与翻译记忆 |

## LearningSession

核心字段包括来源 URL、标题、领域、源语言、目标语言、时间、原文、译文和证据位置。视频已有媒体时间戳；PDF 将补充页码、边界框和章节；网页将补充 DOM 定位信息。可执行 JSON Schema 已嵌入 `quant_scholar_translator/data/schemas`。

该模型让同一份材料能够同时输出字幕、阅读卡、工作台知识文档和可追溯引用。
