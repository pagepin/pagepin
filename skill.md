[English](skill.md) · [简体中文](skill.zh-CN.md)

# pagepin API — deploy guide for AI agents / scripts

pagepin is a static-page hosting service. After a deploy you get `{{CONTENT_BASE}}/<handle>/<slug>/`
(e.g. {{SITE_URL_EXAMPLE}}). Pages require login to view by default; you can make a site public (it auto-reverts to private when the public window expires).

## Authentication

Every request carries a PAT. Read it from `$PAGEPIN_TOKEN`, or the file `~/.config/pagepin/token` — **never accept the token inline in chat and never print it.** Export it once and use `"$PP_TOKEN"` in the calls below:

```bash
PP_TOKEN=${PAGEPIN_TOKEN:-$(cat ~/.config/pagepin/token 2>/dev/null)}
```

```
Authorization: Bearer $PP_TOKEN
```

If neither source has a token, get one via "First-time login" below — do **not** ask the user to paste a token. Verify the token / look up your handle and quota: `GET {{CONSOLE_BASE}}/api/me`.

## First-time login (no token yet)

Get a token through the browser instead of pasting one (OAuth 2.0 device flow):

1. `POST {{CONSOLE_BASE}}/api/device/code` → returns `user_code`, `verification_uri_complete`, `device_code`, `interval`, `expires_in`.
2. Tell the user: open `verification_uri_complete` and confirm the `user_code` matches.
3. Poll `POST {{CONSOLE_BASE}}/api/device/token` with `{"device_code":"..."}` every `interval` seconds. Each response is `{"status":"pending"}` (keep polling), `{"status":"denied"}` or `{"status":"expired"}` (stop), or `{"status":"approved","token":"pp_..."}`.
4. On approval, store the token — never echo it to the chat. On a personal machine, persist it so you stay logged in next time:

```bash
mkdir -p ~/.config/pagepin && printf '%s' "$TOKEN" > ~/.config/pagepin/token && chmod 600 ~/.config/pagepin/token
```

