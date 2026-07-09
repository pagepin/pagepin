/** 设备授权流程(RFC 8628)路由测试 —— 内存 libSQL + 注入式 auth 中间件,不连真服务。
 *
 * 真实的 Cookie/CSRF/JWT 会话由 api/deps.ts 负责(已有验证路径);这里把 cookieMutatingUser
 * 换成「直接注入已登录用户」的桩,专测设备流程本身:发码 → 批准铸 PAT → 一次性交付 → 拒绝。
 *
 * 运行:node --import tsx --test test/device-flow.test.ts(见 package.json test:unit)。
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';

import { makeDeviceRoutes } from '../src/api/device.js';
import { makeAuthMiddleware, type AuthMiddleware } from '../src/api/deps.js';
import { loadConfig } from '../src/config.js';
import { apiTokens, users } from '../src/db/index.js';
import { makeTestDb } from './helpers/db.js';
import type { Storage } from '../src/storage/index.js';
import type { AppDeps, AppEnv } from '../src/types.js';
import { nowIso } from '../src/util.js';

const cfg = loadConfig({
  PAGEPIN_SECRET: 'test-secret',
  PAGEPIN_BASE_URL: 'http://localhost:8000',
});

/** 内存 DB(自动迁移)+ 注入式 mw 的设备路由。 */
async function setup(): Promise<{ app: Hono<AppEnv>; deps: AppDeps }> {
  const db = await makeTestDb();
  await db.insert(users).values({
    id: 'u-test',
    email: 'admin@example.com',
    passwordHash: null,
    oidcSub: null,
    handle: 'admin',
    displayName: 'Admin',
    isAdmin: true,
    disabled: false,
    createdAt: nowIso(),
    lastLoginAt: null,
  });
  const seeded = (await db.select().from(users).where(eq(users.id, 'u-test')))[0];
  if (!seeded) throw new Error('seed user failed');

  // 桩:绕过真实 Cookie/CSRF,直接把已登录用户放进 context(设备逻辑才是被测对象)。
  const inject = createMiddleware<AppEnv>(async (c, next) => {
    c.set('user', seeded);
    c.set('authVia', 'cookie');
    await next();
  });
  const mw = {
    currentUser: inject,
    mutatingUser: inject,
    cookieUser: inject,
    cookieMutatingUser: inject,
    requireVerified: inject,
    adminUser: inject,
    adminMutatingUser: inject,
  } as AuthMiddleware;

  const deps: AppDeps = { config: cfg, db, storage: {} as unknown as Storage };
  return { app: makeDeviceRoutes(deps, mw), deps };
}

function post(app: Hono<AppEnv>, path: string, body?: unknown): Promise<Response> {
  return Promise.resolve(
    app.fetch(
      new Request('http://localhost' + path, {
        method: 'POST',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    ),
  );
}

test('device flow: code → approve → one-time token delivery', async () => {
  const { app, deps } = await setup();

  const codeRes = await post(app, '/api/device/code');
  assert.equal(codeRes.status, 200);
  const code = (await codeRes.json()) as Record<string, string | number>;
  assert.match(String(code.device_code), /^[0-9a-f]{32}$/);
  assert.match(String(code.user_code), /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(code.interval, 5);
  assert.equal(code.verification_uri, 'http://localhost:8000/activate');

  const pending = (await (
    await post(app, '/api/device/token', { device_code: code.device_code })
  ).json()) as {
    status: string;
  };
  assert.equal(pending.status, 'pending');

  const approveRes = await post(app, '/api/device/approve', { user_code: code.user_code });
  assert.equal(approveRes.status, 200);
  assert.equal(((await approveRes.json()) as { ok: boolean }).ok, true);

  const delivered = (await (
    await post(app, '/api/device/token', { device_code: code.device_code })
  ).json()) as {
    status: string;
    token: string;
  };
  assert.equal(delivered.status, 'approved');
  assert.match(delivered.token, /^pp_[0-9a-f]{40}$/);

  // 交付的 token 是一条真实 PAT(走与 /api/tokens 相同的铸造路径);库中只有 hash,无明文(show-once)
  const toks = await deps.db.select().from(apiTokens);
  assert.equal(toks.length, 1);
  assert.equal(toks[0]!.userId, 'u-test');
  assert.equal(toks[0]!.tokenHash, createHash('sha256').update(delivered.token).digest('hex'));
  assert.ok(!('token' in toks[0]!), 'plaintext must not be stored in api_tokens');
  assert.ok(toks[0]!.expiresAt, 'device-minted token carries an expiry (default TTL)'); // 兜底过期

  // 一次性:再轮询行已删 → expired
  const after = (await (
    await post(app, '/api/device/token', { device_code: code.device_code })
  ).json()) as {
    status: string;
  };
  assert.equal(after.status, 'expired');
});

test('device flow: deny stops the poll', async () => {
  const { app } = await setup();
  const code = (await (await post(app, '/api/device/code')).json()) as {
    device_code: string;
    user_code: string;
  };
  const denyRes = await post(app, '/api/device/deny', { user_code: code.user_code });
  assert.equal(denyRes.status, 200);
  const polled = (await (
    await post(app, '/api/device/token', { device_code: code.device_code })
  ).json()) as {
    status: string;
  };
  assert.equal(polled.status, 'denied');
});

test('device token: missing/garbage device_code', async () => {
  const { app } = await setup();
  assert.equal((await post(app, '/api/device/token')).status, 422); // no body
  const unknown = (await (
    await post(app, '/api/device/token', { device_code: 'nope' })
  ).json()) as {
    status: string;
  };
  assert.equal(unknown.status, 'expired'); // unknown code → treated as expired
});

test('auth rejects an expired token but accepts a non-expiring one', async () => {
  const db = await makeTestDb();
  await db.insert(users).values({
    id: 'u2',
    email: 'e@x.com',
    passwordHash: null,
    oidcSub: null,
    handle: 'eee',
    displayName: 'E',
    isAdmin: false,
    disabled: false,
    createdAt: nowIso(),
    lastLoginAt: null,
  });

  const mw = makeAuthMiddleware({ config: cfg, db, storage: {} as unknown as Storage });
  const app = new Hono<AppEnv>();
  app.get('/api/me', mw.currentUser, (c) => c.json({ ok: true }));

  const sha = async (s: string) => {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
  };
  const seedToken = async (raw: string, expiresAt: string | null) => {
    await db.insert(apiTokens).values({
      id: 'tok-' + raw.slice(3, 11),
      userId: 'u2',
      name: 't',
      token: raw,
      tokenHash: await sha(raw),
      prefix: raw.slice(0, 15),
      createdAt: nowIso(),
      lastUsedAt: null,
      expiresAt,
      revokedAt: null,
    });
  };
  const expired = 'pp_expired00000000000000000000000000000000';
  const evergreen = 'pp_evergreen000000000000000000000000000000';
  await seedToken(expired, new Date(Date.now() - 1000).toISOString());
  await seedToken(evergreen, null);

  const get = (tok: string) =>
    app.fetch(
      new Request('http://localhost/api/me', { headers: { Authorization: `Bearer ${tok}` } }),
    );
  assert.equal((await get(expired)).status, 401);
  assert.equal((await get(evergreen)).status, 200);
});
