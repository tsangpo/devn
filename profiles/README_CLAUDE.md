# Claude Code: Bifrost and profile configuration

This guide is for administrators who publish devn remote profiles. It covers what to
configure in Bifrost and in the profile's `claude` section when Claude Code uses Anthropic
models on Amazon Bedrock through Bifrost. The latest Claude Code release is assumed.

## How devn connects to the gateway

`devn claude` talks to the gateway in Anthropic Messages format:

- `ANTHROPIC_BASE_URL` points at `<baseUrl>/anthropic` (override with `claude.baseUrl`).
- `ANTHROPIC_AUTH_TOKEN` is the user's Bifrost key, sent as a bearer token.
- `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX` and `CLAUDE_CODE_USE_FOUNDRY` are fixed to `0`.

Claude Code therefore treats Bifrost as the Anthropic API and sends its full set of beta
headers and request fields. Translating them into what Bedrock accepts is Bifrost's job.
Most image and prompt-cache problems come from that translation.

## Bifrost configuration

### Version

Run a release that keeps Anthropic `image`, `tool_use`, `tool_result` and `cache_control`
blocks on the Bedrock route. Older releases drop them silently:

| Symptom | Fixed in |
|---|---|
| `image`, `tool_use` and `tool_result` blocks dropped; the model cannot see images | v1.6.8 (core v1.7.6) |
| `cache_control` lost on content blocks and tool definitions | same release line |
| `cache_control` lost when any message's content is a plain string | core v1.10.0 |
| `Stream idle timeout` on long tool arguments | core v1.11.2 |

### Request headers

In Settings > Client Settings, set Allowed Headers to `*`, or allow at least
`anthropic-beta`, `anthropic-version`, `authorization`, `x-api-key`, `content-type` and
`user-agent`. Do not allowlist individual `anthropic-beta` values: Claude Code adds new
ones with each release.

### Beta header filtering

Bifrost filters `anthropic-beta` values by what Bedrock supports:

- Kept by default: `interleaved-thinking-*`, `context-1m-*`, `context-management-*`,
  `structured-outputs-*`, `computer-use-*`, `compact-*`.
- Dropped by default: `advanced-tool-use-*`, `prompt-caching-scope-*`, `mcp-client-*`,
  `files-api-*`, `skills-*`, `fast-mode-*`, `redact-thinking-*`.

When a header is dropped but its paired body field (such as `defer_loading` on a tool) is
still forwarded, Bedrock returns 400 `Extra inputs are not permitted`. Fix it one of two ways:

- Adjust the filter in the provider's Beta Headers tab or with `beta_header_overrides`.
- Set `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` in the profile (see below).

Bifrost v2.2.0 and later serves tool search (`defer_loading`) for Claude on Bedrock
natively, so check on your version whether the 400 still occurs before disabling it.

### Models and permissions

- On the Bedrock key, map each deployment name to a Bedrock model ID or inference profile
  (for example `global.anthropic.claude-sonnet-5-5`).
- If the key's `models` setting is not `*`, add the deployment names there too. Mappings do
  not extend the allowlist.
- The virtual key must allow the `bedrock` provider and have enough budget and rate limit.
- The signing identity needs `bedrock:InvokeModel` and
  `bedrock:InvokeModelWithResponseStream`. Streaming fails without the second action.
- `bedrock_key_config` requires `region`, and model access must be enabled in every region
  the inference profile spans.

### Images

- Bedrock accepts base64 images only; remote URLs fail. Images Claude Code pastes or reads
  are already base64.
- Most screenshots arrive inside `tool_result` blocks (reading an image file, MCP
  screenshots), so `image` blocks nested in `tool_result` must survive.

### Prompt cache

- Bifrost converts `cache_control` to Bedrock `cachePoint` markers on system blocks,
  message content blocks and tool definitions.
- Do not let the gateway rewrite the `system` array (merging it into a string, prepending
  content, reordering) or message content. A changed prefix misses the cache and can also
  trigger a 400 from thinking-signature validation.
- Bifrost uses `x-claude-code-session-id` to keep a session on the same provider and key.
  With multiple keys or fallbacks configured, confirm this holds, or the cache is split.
- A broken cache produces no error. Every turn is simply billed as uncached input.

## The profile's `claude` section

Every field is optional. The smallest configuration is `"claude": {}`, which keeps Claude
Code's own default models. Unknown fields reject the profile.

| Field | Description |
|---|---|
| `baseUrl` | Overrides the default `<baseUrl>/anthropic`. Must be HTTPS (except loopback) with no query. |
| `modelPicker` | Models shown in `/model`. `replaceBuiltInOptions` must be `true` and `options` must not be empty. |
| `model` | Default model. Must appear in `modelPicker.options`. |
| `slots` | Models for the `opus`, `sonnet` and `haiku` tiers. Each must reference a listed model. |
| `env` | Claude Code gateway switches, limited to the allowlist below. |

`model` and `slots` require `modelPicker`. `env` can be used on its own.

### Model list

Each entry in `modelPicker.options`:

| Field | Description |
|---|---|
| `model` | Model ID sent to the gateway. Must be unique and contain no whitespace. |
| `label` | Display name. Required. |
| `description` | Optional description. |
| `behavesAs` | Optional Anthropic model ID this entry corresponds to. |

Notes:

