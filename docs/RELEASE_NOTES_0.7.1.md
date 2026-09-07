# Quant Scholar Translator 0.7.1

作者：**LX.COCOSCENT**（GitHub：**PHD-LXETHA**）

这是 0.7.0 的兼容性热修复版本。

- 修复部分网页和播放器派发非标准 `keyup` 事件时，划词翻译监听器读取缺失 `event.key` 导致内容脚本异常的问题。
- 悬浮按钮与完整菜单不再因该类合成键盘事件中断。
- 修复 GitHub Actions 在 Ubuntu 上模拟 Windows `USERPROFILE` 时的路径分隔符断言，使本地 Windows 与云端 Linux 验证结果一致。
- 保留 0.7.0 的专业术语库、Codex/Kimi 精译、CQF 字幕、视频双语存档及科研 PDF 能力。

Chrome/Edge 用户请安装 `quant-scholar-browser-extension-0.7.1.zip`，或在当前源码目录更新后前往扩展管理页点击“重新加载”，随后刷新已打开的网页。
