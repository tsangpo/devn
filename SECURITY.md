# Security policy

## Reporting a vulnerability

Report privately at:
https://github.com/tsangpo/devn/security/advisories/new

The repository owner must enable GitHub private vulnerability reporting before
this channel is available. If it is unavailable, contact the maintainer through
https://github.com/tsangpo to arrange a private channel. Do not publish credentials,
customer profiles, prompts, source code, or exploit details in public issues.

Include the devn version, operating system, a minimal reproduction with dummy
credentials, impact, and any suggested fix. There is no guaranteed response SLA.
Security fixes target the latest released version; no older release branch has
a promised backport policy.

## Trust and data

- Remote profile JSON is fetched without the user's gateway key. Download URLs
  and gateway URLs require HTTPS, except literal loopback HTTP for local testing.
  Redirects are bounded and HTTPS cannot downgrade to HTTP.
- Profile responses are limited to 1 MiB after decompression and a 10-second
  request timeout. Invalid definitions, oversized responses and unsafe redirects
  do not replace the cached definition.
- Adding a profile displays gateway origins and requires explicit approval.
  Refreshes cannot change an approved origin. Re-run "profile add" to review
  changes, including scheme or port changes. Older registrations lacking approval
  must be added again. Paths within an approved origin may change automatically.
- Trusting a profile also trusts its administrator's model and routing updates.
  Origin pinning cannot protect a compromised gateway at the same origin.
- Keys are plaintext in local config.toml and generated tool configuration, with
  mode 0600 and directories 0700 on POSIX. Windows applies a protected DACL
  granting only the current user and SYSTEM, removing inherited and unrelated
  explicit grants. Managed directories and temporary files are protected before
  writing secrets; ACL failures stop the operation. Windows PowerShell must be
  available and the filesystem must support ACLs. This is access control, not
  encryption, and does not protect against privileged administrators.
  devn does not send analytics, but the launched clients have their own behavior.
- Profile separation is not OS isolation. Agents run as your user and can access
  files available to that user. This is not a sandbox for untrusted projects.
- "profile remove" removes registration and the credentials devn writes to tool
  configs. It cannot scrub secrets from arbitrary histories, backups, other
  credentials, or running processes. Stop active sessions first.
- "profile remove NAME --purge" also deletes that profile's tool data and history.
  Revoke the gateway key separately when needed.
- Local files and environment variables are trusted user inputs. Do not run devn
  with elevated privileges or point its config directory into an untrusted project.

## Repository controls

Before public release, maintainers should enable private vulnerability reporting,
secret scanning / push protection, and branch rules requiring CI and review.
These are GitHub account settings; repository files alone do not enable them.

"bun run check:secrets" checks known token/private-key patterns in working files
and reachable Git history. It does not recognize every provider's keys or private
customer information. Review the actual npm tarball and documentation manually.
If a real credential was exposed, revoke/rotate it; deleting the file is not enough.