- **Model IDs must be names Bifrost can route.** For Bedrock, use
  `bedrock/<deployment name or model ID>`, for example
  `bedrock/global.anthropic.claude-sonnet-5-5`.
- **Set `behavesAs` for gateway IDs.** Claude Code does not recognize IDs such as
  `bedrock/...` and treats them as a current model with a 200K context window. Pointing
  `behavesAs` at the real Anthropic ID (such as `claude-sonnet-5-5`) gives it the right
  capabilities.
- **Point all three tiers at configured deployments.** With `modelPicker` set, a tier
  missing from `slots` falls back to `model`. Background tasks use the `haiku` tier; if no
  Haiku deployment exists, point it at Sonnet as the example does.
- The aliases `sonnet`, `opus` and `haiku` are always accepted by `--model`.

### `env` switches

Names and values are fixed enumerations; anything else rejects the profile. A profile
cannot set gateway URLs, credentials, custom headers or request-body overrides.

| Name | Values | Use |
|---|---|---|
| `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` | `1` | Stop pre-release beta headers and their body fields (`defer_loading`, `context_management` and others). Removes the 400 when Bifrost does not forward the matching beta headers. |
| `CLAUDE_CODE_DISABLE_STRUCTURED_OUTPUTS` | `1` | Drop only the structured-output format field, keeping other pre-release capabilities. |
| `CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING` | `0`, `1` | Whether tool inputs stream as they are generated. Off by default behind a custom base URL. |
| `CLAUDE_CODE_PROMPT_CACHE_TTL` | `5m`, `1h` | Prompt cache lifetime for the main conversation. |
| `CLAUDE_CODE_GATEWAY_HINT_HEADERS` | `0`, `1` | Send `x-claude-code-*` routing hint headers to the gateway. |

Notes:

- **`CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` turns off MCP tool search**, so every MCP
  tool loads into context upfront. It is unnecessary if Bifrost forwards
  `advanced-tool-use-*`.
- **Test `CLAUDE_CODE_PROMPT_CACHE_TTL=1h` before relying on it.** On this path the
  one-hour TTL needs the `ttl` field in `cache_control` plus an `extended-cache-ttl` beta
  header, which is not in Bifrost's documented default keep list. One-hour cache writes are
  also billed at a higher rate.
- **Allow the headers before setting `CLAUDE_CODE_GATEWAY_HINT_HEADERS=1`.** If Allowed
  Headers is not `*`, add `x-claude-code-*`.
- Removing a name from the profile removes it from the generated settings on the next
  launch. Entries users add to `env` themselves are preserved.
- Have users upgrade devn before you publish `claude.env`. Older releases reject the field.

### Example

```json
"claude": {
  "model": "bedrock/global.anthropic.claude-sonnet-5-5",
  "slots": {
    "opus": "bedrock/global.anthropic.claude-opus-5-5",
    "sonnet": "bedrock/global.anthropic.claude-sonnet-5-5",
    "haiku": "bedrock/global.anthropic.claude-sonnet-5-5"
  },
  "env": {
    "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS": "1"
  },
  "modelPicker": {
    "replaceBuiltInOptions": true,
    "options": [
      {
        "model": "bedrock/global.anthropic.claude-sonnet-5-5",
        "label": "Sonnet 5.5",
        "behavesAs": "claude-sonnet-5-5"
      },
      {
        "model": "bedrock/global.anthropic.claude-opus-5-5",
        "label": "Opus 5.5",
        "behavesAs": "claude-opus-5-5"
      }
    ]
  }
}
```

See [example.json](example.json) for a complete profile.

## Pre-rollout checks

1. Send a short prompt that uses no tools. In Bifrost Logs, confirm the request used
   `bedrock` and resolved to the expected model ID.
2. Paste an image and ask for a description. Then have Claude read an image file, to
   confirm images inside `tool_result` also reach the model.
3. Hold a conversation of two or more turns and confirm `cache_read_input_tokens` is above
   0 from the second turn.
4. Configure at least one MCP server and send a request. Confirm there is no
   `Extra inputs are not permitted` error.
5. Trigger a long file write and confirm there is no `Stream idle timeout`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| 400 `Extra inputs are not permitted` | Beta header filtered while its body field is forwarded | Forward the beta header in Bifrost, or set `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` |
| Model cannot see images | Bifrost dropped `image` or `tool_result` blocks | Upgrade Bifrost |
| High `input_tokens` every turn, no cache reads | `cache_control` dropped, or system/messages rewritten | Upgrade Bifrost; disable plugins that rewrite request bodies |
| Request headers rejected | Allowed Headers too narrow | Set it to `*` or add the missing headers |
| Streaming fails, non-streaming works | Missing `bedrock:InvokeModelWithResponseStream` | Add the IAM action |
| Model not found, or provider cannot be resolved | Model ID has no deployment or is not in the key's `models` | Check the deployment mapping and allowlist |
| `Stream idle timeout` during long tool calls | Tool arguments buffered into one burst | Upgrade Bifrost |

## References

- [Claude Code gateway compatibility guide](https://code.claude.com/docs/en/llm-gateway-protocol)
- [Bifrost: Claude Code](https://docs.getbifrost.ai/cli-agents/claude-code)
- [Bifrost runbook: Claude Code + Bedrock](https://docs.getbifrost.ai/runbooks/claude-code-bedrock.md)
- [Bifrost Bedrock provider](https://docs.getbifrost.ai/providers/supported-providers/bedrock)
