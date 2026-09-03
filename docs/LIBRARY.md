# Quant Scholar 统一库

`quant_scholar_translator` 是项目唯一的 Python 开发入口。视频实时识别、文本翻译、专业术语保护、字幕稳定和 PDF 任务都通过这个命名空间调用。

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
quant-scholar pdf paper.pdf --output-dir translated
```

## 成品边界

- `quant_scholar_translator-0.4.0-py3-none-any.whl` 是可安装的统一 Python 库。
- `quant-scholar-translator-professional-0.4.0.zip` 包含统一库、Chrome 扩展、脚本和文档。
- 两个成品都不包含 `.venv`、`.models`、`vendor-src`、旧 `services`、旧 `engines` 或旧 `packages` 目录。
- 术语表和知识会话 Schema 已作为库数据一并打包。

## 依赖原则

项目不再依赖任何上游源码仓库或 Git 子模块。FastAPI、CTranslate2、CUDA 运行库及可选 PDF 组件仍以标准安装包形式存在于 `.venv`；它们属于底层运行组件，不能通过改名变成原创代码，也不能在保留同等功能时物理删除。许可证和模型限制见 `SOURCE_AUDIT.md` 与 `MODELS.md`。
