# Codex: Bifrost and profile configuration

This guide is for administrators who publish devn remote profiles. It covers what to
configure in Bifrost and in the profile's `codex` section when Codex uses OpenAI GPT
models on Amazon Bedrock through Bifrost. The latest Codex release is assumed.

## How devn connects to the gateway

`devn codex` defines a named `bifrost` model provider in Codex's `config.toml`:

- `base_url` points at `<baseUrl>/openai/v1` (override with `codex.baseUrl`).
- `wire_api = "responses"`: Codex speaks the OpenAI Responses API.
- The user's Bifrost key is sent as a bearer token; `requires_openai_auth = false`.
- `supports_websockets = false`: requests use HTTPS, which non-OpenAI upstreams require.
- `web_search = "disabled"` unless the user already set it. Gateway model support does not
  imply hosted search support.

Because devn uses a named provider rather than `openai_base_url`, Codex does not send the
client-side `web` namespace tool that Bedrock rejects with a namespace collision.

## Bifrost configuration

### Version

Run v2.2.0 or later. That release contains the fixes Codex on Bedrock depends on:

| Behavior | Why it matters |
|---|---|
| Bedrock runtime models that serve the Responses API are routed to it instead of Converse | Codex requests reach Bedrock in their native format |
| Codex's `functions` tool namespace is unwrapped to top-level tools | Codex 0.147 and later wraps its tools in a namespace Bedrock rejects |
| Namespace tools named `web`, `image_gen`, `browser` or `python` are dropped on Bedrock paths | These names are reserved on Bedrock and otherwise cause a 400 |
| Images inside tool results are hoisted on the Converse path | OpenAI models on Converse reject images nested in a tool result |
| Mid-conversation system messages are inlined instead of hoisted | Hoisting changed the prompt prefix and broke cache reuse |

### Route to the OpenAI-compatible endpoint

Set `use_openai_endpoints` on the Bedrock key or on a model alias so chat and Responses
traffic goes to Bedrock's `/openai/v1` surface instead of Converse. The alias value wins
over the key.

The setting is opt-in because Converse applies Bedrock Guardrails, `performanceConfig`
and `requestMetadata`, which the OpenAI-compatible surface ignores without an error. If you
rely on a guardrail, configure it explicitly and verify it is still enforced.

Bifrost builds the Bedrock Runtime URL from the key's region. There is no base URL to set.

### Provider key

```json
{
  "providers": {
    "bedrock": {
      "keys": [
        {
          "name": "aws-bedrock",
          "models": [
            "global.openai.gpt-6-astra",
            "global.openai.gpt-6-luna",
            "global.openai.gpt-6.1-sol"
          ],
          "weight": 1.0,
          "bedrock_key_config": {
            "region": "us-east-1"
          }
        }
      ]
    }
  }
}
```

- `region` is required. Omitting `access_key`, `secret_key` and `session_token` uses the
  default AWS credential chain.
- `models` lists the exact IDs the key may serve, or `["*"]`. Aliases do not extend it.
- The virtual key must allow the `bedrock` provider and have enough budget and rate limit.

### Model IDs and permissions

- **Use a system inference profile.** OpenAI GPT models on `bedrock-runtime` must be named
  by a cross-Region profile such as `global.openai.gpt-6.1-sol` or `us.openai.gpt-6.1-sol`,
  not the foundation model ID. In-Region inference is not available for them.
- **Application inference profiles are rejected** with a 400 on this endpoint.
- **A global profile can store and process data in any commercial Region.** Use a
  geographic profile (`us.`) if you have data residency requirements.
- The signing identity needs `bedrock:InvokeModel` and
  `bedrock:InvokeModelWithResponseStream` on the inference profile, and
  `bedrock:InvokeModel` on the account's default project.

### Request headers

Bifrost allows only a small set of client headers by default. If requests are rejected, set
Allowed Headers to `*` in Settings > Client Settings, or add the headers Codex sends. No
custom header is needed for images or prompt caching.

### Server-side tools

`bedrock-runtime` does not provide server-side tools, including web search. Leave
`web_search` disabled, and do not advertise search support in the model catalog.

### Stored responses

On Bedrock, `store` defaults to `true` and stored responses are kept for 30 days. Check in
the Bifrost logs what Codex sends. If nothing may be retained, set the AWS account's data
retention mode to `none`, which rejects `store=true` outright.

### Images

- Images are sent as base64. `client.max_request_body_size_mb` (default 100) must cover
  the largest request, including every image still in the conversation.
- Screenshots usually arrive inside tool output. They work on the Responses path; on
  Converse they depend on the hoisting fix above.

### Prompt cache

- Caching for these models is implicit and depends on a stable prompt prefix. There is no
  profile switch or header that enables it.
- Keep the model slug, region, route and `instructions_template` stable. Do not switch
  aliases during a session.
- Do not enable Bifrost's semantic cache for Codex tool sessions unless entries are isolated
  by model, tenant and project.
- A broken cache produces no error. Every turn is simply billed as uncached input.

## The profile's `codex` section

Every field is optional. The smallest configuration is `"codex": {}`, which keeps Codex's
own default model. Unknown fields reject the profile.

| Field | Description |
|---|---|
| `baseUrl` | Overrides the default `<baseUrl>/openai/v1`. Must be HTTPS (except loopback) with no query. |
| `models` | Codex-native model catalog entries. Must not be empty when present. |
| `model` | Default model. Must be the `slug` of a listed entry. Requires `models`. |

