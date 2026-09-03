# iPhone、iPad 与 Safari 支持

Quant Scholar 0.6.0 提供两条移动路径，能力边界不同。

## Safari Web Extension

`apps/safari-extension` 是 Safari Web Extension 源码，适用于 iPhone、iPad 和 macOS Safari。点击 Safari 工具栏中的 QS 后，会在当前网页中打开可拖动悬浮菜单。它可以读取网页向浏览器公开的 HTML5 字幕轨，并用 Kimi、Codex 或 NLLB 翻译；知识库仅记录最终译文。

Safari 扩展必须经过 Apple 的 Web Extension 打包和签名流程才能安装到 iPhone/iPad。Windows 仓库交付的是完整扩展源码和可上传的 ZIP，不冒充已签名的 App Store 安装包。运行 `scripts/build-safari-package.ps1` 可生成源码包。本版标记为实验性移动适配，尚未完成 Apple 签名安装与 iPhone/iPad 真机端到端验证。

## Safari 与 Chrome 通用移动工作台

iOS 版 Chrome 不能安装桌面 Chrome 扩展。Safari 和 Chrome 都可打开移动工作台：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-mobile.ps1
```

命令会生成一次配对令牌，并列出局域网地址。在手机或 iPad 打开显示的 `/mobile/` 地址，再输入同一个令牌。服务只应在可信局域网中使用；关闭窗口即停止局域网服务。

移动工作台支持专业领域、Kimi/Codex/NLLB、上下文翻译、最终译文保存以及 Markdown/JSON 导出。令牌和移动知识记录只保存在当前浏览器。

## 能力边界

| 场景 | Chrome 桌面扩展 | Safari 扩展（iOS/iPadOS） | 移动网页（Safari/Chrome） |
|---|---:|---:|---:|
| 网页公开字幕实时翻译 | 是 | 是 | 否 |
| 无字幕时捕获当前标签页音频 | 是 | 否 | 否 |
| 专业实时 / 极速预览 / 离线模式 | 是 | 是 | 手动文本选择引擎 |
| 知识库导出 | 是 | 是 | 是 |
| PDF 阅读 | 是 | 由 Safari 打开后复制文本 | 可粘贴段落 |

iOS 不允许普通扩展或网页通用捕获另一个标签页的音频，因此无字幕视频不能在移动端声称与桌面 Chrome 完全等价。Safari 扩展的“实时”能力依赖页面可访问字幕。

## 隐私

- 桌面音频按约 1 秒 PCM 内存块发送到本机 Whisper，不生成 WAV、MP3 或 WebM 文件。
- 停止翻译时会清空浏览器音频缓冲区并释放捕获轨道。
- Codex/Kimi 只接收识别后的文字、源文本上下文和术语提示，不接收音频。
- 极速预览的 NLLB 结果只用于屏幕临时显示，不进入专业模型请求，也不写入知识库。
