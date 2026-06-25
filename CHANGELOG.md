# Changelog

All notable changes to pagepin are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] — 2026-06-25

### Fixed

- Docker image crashed on startup with `Can't find meta/_journal.json` — the
  `drizzle/` migrations directory wasn't bundled into the image, so libSQL's
  boot-time auto-migration had nothing to read. The runtime stage now
  `COPY drizzle/`. Verified by building and running the image. If you pulled
  `0.2.0`, use `0.2.1` (or `:latest`).

## [0.2.0] — 2026-06-25

First release since 0.1.0. It also makes the Docker image buildable again — it
had been stale because the build was broken after the skill restructure.

### Added

- Auth overhaul: Google/GitHub social login and OIDC alongside email/password;
  email verification via a pluggable mailer (Resend); an identities +
  canonical-email account model (no silent email merge); connected-accounts
  management; and content-domain (`pagepin.page`) social login.
- Installable Agent Skill + Claude Code plugin
  (`npx skills add pagepin/pagepin -g`).
- Admin: one-click "Verify email" in the user list.
- `GET /references/api.md` served over HTTP, so the agent guide's API reference
  resolves even without a local skill install.
- `free_user_mb` (per-user storage quota) exposed in `GET /api/me` limits.
- Architecture diagram in the README (`docs/architecture.svg`).

### Changed

- README (EN/ZH) configuration tables synced with `src/config.ts`; documented
  the registration-mode, social-login (`PAGEPIN_OAUTH_*`), mail
  (`PAGEPIN_MAIL_*`), and `PAGEPIN_DEVICE_TOKEN_TTL_DAYS` env vars.
- Marketing site leads agent onboarding with the skill install; the `/skill.md`
  fetch is demoted to the explicit no-install fallback.
- Notification email sent from `notifications@` instead of `no-reply@`.

### Fixed

- **The Docker image builds again.** The runtime stage now bundles `skills/`,
  and the build stage runs `pnpm gen:assets` before `tsup` (`serving.ts` imports
  the generated edge-assets). This was the root cause of the stale image.
- Console connected-accounts ordering — password (the account anchor) is pinned
  first.
- Removed a dead `/skill.md` placeholder substitution.
- Corrected stale README defaults (`PAGEPIN_MAX_SITE_MB`, `PAGEPIN_FREE_USER_MB`)
  and brought the EN/ZH tables to parity.

## [0.1.0]

Initial release: self-hosted static-page hosting with pin-point review comments
and the agent deploy → review → fix loop. One Hono app on two runtimes (Node and
Cloudflare Workers) by dependency injection; pluggable storage (FS / S3 / R2) and
auth (password / OIDC / none); atomic versioned deploys with rollback.

[0.2.1]: https://github.com/pagepin/pagepin/releases/tag/v0.2.1
[0.2.0]: https://github.com/pagepin/pagepin/releases/tag/v0.2.0
[0.1.0]: https://github.com/pagepin/pagepin/releases/tag/v0.1.0
