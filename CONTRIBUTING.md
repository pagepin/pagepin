# Contributing to pagepin

Thanks for your interest! pagepin is a small, self-hostable codebase — one Node
process (Hono) + SQLite + a React console, with a review overlay injected into
hosted pages. Contributions of all sizes are welcome.

## Repository layout

| Path | What it is |
|---|---|
| `src/` | Server: Hono app, Drizzle/SQLite, auth, deploy & serving, comments API |
| `static/comments.js` | The review overlay injected into hosted pages (vanilla JS, no build step) |
| `console/` | React + Vite admin console (its own `package.json`) |
| `e2e/` | Playwright tests for the comments overlay — self-contained, stubs the API, no backend or DB needed (its own `package.json`) |
| `skills/pagepin/SKILL.md` | Agent-facing skill (installable via `npx skills add pagepin/pagepin`); also served at `/skill.md` |

## Prerequisites

- Node.js >= 22 (authoritative `engines` value in `package.json`)
- pnpm 10.18.1 (`corepack enable` picks it up from `packageManager`)

The three folders (`.`, `console/`, `e2e/`) are independent pnpm projects —
install each as needed.

## Local development

```bash
pnpm install                       # server deps
pnpm -C console install            # console deps (first time)
pnpm -C console build              # optional: build the admin UI into console/dist (served by the API)
pnpm dev                           # API on http://localhost:8000 (+ console if built)
```

`pnpm dev` runs in `password` auth mode by default. To bootstrap an admin on
first start:

```bash
PAGEPIN_ADMIN_EMAIL=admin@example.com \
PAGEPIN_ADMIN_PASSWORD=change-me \
pnpm dev
```

The full environment-variable table is in the [README](README.md#configuration).

## Checks (run before opening a PR)

All of these run in CI (`.github/workflows/ci.yml`); please make them pass
locally first:

```bash
pnpm lint                                       # ESLint + Prettier check (server)
pnpm typecheck                                  # tsc --noEmit (server)
pnpm test:unit                                  # server unit tests
node --check static/comments.js                 # comments overlay syntax
pnpm build                                       # server bundle (tsup) + tsc
pnpm -C console lint                             # ESLint + Prettier check (console)
pnpm -C console build                            # console typecheck + Vite build
pnpm -C e2e install                              # first time only
pnpm -C e2e exec playwright install chromium     # first time only
pnpm -C e2e test                                 # comments-overlay e2e
```

Run `pnpm format` (and `pnpm -C console format`) to auto-apply Prettier.

When you change `static/comments.js`, add or update an `e2e/tests/*.spec.js`
case. The e2e suite injects the real `comments.js` and stubs `/api/*` via
`page.route`, so it runs fast and fully offline.

## Commit & PR conventions

- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`,
  `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, optionally scoped
  (`feat(comments): …`).
- Keep each PR focused; describe the user-visible change and how you verified it.
- New behavior needs test coverage (server logic or e2e, as appropriate).
- Never commit secrets, tokens, or runtime data — `data/`, `*.db`, and `.env`
  are git-ignored.

## Architecture in one paragraph

A single Hono process serves three things off one origin (or two, in dual-domain
mode): the JSON API, the React console (`console/dist`), and hosted sites with
`comments.js` injected into their HTML. Data lives in SQLite via Drizzle (one
file, WAL); uploaded file contents live in pluggable storage (local FS or any
S3-compatible store). Sessions are stateless signed cookies; deploy tokens are
`pp_` PATs. The agent loop is: deploy → reviewers pin comments → agent fetches
open threads as JSON → fixes → redeploys → resolves. See
[README Architecture](README.md#architecture).

## License

By contributing, you agree that your contributions are licensed under the
[Apache-2.0 License](LICENSE).
