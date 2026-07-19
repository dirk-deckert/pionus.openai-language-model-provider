# Changelog

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
