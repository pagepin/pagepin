/** 登录会话滑动续期 —— 常用者不掉线(此前固定 8h 到点即断,官网点 Sign in 永远要重登)。
 *
 * 覆盖:API 认证中间件在剩余不足半个 TTL 时重铸 pp_session + 原值重种 pp_csrf(双提交配对不破);
 * 充足会话不折腾 Set-Cookie;serving 平面(裸 Response,经 renewCookies 中间件补头)同样续期。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Hono } from 'hono';
import { sign } from 'hono/jwt';

import { makeAuthMiddleware } from '../src/api/deps.js';
import { mint, type SessionClaims } from '../src/auth/sessions.js';
import { loadConfig } from '../src/config.js';
import { sites, users, type Db } from '../src/db/index.js';
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
const CSRF = 'csrf-fixed';
const PAGE_HTML = '<html><body><h1>Hello Secret</h1></body></html>';

class MemStorage implements Storage {
  private readonly objects = new Map<string, { data: Uint8Array; contentType: string }>();
  async put(key: string, data: ReadableStream<Uint8Array> | Uint8Array, ct: string): Promise<void> {
    const bytes =
      data instanceof Uint8Array
        ? data
        : new Uint8Array(await new Response(data as unknown as BodyInit).arrayBuffer());
    this.objects.set(key, { data: bytes, contentType: ct });
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
    return {
      meta: { contentType: o.contentType, contentLength: o.data.byteLength },
      body: new Response(o.data as unknown as BodyInit).body!,
    };
  }
}

async function seed(db: Db, storage: Storage): Promise<void> {
  await db.insert(users).values({
    id: 'u1',
    email: 'a@e.com',
    handle: 'alice',
    displayName: 'Alice',
    createdAt: nowIso(),
  });
  const vid = uuid();
  await db.insert(sites).values({
    id: 's-demo',
    ownerId: 'u1',
    ownerHandle: 'alice',
    slug: 'demo',
    title: 'demo',
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
        storage_prefix: `sites/u1/demo/${vid}/`,
        file_count: 1,
        total_bytes: PAGE_HTML.length,
        uploaded_by: 'u1',
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
    `sites/u1/demo/${vid}/index.html`,
    new TextEncoder().encode(PAGE_HTML),
    'text/html; charset=utf-8',
  );
}

/** 手工签一枚指定剩余寿命的 pp_session(mint() 只会给满 TTL,测续期得能造「快过期」的)。 */
async function agedSession(remainingS: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: SessionClaims = {
    sub: 'u1',
    hdl: 'alice',
    pln: 'session',
    epo: 0,
    iat: now - 3600,
    exp: now + remainingS,
    csrf: CSRF,
  };
  return sign(claims, cfg.secret, 'HS256');
}

async function setup() {
  const db = await makeTestDb();
  const storage = new MemStorage();
  await seed(db, storage);
  const deps: AppDeps = { config: cfg, db, storage };
  const app = new Hono<AppEnv>();
  const mw = makeAuthMiddleware(deps);
  app.get('/api/ping', mw.currentUser, (c) => c.json({ ok: true }));
  app.route('/', makeServingRoutes(deps));
  return { app };
}

function sessionSetCookies(res: Response): string[] {
  return res.headers.getSetCookie().filter((v) => v.startsWith('pp_'));
}

test('API auth: near-expiry session gets re-minted with csrf preserved; fresh one untouched', async () => {
  const { app } = await setup();

  // 剩 1 小时(< 336h/2)→ 续期:pp_session 新铸 + pp_csrf 原值重种
  const old = await agedSession(3600);
  const renewed = await app.fetch(
    new Request('http://localhost/api/ping', { headers: { cookie: `pp_session=${old}` } }),
  );
  assert.equal(renewed.status, 200);
  const cookies = sessionSetCookies(renewed);
  const sess = cookies.find((v) => v.startsWith('pp_session='));
  const csrf = cookies.find((v) => v.startsWith('pp_csrf='));
  assert.ok(sess, 'pp_session re-issued');
  assert.notEqual(sess!.split(';')[0]!.split('=')[1], old, 'a fresh token, not the old one');
  assert.match(sess!, /Max-Age=1209600/, 'full 14d TTL');
  assert.ok(csrf, 'pp_csrf re-issued alongside');
  assert.equal(
    csrf!.split(';')[0]!.split('=')[1],
    CSRF,
    'csrf value unchanged (double-submit intact)',
  );

  // 满血会话(mint = 满 TTL)→ 不折腾 Set-Cookie
  const fresh = await mint(cfg, 'session', 'u1', 'alice', 0, CSRF);
  const quiet = await app.fetch(
    new Request('http://localhost/api/ping', { headers: { cookie: `pp_session=${fresh}` } }),
  );
  assert.equal(quiet.status, 200);
  assert.equal(sessionSetCookies(quiet).length, 0);
});

test('serving: near-expiry viewer session renews on HTML navigation (raw-Response header path)', async () => {
  const { app } = await setup();
  const old = await agedSession(3600);
  const res = await app.fetch(
    new Request('http://localhost/p/alice/demo/', {
      headers: { cookie: `pp_session=${old}`, accept: 'text/html' },
    }),
  );
  assert.equal(res.status, 200);
  assert.ok((await res.text()).includes('Hello Secret'), 'session still serves the private page');
  const sess = sessionSetCookies(res).find((v) => v.startsWith('pp_session='));
  assert.ok(sess, 'viewer-plane renewal lands on the finished response');
  assert.match(sess!, /Max-Age=1209600/);

  // 静态资源请求(非 HTML 导航)不续期
  const asset = await app.fetch(
    new Request('http://localhost/p/alice/demo/index.html', {
      headers: { cookie: `pp_session=${old}`, accept: '*/*' },
    }),
  );
  assert.equal(sessionSetCookies(asset).length, 0);
});
