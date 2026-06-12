/** 数据平面 —— 只读静态 serving + 私有站点登录墙。
 *
 * 每个资源请求都过访问判定:
 *   公开且未过期 → 匿名放行(请求时判定,无需定时任务;过期自动回落登录墙)
 *   否则        → 必须有 viewer 会话(双域 pp_view;单域复用 pp_session)
 * 本平面不挂任何改数据接口(评论 API 是有意例外,见 comments.ts)。
 *
 * ※ 本文件允许 Node import(static/ 文件模块顶层读一次缓存);
 *   集成 edge 运行时再把两段 JS 抽成注入的字符串常量。
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';

import type { Plane } from './auth/sessions.js';
import { readSession } from './auth/sessions.js';
import { currentVersion, isPubliclyVisible, sites } from './db/index.js';
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

// 仓库根 static/(src/ 与 dist/ 都在根下一层,'../static' 两边均成立)
const COMMENTS_JS_URL = new URL('../static/comments.js', import.meta.url);
const MARKED_JS_URL = new URL('../static/marked.min.js', import.meta.url);
const etagOf = (data: Uint8Array) =>
  `"${createHash('sha256').update(data).digest('hex').slice(0, 16)}"`;

interface StaticAsset {
  data: Uint8Array<ArrayBuffer>;
  etag: string;
}
function loadStatic(url: URL): StaticAsset {
  const buf = readFileSync(url);
  const data = new Uint8Array(new ArrayBuffer(buf.byteLength));
  data.set(buf);
  return { data, etag: etagOf(data) };
}
// 生产启动时缓存一次;开发态每请求现读(改 comments.js 刷新即生效,免重启)
const PROD = process.env.NODE_ENV === 'production';
const COMMENTS_CACHED = loadStatic(COMMENTS_JS_URL);
const MARKED_CACHED = loadStatic(MARKED_JS_URL);
const commentsAsset = () => (PROD ? COMMENTS_CACHED : loadStatic(COMMENTS_JS_URL));
const markedAsset = () => (PROD ? MARKED_CACHED : loadStatic(MARKED_JS_URL));

/** html.escape(quote=True) 等价 */
function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');
}

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

const mdShell = (title: string, contentJson: string, inject: string) => `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
:root{color-scheme:light}
body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#24292f;
  max-width:860px;margin:0 auto;padding:40px 28px 120px;line-height:1.75;font-size:15.5px}
h1,h2,h3,h4{line-height:1.35;margin:1.6em 0 .6em;font-weight:700}
h1{font-size:1.9em;padding-bottom:.3em;border-bottom:1px solid #eee}
h2{font-size:1.45em;padding-bottom:.25em;border-bottom:1px solid #f0f0f0}
h3{font-size:1.15em} p{margin:.8em 0} a{color:#0969da}
code{background:#f3f1ec;padding:.15em .45em;border-radius:5px;font-size:.88em;
  font-family:"SF Mono",Menlo,Consolas,monospace}
pre{background:#f6f8fa;border:1px solid #eee;border-radius:10px;padding:14px 18px;overflow-x:auto}
pre code{background:none;padding:0;font-size:.86em;line-height:1.6}
blockquote{margin:.8em 0;padding:.1em 1em;color:#57606a;border-left:4px solid #d8dee4}
table{border-collapse:collapse;margin:1em 0;display:block;overflow-x:auto}
th,td{border:1px solid #d8dee4;padding:7px 14px} th{background:#f6f8fa}
img{max-width:100%;border-radius:8px} hr{border:none;border-top:1px solid #eee;margin:2em 0}
ul,ol{padding-left:1.6em} li{margin:.3em 0}
.pp-md-meta{font-size:12px;color:#9a9183;border-bottom:1px solid #eee;padding-bottom:10px;
  margin-bottom:8px;display:flex;gap:14px}
.pp-md-meta a{color:#9a9183}
</style>
${inject}</head>
<body>
<div class="pp-md-meta"><span>📄 ${title}</span><a href="?raw=1">查看原文</a></div>
<main id="pp-md-content">渲染中…</main>
<script src="/_pagepin/marked.min.js"></script>
<script>
document.getElementById('pp-md-content').innerHTML =
  marked.parse(${contentJson}, { gfm: true, breaks: true });
</script>
</body></html>`;

