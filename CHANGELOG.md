# Changelog

## 0.1.6

- Show the active service tier directly in Copilot Chat model names as
  **(Normal)**, **(Fast)**, or **(Auto)**.
- Offer separate Normal and Fast entries only when model discovery advertises
  priority processing; keep reasoning effort solely in the Thinking control.
- Make an encoded tier authoritative so the displayed picker label always
  matches the Responses request.

## 0.1.5

- Add `pionus.codex.defaultServiceTier` with `auto`, `default`, and `fast`
  choices so priority processing remains accessible when Copilot Chat does not
  render the provider's per-model Speed control.
- Let an explicit per-model Speed selection override the global service-tier
  default while preserving legacy Fast model IDs.

## 0.1.4

- Expose one picker entry per discovered model and move reasoning effort and
  advertised priority speed into model-specific controls.
- Preserve legacy reasoning and Fast model IDs for persisted selections without
  advertising duplicate picker entries.
- Make discovery visibility credential-aware so ChatGPT-only Codex Spark and
  the upstream Auto Review exception are retained while other hidden models
  remain excluded.
- Advertise only the configured model when discovery is unavailable.

## 0.1.3

- Attempt exact input-token counting for ChatGPT Codex, with a ten-minute
  capability cache and conservative fallback when the endpoint is unavailable.
- Consolidate official and fallback model metadata into one registry while
  preserving every existing model identifier, capability, and picker order.
- Derive the HTTP user-agent from the extension manifest version and remove
  redundant management-command and lifecycle mappings.
- Document the intentional stateless request and guarded reasoning boundaries.

## 0.1.2

- Use the full Pionus OpenAI Language Model Provider name consistently across
  the provider label, command titles, configuration, status UI, logs, and README.
- Preserve all existing command IDs, setting IDs, and the `pionus-codex` vendor ID.

## 0.1.1

- Add a dedicated Pionus OpenAI Language Model Provider extension icon.

## 0.1.0

- Add endpoint-specific model discovery for ChatGPT Codex, the official OpenAI API, and custom Responses-compatible endpoints.
- Add reviewed GPT-5.6, GPT-5.5, and GPT-5.4 capability metadata, accurate model limits, and compact reasoning-effort variants while preserving existing base and Fast model IDs.
- Forward supported image attachments, validate host tools, preserve automatic/required tool choice, and handle the complete supported Responses stream lifecycle.
- Improve cancellation, token counting, effective agent-profile model resolution, and VS Code error mapping.
- Make usage-status visibility and local per-model input, cached-input, and output cost estimates functional.
- Preserve existing credentials, custom endpoints, commands, settings, Codex instructions, profiles, skills, IDE context, CLI bridges, usage data, and diagnostics.
- Add compatibility, unit, activation, packaging, and security regression coverage for the 0.1.0 provider surface.

## 0.0.2

- Bind ChatGPT and OpenAI credentials to their official HTTPS endpoints.
- Store custom-endpoint credentials under isolated endpoint-specific secret keys.
- Prevent workspaces from overriding credential destinations and CLI paths.
- Remove unsafe shell interpolation from CLI bridge terminal launches.

## 0.0.1

- Initial public release under the `pionus.openai-language-model-provider` ID.
- OpenAI Codex model discovery, streaming, tool calls, reasoning, image input,
  profiles, skills, IDE context, usage reporting, and optional CLI bridges.
