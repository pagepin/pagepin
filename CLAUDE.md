# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

pagepin is a self-hosted static-page host with pin-point review comments and an AI feedback loop. The same Hono app runs on two targets — Node (self-hosted) and Cloudflare Workers — by dependency injection, with no platform branching in the core request code.

## Repository layout

Three independent pnpm projects, each installed and locked separately:

- `.` (root) — the Hono server (API + page serving), Drizzle ORM, edge-asset pipeline.
- `console/` — React 19 + Vite SPA (the admin UI). Its own `package.json` / `pnpm-lock.yaml`; root installs do not touch it.
- `e2e/` — self-contained Playwright tests for the injected comment overlay. Stubs the backend with `page.route`; never starts the server or a DB.

Run `pnpm install` in each project you touch. Toolchain: Node ≥22, pnpm 10.18.1 (via corepack). (CONTRIBUTING.md still says "Node >= 20" — that line is stale; `package.json` `engines` is authoritative at ≥22.)

## Commands

Root server:

- `pnpm dev` — watch-mode Node server (`tsx watch src/index.ts`).
- `pnpm build` — bundle via tsup + full `tsc --noEmit`.
- `pnpm typecheck` — Node-target typecheck (`tsconfig.json`).
- `pnpm typecheck:workers` — Workers-target typecheck (`tsconfig.workers.json`). Both must pass in CI.
- `pnpm test` — unit + e2e.
- `pnpm test:unit` — `node --import tsx --test test/*.test.ts`.
- Single unit test: `node --import tsx --test test/r2-conditional.test.ts`.
- `pnpm cf:dev` — local Workers preview (`wrangler dev`).
- `pnpm start` — run the built bundle (`node dist/index.js`).

`gen:assets` is auto-run as the first step of `dev`, `build`, `typecheck`, `typecheck:workers`, `cf:dev`, and `cf:deploy`, so `src/generated/edge-assets.ts` stays fresh. Run `pnpm gen:assets` by hand only if you bypass those scripts.

Console (run from `console/`):

- `pnpm -C console dev` — Vite dev server on :5173, proxying `/api`, `/auth`, `/p`, `/_pagepin`, `/skill.md` to the backend on :8000 (so the backend must be running).
- `pnpm -C console build` — outputs to `console/dist`.

E2E (run from `e2e/`):

- `pnpm -C e2e test` — all specs.
- `pnpm -C e2e test:headed` — headed.
- Single spec: `pnpm -C e2e exec playwright test tests/anchoring.spec.js`.

Deploy (Cloudflare):

- `pnpm cf:deploy` — runs `gen:assets`, then `wrangler d1 migrations apply pagepin --remote`, then `wrangler deploy`. Build `console/` first so the ASSETS binding has fresh files.
- D1 migrations are applied via the CLI (`wrangler d1 migrations apply pagepin --remote`), never at runtime. On Node, libSQL auto-applies the same `drizzle/` migrations at startup.
- After changing `src/db/schema.ts`, regenerate SQL with `pnpm drizzle-kit generate`.

## Architecture

One Hono app, two entrypoints. `src/app.ts` (`createApp`) is platform-neutral and imports only edge-safe code; it receives `AppDeps` (config, db, storage) plus injected callbacks. `src/index.ts` is the Node entry (loads/generates `PAGEPIN_SECRET` from `{dataDir}/secret`, builds a libSQL db, bootstraps the admin unconditionally, serves the console via `console-static.ts`, starts `@hono/node-server`). `src/worker.ts` is the Workers entry (config from `env`, D1 + R2 bindings, lazy guarded admin bootstrap once per isolate, serves the console via the `ASSETS` binding). Read `app.ts`, `index.ts`, and `worker.ts` together to understand any request path.

Host-based routing, single vs dual domain. `loadConfig` (`src/config.ts`, a pure function of env — no I/O) picks `mode` from `PAGEPIN_CONSOLE_HOST` + `PAGEPIN_CONTENT_HOST`: both set → `dual`, neither → `single`, exactly one → throws. Mode is fixed per deployment. In single mode one app co-hosts console + content and content lives under `/p/:handle/:slug/*`; in dual mode an outer router dispatches by stripped Host header to a console app and a content app, and content lives at `/:handle/:slug/*` (no `/p`). `contentBase()` / `siteUrl()` compute the right base, so routing code is mode-agnostic. On Workers, `run_worker_first: true` (`wrangler.jsonc`) is essential: every request — including static assets — goes through the Worker so Host dispatch works before falling back to `ASSETS`.

