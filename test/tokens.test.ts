/** /api/tokens 路由测试 —— 重点回归 show-once:明文只在创建/轮换响应出现一次,
 * 列表接口不带 token 字段,库中只存 sha256(schema 已无明文列)。
 *
 * 同 device-flow.test.ts 的做法:内存 libSQL + 注入式 auth 桩,专测 token 管理逻辑本身。
 * 运行:node --import tsx --test test/tokens.test.ts(见 package.json test:unit)。
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';

import { makeTokenRoutes, type AuthMw } from '../src/api/tokens.js';
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

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** 内存 DB(自动迁移)+ 注入式 mw 的 token 路由。 */
async function setup(): Promise<{ app: Hono<AppEnv>; deps: AppDeps }> {
  const db = await makeTestDb();
  await db.insert(users).values({
    id: 'u-test',
    email: 'owner@example.com',
    passwordHash: null,
    oidcSub: null,
    handle: 'owner',
    displayName: 'Owner',
    isAdmin: false,
    disabled: false,
    createdAt: nowIso(),
    lastLoginAt: null,
  });
  const seeded = (await db.select().from(users).where(eq(users.id, 'u-test')))[0];
  if (!seeded) throw new Error('seed user failed');

  const inject = createMiddleware<AppEnv>(async (c, next) => {
    c.set('user', seeded);
    c.set('authVia', 'cookie');
    await next();
  });
  const mw: AuthMw = {
    currentUser: inject,
    mutatingUser: inject,
    cookieUser: inject,
    cookieMutatingUser: inject,
    requireVerified: inject,
  };

  const deps: AppDeps = { config: cfg, db, storage: {} as unknown as Storage };
  return { app: makeTokenRoutes(deps, mw), deps };
}

function call(app: Hono<AppEnv>, method: string, path: string, body?: unknown): Promise<Response> {
  return Promise.resolve(
    app.fetch(
      new Request('http://localhost' + path, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    ),
  );
}

test('tokens: create returns plaintext once; list and DB never carry it again', async () => {
  const { app, deps } = await setup();

  const created = (await (
    await call(app, 'POST', '/api/tokens', { name: 'ci-deploy' })
  ).json()) as Record<string, string>;
  assert.match(created.token!, /^pp_[0-9a-f]{40}$/);
  assert.equal(created.prefix, created.token!.slice(0, 15));

  // 库中只有 hash(schema 已无 token 列),且 hash 与交付的明文对得上
  const rows = await deps.db.select().from(apiTokens);
  assert.equal(rows.length, 1);
  assert.ok(!('token' in rows[0]!), 'plaintext must not be stored');
  assert.equal(rows[0]!.tokenHash, sha256(created.token!));

  // 列表响应不带 token 字段 —— show-once 的对外承诺
  const listed = (await (await call(app, 'GET', '/api/tokens')).json()) as {
    tokens: Record<string, unknown>[];
  };
  assert.equal(listed.tokens.length, 1);
  assert.ok(!('token' in listed.tokens[0]!), 'list must not expose plaintext');
  assert.equal(listed.tokens[0]!.prefix, created.prefix);
});

test('tokens: rotate delivers new plaintext once and invalidates the old hash', async () => {
  const { app, deps } = await setup();

  const created = (await (
    await call(app, 'POST', '/api/tokens', { name: 'agent' })
  ).json()) as Record<string, string>;

  const rotated = (await (
    await call(app, 'POST', `/api/tokens/${created.id}/rotate`)
  ).json()) as Record<string, string>;
  assert.match(rotated.token!, /^pp_[0-9a-f]{40}$/);
  assert.notEqual(rotated.token, created.token);

  const row = (await deps.db.select().from(apiTokens))[0]!;
  assert.equal(row.tokenHash, sha256(rotated.token!), 'stored hash must match the new value');
  assert.notEqual(row.tokenHash, sha256(created.token!), 'old plaintext must stop matching');
  assert.equal(row.prefix, rotated.token!.slice(0, 15));
});
