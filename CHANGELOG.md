# Changelog

Changes are recorded here before each npm release.

## 0.1.0 — Unreleased

- Provide the devn CLI and npm package, with `.devn.json` project bindings and
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
