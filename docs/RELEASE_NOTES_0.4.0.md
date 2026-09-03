# Quant Scholar Translator 0.4.0

首个面向社区发布的专业版，由 **LX.COCOSCENT / PHD-LXETHA** 创建和维护。

## 版本亮点

- 面向 YouTube 及通用 HTML5 网页视频的实时双语字幕；
- 网页字幕优先，本地 Whisper 自动回退，不上传音频；
- 针对金融、量化、经济、统计、数学和编程语料的术语保护；
- Kimi K3 专业翻译、知识概览、内容解释和笔记整理；
- NLLB 本地离线翻译；
- 内置科研 PDF 阅读器，保护公式、代码、引用、图表编号和双栏结构；
- Markdown、JSON 和双语 SRT 导出，方便进入个人知识库；
- 完全移除外部字幕服务依赖；
- 统一深海蓝、青绿与金色的专业界面。

## 安装提醒

Chrome 开发者模式中只加载 `apps/browser-extension` 目录。第一次运行前执行
`scripts/setup.ps1`；模型和 API Key 均不包含在源码包中。

## 隐私与许可证

本地 Whisper 不上传音频。主动使用 Kimi 云端能力时，相关文本会发送到用户配置的
Kimi 接口。项目原创代码采用 MIT，第三方组件与模型继续遵守各自许可证，详见
`THIRD_PARTY_NOTICES.md` 与 `docs/SOURCE_AUDIT.md`。