const imgShell = (title: string, src: string, inject: string) => `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
body{margin:0;background:#22211e;font-family:-apple-system,"PingFang SC",sans-serif}
/* 居中交给内层包裹,body 保持普通流 —— 对后插入 body 的脚本/容器免疫 */
.pp-img-wrap{min-height:100vh;display:grid;place-items:center}
figure{margin:24px;text-align:center}
img{max-width:calc(100vw - 48px);max-height:calc(100vh - 110px);border-radius:6px;
  box-shadow:0 10px 40px rgba(0,0,0,.5);background:#fff}
figcaption{color:#8d877c;font-size:12.5px;margin-top:12px}
</style>
${inject}</head>
<body>
<div class="pp-img-wrap">
<figure>
  <img id="pp-image" src="${src}" alt="${title}"
       onerror="this.closest('figure').innerHTML='<figcaption>图片加载失败</figcaption>'">
  <figcaption>${title} · <a href="?raw=1" style="color:#8d877c">原图</a></figcaption>
</figure>
</div>
</body></html>`;

// 完整文档结构(html/head/body 都闭合):片段式 HTML 会让浏览器二次构树,居中布局先渲染后跳位
const NOT_FOUND_HTML = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>404 · pagepin</title></head>
<body style="font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0;color:#334155">
<div style="text-align:center"><div style="font-size:64px;font-weight:700">404</div>
<p>站点或文件不存在，或已被删除</p></div>
</body>
</html>`;

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

export function makeServingRoutes(deps: AppDeps, _opts: { skillNote?: never } = {}): Hono<AppEnv> {
  const { config: cfg, db, storage } = deps;
  const single = cfg.mode !== 'dual';
  // viewer 会话:双域走内容域 pp_view;单域 viewer 复用控制台 pp_session
  const plane: Plane = single ? 'session' : 'view';
  const prefix = single ? '/p' : '';

  const app = new Hono<AppEnv>();

  // ★ 必须先于下方站点通配路由注册;"_pagepin" 不符合 handle 规则,无冲突
  app.get('/_pagepin/comments.js', (c) => {
    const a = commentsAsset();
    return staticJs(c, a.data, a.etag, 'no-cache');
  });
  app.get('/_pagepin/marked.min.js', (c) => {
    const a = markedAsset();
    return staticJs(c, a.data, a.etag, 'public, max-age=86400');
  });

  const notFound = (c: Context<AppEnv>) => c.html(NOT_FOUND_HTML, 404);

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
    const site = db
      .select()
      .from(sites)
      .where(and(eq(sites.ownerHandle, handle), eq(sites.slug, slug), isNull(sites.deletedAt)))
      .get();
    if (!site || site.currentVersionId === null) return notFound(c);

    const pub = isPubliclyVisible(site, new Date());
    const claims = await readSession(c, cfg, plane);
    if (!pub && claims === null) {
      return c.redirect(`/auth/login?next=${encodeURIComponent(c.req.path)}`, 302);
    }
    // 评论层只给已登录访问者注入:匿名公开访客(对外客户)看到的是干净页面
    const canInject = site.commentsEnabled && claims !== null;

    // 目录式 URL(空路径或尾斜杠)直接落 index.html
    const raw = !rest || rest.endsWith('/') ? rest + 'index.html' : rest;
    const rel = normalizeSitePath(raw);
    if (rel === null) return c.json({ detail: '非法路径' }, 400);

    const cur = currentVersion(site);
    if (!cur) return notFound(c); // 防御:current_version_id 与 versions 不一致时明确 404 而非 500

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
        return c.html(
          imgShell(escapeHtml(fname), escapeHtml(c.req.path), injectHtml),
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
          return c.html(mdShell(escapeHtml(fname), contentJson, injectHtml), 200, baseHeaders);
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
    if (meta === null || body === null) return notFound(c);

    // 评论层注入:HTML 整读改写(≤5MB;超限/类型不符回落 streaming 原样输出)
    const hitLower = hit.toLowerCase();
    if (
      canInject &&
      (hitLower.endsWith('.html') || hitLower.endsWith('.htm')) &&
      meta.contentType.includes('html') &&
      (meta.contentLength ?? 0) <= INJECT_MAX_BYTES
    ) {
      const buf = new Uint8Array(await new Response(body).arrayBuffer());
      const out = injectScriptBytes(buf, injectTag(handle, slug, hit, cur.id));
      // 改写后的字节与存储层的 ETag/Last-Modified/Content-Length 都不再一致,一律不带
      return new Response(out, {
        headers: { ...baseHeaders, 'Content-Type': meta.contentType },
      });
    }

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
