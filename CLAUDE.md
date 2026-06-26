# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

pagepin is a self-hosted static-page host with pin-point review comments and an AI feedback loop. The same Hono app runs on two targets — Node (self-hosted) and Cloudflare Workers — by dependency injection, with no platform branching in the core request code.

## Repository layout

Three independent pnpm projects, each installed and locked separately:

- `.` (root) — the Hono server (API + page serving), Drizzle ORM, edge-asset pipeline.
- `console/` — React 19 + Vite SPA (the admin UI). Its own `package.json` / `pnpm-lock.yaml`; root installs do not touch it.
- `e2e/` — self-contained Playwright tests for the injected comment overlay. Stubs the backend with `page.route`; never starts the server or a DB.

Run `pnpm install` in each project you touch. Toolchain: Node ≥22, pnpm 10.18.1 (via corepack); `package.json` `engines` is authoritative.

## Commands

Root server:

- `pnpm dev` — watch-mode Node server (`tsx watch src/index.ts`).
- `pnpm build` — bundle via tsup + full `tsc --noEmit`.
- `pnpm typecheck` — Node-target typecheck (`tsconfig.json`).
- `pnpm typecheck:workers` — Workers-target typecheck (`tsconfig.workers.json`). Both must pass in CI.
- `pnpm test` — unit + e2e.
- `pnpm test:unit` — `node --import tsx --test test/*.test.ts`.
- Single unit test: `node --import tsx --test test/r2-conditional.test.ts`.
- `pnpm test:pg` / `pnpm test:mysql` — cross-dialect integration tests; each needs a reachable Postgres/MySQL (in `test:unit` they self-skip when no DB is present).
- `pnpm test:routes` — route-level tests run against whatever `PAGEPIN_TEST_DB_URL`/`PAGEPIN_DB_URL` points at, to check dialect parity.
- `pnpm lint` + `pnpm -C console lint` — ESLint (flat config) plus a Prettier `--check`; `pnpm format` / `pnpm -C console format` apply Prettier. Noisy rules (`no-explicit-any`, unused vars) are warnings, so only real errors fail CI. `static/comments.js` is excluded from both — its only static gate is `node --check static/comments.js`.
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
- After changing the schema, regenerate SQL for every dialect: `pnpm drizzle-kit generate` (sqlite/D1 → `drizzle/`), `pnpm gen:migrations:pg` (→ `drizzle/pg/`), and `pnpm gen:migrations:mysql` (→ `drizzle/mysql/`).

## Architecture

One Hono app, two entrypoints. `src/app.ts` (`createApp`) is platform-neutral and imports only edge-safe code; it receives `AppDeps` (config, db, storage) plus injected callbacks. `src/index.ts` is the Node entry (loads/generates `PAGEPIN_SECRET` from `{dataDir}/secret`, builds a libSQL db, bootstraps the admin unconditionally, serves the console via `console-static.ts`, starts `@hono/node-server`). `src/worker.ts` is the Workers entry (config from `env`, D1 + R2 bindings, lazy guarded admin bootstrap once per isolate, serves the console via the `ASSETS` binding). Read `app.ts`, `index.ts`, and `worker.ts` together to understand any request path.

Host-based routing, single vs dual domain. `loadConfig` (`src/config.ts`, a pure function of env — no I/O) picks `mode` from `PAGEPIN_CONSOLE_HOST` + `PAGEPIN_CONTENT_HOST`: both set → `dual`, neither → `single`, exactly one → throws. Mode is fixed per deployment. In single mode one app co-hosts console + content and content lives under `/p/:handle/:slug/*`; in dual mode an outer router dispatches by stripped Host header to a console app and a content app, and content lives at `/:handle/:slug/*` (no `/p`). `contentBase()` / `siteUrl()` compute the right base, so routing code is mode-agnostic. On Workers, `run_worker_first: true` (`wrangler.jsonc`) is essential: every request — including static assets — goes through the Worker so Host dispatch works before falling back to `ASSETS`.

