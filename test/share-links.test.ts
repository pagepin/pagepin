/** 分享链接生命周期路由测试 —— 内存 libSQL + 内存 Storage + 真实 auth 中间件。
 *
 * 现行短码链接(/s/<code>,落库 share_links):
 *   POST share-link 参数校验/默认永不过期/上限钳制/label;GET share-links 列表;
 *   兑换 303 换「本浏览器」会话 Cookie(14 天滑动续期,与链接 expires_at 解耦);
 *   单条撤销踢既有会话;DELETE share-link 全废(skv 自增 + 批量 revoke)。
 * 旧 ?key= JWT(不再新铸,兼容到自然过期):
 *   有效 key 303 兑换;key 绑定站点;撤销/伪造/篡改一律不放行;share.ts 纯函数往返。
 *
 * 运行:node --import tsx --test test/share-links.test.ts(无外部 DB 时以内存 SQLite 直跑)。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { makeAuthMiddleware } from '../src/api/deps.js';
import { makeSiteRoutes } from '../src/api/sites.js';
import { mint } from '../src/auth/sessions.js';
import { makeCommentRoutes } from '../src/comments.js';
import { loadConfig } from '../src/config.js';
import { apiTokens, shareLinks, sites, users, type Db } from '../src/db/index.js';
import { makeServingRoutes } from '../src/serving.js';
import {
  mintShareKey,
  mintShareSession,
  SHARE_SESSION_TTL_S,
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

interface MintOut {
  url: string;
  code: string;
  label: string | null;
  expires_at: string | null;
  hours: number | null;
  guest_comments: boolean;
}

/** 铸一条短码链接,返回响应体;url 形如 http://localhost:8000/p/s/<code>。 */
async function mintLink(
  app: Hono<AppEnv>,
  ownerCookie: string,
  slug: string,
  body: Record<string, unknown> = {},
): Promise<MintOut> {
  const res = await api(app, 'POST', `/api/sites/${slug}/share-link`, {
    body,
    cookie: ownerCookie,
  });
  assert.equal(res.status, 200);
  return (await res.json()) as MintOut;
}

