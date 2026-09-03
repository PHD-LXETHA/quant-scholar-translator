# Quant Scholar Translator 0.6.0

Created by **LX.COCOSCENT** (GitHub: **PHD-LXETHA**)

## Professional live translation

- Adds Professional Live, Fast Preview, and Offline modes, with Professional Live as the default.
- Codex/Kimi final translations are generated directly from source text, source context, and the selected domain glossary.
- NLLB previews are UI-only: they are never sent to the professional model or written to the knowledge base.
- Audio recognition continues while professional translations run in an asynchronous queue.
- Final-output validation protects numbers, percentages, basis points, currencies, formulas, variables, code, URLs, citations, and acronyms.

## Complete in-page floating workspace

- Removes the Chrome-anchored popup. Clicking the QS extension action toggles a draggable menu inside the current webpage.
- The menu contains the complete live, webpage, PDF, settings, learning-workspace, and export controls.
- The QS launcher remembers its position, fades when idle, and shows the active capture state. Pinning the extension is optional.
- Improves side-panel header spacing.

## iPhone, iPad, and Safari

- Adds Safari Web Extension source for webpage-accessible caption tracks.
- Adds the same three translation modes and a draggable in-page Safari menu.
- Adds a token-protected LAN mobile workspace usable from both Safari and Chrome for professional text translation and Markdown/JSON export.
- Documents the platform boundary: iOS Chrome does not install desktop Chrome extensions, and iOS cannot universally capture another tab's audio.

## Privacy and measured local speed

- Browser audio is sent to local Whisper as roughly one-second in-memory chunks; no WAV, MP3, or WebM recording is created.
- Codex/Kimi receive text only, never audio.
- Non-loopback mobile API calls require a pairing token.
- On the current development machine, NLLB cold load measured about 6.6 seconds and warm 60–70 character English sentences with technical-value protection averaged about 0.15 seconds. Other systems will differ.

Existing Chrome users should reload the unpacked extension once and refresh open pages. The Safari source still requires Apple's Web Extension packaging/signing flow before installation on iPhone or iPad and has not completed real-device end-to-end validation; it is experimental. See `docs/VERIFICATION_0.6.0.md` for the verification record.
