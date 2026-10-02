# Changelog

Changes are recorded here before each npm release.

## Unreleased

- Simplify the example profile by using native defaults for optional capabilities and omitting optional display/key-page metadata, while retaining gateway models, limits, pricing and Claude slot routing.

- Initialize missing profile-local OpenCode `cli.json` files with the v2 CLI schema and `system` theme, preserving existing files.

- Map the example's Claude `opusplan` slots to gateway model IDs so planning uses Opus and execution uses Sonnet, instead of sending the mode name to the gateway.

- Update the example profile with the seven supplied gateway models, client-specific defaults, token limits and OpenCode pricing per million tokens.

- Add `devn opencode` for any OpenCode v2 release, with an optional native model catalog, approved Bifrost origin, private server and profile-local configuration/session storage on Linux, macOS and Windows. Preserve old profiles and scrub generated OpenCode credentials on removal.

- Add a Windows PowerShell installer for standalone devn installation and upgrades, with SHA-256 verification, user PATH setup, failure rollback, and versioned GitHub Release assets.

## 0.4.1 — 2026-10-01

- Add Windows x64 npm/Bun and standalone EXE support, with local configuration under LOCALAPPDATA and explicit private ACLs.
- Isolate Windows runtime, build helpers, and integration tests behind platform adapters.
- Use the native Windows shell for release validation so archive paths with drive letters work correctly.

Version 0.4.0 was not published because Windows release validation failed.

## 0.3.1 — 2026-09-30

- Ask for the URL before the local name in `profile add`, offering a valid name derived from the JSON filename as the default.

## 0.3.0 — 2026-09-30

- **Breaking:** project bindings move from `.devn.json` to the `[projects]` table in `~/.config/devn/config.toml`. `.devn.json` is no longer read; run `devn profile use` again in each project.
- Add `devn profile unbind`.

## 0.2.1 — 2026-09-30

- Allow Codex reasoning and verbosity config overrides while still blocking connection and model selection overrides.
- Switch npm publishing to GitHub OIDC only; remove the legacy npm token injection.

## 0.2.0 — 2026-09-30

- Change central model definitions to native Codex catalog entries and Claude `modelPicker`, with `model` as the default-model field. Legacy model manifests must be migrated; URL-only profiles are unchanged.
- Disable Codex built-in web search by default for gateway profiles, preserving explicit user settings.

## 0.1.1 — 2026-09-30

- Publish the `@tsangpo/devn` npm package with the `devn` command, with `.devn.json` project bindings and
  configuration under `${XDG_CONFIG_HOME:-~/.config}/devn`.
- Run Codex and Claude Code with project-selected Bifrost profiles.
- Add local registrations from remote JSON, with private configuration permissions.
- Require HTTPS except for loopback; explicitly approve gateway origins.
- Refresh profiles with bounded downloads, safe redirects, per-profile locks and offline cache fallback.
- Show redacted profile details, remove credentials, and optionally purge tool history.
- Disable terminal echo before displaying the password prompt to prevent fast-input key exposure.
- Provide version reporting and a zero-dependency Bun executable entry.
- Automatically publish verified npm tarballs on stable version tags; support npm OIDC after the first release.
- Build standalone macOS/Linux arm64/x64 binaries with checksums and update the Homebrew tap after installation tests.
- Keep npm source execution build-free and disable project runtime autoloading in standalone binaries.

Before upgrading an earlier development checkout, run "devn profile add" again
to approve gateway origins. Registrations without trusted origins cannot launch
tools. Existing tool history is retained. Non-loopback HTTP services must move
to HTTPS. Version-1 profile JSON and project binding formats remain supported.

The initial 0.1.0 release attempt was not published: npm rejected the unscoped
package name. Version 0.1.1 uses the scoped package without changing CLI or
configuration names.
