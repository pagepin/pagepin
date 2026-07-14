// @ts-check
// markdown 查看器管线(static/md-viewer.js):自包含 —— 注入真实 marked/hljs/md-viewer,
// 不起后端。覆盖:frontmatter 卡、标题锚点+TOC scroll-spy、GitHub Alerts、代码块(高亮+复制)、
// 任务清单、表格包裹、外链新开、深色模式变量生效。
const path = require('path');
const fs = require('fs');
const { test, expect } = require('@playwright/test');

const STATIC = (f) => fs.readFileSync(path.join(__dirname, '../../static', f), 'utf8');
const MARKED = STATIC('marked.min.js');
const HLJS = STATIC('hljs.min.js');
const VIEWER = STATIC('md-viewer.js');
const CSS = STATIC('md-viewer.css');

const STRINGS = {
  toc: '目录',
  copy: '复制',
  copied: '已复制',
  alertNote: '注意',
  alertTip: '提示',
  alertImportant: '重要',
  alertWarning: '警告',
  alertCaution: '当心',
};

const MD = `---
status: as-built
date: 2026-07-14
tags: [pagepin, markdown]
---

# 渲染管线验收

开头段落,带一个[外链](https://example.com/docs)和一个[站内链](/other/page)。

## 功能清单

- [x] 已完成项
- [ ] 待办项

## 代码示例

\`\`\`js
const x = { a: 1 };
console.log(x);
\`\`\`

> [!WARNING]
> 这里是警告内容。

## 数据表

| 列一 | 列二 |
| --- | --- |
| a | b |

## 第四节

结尾。
`;

function shell(md) {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<link rel="stylesheet" href="/md-viewer.css"></head>
<body style="height:2400px">
<div class="pp-md-layout"><main id="pp-md-content">渲染中…</main></div>
<script src="/marked.min.js"></script>
<script src="/hljs.min.js"></script>
<script src="/md-viewer.js"></script>
<script>ppMdViewer.render(${JSON.stringify(md).replaceAll('</', '<\\/')}, { strings: ${JSON.stringify(STRINGS)} });</script>
</body></html>`;
}

async function setup(page, md = MD) {
  const js = (body) => ({ contentType: 'application/javascript; charset=utf-8', body });
  await page.route('**/marked.min.js', (r) => r.fulfill(js(MARKED)));
  await page.route('**/hljs.min.js', (r) => r.fulfill(js(HLJS)));
  await page.route('**/md-viewer.js', (r) => r.fulfill(js(VIEWER)));
  await page.route('**/md-viewer.css', (r) =>
    r.fulfill({ contentType: 'text/css; charset=utf-8', body: CSS }),
  );
  await page.route('https://pagepin.test/md', (r) =>
    r.fulfill({ contentType: 'text/html; charset=utf-8', body: shell(md) }),
  );
  await page.goto('https://pagepin.test/md');
}

test('frontmatter 切出成元数据卡,不进正文;标题拿到 GitHub 风格 id + hover 锚点', async ({
  page,
}) => {
  await setup(page);
  const fm = page.locator('.pp-md-fm');
  await expect(fm).toHaveCount(1);
  await expect(fm.locator('dt').first()).toHaveText('status');
  await expect(page.locator('main')).not.toContainText('as-built\ndate'); // 没被当正文渲染
  // h1 在 frontmatter 卡之后才是正文第一件事
  await expect(page.locator('h1')).toHaveText(/渲染管线验收/);
  await expect(page.locator('h1')).toHaveAttribute('id', '渲染管线验收');
  await expect(page.locator('h2#功能清单 a.pp-md-hl')).toHaveAttribute(
    'href',
    /%E5%8A%9F%E8%83%BD%E6%B8%85%E5%8D%95|#/,
  );
});

test('GitHub Alert:> [!WARNING] 变告示框,标记文本消失,本地化标题', async ({ page }) => {
  await setup(page);
  const alert = page.locator('.pp-md-alert-warning');
  await expect(alert).toHaveCount(1);
  await expect(alert.locator('.pp-md-alert-t')).toHaveText('警告');
  await expect(alert).toContainText('这里是警告内容');
  await expect(alert).not.toContainText('[!WARNING]');
  await expect(page.locator('blockquote')).toHaveCount(0); // 原 blockquote 已被替换
});

test('代码块:hljs 高亮 + 语言标签 + 复制按钮写剪贴板;表格进横滚容器;任务清单/外链', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await setup(page);
  const code = page.locator('.pp-md-code');
  await expect(code).toHaveCount(1);
  await expect(code.locator('.pp-md-code-h > span')).toHaveText('js');
  await expect(code.locator('code .hljs-keyword').first()).toHaveText('const'); // 真高亮了
  await code.locator('.pp-md-copy').click();
  await expect(code.locator('.pp-md-copy')).toHaveText('已复制');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain('console.log(x)');
  // 表格包裹 + 任务清单 + 外链
  await expect(page.locator('.pp-md-tw table')).toHaveCount(1);
  await expect(page.locator('li.pp-md-task input[type="checkbox"]')).toHaveCount(2);
  await expect(page.locator('a[href^="https://example.com"]')).toHaveAttribute('target', '_blank');
  await expect(page.locator('a[href="/other/page"]')).not.toHaveAttribute('target', '_blank');
});

test('TOC:左缘条码 rail 常驻、面板 hover 才浮出,滚动后 scroll-spy 双层同步(宽视口)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await setup(page);
  const toc = page.locator('.pp-md-toc');
  await expect(toc).toBeVisible();
  await expect(toc.locator('.pp-md-toc-rail a')).toHaveCount(4); // 条码:每节一根
  const panel = toc.locator('.pp-md-toc-panel');
  await expect(panel.locator('a')).toHaveCount(4);
  await expect(panel).not.toBeVisible(); // 默认收起,不占版心
  await toc.hover();
  await expect(panel).toBeVisible(); // hover 浮出
  await page.mouse.move(720, 400); // 移开收回
  await expect(panel).not.toBeVisible();
  await expect(panel.locator('a.pp-on')).toHaveText(/功能清单/); // 初始:首个标题
  await expect(toc.locator('.pp-md-toc-rail a.pp-on')).toHaveCount(1);
  // html{scroll-behavior:smooth} 会让 scrollIntoView 动画化 —— 用瞬时滚动直达
  await page.evaluate(() => {
    const el = document.getElementById('第四节');
    window.scrollTo({
      top: el.getBoundingClientRect().top + window.scrollY - 10,
      behavior: 'instant',
    });
  });
  await page.waitForTimeout(200);
  await expect(toc.locator('.pp-md-toc-panel a.pp-on')).toHaveText(/第四节/);
});

test('TOC:标题不足时不渲染;深色模式:背景切到深色变量', async ({ browser }) => {
  const ctx = await browser.newContext({ colorScheme: 'dark' });
  const page = await ctx.newPage();
  await setup(page, '# 只有一个标题\n\n正文。\n');
  await expect(page.locator('.pp-md-toc')).toHaveCount(0);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(14, 20, 22)'); // --pp-bg 深色值 #0e1416
  await ctx.close();
});