Database: one schema, two dialects. `src/db/schema.ts` is the single source of truth (users, sites, comment_threads, api_tokens, invites, instance_settings). Both drivers satisfy one async interface (`Db = BaseSQLiteDatabase<'async'>`) — `src/db/d1.ts` (Workers) and `src/db/libsql.ts` (Node) — so every query must use `await` everywhere; that is non-negotiable for cross-runtime parity. Sites embed `versions` and comment_threads embed `comments` as JSON columns. Publishing is atomic: a new version is appended and `current_version_id` is flipped in one conditional UPDATE guarded on the prior `current_version_id` (optimistic concurrency, retried up to 5×); rollback just points the pointer backward. All of users/sites/comment_threads use soft deletes (`deletedAt`) with conditional unique indexes, so always filter `deletedAt` in queries.

Pluggable storage. `Storage` (`src/storage/index.ts`) is an edge-safe interface implemented by `FsStorage` (Node default), `S3Storage` (SigV4, edge-safe), and `R2Storage` (Workers binding). `src/storage/factory.ts` selects fs vs s3 from `PAGEPIN_STORAGE` on Node; Workers instantiate `R2Storage(env.BUCKET)` directly. Note the ETag quirk: browsers send RFC 7232 quoted `If-None-Match`, but R2's `etagDoesNotMatch` rejects quotes — `parseIfNoneMatch()` in `r2.ts` normalizes them (regression-guarded by `test/r2-conditional.test.ts`).

Auth and sessions. Three mutually exclusive modes (`password` / `oidc` / `none`), plus optional Google/GitHub social login, set per deployment. Sessions are stateless HS256 JWTs in httpOnly cookies on two planes: `pp_view` (content-domain viewer login) and `pp_session` + `pp_csrf` (console API with double-submit CSRF; `pp_csrf` is readable by JS and echoed in `X-CSRF-Token`). Programmatic deploy/comment APIs authenticate with `pp_*` Personal Access Tokens via `Authorization: Bearer` (SHA-256 hashed at rest, no CSRF). OIDC/social subs are namespaced (`google:`, `github:`); email is not a cross-identity merge key. See `src/auth/*` and the middleware factory in `src/api/deps.ts`.

Serving, injection, and the generated asset file. `src/serving.ts` enforces access control and injects the comment overlay only when the site has comments enabled and the viewer is logged in. HTML ≤5MB gets byte-level injection (latin1 position-finding, original bytes preserved, so non-UTF-8 pages and BOMs survive); >5MB HTML on Workers streams through `src/serving-inject.ts` (HTMLRewriter, UTF-8 only). Markdown/image browser navigations get branded "viewer shells"; `?raw` is the escape hatch. `src/generated/edge-assets.ts` is GENERATED by `scripts/gen-edge-assets.mjs` — it inlines `static/comments.js`, `static/marked.min.js`, and `skill.md` as string constants because Workers has no filesystem at runtime (a top-level `readFileSync` crashes the isolate at import). Never hand-edit it; edit the sources and re-run `gen:assets`. `skill.md` is served at `GET /skill.md` with deploy-context placeholders substituted at startup.

Comments and the agent loop. Threads anchor to a CSS selector plus a content fingerprint and snapshot the `currentVersionId` at creation. On redeploy a version mismatch marks a thread `stale` (badged, still clickable) but never deletes it; `static/comments.js`'s `resolveAnchor()` degrades gracefully to a sidebar "anchor lost" entry when the selector no longer matches. `GET /api/sites/{slug}/comments` (PAT-accessible) exports threads as JSON with deep-link URLs, `kind`, `resolved`, and `stale` flags — this is the feedback channel an agent reads, fixes, and redeploys against. The full env-var table and the deploy → review → fix loop are documented in the README and the live `/skill.md`.

## Commit conventions

Write commit messages in English, following Conventional Commits: `feat`/`fix`/`docs`/`refactor`/`test`/`chore`, optionally scoped (e.g. `fix(serving): ...`).
