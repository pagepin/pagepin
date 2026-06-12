# 评论层 E2E 测试

注入式评论层（`static/comments.js`）的端到端回归测试。

**自包含**：每个用例注入真实的 `comments.js` + 一组锚点元素，用 Playwright `page.route`
stub 掉 `/api/viewer` 与 `/api/comments`。**不需要启动后端，也不需要数据库。**

## 跑

```bash
cd e2e
pnpm install          # 首次：装 @playwright/test（chromium 走本地缓存，通常无需下载）
pnpm test             # 全部用例
pnpm test:headed      # 带界面看一眼
```

浏览器版本锁在 `@playwright/test@1.58.1`（对应 Chromium 145 / build 1208）。

## 覆盖

| 文件 | 覆盖点 |
|---|---|
| `pin-switch.spec.js` | **核心 bug 回归**：弹窗打开时直接点另一个 pin 必须切换（z-index 层级修复） |
| `identity.spec.js` | 匿名访客（viewer 401）不注入；站点关评论（403）自我移除；登录则注入 |
| `anchoring.spec.js` | 锚点降级：`@page` / 选择器丢失 / 内容指纹不匹配 都不渲染 pin，但在侧栏列出并标注 |
| `interaction.spec.js` | Esc / 点空白关闭；回复后楼层 +1 且焦点回输入框；草稿切走再切回仍在 |

共享脚手架在 `tests/_helpers.js`（`setup()` 注册路由、`mkThread()` 造数据、`pin()/header()` 定位器）。
