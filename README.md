# devn

Project-aware launcher for Codex, Claude Code and OpenCode v2 through Bifrost gateways.

[中文](README.zh-CN.md) · [Repository](https://github.com/tsangpo/devn) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)

devn maps each project to a local profile. A profile comes from an administrator-hosted JSON document and gets its own client configuration, credentials, plugins and history. devn never ships customer profiles, copies global client data or updates itself.

## Install

Supported hosts are Linux, macOS and Windows 11 x64. Install the clients you need separately:

```sh
bun i -g @anthropic-ai/claude-code @openai/codex @opencode/cli
```

Install devn with Bun:

```sh
bun i -g @tsangpo/devn
devn --version
```

Use `bunx @tsangpo/devn ...` for one-off commands. Homebrew provides a standalone macOS/Linux binary:

```sh
brew install tsangpo/tap/devn
```

Windows uses the Bun/npm package. The source and npm distributions require Bun >=1.4.2; standalone binaries do not. See [releases](https://github.com/tsangpo/devn/releases) for checksums and supported binary platforms.

## Profiles

```sh
devn profile add https://config.example.com/team.json
devn profile list
devn profile show customer-a
devn profile use customer-a
devn profile remove customer-a
devn profile remove customer-a --purge
```

`profile add` downloads and validates the JSON, asks for a local name, and requires approval of every gateway origin. Manual profiles ask for a hidden key; OAuth profiles use `--auth auto`, `--auth browser` or `--auth device`. Each profile has an independent session. Re-adding a name can rotate its URL or key while retaining tool history.

Run a client from a bound project:

```sh
devn codex
devn claude
devn opencode
```

Arguments are forwarded to the native client. Managed provider, profile and working-directory overrides are rejected; use `cd` and `devn profile use` instead. Codex runs with its shared background daemon disabled (`daemon_auto_start = false`), and interactive sessions add `--no-daemon` so they never attach to one that is already running.

## Project binding

```sh
cd /path/to/project
devn profile use customer-a
devn profile unbind
```

Bindings are stored in the user config, not in the project. devn uses the nearest bound parent directory, so nested projects can override a parent. A missing or invalid binding is an error; devn never silently selects another profile.

## Remote profile

The smallest useful profile is:

```json
{
  "version": 1,
  "baseUrl": "https://gateway.example.com",
  "codex": {},
  "claude": {}
}
```

`baseUrl` defaults to `/openai/v1` for Codex and `/anthropic` for Claude. Client-specific `baseUrl` values may override those paths. Keep profiles free of real keys. HTTPS is required except for loopback addresses used in local testing; downloads are size- and time-limited.

OpenCode model entries are copied into OpenCode's configuration as written, so any v2 model field works (`limit`, `cost`, `variants`, `headers`, …). A model may pick another bundled protocol with `package` (only `@opencode/ai/providers/...`) and its own `settings.baseURL`, which must use the OpenCode gateway origin; devn adds the key to those settings. Credentials in model settings and `{env:`/`{file:` substitutions are rejected. For example, to send Claude through Bifrost's Anthropic endpoint:

```json
"bedrock/global.anthropic.claude-haiku-5-5": {
  "package": "@opencode/ai/providers/anthropic-compatible",
  "settings": { "baseURL": "https://gateway.example.com/anthropic/v1" }
}
```

The selected profile refreshes before each launch. Temporary network errors and HTTP 5xx can use a valid cache; invalid definitions, unsafe redirects, HTTP 4xx responses and changed gateway origins stop the launch. Re-run `profile add` to approve an origin change.

### Model discovery

When a client section has no model list (`"codex": {}`, `"claude": {}` or `"opencode": {}`), devn asks the gateway on each launch of that client: `GET <baseUrl>/v1/models` with the user's key. Every model the key may use is offered to the client, and devn generates its configuration:

- Codex: a `models.json` catalog. Each entry is built from the catalog bundled with the installed Codex (`codex debug models --bundled`). An ID ending in a bundled slug, such as `bedrock/global.openai.gpt-6.1-sol`, inherits that model's settings. Other models keep Codex's instructions but claim no reasoning levels. Hosted-only search, service tiers and experimental tools are removed.
- Claude Code: `/model` options and the `ANTHROPIC_DEFAULT_OPUS_MODEL`, `_SONNET_MODEL` and `_HAIKU_MODEL` tiers. A tier is the newest ID containing `claude` and `opus`, `sonnet` or `haiku` (release dates and `-v1:0` suffixes are ignored). A missing tier borrows another tier's model. When both Opus and Sonnet exist, an `opusplan` option (Opus while planning, Sonnet otherwise) is added first and becomes the default; otherwise the Sonnet tier is the default.
- OpenCode: `bifrost/<id>` models with the context and output limits the gateway reports.

The first OpenAI/GPT model becomes the Codex and OpenCode default. Without Claude tiers, the first Anthropic/Claude model becomes the Claude default. A model the user picked earlier is kept while the gateway still offers it. Deprecated entries and IDs with whitespace, control characters or `{env:`/`{file:` templates are skipped.

The key is sent only to the approved `baseUrl` origin, and redirects are not followed. If the gateway is unreachable or returns HTTP 5xx, devn uses the last list it received. HTTP 4xx, invalid responses and an empty list stop the launch. An explicit list in the profile always wins and skips discovery. Upgrade devn before publishing `"opencode": {}`, because older releases reject it.

If you publish a central model list, use the native format and map its IDs to real Bifrost routes. The repository example is documentation only and is never registered automatically.

### Claude Code gateway switches

`claude.env` optionally sets Claude Code compatibility switches for the gateway. Only these names and values are accepted; anything else rejects the profile. The latest Claude Code release is assumed.

| Name | Values | Use |
|---|---|---|
| `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` | `1` | Stop pre-release beta headers and their body fields (`defer_loading`, `context_management`) when the upstream, such as Bedrock, rejects them with `Extra inputs are not permitted`. Also turns off MCP tool search. |
| `CLAUDE_CODE_DISABLE_STRUCTURED_OUTPUTS` | `1` | Drop only the structured-output format field. |
| `CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING` | `0`, `1` | Stream tool inputs through the gateway; off by default behind a custom base URL. |
| `CLAUDE_CODE_PROMPT_CACHE_TTL` | `5m`, `1h` | Prompt cache lifetime for the main conversation. |
| `CLAUDE_CODE_GATEWAY_HINT_HEADERS` | `0`, `1` | Send `x-claude-code-*` routing hints to the gateway. |

Removing a name from the profile removes it from the generated settings on the next launch. Upgrade devn before publishing `claude.env`: older releases reject the field.

`claude.disabledTools` optionally turns off Claude Code tools the gateway cannot serve. Only `WebSearch` is accepted: it needs Anthropic's server-side search, which a gateway routing to Bedrock, OpenAI or Gemini never runs, so the model gets a "no search tool" answer instead of results. devn adds the names to `permissions.deny` in the generated settings and keeps your other deny rules; removing a name from the profile removes it on the next launch. Upgrade devn before publishing the field: older releases reject it.

For Bedrock behind Bifrost, images and prompt caching also depend on the gateway: allow all client headers (or at least `anthropic-beta` and `anthropic-version`), and run a Bifrost release that keeps Anthropic `image`, `tool_result` and `cache_control` blocks on the Bedrock route. Caching failures are silent; confirm `cache_read_input_tokens` is non-zero from the second turn in the gateway logs.

## Local data and limits

Data is stored under `${XDG_CONFIG_HOME:-~/.config}/devn` on Unix and `%LOCALAPPDATA%/devn` on Windows. Each profile contains its cached JSON and separate Codex, Claude and OpenCode directories. Managed credentials are written to client config files with private permissions; they are local plaintext secrets, not encryption. Removing a profile scrubs devn-managed credentials; `--purge` also deletes its profile data.

devn separates configuration and client state, but it is not an OS sandbox. Review [SECURITY.md](SECURITY.md) before using untrusted plugins or profiles.

## Development and release

```sh
bun run check
bun run test:native       # requires installed clients and a local test gateway
bun run check:secrets
bun run build:binary
bun run test:binary
```

Native tests use dummy keys and a loopback gateway. Release and compatibility procedures, including tested client versions and Windows details, are in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — Copyright (c) 2026 tsangpo. See [LICENSE](LICENSE).

### Telemetry

Set `"telemetry": false` at the profile root to disable telemetry, error/feedback reporting and OpenTelemetry export for all three clients. This includes inherited OTEL endpoints, Claude feedback surveys and Codex `/feedback`. Local logs and Bifrost usage are retained. The policy applies when clients are started through devn, including its native-client probes; restart running clients to apply it. Codex telemetry config overrides are rejected while the policy is active. This controls the built-in clients, not arbitrary third-party plugins.

Only omission or `false` is accepted. Omission keeps existing behavior; removing the field removes devn-owned telemetry settings on each client's next launch, without restoring previously overwritten values. Upgrade devn to 0.9.2 or newer before publishing this field: 0.9.1 and older reject it. Existing saved profiles are not migrated automatically.
