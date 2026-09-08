# Quant Scholar Translator 0.9.0 Verification

## Automated checks

- Browser extension and learning workspace: 179 Node tests passed.
- Python backend and library: 97 tests passed in the project virtual environment.
- New PDF document-intelligence tests cover three-column order, full-width section breaks, document classification, paragraph assembly, cross-column isolation, structured translation placement, mathematics/code protection, and cache compatibility.

## Representative document inspection

- Native-text quantitative-finance paper: 81 pages, academic structure and references.
- Bloomberg Businessweek issue: 96 pages, image-rich multi-column magazine layout.
- Schaum's Calculus textbook: 547 pages, approximately 911,909 extractable characters, with formula-dense examples and problem sets.

Source documents remain outside the repository and were not uploaded or copied into release artifacts.

## Runtime independence

- No BabelDOC dependency in `pyproject.toml`.
- No external PDF-provider CLI adapter, setup flag, model warmup, or runtime import.
- PDF document classification, reading order, semantic units, and coordinate placement run inside the extension.
- Existing foundational dependencies such as PDF.js and RapidOCR remain explicitly attributed.
