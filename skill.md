# pagepin API —— 给 AI / 脚本的部署说明

pagepin 是静态页面托管服务。部署后得到 `{{CONTENT_BASE}}/<handle>/<slug>/`
(例如 {{SITE_URL_EXAMPLE}})。默认需要登录才能查看;可设公开(到期自动回落私有)。

## 认证

所有请求带 PAT(让用户在 {{CONSOLE_BASE}} 控制台「API Token」里创建后给你):

```
Authorization: Bearer pp_xxxxxxxxxxxx...
```

验证 token / 查询自己的 handle 与配额:`GET {{CONSOLE_BASE}}/api/me`

## 部署 / 更新(同一个接口:每次调用 = 原子发布一个新版本)

```
POST {{CONSOLE_BASE}}/api/sites/{slug}/deploy    (multipart/form-data)
```

- `files` / `paths` 成对出现、可重复多对:`files` 是文件内容,`paths` 是站内相对路径(不要以 `/` 开头,禁止 `..`)。
- `slug`:小写字母/数字/中划线,≤64 位;同一 slug 重复部署即更新。
- 可选字段 `title`:站点显示名。
- 单个 HTML:`paths` 直接用 `index.html` 最稳(保留原名也行——根目录只有一个 html 时服务端会自动补 index.html 别名)。

单文件部署/更新:

```bash
curl -X POST "{{CONSOLE_BASE}}/api/sites/my-demo/deploy" \
  -H "Authorization: Bearer $PP_TOKEN" \
  -F "files=@report.html" -F "paths=index.html"
```

多文件站点(构建产物):

```bash
curl -X POST "{{CONSOLE_BASE}}/api/sites/my-demo/deploy" \
  -H "Authorization: Bearer $PP_TOKEN" \
  -F "files=@dist/index.html"     -F "paths=index.html" \
  -F "files=@dist/assets/app.js"  -F "paths=assets/app.js" \
  -F "files=@dist/assets/app.css" -F "paths=assets/app.css"
```

响应是 JSON,关键字段:`url`(可直接访问/分享的链接)、`visibility`、`version_count`。部署成功后把 `url` 告诉用户。

## 其他接口(均 JSON body,基地址 {{CONSOLE_BASE}})

| 接口 | 作用 |
|---|---|
| `GET /api/sites` | 我的站点列表 |
| `PATCH /api/sites/{slug}` | 设公开:`{"visibility":"public","public_hours":72}`(上限以服务端配置为准,默认 168=7 天,强制 clamp);转私有:`{"visibility":"private"}`;也可改 `{"title":"..."}`、`{"spa_fallback":true}`(SPA 路由:404 回落 index.html) |
| `GET /api/sites/{slug}/versions` | 版本列表(含 current) |
| `POST /api/sites/{slug}/rollback` | `{"version_id":"..."}` 回滚 |
| `DELETE /api/sites/{slug}` | 删除站点 |
| `GET /api/sites/{slug}/comments` | 拉取页面评论(默认只未解决;`?all=true` 含已解决) |
| `POST /api/sites/{slug}/comments/{thread_id}/replies` | 给某条评论留言:`{"text":"已按 X 修改"}` |
| `PATCH /api/sites/{slug}/comments/{thread_id}` | 标记已解决:`{"resolved":true}`;重开:`{"resolved":false}` |

## 处理页面评论(评审闭环)

托管页面上同事可以打点评论(页面元素级意见)。**更新一个已部署的站点前,先拉一次评论**,
把未解决的意见一并处理掉:

```bash
curl -s "{{CONSOLE_BASE}}/api/sites/my-demo/comments" \
  -H "Authorization: Bearer $PP_TOKEN"
```

返回的每条线程含:`selector`(被评元素的 CSS path,`"@page"` 表示整页意见)、
`kind`(意见类型:copy=改文案 / style=改样式 / question=提问 / bug,可能为 null)、
`comments`(评论与回复,含作者)、`stale`(true = 基于旧版本提出,可能已处理过)、
`url`(直达该评论的页面链接)。

