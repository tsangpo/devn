# devn

Project-aware Codex and Claude Code launcher for Bifrost gateways.

[中文](README.zh-CN.md) · [Repository](https://github.com/tsangpo/devn) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)

devn selects a profile using the project binding in its local config.toml and gives each profile its own
Codex / Claude configuration, plugins and history. Profiles are registered locally
from a remote JSON document. The CLI does not ship customer profiles or update itself.

## Requirements and use

Linux or macOS. Install Codex and Claude Code separately and put them on PATH.
The npm/source distribution requires Bun >=1.4.2 and runs TypeScript directly.
There are no runtime or development npm dependencies or dist files.

Homebrew installs a standalone binary with no Bun dependency:

    brew install tsangpo/tap/devn
    devn --version

Binary releases cover macOS and Linux (glibc), on arm64 and x64. To upgrade, use
`brew update && brew upgrade devn`. Binaries and SHA-256 checksums are also
available from [GitHub Releases](https://github.com/tsangpo/devn/releases).

Run the npm package with Bun:

    bunx @tsangpo/devn --version
    bunx @tsangpo/devn profile add
    bunx @tsangpo/devn profile use customer-a
    bunx @tsangpo/devn codex
    bunx @tsangpo/devn claude

To run from source, get https://github.com/tsangpo/devn and run:

    bun bin/devn --help

Or add /absolute/path/to/devn/bin to PATH. Commands run in the caller's project
directory. Use a version-qualified package (for example bunx @tsangpo/devn@0.1.1) when
you need to pin the CLI version.

## Profiles

    devn profile add
    devn profile list
    devn profile show customer-a
    devn profile use customer-a
    devn profile remove customer-a
    devn profile remove customer-a --purge

Add asks for a local name, a **Profile JSON URL**, and a hidden gateway key. This
URL points to a configuration document, not a model API. The download does not
send your key. You must explicitly approve the displayed Codex / Claude gateway
origins before registration is saved. Adding the same name asks before replacing
its URL/key and retains tool history.

Show reads local data only. It hides the key, URL paths and query parameters.
Without a name, it shows the current project's profile. Use without a name offers
an interactive list of registered profiles. Adding does not change project bindings.

Remove asks you to type the profile name. It removes registration and the
credentials devn generated in tool config files, but retains history and personal
settings. Stop active tool sessions first. Use --purge to delete the whole profile
directory; it also works after registration has already been removed. Project
bindings are left intact and fail until you select another registered profile.

## Project binding

Run profile use in the project directory. It records the directory's real path
in the `[projects]` table of config.toml; nothing is written into the project:

    devn profile use customer-a
    devn profile unbind

The nearest bound directory found while walking up from the current directory wins.
Nested projects may override their parent. `profile unbind` removes the binding of
exactly the current directory. Unknown or malformed bindings fail; devn never
silently chooses another customer's profile. Bindings are per user and per
path: after moving or renaming a project, run profile use again.

Native client arguments are forwarded, including quoted prompts:

    devn codex exec --skip-git-repo-check "Explain this project"
    devn claude -p "Explain this project"
    devn codex --model your-model-id

Arguments that override the managed connection, client profile or working
directory are rejected. Change directory with cd and profile with profile use.

## Remote configuration and trust

An administrator hosts a JSON document at an HTTPS URL. Minimal example:

    {
      "version": 1,
      "baseUrl": "https://gateway.example.com",
      "codex": {},
      "claude": {}
    }

The default endpoints append /openai/v1 and /anthropic. Override either with
codex.baseUrl or claude.baseUrl. Optional id/name fields are descriptive; the
local name controls the binding and directory. Never publish real keys in JSON.

Download and gateway URLs require HTTPS, except loopback HTTP for local testing
(localhost, 127.0.0.0/8, ::1). Redirects are limited to five and HTTPS cannot
downgrade to HTTP. Responses are limited to 1 MiB after decompression and ten seconds.

Before each tool launch, devn refreshes the selected profile. Network failures,
timeouts and HTTP 5xx may use a valid cached profile with a warning. HTTP 4xx,
invalid/oversized definitions and unsafe redirects fail without replacing the
cache. A profile without a valid cache cannot run offline.

Approved gateway origins (scheme, host and port) are pinned in local registration.
A change stops launch: run profile add again to review and accept it. No key is
sent to the new gateway by devn before approval. Paths and model definitions on
the same approved origin may update automatically. Each profile has an independent
refresh lock, so a slow server does not block another profile.

If models are omitted, clients keep native defaults, menus and saved model choices.
Map the model IDs sent by the clients to actual backends in Bifrost. Optional
central model menus are documented by profiles/example.json; replace its values
and remove example: true before hosting it. Repository examples are never
automatically registered. Model metadata must match backend capabilities.

For a central Codex menu, `codex.model` selects the default and `codex.models`
contains native catalog objects (`slug`, `display_name`, `description`, and
capability fields). devn writes `{ "models": [...] }` without adding or changing
model fields, including `priority`, `visibility`, and `supported_in_api`.
For Claude, use `claude.model` and native `claude.modelPicker` with
`replaceBuiltInOptions: true` and `options` containing `model`, `label`, optional
`description` and `behavesAs`. The picker is copied unchanged; optional `slots`
still map `opus`, `sonnet`, and `haiku` to the corresponding environment variables.
Saved model choices are retained while listed; otherwise the manifest default is used.

Migration from the previous model format: rename `defaultModel` to `model`;
flatten Codex `metadata` into each model, rename `id`/`name` to
`slug`/`display_name`, and explicitly include catalog display fields. Move Claude
`models` to `modelPicker.options`, renaming `id`/`name` to `model`/`label`.
Update the hosted manifest and CLI together. Legacy model definitions are rejected;
URL-only profiles are unchanged. Remote manifests cannot supply arbitrary Claude
settings such as keys, hooks, or permissions.

## Local data

Configuration uses ${XDG_CONFIG_HOME:-~/.config}/devn:

    config.toml
    profiles/
      customer-a/
        profile.json
        codex/          # CODEX_HOME
        claude/         # CLAUDE_CONFIG_DIR

Registration is TOML:

    version = 1

    [profiles.customer-a]
    url = "https://config.example.com/customer-a.json"
    key = "your-local-key"

    [profiles.customer-a.origins]
    codex = "https://gateway.example.com"
    claude = "https://gateway.example.com"

    [projects]
    "/home/me/work/customer-a" = "customer-a"

Keys are plaintext in config.toml and generated tool configuration. Files use
0600 and profile directories 0700; permissions are not encryption. Codex uses
experimental_bearer_token and Claude uses ANTHROPIC_AUTH_TOKEN.

Codex built-in web search defaults to `disabled`: gateway model support does not
imply support for OpenAI-hosted search. An explicit `web_search` setting in the
profile's `codex/config.toml` is preserved. To troubleshoot an older installation,
run `devn codex -c 'web_search="disabled"'`.

Only devn-managed fields are regenerated; unrelated personal settings, MCP,
plugins and history are preserved. Profiles do not copy global client settings.
This separates configuration and state, not OS permissions or agent file access.
See SECURITY.md for limitations.

Registrations without approved origins must be added again with `devn profile add`.
Stop active clients before moving configuration or tool data. Preserve file
permissions when copying history and personal settings into a profile directory;
the key in config.toml remains the source of truth. No automatic migration from
older development layouts is performed.

## Development and release

    bun run check
    bun run check:secrets
    bun run test:native

Check runs behavior and packed-package tests, then validates the example.
Secret checks inspect known patterns in working files and reachable history;
they cannot detect all private information. Native smoke uses installed clients
with a local fake gateway and dummy keys. See CONTRIBUTING.md for versions and
schema compatibility.

Pushing a stable `vX.Y.Z` tag matching package.json triggers the Release workflow.
It validates the npm package and four native binaries, publishes npm and GitHub
Release assets, tests Homebrew installation, then updates `tsangpo/homebrew-tap`.
npm publishing uses Trusted Publishing (OIDC), without an npm token. See
[release setup](CONTRIBUTING.md#release-setup) before pushing a tag.

To build and test the current platform locally:

    bun run build:binary
    bun run test:binary

Generated executables and archives are in the ignored release/ directory.

## License

MIT — Copyright (c) 2026 tsangpo. See [LICENSE](LICENSE).
