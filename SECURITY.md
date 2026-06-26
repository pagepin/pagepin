# Security Policy

## Supported versions

pagepin is pre-1.0 and ships security fixes against the latest release only. Fixes
land on `main` and in the next tagged release and `ghcr.io/pagepin/pagepin` image.

| Version       | Supported |
| ------------- | --------- |
| latest `0.x`  | ✅        |
| older `0.x`   | ❌        |

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue, pull
request, or discussion for a vulnerability.

- Preferred: open a private report via GitHub Security Advisories —
  **[Report a vulnerability](https://github.com/pagepin/pagepin/security/advisories/new)**
  (the repository's *Security → Advisories* tab; requires GitHub "Private
  vulnerability reporting" to be enabled on the repo).

When reporting, please include:

- affected version / commit and deploy target (self-hosted Node, Docker, or
  Cloudflare Workers),
- a description of the issue and its impact, and
- the minimal steps or proof-of-concept to reproduce.

We aim to acknowledge reports within a few days and to keep you updated while we
investigate and prepare a fix. Reporters who want credit will be acknowledged when
the fix is released.

## Scope & known security model

Some behaviors are intentional trade-offs rather than vulnerabilities — please
review these before reporting:

- **Single-domain mode co-hosts content with the console.** Hosted pages share the
  browser origin with the console/API, so a malicious uploaded page can act with a
  logged-in viewer's session (including reading that user's API tokens). Only allow
  trusted users to deploy in single-domain mode; use **dual-domain mode** to isolate
  untrusted content on a separate origin. (See the README "Security note".)
- **"Private" means any logged-in user on the instance.** There is no per-site
  reviewer allowlist — anyone with an account on the instance can open a private
  site by its handle/slug. Do not enable open registration on an instance that hosts
  confidential content.
- **Personal Access Tokens are retrievable from the console.** Tokens are stored so
  their owner can re-read them later; protect database backups accordingly.

Reports that only restate the above without a new exploit may be closed as
"by design" — but ideas for hardening these areas are always welcome.
