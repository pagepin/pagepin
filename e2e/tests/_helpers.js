// @ts-check
// 评论层（注入式 comments.js）端到端测试的共享脚手架。
//
// 思路：完全自包含 —— 注入真实 static/comments.js + 一组锚点元素，
// 用 page.route stub 掉 /api/viewer 与 /api/comments，不依赖后端进程或数据库。
// comments.js 从自身 <script data-*> 读配置、从 /api/viewer 取身份、从
// /api/comments/{handle}/{slug} 取线程，全部可拦截。
//
// Lumen 桌面交互模型（右下 pill 坞 + 托盘列表面 + at-pin popover 详情面 + 就地草稿气泡）：
//   - 常驻右下 pill 坞 [data-pp-role="dock"]：画笔 [data-pp-act="comment"] = arm 评论模式；
//     计数钮 [data-pp-role="dock-count"]（[data-pp-act="collapse"]）= 开合托盘 + 未解决徽标。
//   - 列表面 = 右下托盘 [data-pp-role="tray"]，默认展开（评审者一进来就看到评论）；收起为
//     仅剩 pill 坞（托盘 display:none + .pp-anno-tray-closed）。托盘行 = [data-pp-role="card"]
//     （data-tid / data-pp-num / data-pp-status / data-pp-kind），但**不带** data-pp-focused。
//   - 详情面 = 浮在 pin 旁的 at-pin popover [data-pp-role="card"][data-pp-focused="1"]，承载
//     评论流（.pp-anno-msg/.pp-anno-txt）/回复框/resolve/reopen/kind chips/copy-link/删除。
//   - 新建草稿 = 浮在锚点旁的气泡 [data-pp-role="draft"]。
//   - 历史兼容：`drawer(page)` 别名指向托盘 [data-pp-role="tray"]，`tab(page)` 指向坞。
//   - focusedCard 只匹配 popover（托盘行永不带 focused）；card(n) 用 :not([data-pp-focused])
//     限定托盘行，避免「同 num 两个 card」破坏计数断言。
const path = require('path');
const fs = require('fs');

const COMMENTS_JS = fs.readFileSync(
  path.join(__dirname, '../../static/comments.js'), 'utf8');

const NOW = '2026-06-11T00:00:00+00:00';
const VIEWER = { sub: 'u-tester', name: '测试者', handle: 'tester' };

/** 造一条线程；extra 可覆盖 selector/anchor_text/resolved/kind/comments 等。 */
function mkThread(n, selector, extra = {}) {
  return {
    id: `thread-${n}`, page_path: '/', version_id: 'v1',
    selector, rx: 0.5, ry: 0.5, kind: null, anchor_text: null, quote: null, resolved: false,
    comments: [{
      id: `c${n}`, author_sub: 'u-author', author_name: `作者${n}`,
      text: `这是第 ${n} 条评论的内容`, created_at: NOW,
    }],
    created_at: NOW,
    ...extra,
  };
}

/** boxes: [{id,left,top,text?}] → 绝对定位的锚点元素 + 注入脚本的整页 HTML。
 *  height 可选（移动端深链相机测试需要更长的页面才有滚动余量）。 */
