/** 访客评论(分享会话 guest)路由测试 —— 内存 libSQL + 内存 Storage + 真实 auth 中间件。
 *
 * 前置:站点 comments_enabled + guest_comments 都开(默认);访客 = 先走一次 ?key= 兑换
 * pp_share_* 会话 Cookie(per-浏览器 guest 身份)。
 *
 * 覆盖:GET /api/viewer 的 guest/登录/缺参三种形态;访客建线程与署名清洗;
 * 访客只能回复/删自己的线程、不能 resolve;guest_comments 关闭后 API 401 且页面不再注入评论层;
 * 注入 MemoryRateLimiter 后第 21 条线程 429 comment.rateLimited。
 *
 * 运行:node --import tsx --test test/guest-comments.test.ts(无外部 DB 时以内存 SQLite 直跑)。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Hono } from 'hono';

import { makeAuthMiddleware } from '../src/api/deps.js';
import { makeSiteRoutes } from '../src/api/sites.js';
import { mint } from '../src/auth/sessions.js';
import { makeCommentRoutes } from '../src/comments.js';
import { loadConfig } from '../src/config.js';
import { sites, users, type Db } from '../src/db/index.js';
import { MemoryRateLimiter } from '../src/ratelimit.js';
import { makeServingRoutes } from '../src/serving.js';
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

/** 内存 Storage(同 share-links.test.ts):open/exists 够 serving 用。 */
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
    guestComments: true, // 默认开
    expiresAt: null,
    spaFallback: false,
    commentsEnabled: true, // 默认开
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

/** 单域组装(顺序对齐 app.ts);extra 可注入 rateLimiter 等可选依赖。 */
async function setup(extra: Partial<AppDeps> = {}) {
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
  const deps: AppDeps = { config: cfg, db, storage, ...extra };
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
  opts: { body?: unknown; cookie?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cookie) {
    headers.cookie = opts.cookie;
    headers['x-csrf-token'] = CSRF;
  }
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

function getPage(app: Hono<AppEnv>, path: string, cookie?: string): Promise<Response> {
  const headers: Record<string, string> = { accept: 'text/html' };
  if (cookie) headers.cookie = cookie;
  return Promise.resolve(app.fetch(new Request(`http://localhost${path}`, { headers })));
}

/** 走一次完整的 ?key= 兑换,拿到该「浏览器」的分享会话 Cookie(每次调用 = 新 guest 身份)。 */
async function guestSession(app: Hono<AppEnv>, ownerCookie: string): Promise<string> {
  const minted = await api(app, 'POST', '/api/sites/demo/share-link', {
    body: { hours: 24 },
    cookie: ownerCookie,
  });
  assert.equal(minted.status, 200);
  const key = new URL(((await minted.json()) as { url: string }).url).searchParams.get('key');
  assert.ok(key);
  const redeem = await getPage(app, `/p/alice/demo/?key=${key}`);
  assert.equal(redeem.status, 303);
  const sc = redeem.headers.getSetCookie().find((v) => v.startsWith('pp_share_'));
  assert.ok(sc, 'redeem sets a pp_share_* cookie');
  return sc.split(';')[0]!;
}

interface ThreadOut {
  id: string;
  comments: { id: string; author_sub: string; author_name: string; text: string }[];
}

function threadBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    path: 'index.html',
    selector: '#h1',
    rx: 0.5,
    ry: 0.5,
    rw: null,
    rh: null,
    kind: null,
    anchor_text: null,
    text: 'first comment',
    ...over,
  };
}

async function viewerSub(app: Hono<AppEnv>, cookie: string): Promise<string> {
  const res = await api(app, 'GET', '/api/viewer?handle=alice&slug=demo', { cookie });
  assert.equal(res.status, 200);
  return ((await res.json()) as { sub: string }).sub;
}

// ───────────────────────── B1. GET /api/viewer ─────────────────────────

