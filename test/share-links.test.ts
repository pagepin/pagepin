/** 签名分享链接(?key=)生命周期路由测试 —— 内存 libSQL + 内存 Storage + 真实 auth 中间件。
 *
 * 覆盖:POST /api/sites/{slug}/share-link 参数校验/默认值/上限钳制(Cookie 会话与 PAT 两条认证路);
 * 匿名登录墙 → 有效 ?key= 303 换「本浏览器」分享会话 Cookie → 凭 Cookie 出内容;
 * key 绑定站点(A 站 key 用不到 B 站);DELETE 撤销后旧 key 与旧访客 Cookie 同时失效;
 * 伪造/篡改 key 一律不放行;share.ts 纯函数(mint/verify 往返与 plane 隔离)。
 *
 * 运行:node --import tsx --test test/share-links.test.ts(无外部 DB 时以内存 SQLite 直跑)。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Hono } from 'hono';

import { makeAuthMiddleware } from '../src/api/deps.js';
import { makeSiteRoutes } from '../src/api/sites.js';
import { mint } from '../src/auth/sessions.js';
import { makeCommentRoutes } from '../src/comments.js';
import { loadConfig } from '../src/config.js';
import { apiTokens, sites, users, type Db } from '../src/db/index.js';
import { makeServingRoutes } from '../src/serving.js';
import {
  mintShareKey,
  mintShareSession,
  verifyShareKey,
  verifyShareSession,
} from '../src/share.js';
import { NotFoundError } from '../src/storage/index.js';
import type { ObjectMeta, Storage } from '../src/storage/index.js';
import type { AppDeps, AppEnv } from '../src/types.js';
import { nowIso, uuid } from '../src/util.js';
import { makeTestDb } from './helpers/db.js';

const cfg = loadConfig({
  PAGEPIN_SECRET: 'test-secret',
  PAGEPIN_BASE_URL: 'http://localhost:8000',
});
const CSRF = 'test-csrf';
const PAGE_HTML = '<html><head><title>demo</title></head><body><h1>Hello Secret</h1></body></html>';

/** 内存 Storage:open/exists 够 serving 用;list/deletePrefix 是可选能力,故意缺省。 */
class MemStorage implements Storage {
  private readonly objects = new Map<string, { data: Uint8Array; contentType: string }>();

  async put(
    key: string,
    data: ReadableStream<Uint8Array> | Uint8Array,
    contentType: string,
  ): Promise<void> {
    const bytes =
      data instanceof Uint8Array
        ? data
        : new Uint8Array(await new Response(data as unknown as BodyInit).arrayBuffer());
    this.objects.set(key, { data: bytes, contentType });
  }

