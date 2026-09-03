# Quant Scholar Translator

[简体中文](README.md) | [English](README_EN.md)

[![Version](https://img.shields.io/badge/version-0.5.0-36d6c2)](https://github.com/PHD-LXETHA/quant-scholar-translator/releases)
[![License](https://img.shields.io/badge/license-MIT-f0c66d)](LICENSE)
[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4)](apps/browser-extension)
[![Python](https://img.shields.io/badge/Python-3.11--3.13-3776AB)](pyproject.toml)

面向技术视频、专业网页与科研 PDF 的本地优先双语学习工作台。它把实时字幕、专业翻译、论文阅读、术语保护与知识库导出放进同一套工作流，重点服务金融、量化、经济、统计、数学和编程内容。

> **专业版 0.5.0** · 由 [**LX.COCOSCENT**](https://github.com/PHD-LXETHA) 创建 · 本地 Whisper · Codex / Kimi 套餐 · 科研 PDF

## 为什么做这个项目

通用翻译工具适合日常文本，却经常在公式、变量、统计量、金融术语、代码标识符和论文版式上失真。Quant Scholar Translator 以“原始信息不被破坏”为第一原则：能读取原字幕就不重复转写，能本地处理就不上传音频，并让译文、时间戳和学习笔记能够继续进入个人知识库。

## 核心能力

- 通用网页播放器字幕探测（HTML5 TextTrack、YouTube、Vimeo、Video.js、JW Player、Plyr 等）；
- YouTube timedtext 原始字幕轨提取，不依赖页面字幕 DOM；
- 有网页原字幕时优先使用，无法读取时自动捕获当前标签页音频；
- 本地 faster-whisper 实时转写；
- 原文与译文双语字幕浮层；
- 专业领域选择和自动领域识别；
- 公式、代码、URL、引用与符号占位保护；
- Codex 套餐与 Kimi 套餐双通道专业精译，无需在扩展中保存 API Key；
- Kimi/OpenAI 兼容 API、NLLB 本地翻译和 Google 翻译作为高级或实时备用；
- 将最终字幕段保存为结构化学习会话；
- 通用学习侧栏：实时查看、按时间回跳、原文/中文/双语、摘要与笔记；
- 网页全文/选区翻译与内置 PDF.js 论文阅读器；
- 通过统一 PDF 接口调用已安装的复杂论文版面组件；
- 保存可回跳的媒体时间戳、字幕来源并自动去重；
- 导出 Markdown、结构化 JSON 或双语 SRT，供其他工作台作为知识库摄取。

## 快速开始

### 1. 准备本地服务

运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```

需要复杂 PDF 保版式翻译时使用 `-WithPdf`。模型文件保存在本地 `.models`，不会提交到仓库。

### 2. 启动服务

纯本地转写和 NLLB 翻译不要求云端 API Key。专业精译可以选择两个套餐入口：

```powershell
# 二选一登录；已有登录可以跳过
codex login
kimi login --region mainland-cn

.\scripts\start-backend.ps1
```

插件设置中选择 **Codex 套餐**或 **Kimi 套餐**。本地服务只通过官方 CLI 检查登录状态，不读取、复制或保存登录凭据；套餐模式还会清除进程中的 API Key 环境变量，避免误切换到按量 API。Codex 当前必须显示 ChatGPT 登录；Kimi 当前必须显示 `managed:kimi-code` 与 `source=oauth`。

Kimi Code 使用 Kimi 会员共享额度。若账户开启了 Extra Usage，套餐额度耗尽后可能继续扣余额；希望严格不产生套餐外费用时，请在 Kimi 账户中关闭 Extra Usage。

### 3. 加载 Chrome 扩展

1. 打开 `chrome://extensions` 并启用开发者模式；
2. 点击“加载已解压的扩展程序”；
3. **只选择 `apps/browser-extension`**，不要选择其中的 `learning` 或 `research` 子目录；
4. 打开视频、网页或 PDF，点击扩展开始使用。

## 项目结构

- `apps/browser-extension`：Chrome Manifest V3 扩展。
- `quant_scholar_translator`：你的统一 Python 库，包含实时服务、专业翻译、稳定字幕、PDF 接口、术语库和知识数据契约。
- `docs/MODELS.md`：已下载模型、体积、哈希、转换和剔除记录。
- `docs/LIBRARY.md`：统一库公共接口、成品边界和依赖原则。
- `docs`：架构、来源审计和路线图。

## 进阶配置

PDF 论文保版式翻译：

```powershell
$env:QS_LLM_API_KEY='在当前终端自行填写'
$env:QS_LLM_API_BASE='你的 OpenAI-compatible 接口地址'
$env:QS_LLM_MODEL='模型名'
.\scripts\translate-pdf.ps1 -InputPdf 'D:\papers\paper.pdf'
```

若需扩展自动启动后端：先在 `chrome://extensions` 复制该扩展的 32 位 ID，再运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\apps\browser-extension\native\install.ps1 -ExtensionId '这里填扩展ID'
```

专业 LLM 密钥仍只从系统环境读取；不应写进扩展、清单或仓库。统一服务也可运行 `.venv\Scripts\quant-scholar.exe serve`。

Python 中可以直接使用统一库：

```python
from quant_scholar_translator import detect_domain, protect, translate_text

domain = detect_domain("Factor exposure and maximum drawdown")
safe_source = protect("Estimate $E[R_t]$ with `statsmodels.OLS()`")
translated = translate_text("expected return and risk premium", domain="quant_finance")
```

默认推荐 Whisper `large-v3-turbo`；显存或算力有限时可从 `small` 或 `base` 开始。NLLB-200 600M int8 用于离线翻译，BabelDOC 作为可选的复杂论文版面运行组件。

Whisper 是 OpenAI 开源的多语种语音识别模型。本项目使用本地转换后的 `large-v3-turbo` 权重和 faster-whisper 推理，不需要调用 OpenAI 语音 API。只有用户主动选择 Codex、Kimi 或其他云端精译功能时，相关文字才会发给所选服务；标签页音频仍留在本机。套餐 CLI 适合论文、PDF、段落精译、知识概览和笔记整理，但启动开销较高；追求逐句低延迟字幕时优先使用本地 NLLB，随后再用 Codex/Kimi 对学习记录做精译。

## 从旧版重新加载

如果 Chrome 仍显示 **YouTube Digest**，说明浏览器保存的是旧子目录入口：

1. 在 `chrome://extensions` 删除名为 YouTube Digest 的旧卡片；
2. 点击“加载已解压的扩展程序”；
3. 选择本仓库的 `apps/browser-extension` 目录；
4. 确认卡片名称为 **Quant Scholar Translator 0.5.0**，再刷新已打开的视频或论文页面。

## 已知边界

- DRM 平台可能让 `tabCapture` 得到静音，不能承诺支持 Netflix 等站点。
- 当前知识导出为 Markdown/JSON/双语 SRT，尚未绑定某一个工作台的私有数据库接口。
- iframe 内独立播放器、封闭 Shadow DOM 和站点加密字幕可能无法直接读取，但仍可回退标签页音频识别。
- 复杂 PDF 排版作为可选运行组件安装在 `.venv`，不再保留第三方源码项目；其版面模型仍需首次下载。
- 专业译文与数值结论必须回看原始材料。

## 测试

```powershell
node --test tests/extension.test.mjs apps/browser-extension/research/tests/*.test.mjs apps/browser-extension/research/tests/*.test.cjs apps/browser-extension/learning/tests/*.test.js
python -m unittest discover -s tests -p "test_*.py"
python -m py_compile quant_scholar_translator/*.py
```

## 许可证

本项目原创代码采用 MIT。交付库不包含上游源码仓库，但浏览器端已采用的开源代码及运行组件仍保留相应版权和许可证；详见 `docs/SOURCE_AUDIT.md`。个人使用不等于可以抹除许可证，若以后分发或商用，应重新核对组件与模型许可。

项目由 [**LX.COCOSCENT / PHD-LXETHA**](https://github.com/PHD-LXETHA) 创建和维护。贡献方式、第三方声明与安全说明分别见 [CONTRIBUTING.md](CONTRIBUTING.md)、[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 [SECURITY.md](SECURITY.md)。

如果这个项目对你的学习或研究有帮助，欢迎 Star、提出问题，或贡献新的播放器适配、领域术语与翻译质量测试。