test('GET /api/viewer: guest identity, missing params, logged-in user', async () => {
  const { app, ownerCookie } = await setup();
  const guest = await guestSession(app, ownerCookie);

  // 访客 + handle/slug → guest 身份
  const g = await api(app, 'GET', '/api/viewer?handle=alice&slug=demo', { cookie: guest });
  assert.equal(g.status, 200);
  const gb = (await g.json()) as { sub: string; name: unknown; handle: unknown; guest: boolean };
  assert.match(gb.sub, /^guest:/);
  assert.equal(gb.name, null);
  assert.equal(gb.handle, null);
  assert.equal(gb.guest, true);

  // 访客不带 handle/slug → 401(guest 会话是站点级的,无法脱离站点断言身份)
  assert.equal((await api(app, 'GET', '/api/viewer', { cookie: guest })).status, 401);

  // 登录用户 → guest:false
  const o = await api(app, 'GET', '/api/viewer', { cookie: ownerCookie });
  assert.equal(o.status, 200);
  const ob = (await o.json()) as { sub: string; handle: string; guest: boolean };
  assert.equal(ob.sub, 'u-owner');
  assert.equal(ob.handle, 'alice');
  assert.equal(ob.guest, false);

  // 裸匿名 → 401
  assert.equal((await api(app, 'GET', '/api/viewer?handle=alice&slug=demo')).status, 401);
});

// ─────────────── B2. 访客读 / 建线程 + author_name 清洗 ───────────────

test('guest can list and create threads; author_name is sanitized and defaulted', async () => {
  const { app, ownerCookie } = await setup();
  const guest = await guestSession(app, ownerCookie);

  const list = await api(app, 'GET', '/api/comments/alice/demo?path=index.html', {
    cookie: guest,
  });
  assert.equal(list.status, 200);
  assert.deepEqual(((await list.json()) as { threads: unknown[] }).threads, []);

  // 控制符(含换行)替换成空格再并空白:换行分隔的名字不粘连
  const created = await api(app, 'POST', '/api/comments/alice/demo', {
    body: threadBody({ author_name: '  Zoe\nChen  ' }),
    cookie: guest,
  });
  assert.equal(created.status, 200);
  const tb = (await created.json()) as ThreadOut;
  assert.match(tb.comments[0]!.author_sub, /^guest:/);
  assert.equal(tb.comments[0]!.author_name, 'Zoe Chen');

  // 普通空格的并空白 + trim 行为正常
  const spaced = await api(app, 'POST', '/api/comments/alice/demo', {
    body: threadBody({ author_name: '  Zoe   Chen ' }),
    cookie: guest,
  });
  assert.equal(spaced.status, 200);
  assert.equal(((await spaced.json()) as ThreadOut).comments[0]!.author_name, 'Zoe Chen');

  // 超长署名裁到 40 码点
  const long = await api(app, 'POST', '/api/comments/alice/demo', {
    body: threadBody({ author_name: 'x'.repeat(50) }),
    cookie: guest,
  });
  assert.equal(((await long.json()) as ThreadOut).comments[0]!.author_name, 'x'.repeat(40));

  // 缺省署名 → 'Guest'(en locale)
  const anon = await api(app, 'POST', '/api/comments/alice/demo', {
    body: threadBody(),
    cookie: guest,
  });
  assert.equal(anon.status, 200);
  const ab = (await anon.json()) as ThreadOut;
  assert.equal(ab.comments[0]!.author_name, 'Guest');

  // 同一 Cookie 的两条线程 guest 身份一致(per-浏览器稳定身份)
  assert.equal(ab.comments[0]!.author_sub, tb.comments[0]!.author_sub);

  // 建好的线程出现在列表里
  const after = await api(app, 'GET', '/api/comments/alice/demo?path=index.html', {
    cookie: guest,
  });
  assert.equal(((await after.json()) as { threads: unknown[] }).threads.length, 4);
});

// ─────────────── B3. 线程权限:回复 / resolve / 删除 ───────────────

