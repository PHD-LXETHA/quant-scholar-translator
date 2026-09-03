# Quant Scholar Translator

[简体中文](README.md) | [English](README_EN.md)

[![Version](https://img.shields.io/badge/version-0.4.0-36d6c2)](https://github.com/PHD-LXETHA/quant-scholar-translator/releases)
[![License](https://img.shields.io/badge/license-MIT-f0c66d)](LICENSE)
[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4)](apps/browser-extension)
[![Python](https://img.shields.io/badge/Python-3.11--3.13-3776AB)](pyproject.toml)

A local-first bilingual learning workspace for technical videos, professional webpages, and research PDFs. Quant Scholar Translator brings live captions, domain-aware translation, paper reading, terminology protection, and knowledge export into one workflow, with special attention to finance, quantitative research, economics, statistics, mathematics, and programming.

> **Professional Edition 0.4.0** · Created by [**LX.COCOSCENT**](https://github.com/PHD-LXETHA) · Local Whisper · Kimi K3 · Research PDF

## Why this project exists

General-purpose translation tools often damage formulas, variables, statistical notation, financial terminology, code identifiers, and academic layouts. Quant Scholar Translator treats source fidelity as the primary constraint: it reuses native captions whenever possible, keeps audio local when Whisper is used, and turns translated text, timestamps, and notes into reusable knowledge assets.

## Highlights

- Detects captions from common HTML5 players, YouTube, Vimeo, Video.js, JW Player, Plyr, and more.
- Reads YouTube timed-text tracks without depending on the visible caption DOM.
- Prefers native webpage captions and falls back to local tab-audio transcription.
- Runs faster-whisper locally and displays aligned source/translation overlays.
- Detects finance, quantitative finance, economics, statistics, mathematics, and programming domains.
- Protects formulas, code, URLs, references, units, values, and symbols during translation.
- Supports Kimi K3 professional translation, local NLLB translation, and Google Translate.
- Saves structured learning sessions with source provenance and seekable timestamps.
- Provides a side-panel workspace for transcripts, bilingual reading, overviews, explanations, and notes.
- Includes structured webpage translation and a PDF.js research-paper reader.
- Exports Markdown, structured JSON, and bilingual SRT for downstream knowledge bases.

## Quick start

### 1. Prepare the local service

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```

Add `-WithPdf` when you need the optional layout-preserving PDF component. Models are stored under the local `.models` directory and are not committed to Git.

### 2. Start the backend

Local Whisper transcription and NLLB translation do not require a cloud API key. To use Kimi professional translation, set the following values in your current terminal:

```powershell
$env:KAMI_TRANSLATOR='llm'
$env:QS_LLM_API_BASE='https://api.moonshot.cn/v1'
$env:QS_LLM_MODEL='kimi-k3'
$env:QS_LLM_API_KEY='enter-your-key-locally'
.\scripts\start-backend.ps1
```

Never commit an API key or paste it into an issue, screenshot, prompt, or public message.

### 3. Load the Chrome extension

1. Open `chrome://extensions` and enable Developer mode.
2. Select **Load unpacked**.
3. Choose only `apps/browser-extension`; do not load its `learning` or `research` subdirectories.
4. Open a video, webpage, or PDF and launch Quant Scholar Translator.

## Layout-preserving PDF translation

```powershell
$env:QS_LLM_API_KEY='enter-your-key-locally'
$env:QS_LLM_API_BASE='your-openai-compatible-base-url'
$env:QS_LLM_MODEL='your-model-name'
.\scripts\translate-pdf.ps1 -InputPdf 'D:\papers\paper.pdf'
```

## Python library

```python
from quant_scholar_translator import detect_domain, protect, translate_text

domain = detect_domain("Factor exposure and maximum drawdown")
safe_source = protect("Estimate $E[R_t]$ with `statsmodels.OLS()`")
translated = translate_text(
    "expected return and risk premium",
    domain="quant_finance",
)
```

## Models and privacy

Whisper is an open-source multilingual speech-recognition model from OpenAI. This project runs converted `large-v3-turbo` weights locally through faster-whisper, so it does not need the OpenAI speech API. Use `small` or `base` on lower-powered machines. NLLB-200 600M int8 provides offline translation, while BabelDOC is an optional separately installed runtime for complex paper layouts.

Audio remains local on the bundled Whisper path. Text is sent to Kimi only when the user explicitly invokes a Kimi-powered translation, overview, explanation, or note feature.

## Known limitations

- DRM platforms may prevent usable tab-audio capture.
- Encrypted captions, isolated iframes, and closed shadow roots may block direct caption extraction.
- Knowledge export currently targets Markdown, JSON, and bilingual SRT rather than a proprietary workspace database.
- Professional translations and numerical conclusions should always be checked against the original material.
- Optional components and model weights remain subject to their respective licenses.

## Tests

```powershell
node --test tests/extension.test.mjs apps/browser-extension/research/tests/*.test.mjs apps/browser-extension/research/tests/*.test.cjs apps/browser-extension/learning/tests/*.test.js
python -m unittest discover -s tests -p "test_*.py"
```

## License and attribution

Original project code is distributed under the MIT License. Adapted browser code and separately installed runtime/model components retain their original copyrights and licenses. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), [docs/SOURCE_AUDIT.md](docs/SOURCE_AUDIT.md), and [docs/MODELS.md](docs/MODELS.md).

Created and maintained by [**LX.COCOSCENT / PHD-LXETHA**](https://github.com/PHD-LXETHA). Contributions, reproducible bug reports, new player adapters, terminology improvements, and translation-quality tests are welcome.
