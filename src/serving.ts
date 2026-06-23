/** 数据平面 —— 只读静态 serving + 私有站点登录墙。
 *
 * 每个资源请求都过访问判定:
 *   公开且未过期 → 匿名放行(请求时判定,无需定时任务;过期自动回落登录墙)
 *   否则        → 必须有 viewer 会话(双域 pp_view;单域复用 pp_session)
 * 本平面不挂任何改数据接口(评论 API 是有意例外,见 comments.ts)。
 *
 * ※ edge-safe:静态 JS(comments.js/marked.min.js)构建期内联成字符串常量
 *   (src/generated/edge-assets.ts,由 pnpm gen:assets 生成),运行时不读盘。
 */

import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';

import { extOf, relHref } from './autoindex.js';
import { CLOCK_SVG, escapeHtml, FONTS, gateDoc, LOCK_SVG } from './brand-gate.js';
import { COMMENTS_JS, MARKED_JS } from './generated/edge-assets.js';
import type { Plane } from './auth/sessions.js';
import { readSession } from './auth/sessions.js';
import { currentVersion, isPubliclyVisible, sites, users } from './db/index.js';
import type { SiteRow, SiteVersion } from './db/index.js';
import { NotFoundError, NotModifiedError } from './storage/index.js';
import type { ObjectMeta } from './storage/index.js';
import type { AppDeps, AppEnv } from './types.js';
import { normalizeSitePath, RESERVED_SEGMENTS } from './util.js';

// ---- 评论层注入 ----
// 已登录访问者请求 HTML 时,在 </head> 前插入 comments.js(站点级 comments_enabled 开关)。
// 注入路径不走 streaming(要改字节),超过上限的 HTML 放弃注入原样流出,杜绝大文件进内存。
const INJECT_MAX_BYTES = 5 * 1024 * 1024;
const HEAD_CLOSE_RE = /<\/head\s*>/i;
const BODY_CLOSE_RE = /<\/body\s*>/i;

// 静态 JS 内联成构建期常量(edge 无 fs);ETag 用非加密 FNV-1a(只需内容变即变)
const ASSET_ENC = new TextEncoder();
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
interface StaticAsset {
  data: Uint8Array<ArrayBuffer>;
  etag: string;
}
function staticAsset(js: string): StaticAsset {
  const u = ASSET_ENC.encode(js);
  const data = new Uint8Array(new ArrayBuffer(u.byteLength));
  data.set(u);
  return { data, etag: `"${fnv1a(js)}${js.length.toString(16)}"` };
}
const COMMENTS_ASSET = staticAsset(COMMENTS_JS);
const MARKED_ASSET = staticAsset(MARKED_JS);

function injectTag(handle: string, slug: string, rel: string, versionId: string): string {
  const attrs = (
    [
      ['handle', handle],
      ['slug', slug],
      ['path', rel],
      ['version', versionId],
    ] as const
  )
    .map(([k, v]) => `data-${k}="${escapeHtml(v)}"`)
    .join(' ');
  return `<script defer src="/_pagepin/comments.js" ${attrs}></script>`;
}

/** 字节级注入:latin1 解码只做定位(字节位置 1:1),
 * 原文字节原样保留 —— 非 UTF-8 页面(GBK 等)不被 lossy 重编码破坏,BOM 不丢。 */
function injectScriptBytes(buf: Uint8Array, tag: string): Uint8Array<ArrayBuffer> {
  const tagBytes = new TextEncoder().encode(tag);
  const probe = new TextDecoder('latin1').decode(buf);
  let at = buf.length;
  for (const re of [HEAD_CLOSE_RE, BODY_CLOSE_RE]) {
    const m = re.exec(probe);
    if (m) {
      at = m.index;
      break;
    }
  }
  // 残缺 HTML(两个闭合标签都没有):追加到末尾,浏览器照样解析
  const out = new Uint8Array(buf.length + tagBytes.length);
  out.set(buf.subarray(0, at), 0);
  out.set(tagBytes, at);
  out.set(buf.subarray(at), at + tagBytes.length);
  return out;
}

