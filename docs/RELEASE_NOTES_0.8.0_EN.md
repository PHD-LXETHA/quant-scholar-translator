# Quant Scholar Translator 0.8.0

Created by **LX.COCOSCENT** (GitHub: **PHD-LXETHA**)

This release adds an end-to-end local OCR workflow for scanned research PDFs.

- The PDF action automatically changes to **Local OCR and professional translation** when no text layer exists.
- RapidOCR 3.x and ONNX Runtime recognize each page locally; scanned page images are not sent to a third-party OCR service.
- Positioned OCR lines and confidence values are rebuilt into paper reading order, columns, paragraphs, and heading levels.
- The selected Codex/Kimi professional translation starts automatically after OCR.
- OCR and translation share progress, pause, cancel, error, and saved-translation recovery behavior.
- PDF translation continues to start the local backend silently through Native Messaging.

Complex mathematical notation, handwriting, and low-resolution scans should still be checked against the original page.
