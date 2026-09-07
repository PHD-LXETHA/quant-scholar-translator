# Quant Scholar Translator

[简体中文](README.md) | [English](README_EN.md)

[![Version](https://img.shields.io/badge/version-0.7.2-36d6c2)](https://github.com/PHD-LXETHA/quant-scholar-translator/releases)
[![License](https://img.shields.io/badge/license-MIT-f0c66d)](LICENSE)
[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4)](apps/browser-extension)
[![Python](https://img.shields.io/badge/Python-3.11--3.13-3776AB)](pyproject.toml)

A local-first bilingual learning workspace for technical videos, professional webpages, and research PDFs. Quant Scholar Translator brings live captions, domain-aware translation, paper reading, terminology protection, and knowledge export into one workflow, with special attention to finance, quantitative research, economics, statistics, mathematics, and programming.

> **Professional Edition 0.7.2** · Created by [**LX.COCOSCENT**](https://github.com/PHD-LXETHA) · Local Whisper · Codex / Kimi plans · Research PDF

## Why this project exists

General-purpose translation tools often damage formulas, variables, statistical notation, financial terminology, code identifiers, and academic layouts. Quant Scholar Translator treats source fidelity as the primary constraint: it reuses native captions whenever possible, keeps audio local when Whisper is used, and turns translated text, timestamps, and notes into reusable knowledge assets.

## Highlights

- Detects captions from common HTML5 players, YouTube, Vimeo, Video.js, JW Player, Plyr, and more.
- Reads YouTube timed-text tracks without depending on the visible caption DOM.
- Prefers native webpage captions and falls back to local tab-audio transcription.
- Runs faster-whisper locally and displays aligned source/translation overlays.
- Detects finance, quantitative finance, economics, statistics, mathematics, and programming domains.
- Protects formulas, code, URLs, references, units, values, and symbols during translation.
- Offers Codex-plan and Kimi-membership professional translation without storing API keys in the extension.
- Includes 1,424 contextual terms and 703 aliases across seven domains; Codex uses medium reasoning by default and high reasoning for difficult cues, while Kimi applies a bounded corrective pass for explicit terminology misses.
- Keeps Kimi/OpenAI-compatible APIs, local NLLB, and Google Translate as advanced or low-latency alternatives.
- Saves structured learning sessions with source provenance and seekable timestamps.
- Provides a side-panel workspace for transcripts, bilingual reading, overviews, explanations, and notes.
- Includes structured webpage translation and a PDF.js research-paper reader.
- Exports Markdown, structured JSON, and bilingual SRT for downstream knowledge bases.

## Three live modes

- **Professional live (default):** source text appears immediately; Codex or Kimi translates directly from the source, source context, and domain glossary.
- **Fast preview:** local NLLB provides a temporary preview while Codex/Kimi independently creates the final translation from source text. The preview is never included in the professional request.
- **Offline:** Whisper and NLLB run locally without an online translation service.

Only professional or offline final records enter the knowledge base. Numbers, percentages, basis points, currencies, formulas, variables, code, URLs, citations, and acronyms are protected and validated before a result is accepted as final.

The current build passes the project's internal Professional Translation Gate v7. Across 140 real Codex inference cases, terminology accuracy was 422/423 (99.76%); logical-signal retention, cue alignment, and protected-literal integrity were all 100%. This is a reproducible internal engineering gate, not external expert certification. See [`docs/PROFESSIONAL_TRANSLATION_EVALUATION.md`](docs/PROFESSIONAL_TRANSLATION_EVALUATION.md) for per-domain denominators and limitations.

## Quick start

### 1. Prepare the local service

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```

Add `-WithPdf` when you need the optional layout-preserving PDF component. Models are stored under the local `.models` directory and are not committed to Git.

### 2. Start the backend

Local Whisper transcription and NLLB translation do not require a cloud API key. Professional translation can use either subscription login:

```powershell
# Choose either login; normally run it only once and skip it when authenticated.
codex login
kimi login --region mainland-cn

.\scripts\start-backend.ps1
```

Choose **Codex plan** or **Kimi membership** in the extension. The backend queries only the official CLIs for status and never reads or stores login credentials. Subscription mode removes ambient API-key variables to prevent accidental pay-as-you-go routing. Kimi Code shares the Kimi membership allowance; disable Extra Usage in the Kimi account if you want to rule out charges after that allowance is exhausted.

Codex authentication is independent of the translation service process: closing PowerShell or restarting the backend/browser does not require another login. Always use the stable `codex login` command rather than saving an internal `...\Codex\bin\<version-hash>\codex.exe` path. Sign in again only when first setting up, when credentials expire, or when a Codex update invalidates the prior session.

### 3. Load the Chrome extension

1. Open `chrome://extensions` and enable Developer mode.
2. Select **Load unpacked**.
3. Choose only `apps/browser-extension`; do not load its `learning` or `research` subdirectories.
4. Refresh the target page. Click the extension icon to show the bottom-right launcher, then click that launcher to open the complete in-page menu. Click the extension icon again to close the menu and hide the launcher.

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

Audio remains local on the bundled Whisper path and is processed as roughly one-second in-memory PCM chunks; no recording file is created. Text is sent only to the selected Codex, Kimi, or other cloud provider when the user explicitly invokes cloud-backed features. On the current development machine, NLLB took about 6.6 seconds to cold-load and averaged about 0.15 seconds for warm 60–70 character English sentences with technical-value protection; this is a machine-specific measurement.

See [`docs/MOBILE.md`](docs/MOBILE.md) for iPhone/iPad setup and capability boundaries. The Safari Web Extension can translate webpage-accessible captions. iOS Chrome cannot install desktop Chrome extensions, so it uses the shared mobile knowledge workspace instead.

## Known limitations

- DRM platforms may prevent usable tab-audio capture.
- Encrypted captions, isolated iframes, and closed shadow roots may block direct caption extraction.
- Knowledge export currently targets Markdown, JSON, and bilingual SRT rather than a proprietary workspace database.
- Professional translations and numerical conclusions should always be checked against the original material.
- Optional components and model weights remain subject to their respective licenses.

## Tests

```powershell
node --test tests/*.test.mjs apps/browser-extension/research/tests/*.test.mjs apps/browser-extension/research/tests/*.test.cjs apps/browser-extension/learning/tests/*.test.js
.venv\Scripts\python.exe -m unittest discover -s tests -q
```

## License and attribution

Original project code is distributed under the MIT License. Adapted browser code and separately installed runtime/model components retain their original copyrights and licenses. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), [docs/SOURCE_AUDIT.md](docs/SOURCE_AUDIT.md), and [docs/MODELS.md](docs/MODELS.md).

Created and maintained by [**LX.COCOSCENT / PHD-LXETHA**](https://github.com/PHD-LXETHA). Contributions, reproducible bug reports, new player adapters, terminology improvements, and translation-quality tests are welcome.
