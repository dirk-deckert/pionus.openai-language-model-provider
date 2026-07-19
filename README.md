# Pionus OpenAI Language Model Provider

VS Code extension from Pionus GmbH that exposes OpenAI Codex models as a VS Code/Copilot Chat language model provider under vendor `pionus-codex`.

The provider focuses on functional Codex behavior that fits inside VS Code's `LanguageModelChatProvider` API. It is intentionally not a Codex product UI and does not register sidebar views, custom editors, chat-session UI, cloud-task UI, or inline completions.

Provider capabilities include:

- Codex model discovery through the configured Responses backend.
- Capability-driven model metadata for context window, image input, and reasoning levels, with every advertised model duplicated as a Fast service-tier entry.
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

The extension ID changed from `pionus.codex-chat-provider` to
`pionus.openai-language-model-provider`. VS Code treats this as a new extension.
Extension-scoped secret and global storage may therefore need to be configured
again. Credentials stored in `~/.codex/auth.json` are unaffected.

For source-based installation through the configuration repository, run:

```sh
~/clouds/gitlab-dirk-deckert/configuration/Common/vscode/install
```

The installer clones or fast-forwards this repository under
`${PIONUS_VSCODE_REPOS_DIR:-$HOME/clouds/github-dirk-deckert}`, then symlinks it
into `${VSCODE_EXTENSIONS_DIR:-$HOME/.vscode/extensions}`. It is portable across
user names, Apple Silicon, and Intel macOS machines.

## Development

```sh
npm ci
npm test
npm run compile
npm run package
```

## License

MIT. Copyright Pionus GmbH.
