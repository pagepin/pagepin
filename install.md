# Install the pagepin agent skill

Teach your AI coding agent to deploy static pages to pagepin and run the
review-comment loop. Installed once, it works in every project and every new
session — no token pasted into chat, no per-tool config files to hand-edit.

## Install (one command)

The skill ships in this repo at [`skills/pagepin/SKILL.md`](skills/pagepin/SKILL.md).
Install it with the open-source [`skills`](https://github.com/vercel-labs/skills)
CLI (Node ≥18; runs on macOS, Linux, Windows, and WSL):

```bash
npx skills add pagepin/pagepin -g
```

Run it and the CLI **auto-detects your installed agents** and asks which ones to
add the skill to. `-g` installs globally (all projects); drop it for the current
project only. Uninstall any time with `npx skills remove pagepin -g`.

Prefer a no-prompts, scripted install (e.g. CI)? Name the agents and skip
confirmations explicitly:

```bash
npx skills add pagepin/pagepin -g -y \
  -a claude-code -a codex -a cursor -a gemini-cli -a opencode -a windsurf
# on Windows, add --copy if symlink creation is restricted
```

### Claude Code: native plugin (alternative)

Claude Code can also install from this repo as a plugin (bundles the skill, and
later an MCP server / slash commands if added):

```text
/plugin marketplace add pagepin/pagepin
/plugin install pagepin@pagepin
```

## Use it

1. **Start a new session** (skills, like project memory, load at session start).
2. Just say it naturally, e.g. *"deploy this HTML to pagepin and make it public"*
   or *"把这个报告部署到 pagepin 给我个链接"*. The agent recognizes the skill from
   its description and follows it.
3. **First time only**, the agent logs you in through the browser (OAuth device
   flow) and stores the token at `~/.config/pagepin/token` — it never prints the
   token or asks you to paste one. After that, it just deploys.
4. The agent returns the shareable `url`.

## No install? Manual fallback

Any agent can also just be pointed at the live, instance-aware guide:

```text
Read https://YOUR-PAGEPIN-HOST/skill.md and follow it to deploy with pagepin.
```

This is the right path for web-based assistants with no local skill directory.

---

## 中文快速上手

把 AI 编码工具教会"部署静态页面到 pagepin"。装一次，所有项目、所有新会话都能用，
token 不进聊天，也不用手改任何全局指令文件。

```bash
npx skills add pagepin/pagepin -g
```

不用加一堆参数 —— CLI 会**自动探测你装了哪些 agent** 并让你勾选；`-g` 表示全局
（所有项目），去掉就是只装当前项目。需要 CI / 全自动无交互时，再显式指定
`-y -a claude-code -a codex …`。卸载：`npx skills remove pagepin -g`。

装完**开个新会话**，直接说「把这个 HTML 部署到 pagepin，并公开」即可。**首次**会通过
浏览器登录（设备授权流程）把 token 存到 `~/.config/pagepin/token`，全程不打印、不让你粘贴。

无法安装时（如网页版 AI），让它读 `https://你的-pagepin-域名/skill.md` 并照着做即可。
