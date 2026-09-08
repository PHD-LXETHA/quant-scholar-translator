# Quant Scholar Translator 0.9.0

This release upgrades the PDF reader with Quant Scholar's original document-intelligence workflow.

- Detects academic papers, research reports, newspapers, magazines, books, and generic documents, with a manual override.
- Adds one-to-four-column reading order and semantic paragraph assembly for three-column magazines and long-form material.
- Sends complete semantic units to Codex/Kimi, renders complete paragraphs in reading mode, and maps translations back to original coordinates in layout mode.
- Preserves the distinction between facts, analysis, forecasts, recommendations, valuation assumptions, risks, and disclosures in research reports.
- Protects formulas, variables, operators, problem numbers, examples, and answer structures in mathematics textbooks.
- Restores structured paragraphs, translations, document type, annotations, and reading position from local cache.
- Removes the BabelDOC optional dependency, CLI adapter, and model-download path; document intelligence does not call an external PDF-reflow product.

After upgrading, reload `apps/browser-extension` from the Chrome/Edge extensions page and reopen existing PDF-reader tabs.