处理方式:按 `selector` 定位到 HTML 里对应元素,根据意见修改后重新 deploy。
`question` 类不一定要改代码——无法判断时把问题转述给用户。

改完闭环(用线程的 `id`):留言说明怎么改的,再标记已解决——

```bash
curl -s -X POST "{{CONSOLE_BASE}}/api/sites/my-demo/comments/$TID/replies" \
  -H "Authorization: Bearer $PP_TOKEN" -H 'Content-Type: application/json' \
  -d '{"text":"已按建议把按钮文案改成「立即下单」,新版已发布"}'
curl -s -X PATCH "{{CONSOLE_BASE}}/api/sites/my-demo/comments/$TID" \
  -H "Authorization: Bearer $PP_TOKEN" -H 'Content-Type: application/json' \
  -d '{"resolved":true}'
```

留言作者即 token 所属用户(实名留痕);解决可被对方在页面上重开。`question` 类无法判断时
别擅自标解决,转述给用户。

## 一次性配置:让 AI 编码工具在任何项目都会部署

配好之后,在任何项目、任何新会话里说一句「把这个 html 部署到 pagepin」即可,不用再粘 token 和提示词。

**第 1 步 —— token 落盘**(在控制台 {{CONSOLE_BASE}} 复制你的 token):

```bash
mkdir -p ~/.config/pagepin \
  && printf 'pp_你的token' > ~/.config/pagepin/token \
  && chmod 600 ~/.config/pagepin/token
```

**第 2 步 —— 写进你工具的全局指令**(所有工具用同一段内容,见下方):

| 工具 | 全局指令位置 |
|---|---|
| Claude Code | 追加到 `~/.claude/CLAUDE.md` |
| Codex CLI | 追加到 `~/.codex/AGENTS.md` |
| OpenCode | 追加到 `~/.config/opencode/AGENTS.md` |
| Gemini CLI | 追加到 `~/.gemini/GEMINI.md` |
| Cursor | 设置 → Rules → **User Rules** 粘贴同样内容(无全局文件;项目级可放仓库根 `AGENTS.md`) |
| Windsurf | 追加到 `~/.codeium/windsurf/memories/global_rules.md` |

追加内容:

```markdown
# pagepin —— 静态页面托管(所有项目通用)

把 HTML/静态站点部署成 `{{CONTENT_BASE}}/<handle>/<slug>/` 可分享链接。
token 在 `~/.config/pagepin/token`;完整 API 说明见 {{CONSOLE_BASE}}/skill.md 。

单文件部署(同 slug 重复执行即更新,原子发版可回滚):

    curl -sf -X POST "{{CONSOLE_BASE}}/api/sites/<slug>/deploy" \
      -H "Authorization: Bearer $(cat ~/.config/pagepin/token)" \
      -F "files=@page.html" -F "paths=index.html"

响应 JSON 的 `url` 即访问链接。默认需登录才能看;
要对外公开:`PATCH /api/sites/<slug>` body `{"visibility":"public","public_hours":72}`。
```

注意:在控制台**轮换** token 后,记得同步更新 `~/.config/pagepin/token`。

网页版 AI(claude.ai / ChatGPT)没有跨会话记忆:用控制台 token 旁的 ✨ 按钮复制提示语逐次粘贴,或把提示语放进 claude.ai 的 Project instructions / ChatGPT 的 Custom Instructions 一次配置。

## 限制与错误码

- 配额(默认值,自托管可经环境变量调整):单文件 ≤25MB、单站点 ≤200MB、≤2000 个文件
  ——**一律以 `GET /api/me` 返回的 `limits` 为准**。
- 公开时长 `public_hours` 上限同样以服务端配置为准(默认 168 小时 = 7 天),超出会被强制收紧。
- `401` token 无效或已吊销;`404` 站点不存在;`409` 需先在控制台设置 handle;`413` 超出大小限制;`422` slug/路径非法。
- 部署完的站点**默认私有**(访问需登录)——别假设链接匿名可达;需要对外分享先 PATCH 设公开。