// ---- 查看器壳:直接导航访问 .md / 图片时包一层可读页面(评论层因此自动可用)----
// 仅当请求方是「浏览器地址栏导航」(Accept 含 text/html)才包壳:
// 页面内 <img>/fetch 引用资源时 Accept 是 image/* 或 */*,原样返回,互不影响。
const IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif']);
const MD_EXTS = new Set(['.md', '.markdown']);

// ---- 访问门页(登录墙 / 已过期 / 404):品牌壳来自 brand-gate.ts,无评论层 ----

/** 私有页登录墙:命名 slug + 站长 + 「Sign in to view」(→ /auth/login?next=)。 */
function loginWallHtml(slug: string, ownerName: string, loginHref: string): string {
  const initial = escapeHtml((ownerName.replace(/^@/, '').trim()[0] || 'P').toUpperCase());
  return gateDoc(
    'Private · pagepin',
    `<div class="chip chip-teal">${LOCK_SVG}</div>
<h1>This page is private</h1>
<p class="body">You&rsquo;ve been invited to review <span class="mono teal">${escapeHtml(slug)}</span>. Sign in to view it &mdash; most reviewers use the email their invite was sent to.</p>
<a class="btn btn-primary" href="${escapeHtml(loginHref)}">Sign in to view</a>
<div class="row"><span class="avatar">${initial}</span>Shared by ${escapeHtml(ownerName)}</div>
<div class="foot">Hosted on <span class="mono">pagepin</span></div>`,
  );
}

/** 公开窗口已过期:已回落私有,告诉访客何时关闭 + 站长,可登录(若有权限)。 */
function linkExpiredHtml(ownerHandle: string, closedAgo: string, loginHref: string): string {
  return gateDoc(
    'Link expired · pagepin',
    `<div class="chip chip-amber">${CLOCK_SVG}</div>
<h1>This link has expired</h1>
<p class="body">This page was public for a limited time and has reverted to private. The share window closed <span style="color:#3a424b;font-weight:600">${escapeHtml(closedAgo)}</span>.</p>
<a class="btn btn-ghost" href="${escapeHtml(loginHref)}">Sign in</a>
<div class="row">Owner · <span class="mono" style="color:#8a929b">@${escapeHtml(ownerHandle)}</span></div>
<div class="foot">Hosted on <span class="mono">pagepin</span></div>`,
  );
}

/** 404:JetBrains-Mono 数字 + 可选「Go to site root →」。 */
function notFoundHtml(siteRoot?: string): string {
  return gateDoc(
    '404 · pagepin',
    `<div style="text-align:center">
<div class="mono" style="font-size:40px;font-weight:600;letter-spacing:-.02em;color:#11161b">404</div>
<div style="margin-top:4px;font-size:15px;font-weight:600;color:#3a424b">Page not found</div>
<p class="body" style="max-width:230px;margin:6px auto 0">We couldn&rsquo;t find that page or file on this site.</p>
${siteRoot ? `<a href="${escapeHtml(siteRoot)}" style="display:inline-block;margin-top:16px;font-size:13px;font-weight:600;color:#0f7c72;text-decoration:none">Go to site root &rarr;</a>` : ''}
</div>`,
  );
}

