[English](README.md) · [简体中文](README.zh-CN.md)

# pagepin

[![CI](https://github.com/pagepin/pagepin/actions/workflows/ci.yml/badge.svg)](https://github.com/pagepin/pagepin/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/pagepin/pagepin)](https://github.com/pagepin/pagepin/releases)
[![Container](https://img.shields.io/badge/ghcr.io-pagepin-2496ED?logo=docker&logoColor=white)](https://github.com/pagepin/pagepin/pkgs/container/pagepin)

自托管的静态页面托管服务，支持元素级打点评论与 AI 反馈闭环 —— **让 agent 真正能拉取到的反馈**。

用一条 `curl` 部署任意 HTML 报告或静态站点，分享链接，评审者即可直接在页面元素上打点评论。每条评论都带有 CSS selector、类型（`copy` / `style` / `question` / `bug`）和已解决标记 —— 你的编码 agent 因此能以结构化 JSON 拉取未解决的反馈，修改页面后再发布。评审闭环就此闭合，无需再往聊天里贴截图。

## 功能特性

- **一条命令部署** —— multipart `POST /api/sites/{slug}/deploy`；对同一 slug 重新部署即发布一个新的原子版本。
- **版本化发布** —— 每个站点保留完整版本历史，一次调用即可回滚。
- **元素级打点评论** —— 一个轻量 overlay（`comments.js`）被注入到所服务的 HTML 中；登录的访客可在元素上打点、在线程中回复并将线程标记为已解决。
- **分享链接与访客评审** —— 生成带签名、可过期的 `?key=` 链接（`POST /api/sites/{slug}/share-link`）；任何人点开即可查看私有页面并**以访客身份打点评论，无需注册账号**。一次调用可撤销全部已发链接（连同已进入的访客会话）；每站点可单独开关访客评论。
- **匿名试用（默认关闭）** —— `PAGEPIN_TRIAL=true` 开启 `POST /api/try`：无账号 drop 一个 HTML 或 Markdown 文件，即得 1 小时有效的可分享链接（含访客评论 + 凭 key 访问的评论 API），之后可认领进账号永久保留。仅建议在配好 Turnstile 与边缘限速的实例上开启。
- **为 AI agent 而生** —— `GET /api/sites/{slug}/comments` 返回每个线程的 `selector`、`kind`、页面路径、深链 URL 和锚点失效信息；实时 API 指南托管在 `/skill.md`，可直接贴进 agent 上下文。
- **默认私有** —— 查看需要登录；站点可在限定时间窗内公开（默认上限 7 天），到期自动回落为私有。
- **Markdown 与图片查看器壳** —— `.md` 文件和图片会获得一个可读的查看器页面（追加 `?raw` 取原始文件）。
- **SPA 兜底** —— 可按站点开启，适配客户端路由应用。
- **可插拔认证** —— 内置邮箱/密码（可选开放注册）、Google/GitHub 社交登录、任意 OIDC provider，或 `none`（本地开发）。
- **可插拔存储** —— 本地文件系统或任意 S3 兼容对象存储（MinIO、R2 等）。
- **可插拔数据库** —— 默认 SQLite/libSQL（开箱即用），自托管 Node 也可用 PostgreSQL / MySQL。
- **占用小** —— 一个 Node 进程 + SQLite；单个 Docker 镜像，内含 React 控制台。
- **单域或双域服务** —— 全部跑在一个 origin 上，或把托管内容隔离到独立的内容域（见[架构](#架构)）。
- **中英双语** —— 控制台、服务端渲染页面（登录墙、查看器壳、目录索引）、评论浮层、验证邮件以及 API 错误体均已本地化。语言按请求解析（`?lang=` → `pp_lang` cookie → `Accept-Language` → `PAGEPIN_DEFAULT_LOCALE`），控制台可一键切换。API 错误体新增稳定的机器可读 `code`（见 [面向 AI agent 的部署与 API](#面向-ai-agent-的部署与-api)）。

## 快速开始

### Docker

```bash
docker run -d --name pagepin \
  -p 8000:8000 \
  -v pagepin-data:/data \
  -e PAGEPIN_ADMIN_EMAIL=admin@example.com \
  -e PAGEPIN_ADMIN_PASSWORD=change-me-please \
  ghcr.io/pagepin/pagepin
```

打开 `http://localhost:8000`，用管理员身份登录，设置一个 handle，并在控制台创建一个 API token（`pp_...`）。仓库中附带了 `docker-compose.yml`（含可选的 MinIO 配置块）。

### 从源码运行

```bash
pnpm install
pnpm -C console install && pnpm -C console build   # 可选：构建 Web 控制台
pnpm dev                                           # API 跑在 http://localhost:8000
```

### Agent skill（面向 AI 编码工具）

把部署与评审闭环教给你的编码 agent。装一次，所有项目、所有会话都能用；通过浏览器登录（设备授权），token 不进聊天：

```bash
npx skills add pagepin/pagepin -g
```

Claude Code 也可作为插件安装：

```text
/plugin marketplace add pagepin/pagepin
/plugin install pagepin@pagepin
```

完整选项（CI/脚本化安装、支持的 agent）见 [`install.md`](install.md)。没有本地 skill 目录的 agent，可改为指向实时托管的 **`/skill.md`**。

## 配置

所有配置均通过环境变量完成。下表是最常用的几项；**完整清单**——双域托管、OIDC、社交登录、Turnstile、邮件、S3 以及全部上传/配额限制——见 [`.env.example`](.env.example)，按类别分组并带默认值和行内注释。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PAGEPIN_PORT` | `8000` | HTTP 监听端口。 |
| `PAGEPIN_DATA_DIR` | `./data` | 数据根目录：SQLite 数据库、生成的 secret 以及 `fs` 存储。 |
| `PAGEPIN_DB_URL` | — | 数据库连接（自托管）。未设置 → 本地 SQLite 文件。按 scheme 选驱动：`libsql://`/`file:`（SQLite/Turso，配 `PAGEPIN_DB_AUTH_TOKEN`）、`postgres://`、`mysql://`（8.0+）。 |
| `PAGEPIN_BASE_URL` | `http://localhost:8000` | 实例的公开 URL（单域模式）。 |
| `PAGEPIN_ADMIN_EMAIL` / `…_PASSWORD` | — | 两者都设则启动时 upsert 一个管理员；否则首个注册者成为管理员。 |
| `PAGEPIN_AUTH_MODE` | `password` | `password`、`oidc` 或 `none`（仅开发：自动以管理员身份登录）。 |
| `PAGEPIN_DEFAULT_LOCALE` | `en` | 回落语言（`en` 或 `zh`）。每次请求按 `?lang=` → `pp_lang` cookie → `Accept-Language` 覆盖。 |
| `PAGEPIN_STORAGE` | `fs` | `fs`（本地磁盘）或 `s3`（S3 兼容）。 |

复制模板即可开始：

```bash
cp .env.example .env   # 然后编辑；用 `docker run --env-file .env` 或 compose 的 `env_file:` 传入
```

`.env.example` 里的上传/配额限制默认偏向公开免费档；自托管/团队实例可按需用 env 调大。注册与密码登录在应用层还按 IP 做了限流（尽力而为，Workers 上为每 isolate 维度）。面向公开部署、需要真正的边缘防护时，建议在 `/auth/signup` 与 `/auth/password` 上加一条 Cloudflare **Rate Limiting Rule** —— 它在 Worker 之前全局生效。

## 数据库

pagepin **零数据库配置**即可跑 —— 内置 SQLite（经 libSQL），数据落在 `PAGEPIN_DATA_DIR` 下的单个文件里。自托管 Node 部署也可改用 **PostgreSQL** 或 **MySQL**，把数据放进已有基础设施。驱动按 `PAGEPIN_DB_URL` 的 scheme 自动推断（可用 `PAGEPIN_DB_DRIVER` 覆盖）：

| Scheme | 引擎 |
|---|---|
| *(未设置)* / `file:` | 本地 SQLite 文件（默认，开箱即用） |
| `libsql://` | 托管 libSQL / Turso（配 `PAGEPIN_DB_AUTH_TOKEN`） |
| `postgres://` | PostgreSQL |
| `mysql://` | MySQL 8.0+ |

```bash
docker run -d --name pagepin -p 8000:8000 \
  -e PAGEPIN_DB_URL=postgres://user:pass@db-host:5432/pagepin \
  -e PAGEPIN_ADMIN_EMAIL=admin@example.com -e PAGEPIN_ADMIN_PASSWORD=change-me \
  ghcr.io/pagepin/pagepin
```

一份 schema 定义生成三种方言的 DDL，启动时自动应用对应迁移。`postgres` / `mysql2` 驱动是可选依赖，已打进镜像、仅在选用对应方言时才加载，默认 SQLite 路径不受影响、保持精简。Cloudflare Workers 部署始终用 D1，忽略 `PAGEPIN_DB_URL`。

## 部署与面向 AI agent 的 API

部署一个页面并拉取其评审反馈 —— 两条调用：

```bash
curl -sf -X POST "http://localhost:8000/api/sites/my-report/deploy" \
  -H "Authorization: Bearer pp_<your-token>" \
  -F "files=@report.html" -F "paths=index.html"

curl -sf "http://localhost:8000/api/sites/my-report/comments" \
  -H "Authorization: Bearer pp_<your-token>"
```

部署响应中包含可分享的 `url`。评论响应列出未解决的线程，带 `selector`、`kind`、`page_path` 和深链 `url` —— 处理它们、重新部署，搞定。

错误响应为 `{ "detail": "<人读文案>", "code": "<稳定 key>" }`。`detail` 随语言本地化（`?lang=` / `pp_lang` cookie / `Accept-Language`）；`code` 是语言无关的稳定标识（如 `site.quota.exceeded`、`auth.unauthenticated`）—— 按 `code` 分支、展示 `detail`。

面向 agent 的 skill 在 [`skills/pagepin`](skills/pagepin/SKILL.md) —— 用 `npx skills add pagepin/pagepin -g` 一行安装（见 [`install.md`](install.md)），agent 即可自行驱动完整的「部署 → 评审 → 修改」闭环。同一份指南也实时托管在 **`/skill.md`**，供没有本地 skill 目录的 agent 使用。

## 架构

![pagepin 架构](docs/architecture.svg)

*交互版（暗/亮主题切换、PNG/SVG 导出）：[`docs/architecture.html`](docs/architecture.html)；可由 [`docs/architecture.json`](docs/architecture.json) 重新生成。*

一个 Node 进程（Hono）+ SQLite + 可插拔对象存储，对外服务三样东西：JSON API、React 控制台，以及托管站点（向其 HTML 注入评论 overlay）。同一份 `createApp` 通过依赖注入也能跑在 Cloudflare Workers（D1 + R2）上。

- **单域模式**（默认）：一切都在 `PAGEPIN_BASE_URL` 上；托管站点位于 `/p/{handle}/{slug}/` 之下。零 DNS 配置，适合受信任的团队。
- **双域模式**：设置 `PAGEPIN_CONSOLE_HOST` + `PAGEPIN_CONTENT_HOST`，同一进程按 `Host` 头分流 —— 控制台/API 在一个 origin，托管内容在 `https://{content-host}/{handle}/{slug}/`，并拥有独立的访客会话 cookie。

> **关于单域模式的安全提示**：托管页面与控制台共享浏览器 origin，因此上传页面中的恶意脚本可能以登录用户的会话身份行事。仅当所有有部署权限的人都受信任时才用单域模式；否则用双域模式把用户内容放到独立 origin。

## 评论与评审

评审者打开分享链接，点击页面上任意位置，留下一个打点的评论线程（类型：copy / style / question / bug）。打点通过 selector + 内容指纹锚定，在重新部署后依然存活；当锚点丢失时优雅降级为侧栏列表。

![元素级打点评论 overlay](docs/screenshot-comments.png)

## 开发

```bash
pnpm install        # 服务端依赖
pnpm dev            # tsx watch src/index.ts
pnpm typecheck      # tsc --noEmit
pnpm -C e2e install # Playwright（首次）
pnpm test:e2e       # 评论 overlay e2e —— 自包含，无需后端
```

## 许可证

[Apache-2.0](LICENSE)
