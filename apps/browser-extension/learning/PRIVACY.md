# Privacy

Quant Scholar Translator is local-first and contains no developer-operated
account system, analytics, advertising, or telemetry.

- Captured captions, local Whisper transcripts, translations, and notes are
  stored in the current Chrome profile and the local backend.
- Audio processed by the bundled local Whisper path is not uploaded.
- Codex-plan and Kimi-membership modes call the locally installed official CLI.
  The extension and backend do not read or store the CLI login credentials.
- When the user explicitly invokes a cloud-powered feature, the relevant text
  and prompt are sent to the selected provider. Kimi API remains an optional
  advanced mode and uses the user's own key.
- The extension does not require a separate transcript-service account.
- Clearing extension data removes local Chrome storage. It cannot erase data
  already processed under a cloud provider's own retention policy.

API keys must not be committed to source control, pasted into public issues,
or included in screenshots. Revoke a key in the provider console if exposure
is suspected.
