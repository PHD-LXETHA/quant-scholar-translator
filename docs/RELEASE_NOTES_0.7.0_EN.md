# Quant Scholar Translator 0.7.0

Created by **LX.COCOSCENT** (GitHub: **PHD-LXETHA**)

This release unifies video, webpage, and research-PDF translation into a reusable professional learning workflow, with focused support for mathematics, statistics, quantitative finance, finance, economics, programming, and research papers.

## Professional translation

- Ships 1,424 contextual terms and 703 aliases while preserving user-defined glossary entries across migrations.
- Codex uses medium reasoning by default and automatically re-runs difficult passages at high reasoning.
- The Kimi plan path is compatible with the current Kimi Code CLI and uses a tools-disabled translation agent.
- NLLB is limited to fast preview or offline output. Professional results are generated independently from the source and never inherit an NLLB preview.
- Final validation protects numbers, ratios, basis points, currencies, formulas, variables, code, URLs, citations, and acronyms.

## Video and learning archives

- Supports accessible webpage captions, ahead-of-playback translation when a complete caption/audio source can be read legally, and live recognition when audio is available only during playback.
- Improves caption discovery and paragraph merging for embedded players such as CQF/Brightcove. DRM, encrypted tracks, and site restrictions can still require live audio fallback.
- Saves one bilingual Markdown archive per video, ordered from `00001` and named with the video title; completed translations and timestamps can be restored on revisit.
- The learning panel retains original, translated, and bilingual views, editable notes, and Markdown, structured JSON, or bilingual SRT export.

## PDF and web

- Research PDFs are sent directly to Codex/Kimi professional translation rather than through the NLLB preview chain. An optional PDF runtime can handle complex layout preservation.
- Full-page and selection translation, original/translated toggling, and knowledge capture share the same terminology, protection, and export contract.

## Packages

- `quant-scholar-browser-extension-0.7.0.zip`: unpack and load in Chrome/Edge developer mode.
- `quant-scholar-translator-professional-0.7.0.zip`: complete source, extensions, scripts, and documentation.
- `quant_scholar_translator-0.7.0-py3-none-any.whl`: installable unified Python library.
- `quant-scholar-safari-web-extension-0.7.0.zip`: Safari Web Extension source; Apple signing and real-device validation are still required.
- `SHA256SUMS-0.7.0.txt`: SHA-256 checksums for the release assets.

Existing Chrome/Edge users should replace the old unpacked directory, reload the extension, and refresh video pages. See `docs/VERIFICATION_0.7.0.md` for test evidence and explicit limitations.
