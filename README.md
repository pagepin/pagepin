# pagepin

Self-hosted static page hosting with pin-point review comments and an AI feedback loop — **feedback that agents can actually fetch**.

Deploy any HTML report or static site with one `curl`, share the link, and let reviewers pin comments directly onto page elements. Every comment is stored with a CSS selector, a kind (`copy` / `style` / `question` / `bug`) and a resolved flag — so your coding agent can pull the open feedback as structured JSON, fix the page, and redeploy. Review loop closed, no screenshots-in-chat required.

## Features

- **One-command deploys** — multipart `POST /api/sites/{slug}/deploy`; redeploying the same slug publishes a new atomic version.
- **Versioned releases** — full version history per site, one-call rollback.
- **Pin-point comments** — a lightweight overlay (`comments.js`) is injected into served HTML; logged-in viewers drop pins on elements, reply in threads, and mark threads resolved.
- **Built for AI agents** — `GET /api/sites/{slug}/comments` returns each thread with its `selector`, `kind`, page path, deep-link URL and staleness info; the live API guide is served at `/skill.md` for pasting into agent context.
- **Private by default** — viewing requires login; sites can be made public for a bounded time window (default max 7 days) and auto-revert to private.
- **Markdown & image viewer shells** — `.md` files and images get a readable viewer page (append `?raw` for the raw file).
- **SPA fallback** — opt-in per site for client-side routed apps.
- **Pluggable auth** — built-in email/password (with optional signup), any OIDC provider, or `none` for local dev.
- **Pluggable storage** — local filesystem or any S3-compatible object store (MinIO, R2, ...).
- **Small footprint** — one Node process + SQLite; single Docker image with a React console included.
- **Single- or dual-domain serving** — run everything on one origin, or isolate hosted content on a separate content domain (see [Architecture](#architecture)).

## Quick start

### Docker

> The `ghcr.io/pagepin/pagepin` image is not published yet — until then, build it yourself: `docker build -t ghcr.io/pagepin/pagepin .` (or run from source below).

```bash
docker run -d --name pagepin \
  -p 8000:8000 \
  -v pagepin-data:/data \
  -e PAGEPIN_ADMIN_EMAIL=admin@example.com \
  -e PAGEPIN_ADMIN_PASSWORD=change-me-please \
  ghcr.io/pagepin/pagepin
```

Open `http://localhost:8000`, log in as the admin, pick a handle, and create an API token (`pp_...`) from the console. A `docker-compose.yml` (with an optional MinIO block) is included in the repo.

### From source

```bash
pnpm install
pnpm -C console install && pnpm -C console build   # optional: build the web console
pnpm dev                                           # API on http://localhost:8000
```

## Configuration

All configuration is via environment variables.

| Variable | Default | Description |
|---|---|---|
| `PAGEPIN_PORT` | `8000` | HTTP listen port. |
| `PAGEPIN_DATA_DIR` | `./data` | Data root: SQLite DB, generated secret, and `fs` storage. |
| `PAGEPIN_BASE_URL` | `http://localhost:8000` | Public URL of the instance (single-domain mode). |
| `PAGEPIN_CONSOLE_HOST` | — | Console hostname. Setting **both** host vars switches to dual-domain mode. |
| `PAGEPIN_CONTENT_HOST` | — | Content (hosted pages) hostname. |
| `PAGEPIN_EXTERNAL_SCHEME` | `https` | Scheme used to build external URLs in dual-domain mode. |
| `PAGEPIN_AUTH_MODE` | `password` | `password`, `oidc`, or `none` (dev only: auto-login as an admin). |
| `PAGEPIN_ALLOW_SIGNUP` | `true` | Allow self-service signup (password mode). |
| `PAGEPIN_ADMIN_EMAIL` | — | If set with the password, an admin user is upserted at startup. Otherwise the first signup becomes admin. |
| `PAGEPIN_ADMIN_PASSWORD` | — | Bootstrap admin password. |
| `PAGEPIN_SECRET` | auto | Session signing key. Unset → generated once and stored at `{PAGEPIN_DATA_DIR}/secret`. |
| `PAGEPIN_SESSION_TTL_H` | `8` | Session lifetime in hours. |
| `PAGEPIN_OIDC_ISSUER` | — | OIDC issuer URL (required in `oidc` mode; discovery via `/.well-known/openid-configuration`). |
| `PAGEPIN_OIDC_CLIENT_ID` | — | OIDC client id. |
| `PAGEPIN_OIDC_CLIENT_SECRET` | — | OIDC client secret. |
| `PAGEPIN_OIDC_SCOPES` | `openid profile email` | OIDC scopes. |
| `PAGEPIN_OIDC_AUTH_PARAMS` | — | JSON object of extra query params appended to the authorize URL. |
| `PAGEPIN_STORAGE` | `fs` | `fs` (local disk) or `s3` (S3-compatible). |
| `PAGEPIN_S3_ENDPOINT` | — | S3 endpoint (required in `s3` mode; scheme optional, defaults to `https://`). |
| `PAGEPIN_S3_BUCKET` | — | S3 bucket. |
| `PAGEPIN_S3_ACCESS_KEY` | — | S3 access key. |
| `PAGEPIN_S3_SECRET_KEY` | — | S3 secret key. |
| `PAGEPIN_S3_PREFIX` | `pagepin/` | Key prefix inside the bucket. |
| `PAGEPIN_S3_REGION` | `auto` | SigV4 region. |
| `PAGEPIN_S3_FORCE_PATH_STYLE` | `true` | Path-style addressing (MinIO needs `true`). |
| `PAGEPIN_MAX_FILE_MB` | `25` | Max size per uploaded file. |
| `PAGEPIN_MAX_SITE_MB` | `200` | Max total size per deploy. |
| `PAGEPIN_MAX_FILES` | `2000` | Max number of files per deploy. |
| `PAGEPIN_PUBLIC_MAX_HOURS` | `168` | Upper bound for the public-sharing window (hours). |

## Deploy & API for AI agents

Deploy a page and fetch its review feedback — two calls:

```bash
curl -sf -X POST "http://localhost:8000/api/sites/my-report/deploy" \
  -H "Authorization: Bearer pp_<your-token>" \
  -F "files=@report.html" -F "paths=index.html"

curl -sf "http://localhost:8000/api/sites/my-report/comments" \
  -H "Authorization: Bearer pp_<your-token>"
```

The deploy response contains the shareable `url`. The comments response lists unresolved threads with `selector`, `kind`, `page_path` and a deep-link `url` — process them, redeploy, done.

The complete, instance-aware API reference is served at **`/skill.md`** — point your agent at it (e.g. paste a snippet referencing it into `CLAUDE.md` / `AGENTS.md`), and the agent can drive the full deploy → review → fix loop on its own.

## Architecture

One Node process (Hono) + SQLite + pluggable object storage, serving three things: the JSON API, the React console, and the hosted sites (with the comments overlay injected into HTML).

- **Single-domain mode** (default): everything on `PAGEPIN_BASE_URL`; hosted sites live under `/p/{handle}/{slug}/`. Zero-DNS setup, ideal for trusted teams.
- **Dual-domain mode**: set `PAGEPIN_CONSOLE_HOST` + `PAGEPIN_CONTENT_HOST` and the same process splits by `Host` header — console/API on one origin, hosted content on `https://{content-host}/{handle}/{slug}/` with its own viewer session cookie.

> **Security note on single-domain mode**: hosted pages share the browser origin with the console, so a malicious script in an uploaded page could act with a logged-in user's session. Use single-domain only when everyone who can deploy is trusted; use dual-domain mode to put user content on a separate origin otherwise.

## Comments & review

Reviewers open the shared link, click anywhere on the page, and leave a pinned comment thread (kind: copy / style / question / bug). Pins survive redeploys via selector + content-fingerprint anchoring, with graceful degradation to a sidebar list when an anchor is lost.

![pin-point comments overlay](docs/screenshot-comments.png)

*(screenshot placeholder)*

## Development

```bash
pnpm install        # server deps
pnpm dev            # tsx watch src/index.ts
pnpm typecheck      # tsc --noEmit
pnpm -C e2e install # Playwright (first time)
pnpm test:e2e       # comments-overlay e2e — self-contained, no backend needed
```

## License

[Apache-2.0](LICENSE)

---

## 中文快速开始

```bash
# 启动（镜像发布前请先本地构建：docker build -t ghcr.io/pagepin/pagepin .）
docker run -d --name pagepin \
  -p 8000:8000 \
  -v pagepin-data:/data \
  -e PAGEPIN_ADMIN_EMAIL=admin@example.com \
  -e PAGEPIN_ADMIN_PASSWORD=change-me-please \
  ghcr.io/pagepin/pagepin
```

1. 打开 `http://localhost:8000`，用上面设置的管理员邮箱密码登录；
2. 首次登录设置个人 handle（出现在站点 URL 里）；
3. 在控制台「API Token」页创建一个 token（`pp_` 开头，只显示一次）；
4. 用 curl 部署页面：

```bash
curl -sf -X POST "http://localhost:8000/api/sites/demo/deploy" \
  -H "Authorization: Bearer pp_<你的token>" \
  -F "files=@page.html" -F "paths=index.html"
```

返回 JSON 中的 `url` 即可分享给同事；同事登录后可在页面上直接打点评论。完整 API 说明（多文件部署 / 公开分享 / 回滚 / 评论拉取）见实例的 `/skill.md`，可直接贴进 AI 助手的上下文让它代劳整个「部署 → 收集评论 → 修改 → 再发布」闭环。