When `models` is present, devn writes it to `models.json` in the profile's Codex directory
and points `model_catalog_json` at it. `--model` then accepts only listed slugs.

### Model catalog entries

devn checks these fields and passes every other field to Codex unchanged:

| Field | Rule |
|---|---|
| `slug` | Required. Unique, with no whitespace. This is the model ID sent to the gateway. |
| `display_name` | Required. |
| `description` | Required. |
| `context_window` | Optional. A positive integer when present. |
| `supported_reasoning_levels` | Optional list of `{ "effort", "description" }`. An empty list counts as absent. |
| `default_reasoning_level` | Optional. Must be one of the listed efforts. |

Notes:

- **The slug must be a name Bifrost can route.** For Bedrock, use
  `bedrock/<inference profile ID>`, for example `bedrock/global.openai.gpt-6.1-sol`. The
  part after `bedrock/` must be allowed on the provider key.
- **Start from a complete native entry.** The catalog schema is internal to Codex and
  changes between versions. Copy an entry for a comparable model from
  `~/.codex/models_cache.json` and change only what differs, rather than writing one from
  scratch. A model missing from the catalog still runs, but Codex falls back to
  conservative metadata and compacts history early.
- **Set `context_window` from the Bedrock model card**, not from the OpenAI-hosted entry.
  The limits can differ.
- **Keep `"input_modalities": ["text", "image"]` for image input.** Set
  `supports_image_detail_original` to `true` only if the model on Bedrock supports it.
- **Do not copy hosted-only capabilities.** Leave out search support, service tiers and
  entries in `experimental_supported_tools` that the Bedrock route cannot serve.
- **Keep `use_responses_lite` set to `false`**, as in the example profile.
- **`instructions_template` is part of the cached prefix.** Changing it invalidates the
  cache for every user of the profile.
- `cost.cache` belongs to OpenCode pricing metadata. It has no effect in a Codex entry.

### Command-line limits

devn rejects arguments that would bypass the profile: `--profile`, `--cd`, `--remote`,
`--oss`, `--local-provider`, and `-c` overrides of the model, provider, model catalog or
base URL. Use `--model` with a listed slug to switch models.

### Example

```json
"codex": {
  "model": "bedrock/global.openai.gpt-6.1-sol",
  "models": [
    {
      "slug": "bedrock/global.openai.gpt-6.1-sol",
      "display_name": "GPT 6.1 Sol",
      "description": "GPT 6.1 Sol on Bedrock Runtime",
      "context_window": 1050000,
      "default_reasoning_level": "medium",
      "supported_reasoning_levels": [
        { "effort": "low", "description": "Fast" },
        { "effort": "medium", "description": "Balanced" },
        { "effort": "high", "description": "Thorough" }
      ],
      "input_modalities": ["text", "image"],
      "supports_image_detail_original": true,
      "supports_reasoning_summary_parameter": true,
      "supports_parallel_tool_calls": true,
      "use_responses_lite": false,
      "model_messages": {
        "instructions_template": "You are Codex, a coding agent."
      },
      "shell_type": "unified_exec",
      "support_verbosity": false,
      "apply_patch_tool_type": "freeform",
      "truncation_policy": { "mode": "tokens", "limit": 10000 },
      "experimental_supported_tools": [],
      "visibility": "list",
      "supported_in_api": true,
      "priority": 1
    }
  ]
}
```

See [example.json](example.json) for a complete profile.

## Pre-rollout checks

1. Send a short prompt that uses no tools. In Bifrost Logs, confirm the request used
   `bedrock` and resolved to the expected inference profile.
2. Run a task that edits a file and runs a shell command, to confirm tool calls work.
3. Attach an image and ask for a description. Then have Codex view an image file, to
   confirm images in tool output also reach the model.
4. Hold a conversation of several turns and confirm cached input tokens are reported from
   the second turn.
5. Check the `store` value on a logged request against your retention requirements.

Capabilities for these models vary by AWS Region and by Codex and Bifrost version, so
repeat the checks after upgrading either one.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| 400 naming a namespace collision (`functions`, `web`) | Bifrost forwards Codex namespace tools Bedrock reserves | Upgrade Bifrost to v2.2.0 or later |
| 400 on an application inference profile | Not supported for Responses on `bedrock-runtime` | Use a `us.` or `global.` system profile |
| Model not found, or provider cannot be resolved | Slug has no match in the key's `models` | Check the `bedrock/` prefix and the key allowlist |
| Fallback-metadata warning, early compaction | Model missing from the catalog, or entry incomplete | Publish a complete entry in `codex.models` |
| Model cannot see images from tools | Request went through Converse without hoisting | Upgrade Bifrost, or route through `use_openai_endpoints` |
| Request rejected as too large | Base64 images exceed the body limit | Raise `client.max_request_body_size_mb` |
| No cached tokens after the first turn | Prompt prefix changes between turns | Keep slug, route and instructions stable; upgrade Bifrost |
| Web search fails | No server-side tools on `bedrock-runtime` | Leave `web_search` disabled |
| Streaming fails, non-streaming works | Missing `bedrock:InvokeModelWithResponseStream` | Add the IAM action |

## References

- [Amazon Bedrock Responses API](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-responses-api.html)
- [Amazon Bedrock prompt caching](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html)
- [Bifrost: Codex CLI](https://docs.getbifrost.ai/cli-agents/codex-cli)
- [Bifrost Bedrock provider](https://docs.getbifrost.ai/providers/supported-providers/bedrock)
- [Bifrost changelog v2.2.0](https://docs.getbifrost.ai/changelogs/v2.2.0)
