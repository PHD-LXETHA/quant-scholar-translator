# Quant Scholar Translator 0.7.2

Created by **LX.COCOSCENT** (GitHub: **PHD-LXETHA**)

This release fixes PDF professional translation and local-service startup.

- PDF translation through a Codex or Kimi subscription now starts the local service silently through Native Messaging and waits until it is ready; a PowerShell window is no longer required for each run.
- Chrome and Edge use the same per-user native launcher, installed without administrator privileges.
- The PDF reader distinguishes a fully translated document from a document with no extractable text, and directs scanned-PDF users to OCR.
- Remote APIs, Kimi-compatible APIs, and local Ollama startup behavior are unchanged.

Run `apps/browser-extension/native/install.ps1` once after a first installation or an extension-ID change. Reload the unpacked extension after updating its source directory.