test('guest may reply to and delete own thread; cannot resolve; cannot delete others', async () => {
  const { app, ownerCookie } = await setup();
  const guest1 = await guestSession(app, ownerCookie);
  const guest2 = await guestSession(app, ownerCookie);
  assert.notEqual(
    await viewerSub(app, guest1),
    await viewerSub(app, guest2),
    'each redemption mints a distinct guest identity',
  );

  const created = await api(app, 'POST', '/api/comments/alice/demo', {
    body: threadBody({ author_name: 'Zoe' }),
    cookie: guest1,
  });
  assert.equal(created.status, 200);
  const tid = ((await created.json()) as ThreadOut).id;

  // 另一个访客删别人的线程 → 403
  const foreign = await api(app, 'DELETE', `/api/comments/threads/${tid}`, { cookie: guest2 });
  assert.equal(foreign.status, 403);
  assert.equal(((await foreign.json()) as { code: string }).code, 'comment.delete.forbidden');

  // 访客 resolve → 401(resolve/改 kind 留给登录成员)
  const patch = await api(app, 'PATCH', `/api/comments/threads/${tid}`, {
    body: { resolved: true },
    cookie: guest1,
  });
  assert.equal(patch.status, 401);

  // 自己的线程可回复
  const reply = await api(app, 'POST', `/api/comments/threads/${tid}/replies`, {
    body: { text: 'my follow-up', author_name: 'Zoe' },
    cookie: guest1,
  });
  assert.equal(reply.status, 200);
  const rb = (await reply.json()) as { author_sub: string; author_name: string; text: string };
  assert.match(rb.author_sub, /^guest:/);
  assert.equal(rb.author_name, 'Zoe');
  assert.equal(rb.text, 'my follow-up');

  // 自己的线程可删
  const del = await api(app, 'DELETE', `/api/comments/threads/${tid}`, { cookie: guest1 });
  assert.equal(del.status, 200);
  assert.equal(((await del.json()) as { ok: boolean }).ok, true);
  const after = await api(app, 'GET', '/api/comments/alice/demo?path=index.html', {
    cookie: guest1,
  });
  assert.deepEqual(((await after.json()) as { threads: unknown[] }).threads, []);
});

// ─────────────── B4. guest_comments 开关:API 门禁 + 注入开关 ───────────────

test('disabling guest_comments closes the API but keeps the page viewable (no overlay)', async () => {
  const { app, ownerCookie } = await setup();
  const guest = await guestSession(app, ownerCookie);

  // 开着:页面注入评论层
  const on = await getPage(app, '/p/alice/demo/', guest);
  assert.equal(on.status, 200);
  const onHtml = await on.text();
  assert.ok(onHtml.includes('Hello Secret'));
  assert.ok(onHtml.includes('/_pagepin/comments.js'), 'overlay injected while guest_comments on');

  // 站长关闭 guest_comments
  const patch = await api(app, 'PATCH', '/api/sites/demo', {
    body: { guest_comments: false },
    cookie: ownerCookie,
  });
  assert.equal(patch.status, 200);
  assert.equal(((await patch.json()) as { guest_comments: boolean }).guest_comments, false);

  // 评论 API 对访客关门
  assert.equal(
    (await api(app, 'GET', '/api/comments/alice/demo?path=index.html', { cookie: guest })).status,
    401,
  );
  assert.equal(
    (await api(app, 'POST', '/api/comments/alice/demo', { body: threadBody(), cookie: guest }))
      .status,
    401,
  );
  assert.equal(
    (await api(app, 'GET', '/api/viewer?handle=alice&slug=demo', { cookie: guest })).status,
    401,
  );

  // 页面仍可看,只是不再注入评论层
  const off = await getPage(app, '/p/alice/demo/', guest);
  assert.equal(off.status, 200);
  const offHtml = await off.text();
  assert.ok(offHtml.includes('Hello Secret'), 'guest can still view the page');
  assert.ok(!offHtml.includes('/_pagepin/comments.js'), 'overlay not injected when off');
});

// ─────────────── B5. 限频:第 21 条线程 429 ───────────────

test('guest thread creation is rate-limited (21st within window → 429)', async () => {
  // 独立 app + 独立 limiter,避免计数影响其他用例
  const { app, ownerCookie } = await setup({ rateLimiter: new MemoryRateLimiter() });
  const guest = await guestSession(app, ownerCookie);

  for (let i = 1; i <= 20; i++) {
    const r = await api(app, 'POST', '/api/comments/alice/demo', {
      body: threadBody({ text: `spam ${i}` }),
      cookie: guest,
    });
    assert.equal(r.status, 200, `thread ${i} within the per-guest limit`);
  }
  const blocked = await api(app, 'POST', '/api/comments/alice/demo', {
    body: threadBody({ text: 'spam 21' }),
    cookie: guest,
  });
  assert.equal(blocked.status, 429);
  assert.equal(((await blocked.json()) as { code: string }).code, 'comment.rateLimited');
});
