# Changelog

Changes are recorded here before each npm release.

## Unreleased

## 0.8.2 — 2026-10-07
- Run each test file in an isolated Bun process so shared temporary configuration cannot race on CI.

## 0.8.1 — 2026-10-07
- Run the shared test suite serially to prevent temporary configuration races on macOS CI.

## 0.8.0 — 2026-10-07

- Restore macOS/Linux standalone binaries and Homebrew publication; Windows releases use Bun/npm only.
- Make `devn codex`, `devn claude`, and `devn opencode` silent for devn status and fallback notices while preserving client output and errors.

## 0.7.0 — 2026-10-06

- Use an opaque instance resource URL (example `/api/instances/UUID`) returning only `{key}`. Remove user/subject dependence; bind cache reuse to each profile session, clear old credentials before reauthorization or rebinding, and check revision again at add commit. Ignore optional response fields; no value fallback, budget or migration.

- Centralize local credential updates and cleanup locking in store, keep OAuth invalidation policy in lifecycle, and move generic profile lookup out of project binding resolution. Remove the process forwarding module; launch calls the platform facade directly.

- Consolidate generated tool configuration and credential cleanup in `config.ts`; keep launch validation, locking and profile-directory removal in `store.ts`. Remove `profile-data.ts` without changing cleanup behavior.

- Retain the existing refresh token when a refresh response omits it. Distinguish resource failures and refresh-grant rejection from generic discovery/token/device errors, preserving current-session cached credentials on unrelated refresh failures; fresh authorization clears old credentials first. Startup still never claims a missing key.
- Repair malformed generated configs during approved add/re-add and key rotation, warning about lost settings while preserving separate histories. Scrub old generated credentials before committing rotated keys; abort on filesystem cleanup failure.

- Inline local profile fields into `LocalConfig`, removing the separate Registration type and duplicate local display name.
- Remove the Registry concept: profile validation lives in `profile.ts`, while `LocalConfig` and config read/write operations describe local storage directly. Preserve the file format and locking behavior.

- Add optional OAuth through `profile add`: desktop PKCE S256 with a random loopback callback and SSH/headless device flow. Re-add reuses the profile's valid session or renews rejected authorization within one attempt. No public login/logout commands; `--auth auto|browser|device|manual` selects authentication after approval.
- Give every profile an independent random session ID and private rotating tokens, even for identical bindings. Treat resource as the complete opaque key URL; GET directly, POST only on add/re-add after `404 key_missing`, read only `{key}` from the response, and never request `/me`. Remove auth.instanceId. Invalidation, removal, rebinding and failed registration affect only the owning session; preserve Bifrost keys, history and bindings.
- Accept only local config v3, rejecting older versions without compatibility or migration. Remote profiles remain v1 with optional OAuth; manual authUrl retains its meaning. Old shared tokens are not reused. Upgrade the CLI before publishing auth. No new runtime dependencies.

## 0.6.0 — 2026-10-02

- **Breaking:** switch OpenCode to the OpenAI-compatible Responses API instead of Chat Completions. Gateways must serve `<baseUrl>/openai/v1/responses`, or `/responses` under the configured `opencode.baseUrl`. Keep custom base URLs without the `/responses` suffix; existing managed providers switch on the next launch. Chat Completions-only gateways must add Responses support before upgrading.

## 0.5.1 — 2026-10-02

- Fix Windows profile writes failing with `SeSecurityPrivilege` errors in non-elevated sessions when reapplying private directory ACLs.

## 0.5.0 — 2026-10-02

- Add `devn opencode` for OpenCode v2, with an optional native model catalog, approved Bifrost origin, private server and profile-local configuration/session storage on Linux, macOS and Windows. Existing profile v1 data remains compatible. Upgrade devn to 0.5.0 before publishing an `opencode` section; older releases reject it. Re-run `profile add` to approve the added gateway.
- Add a Windows PowerShell installer for standalone installation and upgrades, including checksum verification, user PATH setup and failure rollback.
- Group client validation, configuration, isolation and credential cleanup into small modules with a static supported-client table. Preserve existing commands and configuration paths; pass official package metadata through the platform facade for future CLI integrations.
- Initialize missing profile-local OpenCode `cli.json` files with the v2 schema and system theme, preserving existing files.
- Refresh the example gateway catalog and Claude `opusplan` slot routing. Document that administrators must supply native Codex model instructions before using the example catalog; devn does not synthesize them.
- Keep native Codex protocol smoke coverage independent of the example catalog, and add credential-cleanup and trusted-origin regressions.

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
