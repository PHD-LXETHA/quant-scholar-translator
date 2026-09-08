# 本地模型与资源清单

Whisper 与 NLLB 的主要运行资源位于项目根目录 `.models`，不会依赖用户目录中的 Hugging Face 缓存。RapidOCR 的小型 ONNX 模型随其 Python 包安装在项目 `.venv` 中。PDF 文档理解模块为扩展内置 JavaScript，不需要额外版面模型。

| 资源 | 运行格式 | 体积 | 验证 |
|---|---|---:|---|
| Whisper large-v3-turbo | CTranslate2 FP16 | 1.51 GiB | RTX 3080 Ti / CUDA 加载成功 |
| NLLB-200 distilled 600M | CTranslate2 int8 + tokenizer | 0.62 GiB | 断网、无 PyTorch、CUDA 翻译成功 |
| RapidOCR PP-OCRv6 | 检测 + 方向 + 中英文识别 ONNX | 约 27 MiB（包内模型） | 本地合成英文页面识别通过 |

关键文件 SHA-256：

- Whisper `model.bin`：`E76620F83D5F5B69EFD3D87E3DC180C1BD21DF9FBEBACFD4335E5E1EFCC018DA`
- NLLB int8 `model.bin`：`398726640CC2A02CC6A35277FA3CF2159CE8A1A66B48AA1B6C8837A47E3DD00C`

转换后已剔除：NLLB 原始 2.46GB PyTorch 权重、Hugging Face 构建缓存、临时 PyTorch/SymPy/mpmath 依赖、Whisper 重复下载缓存和未完成文件。保留的是实际运行所需模型、分词器、CUDA 库及 Python 依赖。

模型许可：Whisper CTranslate2 转换版为 MIT；NLLB-200 600M 为 CC-BY-NC-4.0，适合当前个人非商用用途，不应直接用于生产或认证翻译。
