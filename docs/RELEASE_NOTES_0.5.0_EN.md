# Quant Scholar Translator 0.5.0

Author: **LX.COCOSCENT** (GitHub: **PHD-LXETHA**)

## New

- Adds **Codex plan** and **Kimi membership** as the two primary choices across video, webpage, PDF-reader, and learning-workspace flows.
- Codex uses the official CLI's ChatGPT login; Kimi uses the official Kimi Code OAuth login. Neither mode stores an API key in the extension.
- Adds local Chat Completions-compatible endpoints at `/codex/v1/chat/completions` and `/kimi/v1/chat/completions`.
- Adds explicit subscription-login checks and billing-mode metadata.

## Security and billing boundaries

- The project never reads, copies, or stores Codex or Kimi login credentials.
- Subscription calls run from isolated temporary working directories with instructions that prohibit project-file access.
- Platform API-key environment variables are removed in subscription mode to prevent silent pay-as-you-go routing.
- Codex runs only when the official status identifies a ChatGPT login. Kimi runs only when `managed:kimi-code` and `source=oauth` are present.
- Kimi Code shares the Kimi membership allowance. Extra Usage may charge an additional balance after that allowance is exhausted if enabled on the account.

## Recommended usage

- Sentence-by-sentence live captions: prefer local NLLB for predictable latency.
- Papers, PDFs, technical passages, summaries, and knowledge refinement: choose either Codex plan or Kimi membership.
- Kimi/OpenAI-compatible APIs remain under advanced settings for fixed-model or higher-throughput workflows.
