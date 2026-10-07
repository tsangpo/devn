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

Arguments are forwarded to the native client. Managed provider, profile and working-directory overrides are rejected; use `cd` and `devn profile use` instead.

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

The selected profile refreshes before each launch. Temporary network errors and HTTP 5xx can use a valid cache; invalid definitions, unsafe redirects, HTTP 4xx responses and changed gateway origins stop the launch. Re-run `profile add` to approve an origin change.

Omit model lists to keep each client's native defaults. If you publish a central model list, use the native format and map its IDs to real Bifrost routes. The repository example is documentation only and is never registered automatically.

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
