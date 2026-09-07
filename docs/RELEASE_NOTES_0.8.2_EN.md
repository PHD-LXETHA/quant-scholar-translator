# Quant Scholar Translator 0.8.2

This release improves professional scanned-PDF translation and export.

- Detects pages without a usable text layer and exposes OCR, segmentation, translation, and save stages.
- Detects dense market-data pages and protects numeric tables, ticker symbols, formulas, and code-like regions.
- Renames PDF views to Original, Preserve layout, Reading reflow, and Side-by-side.
- Adds separate preserved-layout and reading-edition PDF exports.
- Shows elapsed time, ETA, and the most recent checkpoint save.
- Estimates tokens from glossary terms actually matched per batch instead of the entire glossary.
- Batches across pages to reduce model calls while retaining page-level retries and checkpoint recovery.

After upgrading, reload the extension in Chrome/Edge and reopen any existing PDF reader tab.
