# Quant Scholar Translator 0.7.0

作者：**LX.COCOSCENT**（GitHub：**PHD-LXETHA**）

本版将视频、网页和科研 PDF 翻译管线统一为可复用的专业学习工作流，并重点增强数学、统计、量化金融、金融、经济、编程与科研论文七个领域。

## 专业翻译升级

- 内置 1,424 条语境术语与 703 个别名；保留用户自定义术语，并支持版本迁移。
- Codex 默认使用中等推理完成整句/段落翻译；疑难段落自动进入高等推理复译。
- Kimi 套餐通道兼容当前 Kimi Code CLI，使用禁用工具的专用翻译代理，避免无关工具调用。
- NLLB 只作为快速预览或离线终稿；专业模式始终从原文独立翻译，不引用 NLLB 临时结果。
- 数字、比例、基点、货币、公式、变量、代码、URL、引用及缩写在终稿前进行保护与一致性校验。

## 视频与学习存档

- 支持网页公开字幕、可合法读取的完整字幕/音轨提前翻译，以及只能随播放获取声音时的实时识别。
- 对 CQF/Brightcove 等嵌入式播放器增加字幕发现与段落合并处理；受 DRM、加密轨道和站点权限限制的内容仍会回退实时音频识别。
- 每个视频按 `00001` 起的序号和视频标题自动保存独立双语 Markdown，回看同一视频时可恢复已完成译文与时间戳。
- 右侧学习栏提供原文、中文和双语记录，可继续编辑学习笔记并导出 Markdown、结构化 JSON 或双语 SRT。

## PDF 与网页

- 科研 PDF 默认直接交给 Codex/Kimi 专业精译，不经过 NLLB 预览链；复杂版式可接入可选的 PDF 运行组件。
- 网页全文、选区翻译、原文/译文切换及知识库沉淀继续使用统一术语、保护和导出契约。

## 安装包

- `quant-scholar-browser-extension-0.7.0.zip`：Chrome/Edge 解压后以开发者模式加载。
- `quant-scholar-translator-professional-0.7.0.zip`：完整源码、扩展、脚本与文档。
- `quant_scholar_translator-0.7.0-py3-none-any.whl`：可安装的统一 Python 库。
- `quant-scholar-safari-web-extension-0.7.0.zip`：Safari Web Extension 源码；仍需 Apple 工具链签名与真机验证。
- `SHA256SUMS-0.7.0.txt`：安装包 SHA-256 校验值。

已有 Chrome/Edge 用户需要删除旧的已解压目录或将其替换为新版，然后在扩展管理页点击“重新加载”并刷新视频页面。验证结果与明确限制见 `docs/VERIFICATION_0.7.0.md`。
