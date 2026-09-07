# Quant Scholar Translator 0.8.1

This patch improves local OCR reliability for scanned PDFs.

- Encodes rendered PDF pages as adaptive JPEG images to reduce payload size on color scans.
- Enforces a safe client-side OCR payload limit to prevent HTTP 422 responses.
- Replaces opaque 422 errors with actionable guidance.
- Preserves the direct local-OCR-to-Codex/Kimi professional translation workflow.

After upgrading, reload the extension and reopen the PDF Reader tab.
