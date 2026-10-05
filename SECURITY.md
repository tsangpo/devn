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

## Platform OAuth sessions

OAuth is opt-in through a reviewed four-field `auth` binding: type, issuer,
clientId and resource. Before authentication, devn displays the exact issuer,
public client ID, complete resource URL and gateway origins. Local config v3 pins
these values and caches the key subject. Re-add to approve binding changes.
Manual registrations never silently adopt OAuth. Old config versions are
rejected without rewriting or migration; old shared tokens are never reused.
Public profile downloads contain no platform or gateway credentials.

RFC 8414 discovery uses the issuer origin plus
`/.well-known/oauth-authorization-server` plus the issuer path. The returned
issuer must match exactly and every OAuth endpoint must share its origin.
Secret-bearing requests refuse redirects. The public native client has no secret.
Browser login uses PKCE S256 and random state, validates state and `iss`, and
receives only a code at a random `127.0.0.1` port's `/callback`. Device polling
uses the advertised interval, adds five seconds on `slow_down`, and stops on
denial, expiry or cancellation. Both grants use the advertised token endpoint
and explicit resource and scopes.

The resource is a complete opaque key URL on the issuer origin. devn GETs that
exact URL, including its query, without parsing the path or requesting `/me`.
Only add/re-add may POST after `404 key_missing`. The client depends only on
`value` and `user.id` in successful key responses: the first establishes subject,
and subsequent responses must match. Response instanceId is not interpreted.

Every local profile owns a random persistent session UUID, even for identical
auth bindings. Tokens live only in private `oauth/<session-id>.json` files;
the stored ID and binding must match. Files use POSIX 0600/0700 and Windows ACLs
as described above, not encryption. Platform tokens never reach tools or Bifrost.
Cross-process session locks serialize refresh and atomic writes; browser/device
waits hold no lock. Cleanup leaves a token-free revision marker to reject late
callbacks. Rotated refresh tokens are saved before the next network request. A refresh
response that omits refresh_token retains the previous token; initial
authorization still requires one, and explicitly malformed tokens are rejected.

Re-add reuses only that profile's valid session; invalid_grant or persistent 401
clears it before fresh authorization in the same attempt. Permission denials and
network failures do not trigger interactive retries. Startup only synchronizes
existing keys. Network/timeout/5xx failures may use the profile's same-subject
cached key. Refresh-grant invalid_grant, resource 403/404, malformed sessions and subject
mismatches persistently clear its cached/generated credentials and prohibit
fallback. Session corruption, invalid grants and account disabling also clear
its tokens. Generic discovery/token/device endpoint 401/403/404 failures stop
the operation without erasing cached credentials or allowing offline fallback.
A failed fresh authorization grant does not invalidate a previously cached key;
explicit account_disabled still invalidates credentials. One resource 401 permits at most one refresh and retry. No failure clears
another profile's credentials, including profiles using the same resource.

There are no public login/logout commands. Removal, rebinding and switching to
manual retire only the owning session; failed registration discards its new
session. Refresh-token revocation failure still clears local tokens and reports
unconfirmed remote revocation. Multiple session locks are acquired in ID order,
before profile and config locks. Revocation holds no profile or config lock.
Default removal preserves bindings and tool history; --purge deletes profile
data. Cleanup never deletes Bifrost keys. Stop running clients first: devn cannot
remove credentials from their memory. If generated config is malformed during
credential invalidation, approved add/re-add or key rotation, devn deletes that
config instead of retaining old credentials or secret-containing backups. This
also loses personal settings in the malformed file, with a warning; separate
histories remain. Rotation scrubs generated credentials before committing the new
local key; a filesystem cleanup failure aborts without committing it. Normal
remove still refuses malformed configs unless --purge is requested.
