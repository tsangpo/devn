# Repository guidance

Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, supported client baselines,
platform boundaries and release procedures. [SECURITY.md](SECURITY.md) defines
the trust and credential lifecycle contracts. Keep version numbers and release
instructions there rather than duplicating them here.

## Integrating native clients

- Check the upstream release tag and published package matching the tested
  binary. Default-branch code, older documentation and guessed package names
  may describe a different configuration schema or executable layout.
- Run a real-client smoke test early, using a local gateway and dummy credentials.
  Mocked process launches and generated JSON assertions cannot establish that
  the native client loads the provider or sends the expected protocol and auth.
- Distinguish configuration errors from asynchronous initialization. OpenCode v2
  can return an empty model snapshot before plugins settle. Inspect effective
  config and use bounded readiness polling in tests before diagnosing failure;
  do not add arbitrary production sleeps. See
  [the native OpenCode test](test/native/opencode-smoke.test.ts).
- Check flags per command, including the default TUI. Do not assume a flag
  supported by `run` is accepted by the TUI. Preserve option operands and `--`
  boundaries when validating forwarded arguments.
- Resolve Windows executables from the official package's actual bin metadata
  while preserving containment checks. Do not execute shell shims or guess a
  JavaScript entry point for a package that ships native binaries.

## Isolation and remote configuration

- A config directory alone does not isolate a client. Audit inherited environment
  overrides, shared services, databases, data/cache/state/temp directories,
  project discovery, plugins and compatibility loaders. Even version probes
  can initialize files: run them with the isolated environment. Preserve the
  user's real home directory unless a documented client requirement demands it.
- Verify separate discovery paths. OpenCode's project-config switch does not
  by itself disable TUI plugin discovery or compatibility skill loaders.
  Profile separation is not an OS sandbox.
- Treat remote profiles as data, using an explicit allowlist of fields. Native
  config loaders can expand `{env:...}` and `{file:...}` before validation, even
  inside display labels. Reject such templates wherever remote values enter
  generated OpenCode config, including fallback URLs from the profile root.
- Replace the complete devn-owned provider subtree when regenerating config so
  obsolete credentials, headers and models cannot survive a deep merge.
  Preserve unrelated personal settings and validate retained model selections.
- Exercise the full lifecycle: adding a tool to an existing profile requires
  explicit gateway approval, refresh cannot silently change approved origins,
  invalid updates preserve the cache, key rotation updates generated config,
  removal scrubs managed credentials, and purge removes profile data.
- Keep existing profiles compatible when adding optional tool sections. Strict
  older clients may reject new fields, so document the required CLI upgrade
  before administrators publish an expanded remote profile.

## Architecture and verification

- Keep runtime platform selection in `src/platform/index.ts`; business modules
  use the facade. Platform adapters must not perform work at import time. Follow
  the existing small client modules rather than introducing a plugin framework.
- Run `bun run check` for behavior changes. For client integration changes, also
  run the affected real-client test; the complete `bun run test:native` requires
  all supported clients to be installed. Use dummy keys and loopback gateways.
- Validate standalone delivery with `bun run build:binary` followed by
  `bun run test:binary`; source execution alone does not verify packaging.
- Report exactly which native clients and operating systems were exercised.
  POSIX mocks of Windows behavior do not establish Windows runtime support.
  Bun execution is not a static TypeScript type check.
- Update both READMEs, the changelog and the example profile when public behavior
  changes. Run `bun run check:secrets` before release, but also inspect artifacts:
  its known-pattern scan does not prove the absence of every secret.
