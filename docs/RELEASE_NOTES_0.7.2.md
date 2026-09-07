# Quant Scholar Translator 0.7.2

作者：**LX.COCOSCENT**（GitHub：**PHD-LXETHA**）

这是 PDF 专业精译与本地服务启动修复版本。

- PDF 使用 Codex/Kimi 套餐精译时，会通过 Native Messaging 静默启动本地服务并等待就绪，无需每次手动打开 PowerShell。
- Chrome 与 Edge 共用同一套用户级本地启动器；安装脚本不需要管理员权限。
- PDF 阅读器会区分“全部段落已有译文”和“未识别到可翻译文字”，扫描版 PDF 会明确提示先执行 OCR。
- 不改变远程 API、Kimi 兼容 API 或本地 Ollama 的启动方式。

首次安装或扩展 ID 变化时，仍需运行一次 `apps/browser-extension/native/install.ps1`。升级源码版扩展后，请在扩展管理页点击“重新加载”。
