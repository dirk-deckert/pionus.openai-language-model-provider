# Pionus OpenAI Language Model Provider

Pionus OpenAI Language Model Provider is a VS Code extension from Pionus GmbH
that exposes OpenAI models through the VS Code Language Model API under the
stable vendor ID `pionus-codex`.

The extension maps OpenAI Responses capabilities onto VS Code's `LanguageModelChatProvider` API. It also retains optional Codex context enhancements and local utilities, but it is intentionally not a replacement for the official Codex product UI: it does not register sidebar views, custom editors, cloud-task UI, chat-session UI, or inline completions.

## Provider mappings

### Models and discovery

Pionus OpenAI Language Model Provider maintains reviewed capability metadata
for the current text-output Responses models in the GPT-5.6, GPT-5.5, and
GPT-5.4 families. This is the provider's explicit model scope; it is not a claim
to cover every model in the OpenAI catalog.

Discovery is endpoint-specific:

- The ChatGPT Codex backend supplies rich model metadata such as model slugs, effective context windows, input modalities, and reasoning levels.
- The official OpenAI API supplies model IDs through `/v1/models`. Only IDs that intersect the reviewed GPT-5.6/5.5/5.4 catalog receive built-in capabilities and limits.
- Custom Responses-compatible endpoints remain supported. Their model discovery accepts both `id` and `slug`, deduplicates results, and uses conservative capabilities when verified metadata is unavailable.

The picker keeps reasoning separate from model identity while making the
service tier visible in the chat window:

- **Thinking Effort** contains only the reasoning levels advertised for that model.
- Models that advertise priority processing have explicit **(Normal)** and **(Fast)** entries.
- Models that advertise only the standard tier have one **(Normal)** entry.
- Models whose tier support is unknown have one **(Auto)** entry unless a global tier is configured.

Legacy `codex::<model>::reasoning=<effort>` and `codex::<model>::tier=fast`
identifiers remain request-compatible for persisted selections and agent
profiles. Reasoning variants are no longer advertised as duplicate picker
entries. If discovery is unavailable, only the configured fallback model is
advertised.

Copilot Chat does not provide language-model providers with a separate,
always-visible tier badge. Pionus therefore includes the tier in the model
name. For fallback models and endpoints whose tier metadata is unknown, set
`pionus.codex.defaultServiceTier` to `auto`, `default`, or `fast` in VS Code
Settings. An explicit **(Normal)** or **(Fast)** picker entry is authoritative
and takes precedence over this default.

ChatGPT discovery treats visibility and API support independently: models such
as GPT-5.3 Codex Spark that are unavailable to API-key credentials remain
eligible with ChatGPT credentials, and the upstream Codex Auto Review exception
is preserved. Other hidden models remain excluded.

For cataloged OpenAI API models, VS Code receives the reviewed input limit, maximum output, image-input support, and tool-calling support. The `pionus.codex.maxOutputTokens` setting remains a per-request cap and is clamped to the effective model's maximum. If an agent profile changes the requested model, the provider resolves capabilities for that effective model before applying image, reasoning, and output limits.

### Requests and responses

- Text and text-like data, assistant history, tool calls, and tool results are converted to Responses input.
- PNG, JPEG, WebP, and GIF attachments are forwarded only when image input is enabled and the effective model advertises it. `image/jpg` is normalized to `image/jpeg`; unsupported image formats fail clearly.
- VS Code host tools map one-to-one to OpenAI function tools. Automatic and required tool choice are preserved, and completed calls stream back as VS Code tool-call parts.
- Text, supported reasoning output, refusals, function calls, completion, failure, incomplete response, and cancellation events are handled explicitly. Unknown future stream events are logged for diagnostics without being exposed as invented content.
- Permission, missing-model, and rate-limit/quota failures map to the closest VS Code language-model error. Transport, malformed-stream, incomplete, and server failures retain their original cause.
- Token counting attempts the Responses input-token endpoint for ChatGPT Codex, OpenAI API, and custom endpoints. Definitively unsupported endpoints are remembered for ten minutes; all unsupported or unavailable cases retain the conservative local estimate. Message and image conversion follows the same policy for counting and requests.