/** 过去时间的人话(站点过期判定:Date 在 Node 服务端,非沙箱)。 */
function fmtAgo(iso: string, now: Date): string {
  const diff = now.getTime() - new Date(iso).getTime();
  const min = 60_000,
    hour = 60 * min,
    day = 24 * hour;
  if (diff >= day) {
    const d = Math.floor(diff / day);
    return `${d} day${d === 1 ? '' : 's'} ago`;
  }
  if (diff >= hour) {
    const h = Math.floor(diff / hour);
    return `${h} hour${h === 1 ? '' : 's'} ago`;
  }
  return 'just now';
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const FILE_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>`;
const CODE_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/></svg>`;

const mdShell = (fname: string, contentJson: string, inject: string, sizeBytes: number) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${FONTS}<title>${fname}</title>
<style>
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;font-family:'Hanken Grotesk',system-ui,sans-serif;color:#3a424b;background:#fff}
.pp-md-head{display:flex;align-items:center;gap:11px;padding:13px 22px;border-bottom:1px solid #f0f1f2;background:#fcfcfd}
.pp-md-ic{width:30px;height:30px;border-radius:8px;background:#eef0f1;color:#6b7480;display:grid;place-items:center;flex-shrink:0}
.pp-md-name{display:block;font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:600;color:#11161b;line-height:1.3}
.pp-md-sub{display:block;font-size:11.5px;color:#9aa1a9;margin-top:1px}
.pp-md-raw{margin-left:auto;display:inline-flex;align-items:center;gap:5px;text-decoration:none;
  border:1px solid #e1e4e6;border-radius:8px;padding:5px 10px;font-size:12px;font-weight:600;color:#3a424b}
.pp-md-raw:hover{border-color:#0f7c72;color:#0f7c72}
main{max-width:680px;margin:0 auto;padding:34px 28px 96px;line-height:1.7;font-size:15.5px}
h1,h2,h3,h4{line-height:1.3;margin:1.6em 0 .6em;font-weight:700;color:#11161b}
h1{font-size:28px;letter-spacing:-.01em} h2{font-size:19px;padding-bottom:.25em;border-bottom:1px solid #f0f1f2}
h3{font-size:16px} p{margin:.8em 0;color:#3a424b} a{color:#0f7c72}
code{background:#f4f5f6;padding:.15em .45em;border-radius:5px;font-size:.86em;
  font-family:'JetBrains Mono',monospace;color:#0b6358}
pre{background:#11161b;border-radius:10px;padding:14px 18px;overflow-x:auto}
pre code{background:none;padding:0;font-size:.84em;line-height:1.65;color:#cfd6d4}
blockquote{margin:.8em 0;padding:.4em 1em;color:#57606a;border-left:3px solid #bfe5df;background:#f6f9f8;border-radius:0 6px 6px 0}
table{border-collapse:collapse;margin:1em 0;display:block;overflow-x:auto}
th,td{border:1px solid #e7e9eb;padding:7px 14px} th{background:#f4f5f6}
img{max-width:100%;border-radius:8px} hr{border:none;border-top:1px solid #eef0f1;margin:2em 0}
ul,ol{padding-left:1.6em} li{margin:.3em 0}
</style>
${inject}</head>
<body>
<header class="pp-md-head">
  <span class="pp-md-ic">${FILE_ICON}</span>
  <span><span class="pp-md-name">${fname}</span><span class="pp-md-sub">Markdown · ${fmtBytes(sizeBytes)}</span></span>
  <a class="pp-md-raw" href="?raw=1">${CODE_ICON} View raw</a>
</header>
<main id="pp-md-content">Rendering…</main>
<script src="/_pagepin/marked.min.js"></script>
<script>
document.getElementById('pp-md-content').innerHTML =
  marked.parse(${contentJson}, { gfm: true, breaks: true });
</script>
</body></html>`;

/** 同版本兄弟图片(顺序与画廊一致:rel 升序);单图/旧版本无清单 → null。 */
interface ImgView {
  imgs: string[];
  i: number;
  base: string; // 站点根的绝对路径前缀(/p/<handle>/<slug>/)
}

function imageView(files: string[] | undefined, rel: string, siteBase: string): ImgView | null {
  if (!files) return null; // 旧版本无清单 → 不出导航
  const imgs = files.filter((f) => IMG_EXTS.has(extOf(f))).sort((a, b) => a.localeCompare(b));
  const i = imgs.indexOf(rel);
  if (i < 0 || imgs.length < 2) return null;
  return { imgs, i, base: siteBase };
}

const CHEV_L = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`;
const CHEV_R = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;
const X_18 = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>`;
const EXT_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>`;

const imgShell = (title: string, src: string, inject: string, view: ImgView | null): string => {
  const pos = view
    ? `<span id="pp-img-pos" class="pp-img-pos">${view.i + 1} / ${view.imgs.length}</span>`
    : '';
  const arrow = (cls: string, id: string, rel: string | null, tip: string, ch: string) =>
    `<a class="pp-img-nav ${cls}" id="${id}" href="${rel ? escapeHtml(view!.base + relHref(rel)) : '#'}"${
      rel ? '' : ' style="visibility:hidden"'
    } title="${tip}">${ch}</a>`;
  const arrows = view
    ? arrow('pp-img-prev', 'pp-prev', view.i > 0 ? view.imgs[view.i - 1]! : null, 'Previous (←)', CHEV_L) +
      '\n' +
      arrow(
        'pp-img-next',
        'pp-next',
        view.i < view.imgs.length - 1 ? view.imgs[view.i + 1]! : null,
        'Next (→)',
        CHEV_R,
      ) +
      `\n<a class="pp-img-nav pp-img-close" id="pp-close" href="${escapeHtml(view.base)}" title="Back to index (Esc)">${X_18}</a>`
    : '';
  // 就地切换(lightbox):换 <img> 节点不跳页 → 零闪烁;pushState 同步 URL(刷新/分享/后退
  // 都落在正确图片);邻图预解码秒切。切换前派发 cancelable 的 pagepin:navigate,评论层
  // 据此换路径重拉线程,composer 有未发草稿时 preventDefault 阻断本次切换。
  const viewerScript = view
    ? `<script>
(() => {
  const IMGS = ${JSON.stringify(view.imgs).replaceAll('</', '<\\/')};
  const BASE = ${JSON.stringify(view.base)};
  let i = ${view.i};
  const href = (rel) => BASE + rel.split('/').map(encodeURIComponent).join('/');
  let cur = document.getElementById('pp-image');
  const nameEl = document.getElementById('pp-img-name');
  const posEl = document.getElementById('pp-img-pos');
  const prevA = document.getElementById('pp-prev');
  const nextA = document.getElementById('pp-next');
  const cache = new Map([[IMGS[i], cur]]); // rel → 预解码好的 <img>(no-store 下避免重拉字节)
  const nodeFor = (rel) => {
    let n = cache.get(rel);
    if (!n) { n = new Image(); n.src = href(rel); cache.set(rel, n); }
    return n;
  };
  const preload = () => {
    if (i > 0) nodeFor(IMGS[i - 1]);
    if (i < IMGS.length - 1) nodeFor(IMGS[i + 1]);
  };
  function show(j, push) {
    if (j < 0 || j >= IMGS.length || j === i) return;
    const ev = new CustomEvent('pagepin:navigate', { cancelable: true, detail: { path: IMGS[j] } });
    if (!dispatchEvent(ev)) return; // 评论草稿未发:评论层已抖动提示,本次切换作罢
    i = j;
    const rel = IMGS[i];
    const n = nodeFor(rel);
    n.id = 'pp-image';
    n.alt = rel;
    n.style.opacity = '0';
    cur.replaceWith(n);
    cur = n;
    (n.decode ? n.decode().catch(() => {}) : Promise.resolve())
      .then(() => requestAnimationFrame(() => { n.style.opacity = ''; }));
    nameEl.textContent = rel;
    posEl.textContent = (i + 1) + ' / ' + IMGS.length;
    document.title = rel.split('/').pop();
    prevA.style.visibility = i > 0 ? '' : 'hidden';
    nextA.style.visibility = i < IMGS.length - 1 ? '' : 'hidden';
    if (i > 0) prevA.href = href(IMGS[i - 1]);
    if (i < IMGS.length - 1) nextA.href = href(IMGS[i + 1]);
    if (push) history.pushState({ ppImg: i }, '', href(rel));
    preload();
  }
  const onNav = (d) => (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return; // 让开新标签页等原生行为
    e.preventDefault();
    show(i + d, true);
  };
  prevA.addEventListener('click', onNav(-1));
  nextA.addEventListener('click', onNav(1));
  addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'ArrowLeft') show(i - 1, true);
    else if (e.key === 'ArrowRight') show(i + 1, true);
  });
  addEventListener('popstate', (e) => {
    show(e.state && typeof e.state.ppImg === 'number' ? e.state.ppImg : ${view.i}, false);
  });
  // 关闭预览(×/Esc)回索引页。Esc 分层:评论弹窗/评论模式开着时归评论层
  // (capture 比评论层的 document 监听先跑,看到的是未被它消费前的状态);
  // × 在有未发草稿时拦下导航,评论层的点击外部处理会抖动提示,不丢稿。
  const closeA = document.getElementById('pp-close');
  closeA.addEventListener('click', (e) => {
    const ta = document.querySelector('[data-pp-role="draft"] textarea, [data-pp-role="reply"] textarea');
    if (ta && ta.value.trim()) e.preventDefault();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const de = document.documentElement;
    // 评论层占用 Esc 时让权（弹层/列表/Walk/评论模式 → pp-anno-paused / pp-anno-mode-on）
    if (de.classList.contains('pp-anno-paused') || de.classList.contains('pp-anno-mode-on')) return;
    location.href = BASE;
  }, true);
  history.replaceState({ ppImg: i }, '');
  preload();
})();
</script>`
    : '';
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${FONTS}<title>${title}</title>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;font-family:'Hanken Grotesk',system-ui,sans-serif;
  background:#e9ebec;background-image:repeating-conic-gradient(#e3e5e7 0 25%,#e9ebec 0 50%);background-size:20px 20px}
.pp-img-head{display:flex;align-items:center;gap:12px;padding:11px 18px;background:#fcfcfd;border-bottom:1px solid #f0f1f2;flex-shrink:0}
.pp-img-name{font-family:'JetBrains Mono',monospace;font-size:12.5px;font-weight:600;color:#11161b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pp-img-right{margin-left:auto;display:flex;align-items:center;gap:14px;flex-shrink:0}
.pp-img-pos{font-family:'JetBrains Mono',monospace;font-size:11.5px;color:#9aa1a9;font-variant-numeric:tabular-nums}
.pp-img-orig{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;font-weight:600;color:#0f7c72;text-decoration:none}
.pp-img-orig:hover{text-decoration:underline}
/* 居中交给内层包裹,body 保持普通流 —— 对后插入 body 的脚本/容器免疫 */
.pp-img-wrap{flex:1;display:grid;place-items:center;min-height:0;padding:24px}
figure{margin:0;text-align:center}
img{max-width:calc(100vw - 48px);max-height:calc(100vh - 130px);border-radius:6px;
  box-shadow:0 12px 40px -8px rgba(17,22,27,.28);background:#fff;transition:opacity .15s ease}
.pp-img-err{color:#6b7480;font-size:13px}
/* 翻页箭头压在评论层之下(pin 2147482600 / 区域框 2147481900) */
.pp-img-nav{position:fixed;top:calc(50% + 22px);transform:translateY(-50%);z-index:2147480000;
  width:40px;height:40px;border-radius:50%;display:grid;place-items:center;
  background:#fff;border:1px solid #e1e4e6;color:#3a424b;box-shadow:0 4px 14px -4px rgba(17,22,27,.2);
  text-decoration:none;user-select:none;transition:border-color .15s,color .15s,box-shadow .15s}
.pp-img-nav:hover{border-color:#0f7c72;color:#0f7c72;box-shadow:0 6px 18px -4px rgba(17,22,27,.28)}
.pp-img-prev{left:16px}.pp-img-next{right:16px}
.pp-img-close{top:58px;right:16px;transform:none;width:36px;height:36px}
</style>
${inject}</head>
<body>
<header class="pp-img-head">
  <span id="pp-img-name" class="pp-img-name">${title}</span>
  <span class="pp-img-right">${pos}<a class="pp-img-orig" href="?raw=1">${EXT_ICON} View original</a></span>
</header>
<div class="pp-img-wrap">
<figure>
  <img id="pp-image" src="${src}" alt="${title}"
       onerror="this.closest('figure').innerHTML='<div class=&quot;pp-img-err&quot;>Image failed to load</div>'">
</figure>
</div>
${arrows}
${viewerScript}
</body></html>`;
};

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** 静态 JS:no-cache + ETag revalidate(comments.js 发版即生效)/ vendor 长缓存 */
function staticJs(
  c: Context<AppEnv>,
  data: Uint8Array<ArrayBuffer>,
  etag: string,
  cacheControl: string,
): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': cacheControl,
    ETag: etag,
  };
  if (c.req.header('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(data, { headers });
}

export interface ServingOptions {
  /** HTML 注入策略(Workers 注入 HTMLRewriter 流式注入器,见 serving-inject.ts);
   * 不传(Node)时 >5MB HTML 不注入、原样流出。≤5MB 一律走内置字节注入。 */
  injectHtmlStream?: (resp: Response, tag: string) => Response;
}

export function makeServingRoutes(deps: AppDeps, opts: ServingOptions = {}): Hono<AppEnv> {
  const { config: cfg, db, storage } = deps;
  const injectHtmlStream = opts.injectHtmlStream;
  const single = cfg.mode !== 'dual';
  // viewer 会话:双域走内容域 pp_view;单域 viewer 复用控制台 pp_session
  const plane: Plane = single ? 'session' : 'view';
  const prefix = single ? '/p' : '';

  const app = new Hono<AppEnv>();

  // ★ 必须先于下方站点通配路由注册;"_pagepin" 不符合 handle 规则,无冲突
  app.get('/_pagepin/comments.js', (c) =>
    staticJs(c, COMMENTS_ASSET.data, COMMENTS_ASSET.etag, 'no-cache'),
  );
  app.get('/_pagepin/marked.min.js', (c) =>
    staticJs(c, MARKED_ASSET.data, MARKED_ASSET.etag, 'public, max-age=86400'),
  );

  const notFound = (c: Context<AppEnv>, siteRoot?: string) => c.html(notFoundHtml(siteRoot), 404);

  /** 文件清单懒回填:清单随部署写入,更早的版本没有 → 有 list 能力的驱动(fs)
   * 访问图片时现场补一次写回 DB,本次响应即带导航;S3 等无 list 驱动跳过。
   * 回填清单会多出部署期生成物(自动索引页/根 html 别名),均非图片,不影响导航。 */
  async function ensureFiles(site: SiteRow, cur: SiteVersion): Promise<string[] | undefined> {
    if (cur.files || !storage.list) return cur.files;
    let listed: string[];
    try {
      listed = await storage.list(cur.storage_prefix);
    } catch {
      return undefined; // 回填失败不影响出图
    }
    if (listed.length === 0 || listed.length > 2000) return undefined; // 上限与部署侧同一口径
    cur.files = listed; // 本次响应即带导航,落库失败也不影响
    // 尽力而为回填(D1 无交互事务):重读 → 该版本仍缺清单才写回;不动 updatedAt(元数据补写非内容更新)。
    try {
      const fresh = await db.select().from(sites).where(eq(sites.id, site.id)).get();
      if (fresh) {
        const v = fresh.versions.find((x) => x.id === cur.id);
        if (v && !v.files) {
          v.files = listed;
          await db.update(sites).set({ versions: fresh.versions }).where(eq(sites.id, site.id)).run();
        }
      }
    } catch {
      /* 回填失败不影响出图 */
    }
    return listed;
  }

  /** 从 pathname 拆 handle/slug/站内路径(段级 decode,对齐 FastAPI path 参数解码)。 */
  function splitSitePath(c: Context<AppEnv>): { handle: string; slug: string; rest: string } {
    const segs = c.req.path.split('/'); // ['', ('p',) handle, slug, ...rest]
    const base = single ? 2 : 1;
    return {
      handle: safeDecode(segs[base] ?? ''),
      slug: safeDecode(segs[base + 1] ?? ''),
      rest: segs.slice(base + 2).map(safeDecode).join('/'),
    };
  }

  const siteRootNoSlash = (c: Context<AppEnv>) => {
    const { handle, slug } = splitSitePath(c);
    if (RESERVED_SEGMENTS.has(handle)) return notFound(c); // /api/* 等保留段:本平面没有这些路由
    // 必须带尾斜杠,站点内相对资源路径才解析得对
    return c.redirect(`${prefix}/${handle}/${slug}/`, 308);
  };

  const serve = async (c: Context<AppEnv>): Promise<Response> => {
    const { handle, slug, rest } = splitSitePath(c);
    if (RESERVED_SEGMENTS.has(handle)) return notFound(c);
    const site = await db
      .select()
      .from(sites)
      .where(and(eq(sites.ownerHandle, handle), eq(sites.slug, slug), isNull(sites.deletedAt)))
      .get();
    if (!site || site.currentVersionId === null) return notFound(c);

    const siteRoot = `${prefix}/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}/`;
    const now = new Date();
    const pub = isPubliclyVisible(site, now);
    const claims = await readSession(c, cfg, plane);
    // 查库判活:会话用户须存在且未被禁用,否则按未登录处理(私有页不放行、不注入评论层)
    let viewerActive = false;
    if (claims !== null) {
      const u = await db
        .select({ disabled: users.disabled })
        .from(users)
        .where(eq(users.id, claims.sub))
        .get();
      viewerActive = u !== undefined && !u.disabled;
    }
    if (!pub && !viewerActive) {
      // 品牌门页(不再裸 302):曾公开但窗口已关 → 过期页;否则私有 → 登录墙。
      // 「Sign in」回 /auth/login?next=,登录后落回本页。
      const loginHref = `/auth/login?next=${encodeURIComponent(c.req.path)}`;
      const gateHeaders = { 'Cache-Control': 'no-store, private' };
      if (site.visibility === 'public' && site.publicExpiresAt) {
        return c.html(linkExpiredHtml(handle, fmtAgo(site.publicExpiresAt, now), loginHref), 200, gateHeaders);
      }
      const owner = await db.select().from(users).where(eq(users.id, site.ownerId)).get();
      const ownerName = owner?.displayName || `@${handle}`;
      return c.html(loginWallHtml(slug, ownerName, loginHref), 200, gateHeaders);
    }
    // 评论层只给已登录且未禁用的访问者注入:匿名公开访客(对外客户)看到的是干净页面
    const canInject = site.commentsEnabled && viewerActive;

    // 目录式 URL(空路径或尾斜杠)直接落 index.html
    const raw = !rest || rest.endsWith('/') ? rest + 'index.html' : rest;
    const rel = normalizeSitePath(raw);
    if (rel === null) return c.json({ detail: 'Invalid path' }, 400);

    const cur = currentVersion(site);
    if (!cur) return notFound(c, siteRoot); // 防御:current_version_id 与 versions 不一致时明确 404 而非 500

    const baseHeaders: Record<string, string> = {
      'X-Content-Type-Options': 'nosniff',
      // 公开内容也别被搜索引擎收录
      'X-Robots-Tag': 'noindex, nofollow',
      // 私有 no-store;公开 no-cache(每次 revalidate,保证过期及时生效)
      'Cache-Control': pub ? 'no-cache' : 'no-store, private',
    };

    // ---- 查看器壳:浏览器直接导航访问 .md / 图片 ----
    const rawMode = c.req.query('raw') !== undefined;
    const acceptHtml = (c.req.header('accept') ?? '').includes('text/html');
    const fname = rel.split('/').pop() ?? rel;
    const ext = fname.includes('.') ? '.' + fname.split('.').pop()!.toLowerCase() : '';
    const injectHtml = canInject ? injectTag(handle, slug, rel, cur.id) : '';

    if (!rawMode && acceptHtml && IMG_EXTS.has(ext)) {
      if (await storage.exists(cur.storage_prefix + rel)) {
        const siteBase = `${prefix}/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}/`;
        return c.html(
          imgShell(
            escapeHtml(fname),
            escapeHtml(c.req.path),
            injectHtml,
            imageView(await ensureFiles(site, cur), rel, siteBase),
          ),
          200,
          baseHeaders,
        );
      }
      // 对象不存在:落到常规流程返回 404 页
    }

    if (!rawMode && acceptHtml && MD_EXTS.has(ext)) {
      let opened: { meta: ObjectMeta; body: ReadableStream<Uint8Array> } | null = null;
      try {
        opened = await storage.open(cur.storage_prefix + rel);
      } catch (e) {
        if (!(e instanceof NotFoundError)) throw e; // NotFound → 常规流程 404
      }
      if (opened) {
        if ((opened.meta.contentLength ?? 0) <= INJECT_MAX_BYTES) {
          const buf = await new Response(opened.body).arrayBuffer();
          const text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
          // </ 转义防止 markdown 原文里的 </script> 提前闭合壳页脚本
          const contentJson = JSON.stringify(text).replaceAll('</', '<\\/');
          return c.html(
            mdShell(escapeHtml(fname), contentJson, injectHtml, opened.meta.contentLength ?? buf.byteLength),
            200,
            baseHeaders,
          );
        }
        // 超大 md:原样流出(已打开的流直接用)
        return new Response(opened.body, {
          headers: { ...baseHeaders, 'Content-Type': opened.meta.contentType },
        });
      }
    }

    // 依次尝试:精确路径 → <path>/index.html(无扩展名时)→ 根 index.html(spa_fallback)
    const candidates = [rel];
    if (!(rel.split('/').pop() ?? '').includes('.')) candidates.push(`${rel}/index.html`);
    if (site.spaFallback) candidates.push('index.html');

    let meta: ObjectMeta | null = null;
    let body: ReadableStream<Uint8Array> | null = null;
    let hit = '';
    for (const cand of candidates) {
      // 注入候选(HTML 且开评论)不带条件请求:响应体会被改写,存储层的 ETag 对不上号
      const candLower = cand.toLowerCase();
      const injectThis =
        canInject && (candLower.endsWith('.html') || candLower.endsWith('.htm'));
      try {
        const o = await storage.open(cur.storage_prefix + cand, {
          ifNoneMatch: injectThis ? undefined : c.req.header('if-none-match'),
        });
        meta = o.meta;
        body = o.body;
        hit = cand;
        break;
      } catch (e) {
        if (e instanceof NotModifiedError) return new Response(null, { status: 304 });
        if (e instanceof NotFoundError) continue;
        throw e;
      }
    }
    if (meta === null || body === null) return notFound(c, siteRoot);

    // 评论层注入:HTML 改写后字节/长度变,存储层的 ETag/Last-Modified/Content-Length 都不再一致,一律不带
    const hitLower = hit.toLowerCase();
    const injectableHtml =
      canInject &&
      (hitLower.endsWith('.html') || hitLower.endsWith('.htm')) &&
      meta.contentType.includes('html');
    if (injectableHtml && (meta.contentLength ?? 0) <= INJECT_MAX_BYTES) {
      // ≤5MB:整读 + 字节级注入(跨运行时一致,保非 UTF-8/BOM 原样)
      const buf = new Uint8Array(await new Response(body).arrayBuffer());
      const out = injectScriptBytes(buf, injectTag(handle, slug, hit, cur.id));
      return new Response(out, {
        headers: { ...baseHeaders, 'Content-Type': meta.contentType },
      });
    }
    if (injectableHtml && injectHtmlStream) {
      // >5MB:HTMLRewriter 流式注入(Workers;去整读上限,不占内存)
      const src = new Response(body, { headers: { ...baseHeaders, 'Content-Type': meta.contentType } });
      return injectHtmlStream(src, injectTag(handle, slug, hit, cur.id));
    }
    // 否则(>5MB 且无流式注入器,如 Node)原样流出,不注入

    const headers: Record<string, string> = { ...baseHeaders, 'Content-Type': meta.contentType };
    if (meta.etag) headers['ETag'] = meta.etag;
    if (meta.lastModified) headers['Last-Modified'] = meta.lastModified;
    if (meta.contentLength != null) headers['Content-Length'] = String(meta.contentLength);
    return new Response(body, { headers });
  };

  // 无尾斜杠精确路由必须先注册:Hono 的尾部 /* 也会匹配不带斜杠的 /:handle/:slug
  if (single) {
    app.get('/p/:handle/:slug', siteRootNoSlash);
    app.get('/p/:handle/:slug/*', serve);
  } else {
    app.get('/:handle/:slug', siteRootNoSlash);
    app.get('/:handle/:slug/*', serve);
  }

  return app;
}