function fixtureHtml(boxes, height = 1300, versionN = null) {
  const style = boxes.map((b) => `#${b.id}{left:${b.left}px;top:${b.top}px}`).join('');
  const divs = boxes.map((b) => `<div class="box" id="${b.id}">${b.text || b.id}</div>`).join('\n  ');
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html,body{margin:0;height:${height}px;font-family:-apple-system,sans-serif}
  .box{position:absolute;width:170px;height:70px;border:1px solid #ccc;
       border-radius:8px;padding:10px;background:#fafafa;box-sizing:border-box}
  ${style}
</style></head><body>
  ${divs}
  <script src="/comments.js" data-handle="alice" data-slug="demo"
          data-path="/" data-version="v1"${versionN ? ` data-version-n="${versionN}"` : ''}></script>
</body></html>`;
}

/**
 * 注册全部路由。opts:
 *   boxes          锚点元素布局（默认 4 个）
 *   threads        线程数组
 *   viewer         /api/viewer 返回体（默认已登录）
 *   viewerStatus   /api/viewer 状态码（401 = 匿名访客）
 *   threadsStatus  线程列表状态码（403 = 站点已关评论）
 *   reply          POST 回复时返回的 comment（默认自动造一条）
 */
async function setup(page, opts = {}) {
  const {
    boxes = DEFAULT_BOXES, threads = [], viewer = VIEWER,
    viewerStatus = 200, threadsStatus = 200, reply,
    html,        // 自定义整页 HTML(默认 fixtureHtml(boxes))
    onCreate,    // 新建线程时回调(拿到 POST body,供断言 rw/rh 等)
    onPatch,     // PATCH 线程时回调(拿到 body,供断言 resolved/kind)
    onReply,     // POST 回复时回调(拿到 body,供断言 author_name 等)
  } = opts;

  // comments.js 现在带 ?handle=&slug= 探测分享会话访客 —— 通配须吃掉查询串
  await page.route('**/api/viewer*', (route) =>
    viewerStatus === 200
      ? route.fulfill({ json: viewer })
      : route.fulfill({ status: viewerStatus, json: { detail: '匿名' } }));

  await page.route('**/api/comments/**', async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    // 回复
    if (url.includes('/threads/') && url.endsWith('/replies') && method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      if (onReply) onReply(body);
      const c = reply || {
        id: 'reply-1', author_sub: VIEWER.sub, author_name: VIEWER.name,
        text: body.text || '', created_at: NOW,
      };
      return route.fulfill({ json: c });
    }
    // 标记解决 / 重新打开 / 改 kind —— 只回显本次改动的字段(对齐后端 threadOut 的合并语义)
    if (url.includes('/threads/') && method === 'PATCH') {
      const body = JSON.parse(req.postData() || '{}');
      if (onPatch) onPatch(body);
      const out = {};
      if ('resolved' in body) out.resolved = !!body.resolved;
      if ('kind' in body) out.kind = body.kind;
      return route.fulfill({ json: out });
    }
    // 删除
    if (url.includes('/threads/') && method === 'DELETE') {
      return route.fulfill({ status: 204, body: '' });
    }
    // 新建线程
    if (method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      if (onCreate) onCreate(body);
      const n = threads.length + 1;
      return route.fulfill({
        json: mkThread(n, body.selector, {
          rx: body.rx, ry: body.ry, rw: body.rw ?? null, rh: body.rh ?? null,
          kind: body.kind, anchor_text: body.anchor_text, quote: body.quote ?? null,
          comments: [{
            id: `cnew${n}`, author_sub: VIEWER.sub, author_name: VIEWER.name,
            text: body.text, created_at: NOW,
          }],
        }),
      });
    }
    // 线程列表（GET）—— dyn 允许测试中途改版本/线程（模拟 agent 发新版/远程 resolve）
    const dyn = opts.dyn;
    return threadsStatus === 200
      ? route.fulfill({ json: {
          threads: dyn && dyn.threads ? dyn.threads : threads,
          site_version: (dyn && dyn.site_version) || 'v1',
        } })
      : route.fulfill({ status: threadsStatus, json: { detail: '站点已关评论' } });
  });

  await page.route('**/comments.js', (route) =>
    route.fulfill({ contentType: 'application/javascript; charset=utf-8', body: COMMENTS_JS }));
  await page.route('http://pagepin.test/', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: html || fixtureHtml(boxes, opts.height || 1300, opts.versionN || null) }));
}

// 默认布局：四个锚点都在抽屉左侧（x≤510，不被右侧 320px 抽屉遮挡）、都在首屏内（top≤450）、互不重叠。
const DEFAULT_BOXES = [
  { id: 't1', left: 80, top: 80 }, { id: 't2', left: 340, top: 80 },
  { id: 't3', left: 80, top: 380 }, { id: 't4', left: 340, top: 380 },
];

// 常用定位器（与 Lumen 桌面模型的稳定 data-pp-* 钩子对齐）
// pin 文本是首评作者缩写(设计稿 p.label),编号走 data-pp-num 钩子
const pin = (page, n) => page.locator(`.pp-anno-pin[data-pp-num="${n}"]`);
// drawer 别名 → 托盘（列表面）；tab 别名 → 坞（收起态入口）；dockCount → 坞计数钮
const drawer = (page) => page.locator('[data-pp-role="tray"]');
const tray = (page) => page.locator('[data-pp-role="tray"]');
const tab = (page) => page.locator('[data-pp-role="dock"]');
const dock = (page) => page.locator('[data-pp-role="dock"]');
const dockCount = (page) => page.locator('[data-pp-role="dock-count"]');
const act = (page, name) => page.locator(`[data-pp-act="${name}"]`);
// 线程卡：托盘行（全部 / 按编号，均排除 popover）/ 当前聚焦的 at-pin popover
const cards = (page) => page.locator('[data-pp-role="card"]:not([data-pp-focused="1"])');
const card = (page, n) =>
  page.locator(`[data-pp-role="card"][data-pp-num="${n}"]:not([data-pp-focused="1"])`);
const focusedCard = (page) => page.locator('[data-pp-role="card"][data-pp-focused="1"]');
const draft = (page) => page.locator('[data-pp-role="draft"]');

async function goto(page) {
  await page.goto('http://pagepin.test/');
}
// 托盘可见 = 评论层就绪门（桌面默认展开）
const ready = async (page) => { await tray(page).waitFor(); };

module.exports = {
  COMMENTS_JS, NOW, VIEWER, DEFAULT_BOXES,
  mkThread, fixtureHtml, setup, goto,
  pin, drawer, tray, tab, dock, dockCount, act, cards, card, focusedCard, draft, ready,
};
