# Pionus Codex Chat Provider

Repo-managed VS Code extension that exposes Codex as a VS Code/Copilot Chat language model provider under vendor `pionus-codex`.

The provider focuses on functional Codex behavior that can fit inside VS Code's language model provider API: model discovery, reasoning effort, fast service tier, Codex credentials, host-provided tools, AGENTS.md instructions, provider agent profiles, and diagnostics. Features owned by the official Codex app/sidebar/cloud runtime are exposed only through explicit helper commands when feasible.

The second integration slice adds lightweight active-editor context injection, selectable `SKILL.md` instruction injection, and explicit Codex CLI bridge commands for read-only `codex exec` plus non-mutating `codex review`. CLI bridge commands are disabled by default and ask before enabling.

Install from the synced configuration repo by running:

```sh
~/clouds/gitlab-dirk-deckert/configuration/Common/vscode/install
```

The installer symlinks this source directory into `${VSCODE_EXTENSIONS_DIR:-$HOME/.vscode/extensions}` and is portable across user names, Apple Silicon, and Intel macOS machines.
