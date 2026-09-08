# Quant Scholar 统一库

`quant_scholar_translator` 是项目唯一的 Python 开发入口。视频实时识别、文本翻译、专业术语保护和字幕稳定都通过这个命名空间调用；PDF 文档理解位于浏览器扩展内部。

## 公共接口

```python
from quant_scholar_translator import (
    detect_domain,
    hotwords_for_domain,
    protect,
    restore,
    translate_text,
)
```

命令行入口：

```powershell
quant-scholar serve
quant-scholar translate "expected return and risk premium" --domain quant_finance
```

## 成品边界

- `quant_scholar_translator-0.9.0-py3-none-any.whl` 是可安装的统一 Python 库。
- `quant-scholar-translator-professional-0.9.0.zip` 包含统一库、Chrome/Safari 扩展、脚本和文档。
- 两个成品都不包含 `.venv`、`.models`、`vendor-src`、旧 `services`、旧 `engines` 或旧 `packages` 目录。
- 术语表和知识会话 Schema 已作为库数据一并打包。

## 依赖原则

项目不依赖任何上游源码仓库或 Git 子模块。FastAPI、CTranslate2、CUDA 运行库、PDF.js、RapidOCR 与 ONNX Runtime 仍以明确标注的基础依赖形式存在；PDF 文档分类、阅读顺序、段落合并与译文回填不调用外部 PDF 重排产品。许可证和模型限制见 `SOURCE_AUDIT.md` 与 `MODELS.md`。