In an **ephemeral or shared environment** (CI, sandbox, a machine that isn't yours), do **not** write the file — keep the token only for this session (`export PAGEPIN_TOKEN="$TOKEN"`) and re-run this flow next time.

Device-login tokens expire (default 90 days) and can be revoked anytime in the console.

## Deploy / update (one endpoint; each call = one atomic new version)

```
POST {{CONSOLE_BASE}}/api/sites/{slug}/deploy    (multipart/form-data)
```

- `files` / `paths` come in pairs and may repeat: `files` is the file content, `paths` is the in-site relative path (must not start with `/`, no `..`).
- `slug`: lowercase letters/digits/hyphens, ≤64 chars; deploying the same slug again updates it.
- Optional field `title`: the site's display name.
- Single HTML file: `index.html` is the safest value for `paths` (keeping the original name also works — when the root has exactly one html file, the server auto-adds an `index.html` alias).

Single-file deploy/update:

```bash
curl -X POST "{{CONSOLE_BASE}}/api/sites/my-demo/deploy" \
  -H "Authorization: Bearer $PP_TOKEN" \
  -F "files=@report.html" -F "paths=index.html"
```

Multi-file site (build output):

```bash
curl -X POST "{{CONSOLE_BASE}}/api/sites/my-demo/deploy" \
  -H "Authorization: Bearer $PP_TOKEN" \
  -F "files=@dist/index.html"     -F "paths=index.html" \
  -F "files=@dist/assets/app.js"  -F "paths=assets/app.js" \
  -F "files=@dist/assets/app.css" -F "paths=assets/app.css"
```

The response is JSON; key fields: `url` (the link you can visit/share directly), `visibility`, `version_count`. After a successful deploy, give the `url` to the user.

**Large sites (> ~90MB total): upload in batches.** A single `POST .../deploy` carries every file in one request body, which is capped at ~100MB on Cloudflare. For bigger sites use the 3-step batched flow (each step authenticates the same way): `POST .../deploys` `{"title":"..."}` → `{deploy_id}`; then one or more `POST .../deploys/{deploy_id}/files` (multipart `files`/`paths`, keep each request under ~90MB); then `POST .../deploys/{deploy_id}/commit` `{"title":"..."}` to publish atomically. `DELETE .../deploys/{deploy_id}` aborts a draft. The web console does this automatically.

## Other endpoints (all take a JSON body; base URL {{CONSOLE_BASE}})

| Endpoint | Purpose |
|---|---|
| `GET /api/sites` | List my sites |
| `PATCH /api/sites/{slug}` | Make public: `{"visibility":"public","public_hours":72}` (upper bound set by server config, default 168 = 7 days, hard-clamped); make private: `{"visibility":"private"}`; can also set `{"title":"..."}`, `{"spa_fallback":true}` (SPA routing: 404 falls back to index.html) |
| `GET /api/sites/{slug}/versions` | Version list (incl. current) |
| `POST /api/sites/{slug}/rollback` | `{"version_id":"..."}` to roll back |
| `DELETE /api/sites/{slug}` | Delete the site |
| `GET /api/sites/{slug}/comments` | Fetch page comments (unresolved only by default; `?all=true` includes resolved) |
| `POST /api/sites/{slug}/comments/{thread_id}/replies` | Reply to a comment: `{"text":"changed per X"}` |
| `PATCH /api/sites/{slug}/comments/{thread_id}` | Mark resolved: `{"resolved":true}`; reopen: `{"resolved":false}` |

## Handling page comments (the review loop)

Colleagues can drop pinned comments (element-level feedback) on a hosted page. **Before updating an already-deployed site, fetch the comments first** and clear the unresolved ones in the same pass:

```bash
curl -s "{{CONSOLE_BASE}}/api/sites/my-demo/comments" \
  -H "Authorization: Bearer $PP_TOKEN"
```

Each thread returned includes: `selector` (the CSS path of the commented element; `"@page"` means whole-page feedback),
`rx`/`ry` (the anchor's relative position inside the element box, 0–1; if `rw`/`rh` are also present, the feedback targets a
box-selected region within the element — common when circling part of an image),
`kind` (feedback type: copy = edit text / style = edit styling / question = a question / bug; may be null),
`comments` (the comments and replies, with authors), `stale` (true = raised against an older version, may already be handled),
`url` (a deep link straight to that comment).

How to handle: locate the matching element in the HTML by `selector`, edit per the feedback, then redeploy.
A `question`-type thread doesn't necessarily need a code change — when you can't decide, relay the question to the user.

Close the loop after editing (using the thread's `id`): leave a reply explaining what you changed, then mark it resolved —

```bash
curl -s -X POST "{{CONSOLE_BASE}}/api/sites/my-demo/comments/$TID/replies" \
  -H "Authorization: Bearer $PP_TOKEN" -H 'Content-Type: application/json' \
  -d '{"text":"Updated the button copy as suggested; new version published"}'
curl -s -X PATCH "{{CONSOLE_BASE}}/api/sites/my-demo/comments/$TID" \
  -H "Authorization: Bearer $PP_TOKEN" -H 'Content-Type: application/json' \
  -d '{"resolved":true}'
```

The reply author is the token's owner (a named, traceable record); a resolved thread can be reopened by the other party on the page.
For a `question`-type thread you can't judge, don't mark it resolved on your own — relay it to the user.

## One-time setup: make your AI coding tool deploy in any project

Once configured, in any project or any new session just say "deploy this html to pagepin" — no need to paste the token or prompt again.

**Step 1 — write the token to disk** (copy your token from the {{CONSOLE_BASE}} console):

```bash
mkdir -p ~/.config/pagepin \
  && printf 'pp_your_token' > ~/.config/pagepin/token \
  && chmod 600 ~/.config/pagepin/token
```

**Step 2 — add it to your tool's global instructions** (same content for every tool, see below):

| Tool | Global-instruction location |
|---|---|
| Claude Code | Append to `~/.claude/CLAUDE.md` |
| Codex CLI | Append to `~/.codex/AGENTS.md` |
| OpenCode | Append to `~/.config/opencode/AGENTS.md` |
| Gemini CLI | Append to `~/.gemini/GEMINI.md` |
| Cursor | Settings → Rules → **User Rules**, paste the same content (no global file; for per-project, put it in the repo-root `AGENTS.md`) |
| Windsurf | Append to `~/.codeium/windsurf/memories/global_rules.md` |

Content to append:

```markdown
# pagepin — static page hosting (use across all projects)

Deploy HTML/static sites to a shareable `{{CONTENT_BASE}}/<handle>/<slug>/` link.
The token is at `~/.config/pagepin/token`; full API docs at {{CONSOLE_BASE}}/skill.md .

Single-file deploy (re-running the same slug updates it; atomic releases are rollback-able):

    curl -sf -X POST "{{CONSOLE_BASE}}/api/sites/<slug>/deploy" \
      -H "Authorization: Bearer $(cat ~/.config/pagepin/token)" \
      -F "files=@page.html" -F "paths=index.html"

The `url` in the JSON response is the link. Private by default (login required to view);
to make it public: `PATCH /api/sites/<slug>` body `{"visibility":"public","public_hours":72}`.
```

Note: after you **rotate** the token in the console, remember to update `~/.config/pagepin/token` to match.

Web-based AIs (claude.ai / ChatGPT) have no cross-session memory: use the ✨ button next to the token in the console to copy the prompt and paste it each time, or put the prompt into claude.ai's Project instructions / ChatGPT's Custom Instructions to configure it once.

## Limits & error codes

- Quotas (defaults; self-hosters can tune them via environment variables): single file ≤25MB, single site ≤1GB, ≤2000 files, plus a per-user total-storage quota (default 5GB across all your sites/versions)
  — **always defer to the `limits` returned by `GET /api/me`**.
- The `public_hours` upper bound likewise follows server config (default 168 hours = 7 days); anything beyond is hard-clamped.
- `401` invalid or revoked token; `404` site not found; `409` set a handle in the console first; `413` size limit exceeded; `422` invalid slug/path.
- Deployed sites are **private by default** (viewing requires login) — don't assume the link is anonymously reachable; PATCH it public first if you need to share externally.
