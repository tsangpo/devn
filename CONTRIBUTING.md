# Contributing

Repository: https://github.com/tsangpo/devn

Use Bun 1.4.2 or newer on Linux or macOS. Keep runtime and development package
dependencies empty. TypeScript runs directly for npm/source users. Standalone
binaries are built only for distribution and tests, in the ignored release/
directory. There is no dist directory.

    bun run check
    bun run check:secrets
    bun run test:native
    bun run build:binary
    bun run test:binary

The native smoke command requires installed Codex and Claude Code; it uses dummy keys
and a local gateway. Never use customer credentials in tests or issue reports.
Bun transpiles TypeScript without static type-checking.

Keep changes focused. Explain the behavior change and validation in your PR.
Update CHANGELOG.md and both READMEs for user-visible changes. Contributions
are made under the project's MIT license; submit only material you can license.

## Compatibility

The CLI supports Linux/macOS and Bun >=1.4.2. Native smoke was tested locally
with Codex 0.159.2 and Claude Code 2.1.285. Other versions are not guaranteed;
run smoke tests when updating either client. CI tests fake clients on Linux and
macOS and validates npm packages and standalone executables. Release jobs test
all four supported OS/CPU combinations. CI does not install real AI clients.
The binary CI baseline is macOS 15 and Ubuntu 24.04 (glibc); Windows and musl
are not distributed. No Apple Developer ID signing or notarization is provided.

Package versions follow semantic versioning. Before 1.0, breaking behavior
changes require a minor bump and migration notes. Local TOML, remote JSON, and
project bindings declare version 1; unsupported versions fail instead of being
silently interpreted. New required schema changes need migration documentation.

## Release setup

The source must be pushed to the public `tsangpo/devn` repository. Confirm that
your npm account can publish the `devn` package before the first tag. Runtime
users need neither GitHub credentials nor access to the tap repository.

1. For the first npm release, create a short-lived granular npm token with package
   creation/publish rights and the required CI/2FA bypass. Store it as the GitHub
   Actions secret `NPM_TOKEN` in `tsangpo/devn`. Never commit it.
2. Create a fine-grained GitHub token restricted to `tsangpo/homebrew-tap`, with
   Contents read/write. Store it in the source repository as `GH_PAT`.
   The tap's main branch must permit that identity to commit `Formula/devn.rb`.
   No Workflow or other-repository write permissions are needed.
3. After the first successful npm publication, configure a GitHub Actions Trusted
   Publisher in the npm package settings: owner `tsangpo`, repository `devn`,
   workflow `release.yml`, no environment name. Explicitly allow `npm publish`
   (stage-only permission is insufficient). Delete `NPM_TOKEN` from GitHub and
   revoke the token. Later releases use OIDC with provenance.

Only the publisher uses Node 24/npm 11.16.0; development, tests and builds use
Bun 1.4.2. No npm dependencies are installed into the project. See the
[npm trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).

## Publishing a release

1. Update package.json version and CHANGELOG.md; only stable X.Y.Z versions are
   supported. Run checks, native smoke, and local binary tests.
2. Review the package contents and sensitive information, then commit and push.
3. Create and push the matching tag, for example:

       git tag v0.1.0
       git push origin v0.1.0

The Release workflow validates the version before building. It packs npm once,
installs that same tarball on four runners, builds and tests macOS/Linux arm64/x64
binaries, and verifies SHA-256 checksums for every archive. It then stages a
GitHub draft Release, publishes the verified npm tarball, and publishes the
Release. Homebrew installs/tests the released binaries on all four platforms
before the workflow commits the generated Formula to the tap.

Release assets include `devn.tgz`, `devn-vX.Y.Z-<os>-<arch>.tar.gz`, per-archive
`.sha256` files and `SHA256SUMS`. OS names are `darwin` and `linux`; architectures
are `arm64` and `x64`. Each binary archive contains `devn` and `LICENSE`.

Generated files stay in release/; they are not committed. npm continues to ship
TypeScript with its Bun shebang and no install scripts or downloaded binaries.
Homebrew downloads a binary from the source repository's Release, checks SHA-256,
and installs it without Bun. The CLI never updates itself.

## Failed releases and retries

Re-run **failed jobs**, retaining the original artifacts (available for 30 days).
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