  async copy(src: string, dst: string): Promise<void> {
    const o = this.objects.get(src);
    if (!o) throw new NotFoundError(src);
    this.objects.set(dst, o);
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async open(key: string): Promise<{ meta: ObjectMeta; body: ReadableStream<Uint8Array> }> {
    const o = this.objects.get(key);
    if (!o) throw new NotFoundError(key);
    const meta: ObjectMeta = { contentType: o.contentType, contentLength: o.data.byteLength };
    return { meta, body: new Response(o.data as unknown as BodyInit).body! };
  }
}

/** 私有站点一枚:current 版本 + index.html 落内存存储。 */
async function seedSite(db: Db, storage: Storage, slug: string): Promise<void> {
  const vid = uuid();
  await db.insert(sites).values({
    id: `s-${slug}`,
    ownerId: 'u-owner',
    ownerHandle: 'alice',
    slug,
    title: slug,
    visibility: 'private' as const,
    publicExpiresAt: null,
    shareKeyVersion: 1,
    guestComments: true,
    expiresAt: null,
    spaFallback: false,
    commentsEnabled: true,
    currentVersionId: vid,
    versions: [
      {
        id: vid,
        storage_prefix: `sites/u-owner/${slug}/${vid}/`,
        file_count: 1,
        total_bytes: PAGE_HTML.length,
        uploaded_by: 'u-owner',
        created_at: nowIso(),
      },
    ],
    createdAt: nowIso(),
    updatedAt: nowIso(),
    deletedAt: null,
    suspendedAt: null,
    suspendedReason: null,
  });
  await storage.put(
    `sites/u-owner/${slug}/${vid}/index.html`,
    new TextEncoder().encode(PAGE_HTML),
    'text/html; charset=utf-8',
  );
}

/** 单域组装(顺序对齐 app.ts):控制台 API → 评论 API → serving 通配。真实 Cookie/CSRF 认证。 */
async function setup() {
  const db = await makeTestDb();
  const storage = new MemStorage();
  await db.insert(users).values({
    id: 'u-owner',
    email: 'alice@example.com',
    handle: 'alice',
    displayName: 'Alice',
    createdAt: nowIso(),
  });
  await seedSite(db, storage, 'demo');
  await seedSite(db, storage, 'other');
  const deps: AppDeps = { config: cfg, db, storage };
  const app = new Hono<AppEnv>();
  app.route('/', makeSiteRoutes(deps, makeAuthMiddleware(deps)));
  app.route('/', makeCommentRoutes(deps));
  app.route('/', makeServingRoutes(deps));
  const ownerCookie = `pp_session=${await mint(cfg, 'session', 'u-owner', 'alice', 0, CSRF)}`;
  return { db, storage, deps, app, ownerCookie };
}

function api(
  app: Hono<AppEnv>,
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string; bearer?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cookie) {
    headers.cookie = opts.cookie;
    headers['x-csrf-token'] = CSRF; // 双提交:与 JWT 内嵌 csrf claim 一致
  }
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(
    app.fetch(
      new Request(`http://localhost${path}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      }),
    ),
  );
}

/** 浏览器导航式 GET(Accept: text/html);serving 单域前缀 /p。 */
function getPage(app: Hono<AppEnv>, path: string, cookie?: string): Promise<Response> {
  const headers: Record<string, string> = { accept: 'text/html' };
  if (cookie) headers.cookie = cookie;
  return Promise.resolve(app.fetch(new Request(`http://localhost${path}`, { headers })));
}

function shareSetCookies(res: Response): string[] {
  return res.headers.getSetCookie().filter((v) => v.startsWith('pp_share_'));
}

/** 兑换后的分享会话 Cookie("pp_share_xxx=<jwt>")。 */
function shareCookieOf(res: Response): string {
  const sc = shareSetCookies(res)[0];
  assert.ok(sc, 'expected a pp_share_* Set-Cookie');
  return sc.split(';')[0]!;
}

async function mintKey(app: Hono<AppEnv>, ownerCookie: string, slug: string): Promise<string> {
  const res = await api(app, 'POST', `/api/sites/${slug}/share-link`, {
    body: { hours: 24 },
    cookie: ownerCookie,
  });
  assert.equal(res.status, 200);
  const key = new URL(((await res.json()) as { url: string }).url).searchParams.get('key');
  assert.ok(key, 'share-link url carries ?key=');
  return key;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ───────────────────────── A1. 签发:默认值 / 校验 / 上限 ─────────────────────────

test('share-link mint: hours validation, defaults, and cap', async () => {
  const { app, ownerCookie } = await setup();

  const r24 = await api(app, 'POST', '/api/sites/demo/share-link', {
    body: { hours: 24 },
    cookie: ownerCookie,
  });
  assert.equal(r24.status, 200);
  const b24 = (await r24.json()) as { url: string; expires_at: string; hours: number };
  assert.equal(b24.hours, 24);
  assert.ok(b24.url.includes('/p/alice/demo/?key='), `url has ?key=: ${b24.url}`);
  const drift = Math.abs(Date.parse(b24.expires_at) - (Date.now() + 24 * 3600 * 1000));
  assert.ok(drift < 10_000, `expires_at ≈ now+24h (drift ${drift}ms)`);

  // 缺 body / 空 body → 默认 72h
  for (const opts of [{ cookie: ownerCookie }, { body: {}, cookie: ownerCookie }]) {
    const r = await api(app, 'POST', '/api/sites/demo/share-link', opts);
    assert.equal(r.status, 200);
    assert.equal(((await r.json()) as { hours: number }).hours, 72);
  }

  // 非整数 hours(字符串 / 小数)→ 422 notInteger
  for (const hours of ['x', 1.5]) {
    const r = await api(app, 'POST', '/api/sites/demo/share-link', {
      body: { hours },
      cookie: ownerCookie,
    });
    assert.equal(r.status, 422, `hours=${JSON.stringify(hours)} rejected`);
    assert.equal(((await r.json()) as { code: string }).code, 'site.shareHours.notInteger');
  }

  // 负数 → 422 tooSmall
  const rNeg = await api(app, 'POST', '/api/sites/demo/share-link', {
    body: { hours: -3 },
    cookie: ownerCookie,
  });
  assert.equal(rNeg.status, 422);
  assert.equal(((await rNeg.json()) as { code: string }).code, 'site.shareHours.tooSmall');

  // hours:0 → 422 tooSmall(?? 而非 || 回落,0 不是「用默认」的意思)
  const r0 = await api(app, 'POST', '/api/sites/demo/share-link', {
    body: { hours: 0 },
    cookie: ownerCookie,
  });
  assert.equal(r0.status, 422);
  assert.equal(((await r0.json()) as { code: string }).code, 'site.shareHours.tooSmall');

  // 超 cap 钳到 shareMaxHours(默认 720),不报错
  const rBig = await api(app, 'POST', '/api/sites/demo/share-link', {
    body: { hours: 100_000 },
    cookie: ownerCookie,
  });
  assert.equal(rBig.status, 200);
  assert.equal(((await rBig.json()) as { hours: number }).hours, cfg.shareMaxHours);

  // 不存在的站点 → 404
  const r404 = await api(app, 'POST', '/api/sites/nope/share-link', {
    body: { hours: 24 },
    cookie: ownerCookie,
  });
  assert.equal(r404.status, 404);
});

test('share-link mint works via PAT bearer (no cookie, no CSRF)', async () => {
  const { app, db } = await setup();
  const pat = 'pp_' + 'a'.repeat(40);
  await db.insert(apiTokens).values({
    id: uuid(),
    userId: 'u-owner',
    name: 'test-token',
    token: pat,
    tokenHash: await sha256Hex(pat),
    prefix: pat.slice(0, 15),
    createdAt: nowIso(),
  });
  const res = await api(app, 'POST', '/api/sites/demo/share-link', {
    body: { hours: 24 },
    bearer: pat,
  });
  assert.equal(res.status, 200);
  assert.ok(((await res.json()) as { url: string }).url.includes('?key='));
});

// ───────────────── A2. 匿名登录墙 → ?key= 303 换 Cookie → 凭 Cookie 出内容 ─────────────────

test('anonymous gets login wall; valid ?key= 303-redirects with share cookie; cookie serves content', async () => {
  const { app, ownerCookie } = await setup();

  // 匿名:200 登录墙(品牌门页),不泄内容、不注评论脚本
  const anon = await getPage(app, '/p/alice/demo/');
  assert.equal(anon.status, 200);
  const anonHtml = await anon.text();
  assert.ok(anonHtml.includes('This page is private'), 'login wall heading');
  assert.ok(!anonHtml.includes('Hello Secret'), 'content must not leak');
  assert.ok(!anonHtml.includes('/_pagepin/comments.js'), 'no comments overlay on the gate');

  // 有效 key:303 到去掉 key 的同路径 + 种 pp_share_* Cookie
  const key = await mintKey(app, ownerCookie, 'demo');
  const redeem = await getPage(app, `/p/alice/demo/?key=${key}`);
  assert.equal(redeem.status, 303);
  assert.equal(redeem.headers.get('location'), '/p/alice/demo/');
  const rawSetCookie = shareSetCookies(redeem)[0]!;
  assert.match(rawSetCookie, /httponly/i);
  assert.match(rawSetCookie, /path=\//i);
  const cookie = shareCookieOf(redeem);
  assert.match(cookie, /^pp_share_/);

  // 凭 Cookie 再访:200 出内容
  const page = await getPage(app, '/p/alice/demo/', cookie);
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes('Hello Secret'));
});

// ───────────────────────── A3. key 绑定站点 ─────────────────────────

test('a share key minted for site A does not open site B', async () => {
  const { app, ownerCookie } = await setup();
  const key = await mintKey(app, ownerCookie, 'demo');

  const res = await getPage(app, `/p/alice/other/?key=${key}`);
  assert.notEqual(res.status, 303, 'no redirect for a foreign-site key');
  assert.equal(res.status, 200);
  assert.equal(shareSetCookies(res).length, 0, 'no share cookie is set');
  const html = await res.text();
  assert.match(html, /share link/i, 'dedicated share-link-expired gate');
  assert.ok(!html.includes('Hello Secret'));
});

// ───────────────── A4. 撤销:旧 key 与旧访客 Cookie 同时失效 ─────────────────

test('revocation invalidates both old keys and previously issued guest cookies', async () => {
  const { app, ownerCookie } = await setup();
  const key = await mintKey(app, ownerCookie, 'demo');
  const redeem = await getPage(app, `/p/alice/demo/?key=${key}`);
  assert.equal(redeem.status, 303);
  const cookie = shareCookieOf(redeem);
  assert.ok((await (await getPage(app, '/p/alice/demo/', cookie)).text()).includes('Hello Secret'));

  const del = await api(app, 'DELETE', '/api/sites/demo/share-link', { cookie: ownerCookie });
  assert.equal(del.status, 200);
  assert.equal(((await del.json()) as { ok: boolean }).ok, true);

  // 旧 key → 分享链接失效门页,不再 303
  const stale = await getPage(app, `/p/alice/demo/?key=${key}`);
  assert.notEqual(stale.status, 303);
  assert.equal(stale.status, 200);
  assert.match(await stale.text(), /share link/i);

  // 撤销前拿到的访客 Cookie → skv 不再匹配,回到登录墙
  const gated = await getPage(app, '/p/alice/demo/', cookie);
  assert.equal(gated.status, 200);
  const gatedHtml = await gated.text();
  assert.ok(!gatedHtml.includes('Hello Secret'), 'old guest cookie no longer serves content');
  assert.ok(gatedHtml.includes('This page is private'), 'falls back to the login wall');
});

// ───────────────────────── A5. 伪造 / 篡改 key ─────────────────────────

test('forged or tampered keys never grant access', async () => {
  const { app, ownerCookie } = await setup();
  const key = await mintKey(app, ownerCookie, 'demo');
  const [h, p, s] = key.split('.') as [string, string, string];
  const flip = (str: string, i: number) =>
    str.slice(0, i) + (str[i] === 'A' ? 'B' : 'A') + str.slice(i + 1);

  const badKeys = [
    [h, flip(p, 5), s].join('.'), // payload 改一个字符 → 验签失败
    [h, p, flip(s, 5)].join('.'), // 签名改一个字符
    `${h}.${p}`, // 掐掉签名段
    'garbage', // 完全不是 JWT
  ];
  for (const bad of badKeys) {
    const res = await getPage(app, `/p/alice/demo/?key=${bad}`);
    assert.notEqual(res.status, 303, `tampered key must not redirect: ${bad.slice(0, 24)}…`);
    assert.equal(res.status, 200);
    assert.equal(shareSetCookies(res).length, 0, 'no share cookie for tampered key');
    const html = await res.text();
    assert.match(html, /share link/i);
    assert.ok(!html.includes('Hello Secret'));
  }
});

// ───────────────────────── A6. share.ts 纯函数 ─────────────────────────

test('share.ts primitives: roundtrips, plane isolation, expiry and secret mismatch', async () => {
  // key 往返
  const { token, expiresAt } = await mintShareKey(cfg, 'site-1', 3, 24);
  const claims = await verifyShareKey(cfg, token);
  assert.ok(claims);
  assert.equal(claims.pln, 'share');
  assert.equal(claims.sid, 'site-1');
  assert.equal(claims.skv, 3);
  assert.equal(new Date(claims.exp * 1000).toISOString(), expiresAt);

  // 会话往返:内嵌 per-浏览器 guest 身份,两次 mint 身份不同
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const sess = await mintShareSession(cfg, 'site-1', 3, exp);
  const sc = await verifyShareSession(cfg, sess);
  assert.ok(sc);
  assert.equal(sc.pln, 'shares');
  assert.equal(sc.sid, 'site-1');
  assert.equal(sc.skv, 3);
  assert.equal(sc.exp, exp);
  assert.match(sc.gst, /^guest:/);
  const sc2 = await verifyShareSession(cfg, await mintShareSession(cfg, 'site-1', 3, exp));
  assert.ok(sc2);
  assert.notEqual(sc2.gst, sc.gst, 'each session mints a fresh guest identity');

  // plane 混用:share key 当会话验 / 会话当 key 验 → null
  assert.equal(await verifyShareSession(cfg, token), null);
  assert.equal(await verifyShareKey(cfg, sess), null);

  // 过期 key → null(hono/jwt 校验 exp)
  const { token: expired } = await mintShareKey(cfg, 'site-1', 3, -1);
  assert.equal(await verifyShareKey(cfg, expired), null);

  // 异 secret / 垃圾输入 → null
  const cfg2 = loadConfig({
    PAGEPIN_SECRET: 'other-secret',
    PAGEPIN_BASE_URL: 'http://localhost:8000',
  });
  assert.equal(await verifyShareKey(cfg2, token), null);
  assert.equal(await verifyShareSession(cfg2, sess), null);
  assert.equal(await verifyShareKey(cfg, 'not-a-jwt'), null);
  assert.equal(await verifyShareSession(cfg, ''), null);
});