Reasoning presentation uses a guarded VS Code thinking part when the runtime provides it. Stable VS Code currently has no reasoning response part, so reasoning is not converted into ordinary answer text or a proprietary data part. This response-rendering limitation is independent of the model's Thinking Effort request control.

Each request is intentionally stateless (`store: false`) and does not use `previous_response_id`. Copilot supplies the complete conversation history in each provider request, so the provider does not maintain a second conversation state.

## Codex enhancements

The provider can augment requests with Codex-style context while leaving model capabilities unchanged:

- `AGENTS.md` and configured fallback project-instruction files, bounded by the configured byte limit.
- Selectable agent profiles, automatic planning/execution profile selection, and optional mirroring of configured Codex agents.
- Selectable `SKILL.md` instructions from configured skill paths.
- Optional active-editor and selection context.

These features are instruction-layer enhancements. They are kept separate from the OpenAI-to-VS Code capability mapping described above.

## Extension utilities

- Credential management for ChatGPT Codex, the official OpenAI API, and custom HTTPS endpoints.
- Provider status, debug logs, model discovery diagnostics, and IDE-context snapshot commands.
- A last-usage status item and usage response data, controlled by `pionus.codex.showUsageInStatusBar`.
- Optional local cost estimates from `pionus.codex.modelPricingUsdPerMTok`.
- Explicit Codex CLI bridge commands for read-only `codex exec` and non-mutating `codex review`. The bridge is disabled by default and asks before being enabled.

Pricing is configured locally in VS Code settings as USD per one million tokens:

```json
"pionus.codex.modelPricingUsdPerMTok": {
  "gpt-5.6-sol": {
    "input": 5,
    "cachedInput": 0.5,
    "output": 30
  }
}
```

`cachedInput` is optional and defaults to the input rate. Estimated cost is the sum of uncached input, cached input, and output tokens; reasoning tokens already included in the output count are not charged a second time. Invalid entries are ignored and reported in the extension log. Models without a configured entry continue to show token totals without a price. These local estimates do not replace authoritative provider billing data.

## Privacy and credentials

Requests may include chat messages, explicitly attached images, host-provided tool schemas and results, active-editor context, project instructions, selected skills, and agent-profile instructions. They are sent only to the configured endpoint.

ChatGPT access tokens from `~/.codex/auth.json` are restricted to the official ChatGPT Codex HTTPS endpoint. `OPENAI_API_KEY` credentials from that file are restricted to the official OpenAI API HTTPS endpoint. Custom endpoints require a separate, explicitly confirmed API key stored under an endpoint-specific key in VS Code SecretStorage; official credentials are never forwarded to them.

Inline completions are intentionally split out of this extension. A future `pionus.codex-inline-completions` extension may share provider-independent code such as credentials, model discovery, Responses transport, URL handling, and diagnostics, but it should own editor typing hooks, completion prompts, latency behavior, and completion-specific settings.

Features that require the official Codex app/sidebar/cloud runtime remain out of scope unless they can be exposed as provider-only behavior without UI coupling. This includes Codex sidebar sessions, custom Codex task editors, cloud task tracking, ChatGPT macOS app integration, and copied OpenAI extension internals or assets.

## Extension identity and source installation

The extension ID changed from `pionus.codex-chat-provider` to `pionus.openai-language-model-provider`. VS Code treats this as a new extension. Extension-scoped secret and global storage may therefore need to be configured again. Credentials stored in `~/.codex/auth.json` are unaffected.

For configuration-managed installation, run:

```sh
~/clouds/gitlab-dirk-deckert/configuration/Common/vscode/install
```

The installer clones or fast-forwards this repository under
`${PIONUS_VSCODE_REPOS_DIR:-$HOME/clouds/github-dirk-deckert}`, downloads the
matching GitHub Release VSIX, and registers it with the official VS Code CLI.
It is portable across user names, Apple Silicon, and Intel macOS machines.

## Development

```sh
npm ci
npm test
npm run compile
npm run package
```

## License

MIT. Copyright Pionus GmbH.
