# Contributing

Repository: https://github.com/tsangpo/devn

Use Bun 1.4.2 or newer on Linux, macOS, or Windows x64. Keep runtime and development package
dependencies empty. TypeScript runs directly for npm/source users. Standalone
binaries are built only for distribution and tests, in the ignored release/
directory. There is no dist directory.

    bun run check
    bun run check:secrets
    bun run test:native
    bun run build:binary
    bun run test:binary
    bun run test:windows  # Windows-specific integration tests

The native smoke command requires installed Codex and Claude Code; it uses dummy keys
and a local gateway. Never use customer credentials in tests or issue reports.
Bun transpiles TypeScript without static type-checking.

Keep changes focused. Explain the behavior change and validation in your PR.
Update CHANGELOG.md and both READMEs for user-visible changes. Contributions
are made under the project's MIT license; submit only material you can license.

## Compatibility

The CLI supports Linux/macOS and Windows 11 x64 with Bun >=1.4.2. Native smoke
was tested locally with Codex 0.159.2 and Claude Code 2.1.285; Windows CI installs
Codex 0.159.3 and Claude Code 2.1.286 for local-gateway smoke tests. Other client
versions are not guaranteed; run smoke tests when updating either client.
CI validates npm packages, terminal interaction, and standalone executables.
The binary CI baseline is macOS 15, Ubuntu 24.04 (glibc), and Windows Server 2025
(`windows-2025`). Windows ARM64 and musl are not distributed.
Hosted Linux kernels currently lack Landlock ABI 10, so
Homebrew reports limited network isolation and applies the restrictions the
kernel supports. We retain its sandbox and capability warning. Intel macOS
may also report upstream support-policy notices; its tests remain enabled.
No Apple Developer ID signing, notarization, or Windows Authenticode signing is provided.

Package versions follow semantic versioning. Before 1.0, breaking behavior
changes require a minor bump and migration notes. Local TOML, remote JSON, and
the config.toml (including project bindings) declares version 1; unsupported versions fail instead of being
silently interpreted. New required schema changes need migration documentation.

## Release setup

The source must be pushed to the public `tsangpo/devn` repository. Confirm that
your npm account can publish the `@tsangpo/devn` package before the first tag. Runtime
users need neither GitHub credentials nor access to the tap repository.

1. Configure a GitHub Actions Trusted Publisher for the existing `@tsangpo/devn`
   npm package: owner `tsangpo`, repository `devn`, workflow `release.yml`, no
   environment name. Explicitly allow `npm publish` (stage-only permission is
   insufficient). The workflow uses OIDC and does not inject `NPM_TOKEN` or
   `NODE_AUTH_TOKEN`.
2. Create a fine-grained GitHub token restricted to `tsangpo/homebrew-tap`, with
   Contents read/write. Store it in the source repository as `GH_PAT`.
   The tap's main branch must permit that identity to commit `Formula/devn.rb`.
   No Workflow or other-repository write permissions are needed.
3. After a new version is successfully published without token injection, delete
   the legacy `NPM_TOKEN` GitHub secret and revoke the corresponding npm token.
   Re-running an already published version does not verify OIDC: the publisher
   checks its integrity and skips `npm publish`.

The publisher uses Node 24/npm 11.16.0. Windows CI also uses Node 24 for npm
installation tests and JavaScript client entries. Development and builds use Bun 1.4.2. No npm dependencies are installed into the project. See the
[npm trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).

## Publishing a release

1. Update package.json version and CHANGELOG.md; only stable X.Y.Z versions are
   supported. Run checks, native smoke, and local binary tests.
2. Review the package contents and sensitive information, then commit and push.
3. Create and push the matching tag, for example:

       git tag v0.1.1
       git push origin v0.1.1

The Release workflow validates the version before building. It packs npm once,
installs that same tarball on five runners, builds and tests macOS/Linux arm64/x64
and Windows x64 binaries, and verifies SHA-256 checksums for every archive. It then stages a
GitHub draft Release, publishes the verified npm tarball, and publishes the
Release. Homebrew installs/tests the released binaries on all four platforms
before the workflow commits the generated Formula to the tap.

Release assets include `devn.tgz`, `devn-vX.Y.Z-<os>-<arch>.tar.gz`, per-archive
`.sha256` files and `SHA256SUMS`. OS names are `darwin` and `linux`; architectures
are `arm64` and `x64`. These archives contain `devn` and `LICENSE`. Windows adds
`devn-vX.Y.Z-windows-x64.zip` containing `devn.exe` and `LICENSE`, with the same
checksum and publishing verification.

Generated files stay in release/; they are not committed. npm continues to ship
TypeScript with its Bun shebang and no install scripts or downloaded binaries.
Homebrew downloads a binary from the source repository's Release, checks SHA-256,
and installs it without Bun. The CLI never updates itself.

## Failed releases and retries

Re-run **failed jobs**, retaining the original artifacts (available for 30 days).
If a publishing-script fix is needed, commit it to main and manually dispatch
the Release workflow from main with the original `tag` and `artifact_run_id`.
This recovery path skips builds, verifies the original run belongs to that tag
and passed all configured binary jobs, and reuses its artifacts. The main branch must
still have the same package version. Never move the release tag.
An identical already-published npm tarball is accepted; different contents for
an existing npm version cause failure. Existing Release assets are verified and
never overwritten; missing draft assets may be uploaded on retry. Rebuilding
all jobs can produce different archive bytes and is not a safe retry strategy.

Publishing to npm, GitHub and the tap is not atomic. If npm succeeds but another
step fails, fix the failure and re-run failed jobs; do not unpublish npm or move
the tag. A Homebrew test failure leaves the existing tap Formula unchanged.
The tap update is a normal non-force push, refuses version downgrades, and is a
no-op if its generated Formula is already identical. A changed Formula for the
same version fails rather than silently replacing it. After artifact expiration,
publish a new version if the original verified artifacts cannot be recovered.

Configure repository/tag protections and npm account security in their respective
settings. A checksum detects modified artifacts; it is not a signature.

## Platform boundaries and removing Windows support

Runtime selection lives only in `src/platform/index.ts`. Business modules depend
on that adapter, never on `windows/` directly. POSIX behavior lives in `posix.ts`;
Windows ACL, process and path handling lives in `src/platform/windows/`. Imports
must not launch helpers or mutate configuration. Keep the adapter as ordinary
functions; do not add a plugin registry or dependency injection framework.

Build targets and archive interfaces live in `scripts/platform/index.ts`; ZIP
helpers live in `scripts/platform/windows/`. Windows test fixtures and integration
scenarios live in `test/windows/`, selected by `test/platform.ts`. Shared tests
retain behavior assertions, using platform fixtures for executables, permissions
and links. POSIX signal and executable-symlink tests have Windows equivalents.

To remove Windows support: delete the runtime/build/test Windows directories,
select POSIX directly in the two runtime/test selectors, remove the Windows build
target and ZIP import, remove the Windows Check job and Release matrix/artifact
entries, and remove the Windows test command and documentation. Business modules
need no changes. Keep existing published assets; use the original release revision
and artifacts when recovering a historical Windows release.

Before a release, use the Check workflow's `windows-x64-verified` ZIP and checksum
artifacts for validation. Do not use preview tags or workflow_dispatch as a dry
run: the release workflow publishes stable tags, and dispatch is for recovery.
