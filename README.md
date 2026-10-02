# devn

Project-aware Codex, Claude Code and OpenCode v2 launcher for Bifrost gateways.

[中文](README.zh-CN.md) · [Repository](https://github.com/tsangpo/devn) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)

devn selects a profile using the project binding in its local config.toml and gives each profile its own
Codex / Claude / OpenCode configuration, plugins and history. Profiles are registered locally
from a remote JSON document. The CLI does not ship customer profiles or update itself.

## Requirements and use

Linux, macOS, or Windows 11 x64. Install the clients you use (Codex, Claude Code or OpenCode v2) separately and put them on PATH.
The npm/source distribution requires Bun >=1.4.2 and runs TypeScript directly.
There are no runtime or development npm dependencies or dist files.

With Bun installed, install Codex, Claude Code and OpenCode globally:

```sh
bun i -g @anthropic-ai/claude-code @openai/codex @opencode/cli
```

Make sure `codex`, `claude` and `opencode` are available on PATH before using them through devn.

Homebrew installs a standalone binary with no Bun dependency:

    brew install tsangpo/tap/devn
    devn --version

Binary releases cover macOS and Linux (glibc) on arm64/x64, plus Windows x64. To upgrade, use
`brew update && brew upgrade devn`. Binaries and SHA-256 checksums are also
available from [GitHub Releases](https://github.com/tsangpo/devn/releases).

On Windows x64, install or upgrade the latest stable release from 64-bit PowerShell
(Windows PowerShell 5.1 or PowerShell 7):

```powershell
irm https://github.com/tsangpo/devn/releases/latest/download/install.ps1 | iex
```

From either cmd or PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -c "irm https://github.com/tsangpo/devn/releases/latest/download/install.ps1 | iex"
```

The installer checks SHA-256, installs `devn.exe` and its license into
`%LOCALAPPDATA%\Programs\devn` (falling back to `AppData\Local\Programs\devn`
under your user directory), and adds that directory to your user PATH. No administrator
rights, Bun or Node.js are needed. Re-run the same command to upgrade; profiles and
tool history are preserved. Clients must still be installed separately.
When using the outer `powershell -c` command, close and reopen your terminal application,
then run `devn --version`. If another devn installation takes precedence, adjust PATH
or use the installed EXE's full path. Close running devn processes before upgrading.

The installer endpoint becomes available with the first stable release containing this
feature. For earlier releases or a specific version, download
`devn-vX.Y.Z-windows-x64.zip` from GitHub Releases, verify its SHA-256 checksum,
extract it, and add the directory containing `devn.exe` to PATH.
npm/Bun installations still require Bun;
`npm install -g @tsangpo/devn` installs the `devn` command for PowerShell and cmd.

Windows supports native client EXEs and official npm installations of Codex/Claude/OpenCode.
JavaScript client entries require Node.js; native entries do not. Custom cmd/bat/ps1
wrappers are not executed. Use an official installation when an entry cannot be resolved.
Scoop, winget and Windows ARM64 are not supported.

Install globally with Bun to use the `devn` command directly:

```sh
bun i -g @tsangpo/devn
devn --version
devn profile add
```

Alternatively, run the npm package with `bunx`:

    bunx @tsangpo/devn --version
    bunx @tsangpo/devn profile add
    bunx @tsangpo/devn profile use customer-a
    bunx @tsangpo/devn codex
    bunx @tsangpo/devn claude
    bunx @tsangpo/devn opencode

To run from source, get https://github.com/tsangpo/devn and run:

    bun bin/devn --help

On Linux/macOS, you can also add /absolute/path/to/devn/bin to PATH. Commands run in the caller's project
directory. Use a version-qualified package (for example bunx @tsangpo/devn@0.1.1) when
you need to pin the CLI version.

Windows stores configuration and tool data in `%LOCALAPPDATA%\devn` (falling back
to `AppData\Local\devn` under the user directory). `XDG_CONFIG_HOME` overrides
this root on all platforms. Existing directories are not migrated automatically.
Windows protects managed files and directories with ACLs granting only the current
user and SYSTEM; failure to apply permissions stops the operation. Profile management
runs in a normal, non-elevated terminal and does not require administrator privileges.
Windows device names and profile names differing only in case cannot be registered together.

## Profiles

    devn profile add
    devn profile list
    devn profile show customer-a
    devn profile use customer-a
    devn profile remove customer-a
    devn profile remove customer-a --purge

Add asks for a **Profile JSON URL**, then a local name, then a hidden gateway key.
The name prompt always appears. A valid JSON filename supplies the default:
`customer-a.json` shows `Profile name [customer-a]: `. Press Enter to accept it
or type another name. Query parameters are ignored; the filename is URL-decoded
and its `.json` suffix is removed (case-insensitively). If it cannot supply a valid
local name, no default is shown and you must enter one.
After the name and any update confirmation, devn downloads and validates the
profile before asking for the key. If the profile includes `authUrl`, it displays
the full URL so you can open it to obtain a key. Terminals that recognize URLs
can make it clickable; otherwise copy it into your browser. Then paste the key
into the hidden prompt. devn does not open the browser or fetch the key for you.
The URL points to a configuration document, not a model API. The download does not
send your key. You must explicitly approve the displayed client gateway
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

Optional top-level `authUrl` (for example, `"authUrl": "https://gateway.example.com/keys"`)
points to a page for obtaining a key. Paths and query parameters are allowed.
It requires HTTPS (loopback HTTP is allowed), without credentials, fragments,
or control characters. Omit it to keep the usual key prompt without a link.

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

For Codex and Claude, if models are omitted, clients keep native defaults, menus and saved model choices.
Map the model IDs sent by the clients to actual backends in Bifrost. Optional
central model menus are documented by profiles/example.json; replace its values
and remove example: true before hosting it. Repository examples are never
automatically registered. Model metadata must match backend capabilities.

The example lists three OpenAI models for Codex, Claude Opus/Sonnet 5.5 for Claude,
and all six gateway models (including Gemini 3.8 Flash) for OpenCode. Defaults
are GPT 6.1 Sol for Codex/OpenCode and `opusplan` for Claude. IDs and token
limits follow the supplied gateway catalog; OpenCode costs convert its per-token
rates to [per-million-token pricing](https://opencode.ai/v2/docs/providers).
Optional capability fields use native client defaults, including text/image
input and OpenCode tool support. Codex declares the freeform patch tool. The catalog does not establish actual tool, modality or
reasoning support; verify these defaults before publishing. Optional `name` is
omitted; replace or remove the example `authUrl`. Web-search prices are omitted
because the profile schema has no corresponding cost field.

Before using the example Codex catalog, supply `base_instructions` or
`model_messages.instructions_template` for every model, matching your native
client and backend. The example omits these instructions; the tested Codex client
rejects a catalog without them. devn passes native catalog fields through unchanged.
See [CONTRIBUTING.md](CONTRIBUTING.md#compatibility) for tested client versions.

For a central Codex menu, `codex.model` selects the default and `codex.models`
contains native catalog objects (`slug`, `display_name`, `description`, and
capability fields). devn writes `{ "models": [...] }` without adding or changing
model fields, including `priority`, `visibility`, and `supported_in_api`.
For Claude, use `claude.model` and native `claude.modelPicker` with
`replaceBuiltInOptions: true` and `options` containing `model`, `label`, optional
`description` and `behavesAs`. The picker is copied unchanged; optional `slots`
still map `opus`, `sonnet`, and `haiku` to the corresponding environment variables.
When using `opusplan`, explicitly map all three slots to gateway model IDs:
the example uses Opus 5.5 for planning and Sonnet 5.5 for execution, with Sonnet
also serving the Haiku slot because the supplied catalog has no Haiku model.
Without slots, devn uses `claude.model` for every slot, so `opusplan` would be sent
as a literal gateway model ID and Claude could warn about an unknown model.
Saved model choices are retained while listed; otherwise the manifest default is used.

Migration from the previous model format: rename `defaultModel` to `model`;
flatten Codex `metadata` into each model, rename `id`/`name` to
`slug`/`display_name`, and explicitly include catalog display fields. Move Claude
`models` to `modelPicker.options`, renaming `id`/`name` to `model`/`label`.
Update the hosted manifest and CLI together. Legacy model definitions are rejected;
URL-only profiles are unchanged. Remote manifests cannot supply arbitrary Claude
settings such as keys, hooks, or permissions.

## OpenCode v2

Install the official `@opencode/cli` client separately (any v2 release).
devn checks `opencode` first, then `opencode2` if no supported version is available.
It does not install, upgrade, or migrate OpenCode. Windows supports the official
npm package and native EXE.

Add an optional `opencode` section to your existing version-1 remote profile:

```json
"opencode": {
  "model": "coding",
  "models": {
    "coding": {
      "modelID": "openai/your-chat-model",
      "name": "Coding model",
      "capabilities": { "tools": true, "input": ["text"], "output": ["text"] },
      "limit": { "context": 128000, "output": 16000 }
    }
  }
}
```

`model` must name a key in the nonempty `models` map. Model entries accept the
native v2 fields `name`, `modelID`, `family`, `capabilities`, `limit`, and `cost`
(`input`, `output`, optional `cache.read`/`cache.write`). Other fields, including
provider packages, connection settings, headers, credentials, and configuration
substitutions, are rejected. Without `modelID`, the map key is the upstream ID.
Use actual backend capabilities rather than the example's placeholder values.

The fixed `bifrost` provider uses the OpenAI-compatible Responses API, sending
requests to `<baseUrl>/openai/v1/responses`. Optional `opencode.baseUrl` supplies
the API base URL (for example, `https://gateway.example/v1`); do not append
`/responses`, since the provider adds it. The gateway must support Responses
requests and streaming events; Chat Completions-only gateways are incompatible.
Existing managed OpenCode configurations switch providers on the next launch.
This does not inherit `codex.baseUrl` or the Codex model catalog. After adding
OpenCode to a previously registered profile, run `devn profile add` again to
approve its gateway origin. Old profiles still work with Codex and Claude.
Upgrade devn to 0.5.0 or later before publishing the new field; older releases reject it.

```sh
devn opencode
devn opencode run --model bifrost/coding "Explain this project"
devn opencode mini
devn opencode models
```

`models` lists the approved profile catalog directly, avoiding v2's early empty
snapshot when a private server is still loading plugins. The root TUI accepts
`--model bifrost/<key>` through devn; `run` and `mini` receive the native flag.
Saved `model` values in the generated config are retained while listed, otherwise
they fall back to the profile default.

OpenCode runs with a private server and separate configuration, sessions, cache,
state and temporary files under `profiles/<name>/opencode/`. HOME is unchanged;
XDG and temporary-directory overrides apply to the child and its subprocesses.
`opencode.json`, `service.json` and managed provider policy are regenerated.
Put personal agents, skills, MCP and server plugins in this profile directory;
put terminal preferences in its `cli.json`. Unrelated JSON settings are preserved.
If `cli.json` is missing, devn creates it with the v2 CLI schema and the `system`
theme. Existing `cli.json` files are left unchanged.
Use `opencode.json`, not an adjacent `opencode.jsonc` that could override it.

Project OpenCode configuration and automatic project instruction discovery are
disabled, as is compatibility loading of global Claude/agents skills. Since v2
has separate client plugin discovery, TUI/plugin commands refuse nonempty
ancestor `.opencode/plugins` directories; move those plugins into the profile.
This is configuration separation, not a sandbox against user-installed plugins.

Supported commands: the TUI, `run`, `mini`, `models`, `session`, `stats`, `debug`,
`acp`, `mcp`, `plugin`, and `reload`. `mcp add` writes to the profile global config.
Run devn from the bound project: directory overrides, external servers, shared
service commands, `serve`, `pair`, `auth`, `api`, upgrades and uninstallation are
not forwarded. Use `devn profile add` to rotate the gateway key. Removing a profile
scrubs its generated key while retaining sessions; `--purge` deletes all its data.

Configuration references: [v2 providers](https://opencode.ai/v2/docs/providers),
[private servers](https://opencode.ai/v2/docs/cli),
[provider policies](https://opencode.ai/v2/docs/policies).

## Local data

Configuration uses ${XDG_CONFIG_HOME:-~/.config}/devn:

    config.toml
    profiles/
      customer-a/
        profile.json
        codex/          # CODEX_HOME
        claude/         # CLAUDE_CONFIG_DIR
        opencode/       # OPENCODE_CONFIG_DIR; isolated data/cache/state below it

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
experimental_bearer_token, Claude uses ANTHROPIC_AUTH_TOKEN, and OpenCode uses
providers.bifrost.settings.apiKey.

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
It validates the npm package and five native binaries, publishes npm and GitHub
Release assets, tests Homebrew installation, then updates `tsangpo/homebrew-tap`.
npm publishing uses Trusted Publishing (OIDC), without an npm token. See
[release setup](CONTRIBUTING.md#release-setup) before pushing a tag.

To build and test the current platform locally:

    bun run build:binary
    bun run test:binary

Generated executables and archives are in the ignored release/ directory.

## License

MIT — Copyright (c) 2026 tsangpo. See [LICENSE](LICENSE).
