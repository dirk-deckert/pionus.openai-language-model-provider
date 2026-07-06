# Pionus Codex Chat Provider Maintenance

Before changing this extension, re-check potentially stale Codex behavior against the current upstream sources:

- `GaussianGuaicai/Codex-For-Copilot`, especially provider registration, model discovery, credentials, tool calling, service tier, reasoning, usage, image/data conversion, and request shape.
- OpenAI Codex CLI and IDE docs for slash commands, `/fast`, model/reasoning behavior, AGENTS.md discovery, skills, MCP, review, hooks, subagents, cloud, auth, and platform support.
- The locally installed `openai.chatgpt` extension manifest and bundled assets when available, especially contribution points, settings, command IDs, request metadata, CLI/MCP hooks, review behavior, and `languageModelProxy`/chat-session signals.
- Local Codex CLI behavior for commands bridged by this extension.

If upstream behavior differs from this implementation, update code, settings, docs, tests, and compatibility notes in the same change. Keep all paths portable: infer user homes from `$HOME` or platform APIs, and do not hard-code usernames or machine-specific Homebrew locations.