Database: one schema, four engines. `src/db/schema.ts` is the canonical source of truth (users, sites, comment_threads, api_tokens, invites, instance_settings) and defines the precise row types. Self-hosted Node runs on SQLite/libSQL (default), PostgreSQL, or MySQL; Workers always run on D1 (SQLite). `inferDbDriver()` (`src/db/driver.ts`, a pure function) picks the dialect from `PAGEPIN_DB_URL`'s scheme — or explicit `PAGEPIN_DB_DRIVER` — and the dialect is fixed per deployment. SQLite/D1 use `schema.ts` directly; for pg/mysql, `buildSchema()` (`src/db/schema-factory.ts`) re-derives the *same* tables (identical names, indexes, constraints) from per-dialect column helpers in `src/db/columns.ts`, emitting `schema.pg.ts` / `schema.mysql.ts` for drizzle-kit. Each driver — `d1.ts`, `libsql.ts`, `postgres.ts`, `mysql.ts` — satisfies one async `Db` interface, so every query must `await` everywhere; that parity is non-negotiable. Two deliberate factory differences from `schema.ts`: JSON columns carry no DB default (the app always supplies the value), and string lengths exist only so MySQL `VARCHAR(n)` columns stay index-safe (utf8mb4 composite index ≤3072B). Sites embed `versions` and comment_threads embed `comments` as JSON columns. Publishing is atomic: a new version is appended and `current_version_id` is flipped in one conditional UPDATE guarded on the prior value (optimistic concurrency, retried up to 5×); rollback just moves the pointer backward. users/sites/comment_threads use soft deletes (`deletedAt`) with conditional unique indexes, so always filter `deletedAt` in queries.

Pluggable storage. `Storage` (`src/storage/index.ts`) is an edge-safe interface implemented by `FsStorage` (Node default), `S3Storage` (SigV4, edge-safe), and `R2Storage` (Workers binding). `src/storage/factory.ts` selects fs vs s3 from `PAGEPIN_STORAGE` on Node; Workers instantiate `R2Storage(env.BUCKET)` directly. Note the ETag quirk: browsers send RFC 7232 quoted `If-None-Match`, but R2's `etagDoesNotMatch` rejects quotes — `parseIfNoneMatch()` in `r2.ts` normalizes them (regression-guarded by `test/r2-conditional.test.ts`).

Auth and sessions. Three mutually exclusive modes (`password` / `oidc` / `none`), plus optional Google/GitHub social login, set per deployment. Sessions are stateless HS256 JWTs in httpOnly cookies on two planes: `pp_view` (content-domain viewer login) and `pp_session` + `pp_csrf` (console API with double-submit CSRF; `pp_csrf` is readable by JS and echoed in `X-CSRF-Token`). Programmatic deploy/comment APIs authenticate with `pp_*` Personal Access Tokens via `Authorization: Bearer` (SHA-256 hashed at rest, no CSRF). OIDC/social subs are namespaced (`google:`, `github:`); email is not a cross-identity merge key. See `src/auth/*` and the middleware factory in `src/api/deps.ts`. Two access-model facts constrain any serving/auth change: in single-domain mode uploaded page JS shares the console origin and can read the JS-readable `pp_csrf` cookie to call the API as the logged-in viewer (use dual-domain to isolate untrusted content), and a "private" site is viewable by *any* logged-in instance user — there is no per-site reviewer ACL, despite login-wall copy that implies one.

Serving, injection, and the generated asset file. `src/serving.ts` enforces access control and injects the comment overlay only when the site has comments enabled and the viewer is logged in. HTML ≤5MB gets byte-level injection (latin1 position-finding, original bytes preserved, so non-UTF-8 pages and BOMs survive); >5MB HTML on Workers streams through `src/serving-inject.ts` (HTMLRewriter, UTF-8 only). Markdown/image browser navigations get branded "viewer shells"; `?raw` is the escape hatch. `src/generated/edge-assets.ts` is GENERATED by `scripts/gen-edge-assets.mjs` — it inlines `static/comments.js`, `static/marked.min.js`, and `skill.md` as string constants because Workers has no filesystem at runtime (a top-level `readFileSync` crashes the isolate at import). Never hand-edit it; edit the sources and re-run `gen:assets`. `skill.md` is served at `GET /skill.md` with deploy-context placeholders substituted at startup.

Comments and the agent loop. Threads anchor to a CSS selector plus a content fingerprint and snapshot the `currentVersionId` at creation. On redeploy a version mismatch marks a thread `stale` (badged, still clickable) but never deletes it; `static/comments.js`'s `resolveAnchor()` degrades gracefully to a sidebar "anchor lost" entry when the selector no longer matches. `GET /api/sites/{slug}/comments` (PAT-accessible) exports threads as JSON with deep-link URLs, `kind`, `resolved`, and `stale` flags — this is the feedback channel an agent reads, fixes, and redeploys against. The full env-var table and the deploy → review → fix loop are documented in the README and the live `/skill.md`.

## Commit conventions

Write commit messages in English, following Conventional Commits: `feat`/`fix`/`docs`/`refactor`/`test`/`chore`, optionally scoped (e.g. `fix(serving): ...`).