/** 兑换短码 → 期望 303 到站点根 + 拿到会话 Cookie。 */
async function redeem(app: Hono<AppEnv>, code: string): Promise<string> {
  const res = await getPage(app, `/p/s/${code}`);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/p/alice/demo/');
  return shareCookieOf(res);
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ───────────────────────── A1. 签发:默认永久 / 校验 / 上限 / label ─────────────────────────

test('share-link mint: permanent by default, hours validation, cap, label', async () => {
  const { app, ownerCookie } = await setup();

  // 缺 body / 空 body / hours:null → 永不过期的短码链接
  for (const body of [{}, { hours: null }]) {
    const out = await mintLink(app, ownerCookie, 'demo', body);
    assert.equal(out.expires_at, null, 'permanent by default');
    assert.equal(out.hours, null);
    assert.match(out.code, /^[0-9A-Za-z]{10}$/, '10-char base62 code');
    assert.equal(out.url, `http://localhost:8000/p/s/${out.code}`);
  }

  // 限时:expires_at ≈ now+24h
  const t24 = await mintLink(app, ownerCookie, 'demo', { hours: 24 });
  assert.equal(t24.hours, 24);
  assert.ok(t24.expires_at);
  const drift = Math.abs(Date.parse(t24.expires_at!) - (Date.now() + 24 * 3600 * 1000));
  assert.ok(drift < 10_000, `expires_at ≈ now+24h (drift ${drift}ms)`);

  // 非整数 hours(字符串 / 小数)→ 422 notInteger
  for (const hours of ['x', 1.5]) {
    const r = await api(app, 'POST', '/api/sites/demo/share-link', {
      body: { hours },
      cookie: ownerCookie,
    });
    assert.equal(r.status, 422, `hours=${JSON.stringify(hours)} rejected`);
    assert.equal(((await r.json()) as { code: string }).code, 'site.shareHours.notInteger');
  }

  // 0 / 负数 → 422 tooSmall(0 不是「用默认」的意思)
  for (const hours of [0, -3]) {
    const r = await api(app, 'POST', '/api/sites/demo/share-link', {
      body: { hours },
      cookie: ownerCookie,
    });
    assert.equal(r.status, 422);
    assert.equal(((await r.json()) as { code: string }).code, 'site.shareHours.tooSmall');
  }

  // 超 cap 钳到 shareMaxHours(默认 720),不报错
  const big = await mintLink(app, ownerCookie, 'demo', { hours: 100_000 });
  assert.equal(big.hours, cfg.shareMaxHours);

  // label:trim 后入库;非字符串 422;超长 422
  const labeled = await mintLink(app, ownerCookie, 'demo', { label: '  发给老王的  ' });
  assert.equal(labeled.label, '发给老王的');
  const rBadLabel = await api(app, 'POST', '/api/sites/demo/share-link', {
    body: { label: 42 },
    cookie: ownerCookie,
  });
  assert.equal(rBadLabel.status, 422);
  assert.equal(((await rBadLabel.json()) as { code: string }).code, 'site.shareLabel.notString');
  const rLongLabel = await api(app, 'POST', '/api/sites/demo/share-link', {
    body: { label: 'x'.repeat(200) },
    cookie: ownerCookie,
  });
  assert.equal(rLongLabel.status, 422);
  assert.equal(((await rLongLabel.json()) as { code: string }).code, 'site.shareLabel.tooLong');

  // 不存在的站点 → 404
  const r404 = await api(app, 'POST', '/api/sites/nope/share-link', {
    body: {},
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
  const res = await api(app, 'POST', '/api/sites/demo/share-link', { body: {}, bearer: pat });
  assert.equal(res.status, 200);
  assert.ok(((await res.json()) as { url: string }).url.includes('/p/s/'));
});

// ───────────── B1. 匿名登录墙 → 短码 303 换 Cookie → 凭 Cookie 出内容 ─────────────

test('anonymous gets login wall; /s/<code> 303-redirects with share cookie; cookie serves content', async () => {
  const { app, ownerCookie } = await setup();

  // 匿名:200 登录墙(品牌门页),不泄内容、不注评论脚本
  const anon = await getPage(app, '/p/alice/demo/');
  assert.equal(anon.status, 200);
  const anonHtml = await anon.text();
  assert.ok(anonHtml.includes('This page is private'), 'login wall heading');
  assert.ok(!anonHtml.includes('Hello Secret'), 'content must not leak');
  assert.ok(!anonHtml.includes('/_pagepin/comments.js'), 'no comments overlay on the gate');

  // 有效短码:303 到站点根 + 种 pp_share_* Cookie(HttpOnly, Path=/)
  const { code } = await mintLink(app, ownerCookie, 'demo');
  const res = await getPage(app, `/p/s/${code}`);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/p/alice/demo/');
  const rawSetCookie = shareSetCookies(res)[0]!;
  assert.match(rawSetCookie, /httponly/i);
  assert.match(rawSetCookie, /path=\//i);
  const cookie = shareCookieOf(res);

  // 凭 Cookie 再访:200 出内容
  const page = await getPage(app, '/p/alice/demo/', cookie);
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes('Hello Secret'));

  // ?lang= 等查询串原样带去站点
  const withLang = await getPage(app, `/p/s/${code}?lang=zh`);
  assert.equal(withLang.headers.get('location'), '/p/alice/demo/?lang=zh');
});

test('re-redeeming the same short code keeps the same guest identity', async () => {
  const { app, ownerCookie } = await setup();
  const { code } = await mintLink(app, ownerCookie, 'demo');

  const cookie1 = await redeem(app, code);
  const viewer = (c: string) =>
    app
      .fetch(
        new Request('http://localhost/api/viewer?handle=alice&slug=demo', {
          headers: { cookie: c },
        }),
      )
      .then((r) => r.json() as Promise<{ sub: string }>);
  const sub1 = await viewer(cookie1);

  // 带着已有会话 Cookie 再点同一链接:仍 303,但 gst 不变
  const second = await app.fetch(
    new Request(`http://localhost/p/s/${code}`, {
      headers: { accept: 'text/html', cookie: cookie1 },
    }),
  );
  assert.equal(second.status, 303);
  const sub2 = await viewer(shareCookieOf(second));
  assert.equal(sub2.sub, sub1.sub, 'guest identity is stable across re-redemption');
});

// ───────────── B2. 失效短码:未知 404;撤销/过期 → 失效门页;会话与链接过期解耦 ─────────────

test('unknown code 404s; revoked/expired codes hit the share-expired gate', async () => {
  const { app, db, ownerCookie } = await setup();

  const unknown = await getPage(app, '/p/s/AAAAAAAAAA');
  assert.equal(unknown.status, 404);

  // 单条撤销:兑换被拒(门页,无 Cookie)
  const { code } = await mintLink(app, ownerCookie, 'demo');
  const del = await api(app, 'DELETE', `/api/sites/demo/share-links/${code}`, {
    cookie: ownerCookie,
  });
  assert.equal(del.status, 200);
  const revoked = await getPage(app, `/p/s/${code}`);
  assert.notEqual(revoked.status, 303);
  assert.equal(revoked.status, 200);
  assert.match(await revoked.text(), /share link/i, 'dedicated share-link-expired gate');
  assert.equal(shareSetCookies(revoked).length, 0);

  // 重复撤销 → 404 notFound
  const again = await api(app, 'DELETE', `/api/sites/demo/share-links/${code}`, {
    cookie: ownerCookie,
  });
  assert.equal(again.status, 404);

  // 过期链接:新兑换被拒 …
  const timed = await mintLink(app, ownerCookie, 'demo', { hours: 1 });
  const cookie = await redeem(app, timed.code);
  await db
    .update(shareLinks)
    .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
    .where(eq(shareLinks.id, timed.code));
  const expired = await getPage(app, `/p/s/${timed.code}`);
  assert.notEqual(expired.status, 303);
  assert.match(await expired.text(), /share link/i);
  // … 但已进来的会话不受牵连(过期只挡新访客;踢人用撤销)
  const page = await getPage(app, '/p/alice/demo/', cookie);
  assert.ok((await page.text()).includes('Hello Secret'), 'existing session outlives link expiry');
});

test('revoking a single link kicks its existing browser sessions (view + comment planes)', async () => {
  const { app, ownerCookie } = await setup();
  const { code } = await mintLink(app, ownerCookie, 'demo');
  const cookie = await redeem(app, code);
  assert.ok((await (await getPage(app, '/p/alice/demo/', cookie)).text()).includes('Hello Secret'));

  await api(app, 'DELETE', `/api/sites/demo/share-links/${code}`, { cookie: ownerCookie });

  // 查看平面:回落登录墙
  const gated = await getPage(app, '/p/alice/demo/', cookie);
  const gatedHtml = await gated.text();
  assert.ok(!gatedHtml.includes('Hello Secret'), 'revoked link session no longer serves content');
  assert.ok(gatedHtml.includes('This page is private'));

  // 评论平面:同口径拒(裸匿名 401,不泄露站点存在性)
  const list = await app.fetch(
    new Request('http://localhost/api/comments/alice/demo?path=index.html', {
      headers: { cookie },
    }),
  );
  assert.equal(list.status, 401);
});

// ───────────── B3. 滑动续期:剩余不足一半才重种;链接列表 ─────────────

test('sliding renewal: cookie re-set only when under half TTL remains', async () => {
  const { app, ownerCookie, deps } = await setup();
  const { code } = await mintLink(app, ownerCookie, 'demo');
  await redeem(app, code);

  const name = (await import('../src/share.js')).shareCookieName('s-demo');
  const nowS = Math.floor(Date.now() / 1000);
  // 剩 1 天(< 7 天):HTML 导航应续满 14 天
  const oldSess = await mintShareSession(
    deps.config,
    's-demo',
    1,
    nowS + 86400,
    'guest:stable',
    code,
  );
  const renewed = await getPage(app, '/p/alice/demo/', `${name}=${oldSess}`);
  assert.equal(renewed.status, 200);
  const setCookie = shareSetCookies(renewed)[0];
  assert.ok(setCookie, 'renewal re-sets the share cookie');
  const renewedClaims = await verifyShareSession(
    deps.config,
    setCookie.split(';')[0]!.split('=')[1]!,
  );
  assert.ok(renewedClaims);
  assert.equal(renewedClaims.gst, 'guest:stable', 'renewal keeps the guest identity');
  assert.equal(renewedClaims.lnk, code);
  assert.ok(renewedClaims.exp - nowS > SHARE_SESSION_TTL_S - 60, 'renewed to full TTL');

  // 剩 13 天(> 7 天):不折腾 Set-Cookie
  const fresh = await mintShareSession(
    deps.config,
    's-demo',
    1,
    nowS + 13 * 86400,
    'guest:stable',
    code,
  );
  const quiet = await getPage(app, '/p/alice/demo/', `${name}=${fresh}`);
  assert.equal(quiet.status, 200);
  assert.equal(shareSetCookies(quiet).length, 0, 'no cookie churn while plenty remains');
});

test('share-links list: active links with url/label; revoked ones drop out', async () => {
  const { app, ownerCookie } = await setup();
  const a = await mintLink(app, ownerCookie, 'demo', { label: '给老王' });
  const b = await mintLink(app, ownerCookie, 'demo', { hours: 24 });

  const res = await api(app, 'GET', '/api/sites/demo/share-links', { cookie: ownerCookie });
  assert.equal(res.status, 200);
  const { links } = (await res.json()) as {
    links: { code: string; url: string; label: string | null; expires_at: string | null }[];
  };
  assert.equal(links.length, 2);
  const byCode = new Map(links.map((l) => [l.code, l]));
  assert.equal(byCode.get(a.code)!.label, '给老王');
  assert.equal(byCode.get(a.code)!.expires_at, null);
  assert.ok(byCode.get(b.code)!.expires_at);
  assert.equal(byCode.get(a.code)!.url, `http://localhost:8000/p/s/${a.code}`);

  await api(app, 'DELETE', `/api/sites/demo/share-links/${a.code}`, { cookie: ownerCookie });
  const after = await api(app, 'GET', '/api/sites/demo/share-links', { cookie: ownerCookie });
  const remaining = ((await after.json()) as { links: { code: string }[] }).links;
  assert.deepEqual(
    remaining.map((l) => l.code),
    [b.code],
  );
});

// ───────────── B4. 短码绑定站点:A 站短码撤销权不跨站;全废撤销一切 ─────────────

test('cross-site revocation is rejected; revoke-all kills codes, JWT keys and all sessions', async () => {
  const { app, ownerCookie } = await setup();
  const { code } = await mintLink(app, ownerCookie, 'demo');

  // 用 other 站的路径撤 demo 站的短码 → 404(短码归属校验)
  const cross = await api(app, 'DELETE', `/api/sites/other/share-links/${code}`, {
    cookie: ownerCookie,
  });
  assert.equal(cross.status, 404);

  // 短码会话 + 旧 JWT 会话都活着
  const codeCookie = await redeem(app, code);
  const { token: legacyKey } = await mintShareKey(cfg, 's-demo', 1, 24);
  const legacyRedeem = await getPage(app, `/p/alice/demo/?key=${legacyKey}`);
  assert.equal(legacyRedeem.status, 303);
  const legacyCookie = shareCookieOf(legacyRedeem);

  const del = await api(app, 'DELETE', '/api/sites/demo/share-link', { cookie: ownerCookie });
  assert.equal(del.status, 200);

  // 短码兑换被拒(行已 revoke);两种会话都失效(skv 自增);旧 key 也失效
  assert.notEqual((await getPage(app, `/p/s/${code}`)).status, 303);
  for (const c of [codeCookie, legacyCookie]) {
    const gated = await getPage(app, '/p/alice/demo/', c);
    assert.ok(!(await gated.text()).includes('Hello Secret'));
  }
  assert.notEqual((await getPage(app, `/p/alice/demo/?key=${legacyKey}`)).status, 303);

  // 全废后列表为空
  const list = await api(app, 'GET', '/api/sites/demo/share-links', { cookie: ownerCookie });
  assert.equal(((await list.json()) as { links: unknown[] }).links.length, 0);
});

// ───────────────── C. 旧 ?key= JWT 兼容(已发出的链接活到自然过期) ─────────────────

test('legacy ?key= JWT still redeems; foreign-site key rejected; forged keys never grant access', async () => {
  const { app } = await setup();
  const { token: key } = await mintShareKey(cfg, 's-demo', 1, 24);

  // 兑换:303 去掉 key + 种 Cookie → 出内容
  const redeemRes = await getPage(app, `/p/alice/demo/?key=${key}`);
  assert.equal(redeemRes.status, 303);
  assert.equal(redeemRes.headers.get('location'), '/p/alice/demo/');
  const cookie = shareCookieOf(redeemRes);
  assert.ok((await (await getPage(app, '/p/alice/demo/', cookie)).text()).includes('Hello Secret'));

  // A 站 key 用不到 B 站
  const foreign = await getPage(app, `/p/alice/other/?key=${key}`);
  assert.notEqual(foreign.status, 303);
  assert.equal(shareSetCookies(foreign).length, 0);
  const foreignHtml = await foreign.text();
  assert.match(foreignHtml, /share link/i);
  assert.ok(!foreignHtml.includes('Hello Secret'));

  // 伪造/篡改
  const [h, p, s] = key.split('.') as [string, string, string];
  const flip = (str: string, i: number) =>
    str.slice(0, i) + (str[i] === 'A' ? 'B' : 'A') + str.slice(i + 1);
  for (const bad of [
    [h, flip(p, 5), s].join('.'),
    [h, p, flip(s, 5)].join('.'),
    `${h}.${p}`,
    'garbage',
  ]) {
    const res = await getPage(app, `/p/alice/demo/?key=${bad}`);
    assert.notEqual(res.status, 303, `tampered key must not redirect: ${bad.slice(0, 24)}…`);
    assert.equal(shareSetCookies(res).length, 0);
    assert.ok(!(await res.text()).includes('Hello Secret'));
  }
});

// ───────────────────────── D. share.ts 纯函数 ─────────────────────────

test('share.ts primitives: roundtrips, plane isolation, lnk claim, expiry and secret mismatch', async () => {
  // key 往返(旧 JWT,仍需可验)
  const { token, expiresAt } = await mintShareKey(cfg, 'site-1', 3, 24);
  const claims = await verifyShareKey(cfg, token);
  assert.ok(claims);
  assert.equal(claims.pln, 'share');
  assert.equal(claims.sid, 'site-1');
  assert.equal(claims.skv, 3);
  assert.equal(new Date(claims.exp * 1000).toISOString(), expiresAt);

  // 会话往返:内嵌 per-浏览器 guest 身份,两次 mint 身份不同;lnk 可选往返
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const sess = await mintShareSession(cfg, 'site-1', 3, exp);
  const sc = await verifyShareSession(cfg, sess);
  assert.ok(sc);
  assert.equal(sc.pln, 'shares');
  assert.equal(sc.sid, 'site-1');
  assert.equal(sc.skv, 3);
  assert.equal(sc.exp, exp);
  assert.match(sc.gst, /^guest:/);
  assert.equal(sc.lnk, undefined, 'legacy sessions carry no lnk');
  const sc2 = await verifyShareSession(cfg, await mintShareSession(cfg, 'site-1', 3, exp));
  assert.ok(sc2);
  assert.notEqual(sc2.gst, sc.gst, 'each session mints a fresh guest identity');
  const withLnk = await verifyShareSession(
    cfg,
    await mintShareSession(cfg, 'site-1', 3, exp, 'guest:x', 'Abc123XYZ0'),
  );
  assert.ok(withLnk);
  assert.equal(withLnk.lnk, 'Abc123XYZ0');
  assert.equal(withLnk.gst, 'guest:x');

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
