// @ts-check
// 评论层（注入式 comments.js）端到端测试的共享脚手架。
//
// 思路：完全自包含 —— 注入真实 static/comments.js + 一组锚点元素，
// 用 page.route stub 掉 /api/viewer 与 /api/comments，不依赖后端进程或数据库。
// comments.js 从自身 <script data-*> 读配置、从 /api/viewer 取身份、从
// /api/comments/{handle}/{slug} 取线程，全部可拦截。
//
// v3 交互模型（右侧浮动抽屉 + 常驻 j/k + 发光相机）：
//   - 唯一全局 chrome = 右侧抽屉 [data-pp-role="drawer"]，默认展开（评审者一进来就看到评论）；
//     收起为右缘 tab [data-pp-role="tab"]。
//   - 读与改都在抽屉里的线程卡 [data-pp-role="card"]（data-tid / data-pp-num / data-pp-status /
//     聚焦时 data-pp-focused="1" 就地展开）；不再有 at-pin 弹层。
//   - 新建草稿落在抽屉里 [data-pp-role="draft"]。
//   - 锚点遮挡：抽屉占右侧 ~320px，落在其下的元素 pin 会被盖住 —— 测试锚点统一放抽屉左侧。
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
    selector, rx: 0.5, ry: 0.5, kind: null, anchor_text: null, resolved: false,
    comments: [{
      id: `c${n}`, author_sub: 'u-author', author_name: `作者${n}`,
      text: `这是第 ${n} 条评论的内容`, created_at: NOW,
    }],
    created_at: NOW,
    ...extra,
  };
}

/** boxes: [{id,left,top,text?}] → 绝对定位的锚点元素 + 注入脚本的整页 HTML。 */
function fixtureHtml(boxes) {
  const style = boxes.map((b) => `#${b.id}{left:${b.left}px;top:${b.top}px}`).join('');
  const divs = boxes.map((b) => `<div class="box" id="${b.id}">${b.text || b.id}</div>`).join('\n  ');
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<style>
  html,body{margin:0;height:1300px;font-family:-apple-system,sans-serif}
  .box{position:absolute;width:170px;height:70px;border:1px solid #ccc;
       border-radius:8px;padding:10px;background:#fafafa;box-sizing:border-box}
  ${style}
</style></head><body>
  ${divs}
  <script src="/comments.js" data-handle="alice" data-slug="demo"
          data-path="/" data-version="v1"></script>
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
          kind: body.kind, anchor_text: body.anchor_text,
          comments: [{
            id: `cnew${n}`, author_sub: VIEWER.sub, author_name: VIEWER.name,
            text: body.text, created_at: NOW,
          }],
        }),
      });
    }
    // 线程列表（GET）
    return threadsStatus === 200
      ? route.fulfill({ json: { threads } })
      : route.fulfill({ status: threadsStatus, json: { detail: '站点已关评论' } });
  });

  await page.route('**/comments.js', (route) =>
    route.fulfill({ contentType: 'application/javascript; charset=utf-8', body: COMMENTS_JS }));
  await page.route('http://pagepin.test/', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: html || fixtureHtml(boxes) }));
}

// 默认布局：四个锚点都在抽屉左侧（x≤510，不被右侧 320px 抽屉遮挡）、都在首屏内（top≤450）、互不重叠。
const DEFAULT_BOXES = [
  { id: 't1', left: 80, top: 80 }, { id: 't2', left: 340, top: 80 },
  { id: 't3', left: 80, top: 380 }, { id: 't4', left: 340, top: 380 },
];

// 常用定位器（与 v3 抽屉模型的稳定 data-pp-* 钩子对齐）
const pin = (page, n) =>
  page.locator('.pp-anno-pin').filter({ hasText: new RegExp(`^\\s*${n}\\s*$`) });
const drawer = (page) => page.locator('[data-pp-role="drawer"]');
const tab = (page) => page.locator('[data-pp-role="tab"]');
const act = (page, name) => page.locator(`[data-pp-act="${name}"]`);
// 线程卡：全部 / 按编号 / 当前聚焦展开的那张
const cards = (page) => page.locator('[data-pp-role="card"]');
const card = (page, n) => page.locator(`[data-pp-role="card"][data-pp-num="${n}"]`);
const focusedCard = (page) => page.locator('[data-pp-role="card"][data-pp-focused="1"]');
const draft = (page) => page.locator('[data-pp-role="draft"]');

async function goto(page) {
  await page.goto('http://pagepin.test/');
}
// 抽屉可见 = 评论层就绪门
const ready = async (page) => { await drawer(page).waitFor(); };

module.exports = {
  COMMENTS_JS, NOW, VIEWER, DEFAULT_BOXES,
  mkThread, fixtureHtml, setup, goto,
  pin, drawer, tab, act, cards, card, focusedCard, draft, ready,
};
