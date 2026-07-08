# Pionus Codex Chat Provider

Repo-managed VS Code extension that exposes Codex as a VS Code/Copilot Chat language model provider under vendor `pionus-codex`.

The provider focuses on functional Codex behavior that fits inside VS Code's `LanguageModelChatProvider` API. It is intentionally not a Codex product UI and does not register sidebar views, custom editors, chat-session UI, cloud-task UI, or inline completions.

Provider capabilities include:

- Codex model discovery through the configured Responses backend.
- Capability-driven model advertisement for context window, image input, reasoning levels, and fast service tier.
- Reasoning-effort model configuration when discovered model metadata exposes more than one supported reasoning level.
- Streaming text, reasoning text, tool calls, usage reporting, and response diagnostics.
- Host-provided VS Code tools mapped to Responses function tools.
- Text, JSON/XML/text-like data, image data, tool-call, and tool-result conversion from VS Code chat messages into Responses input.
- Codex credentials from `~/.codex/auth.json` or VS Code secret storage.
- AGENTS.md/project instructions, provider agent profiles, optional skill injection, and lightweight IDE context injection.
- Token counting through the Responses input-token endpoint with local fallback estimation.

The second integration slice adds lightweight active-editor context injection, selectable `SKILL.md` instruction injection, and explicit Codex CLI bridge commands for read-only `codex exec` plus non-mutating `codex review`. CLI bridge commands are disabled by default and ask before enabling.

Inline completions are intentionally split out of this extension. A future `pionus.codex-inline-completions` extension may share provider-independent code such as credentials, model discovery, Responses transport, URL handling, and diagnostics, but it should own editor typing hooks, completion prompts, latency behavior, and completion-specific settings.

Features that require the official Codex app/sidebar/cloud runtime remain out of scope unless they can be exposed as provider-only behavior without UI coupling. This includes Codex sidebar sessions, custom Codex task editors, cloud task tracking, ChatGPT macOS app integration, and copied OpenAI extension internals or assets.

Install from the synced configuration repo by running:

```sh
~/clouds/gitlab-dirk-deckert/configuration/Common/vscode/install
```

The installer symlinks this source directory into `${VSCODE_EXTENSIONS_DIR:-$HOME/.vscode/extensions}` and is portable across user names, Apple Silicon, and Intel macOS machines.
