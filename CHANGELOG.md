# Changelog

## 0.0.2

- Bind ChatGPT and OpenAI credentials to their official HTTPS endpoints.
- Store custom-endpoint credentials under isolated endpoint-specific secret keys.
- Prevent workspaces from overriding credential destinations and CLI paths.
- Remove unsafe shell interpolation from CLI bridge terminal launches.

## 0.0.1

- Initial public release under the `pionus.openai-language-model-provider` ID.
- OpenAI Codex model discovery, streaming, tool calls, reasoning, image input,
  profiles, skills, IDE context, usage reporting, and optional CLI bridges.
