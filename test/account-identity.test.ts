/** 账号统一(identities 副表 + canonicalEmail 键)单测 —— 内存 libSQL + 注入式 deps。
 *
 * 覆盖 PR1(Phase 0+1)的核心不变量:
 *   - 社交/OIDC 登录恒按 (provider, sub) 解析,同 sub 二次登录不重复建号;
 *   - **绝不**按 email 跨 provider 自动并号(同一 verified email → 独立账号);
 *   - 未验证 email 不作账号键;
 *   - password 注册/登录走 canonicalEmail(大小写归一),变体重复 → 409;
 *   - 社交登录不挂到同 email 的已存在 password 账号(无自动并号)。
 *
 * 运行:node --import tsx --test test/account-identity.test.ts(见 package.json test:unit)。
 */
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { makeAuthRoutes, upsertFederatedUser } from '../src/auth/routes.js';
import { loadConfig } from '../src/config.js';
import { identities, users } from '../src/db/index.js';
import { createLibsqlDb } from '../src/db/libsql.js';
import { FsStorage } from '../src/storage/fs.js';
import type { AppDeps, AppEnv } from '../src/types.js';

async function setup(env: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'pagepin-ident-'));
  const storage = new FsStorage(dir);
  const db = await createLibsqlDb(':memory:'); // 自动应用 drizzle 迁移(含 0005 identities)
  const cfg = loadConfig({
    PAGEPIN_SECRET: 'test',
    PAGEPIN_BASE_URL: 'http://localhost:8000',
    PAGEPIN_AUTH_MODE: 'password',
    PAGEPIN_REGISTRATION_MODE: 'open',
    ...env,
  });
  const deps: AppDeps = { config: cfg, db, storage };
  const app = makeAuthRoutes(deps, 'session');
  return { db, cfg, deps, app };
}

function postJson(app: Hono<AppEnv>, path: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    app.fetch(
      new Request('http://localhost' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    ),
  );
}

test('federated: 同 (provider,sub) 二次登录 → 同一账号,不重复建号', async () => {
  const { deps, db } = await setup();
  const a = await upsertFederatedUser(deps, { provider: 'google', sub: 'google:1', email: 'a@x.com', emailVerified: true, name: 'A' });
  const b = await upsertFederatedUser(deps, { provider: 'google', sub: 'google:1', email: 'a@x.com', emailVerified: true });
  assert.equal(a.id, b.id);
  assert.equal((await db.select().from(users).all()).length, 1);
  const ids = await db.select().from(identities).where(eq(identities.userId, a.id)).all();
  assert.equal(ids.length, 1);
  assert.equal(ids[0]!.provider, 'google');
  assert.equal(ids[0]!.sub, 'google:1');
});

test('federated: 同一 verified email 跨 provider → 两个独立账号,不按 email 并号', async () => {
  const { deps, db } = await setup();
  const g = await upsertFederatedUser(deps, { provider: 'google', sub: 'google:1', email: 'same@x.com', emailVerified: true });
  const h = await upsertFederatedUser(deps, { provider: 'github', sub: 'github:9', email: 'same@x.com', emailVerified: true });
  assert.notEqual(g.id, h.id);
  const rows = await db.select().from(users).all();
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.id === g.id)!.canonicalEmail, 'same@x.com');
  assert.equal(rows.find((r) => r.id === h.id)!.canonicalEmail, null); // canonical 被占 → 独立账号落 null
  const hIdent = await db.select().from(identities).where(eq(identities.userId, h.id)).get();
  assert.equal(hIdent?.email, 'same@x.com'); // 身份仍记录 email(展示/Phase2 提示用)
});

test('federated: 未验证 email 不作账号键', async () => {
  const { deps, db } = await setup();
  const u = await upsertFederatedUser(deps, { provider: 'oidc', sub: 'sub-1', email: 'x@y.com', emailVerified: false });
  assert.equal((await db.select().from(users).where(eq(users.id, u.id)).get())?.canonicalEmail, null);
  assert.equal((await db.select().from(identities).where(eq(identities.userId, u.id)).get())?.email, null);
});

test('password: 注册建 user + password identity,大小写归一,变体重复 → 409', async () => {
  const { app, db } = await setup();
  const r1 = await postJson(app, '/auth/signup', { email: 'Bob@Example.com', password: 'password123' });
  assert.equal(r1.status, 200);
  const u = await db.select().from(users).get();
  assert.equal(u?.canonicalEmail, 'bob@example.com');
  const ident = await db
    .select()
    .from(identities)
    .where(and(eq(identities.provider, 'password'), eq(identities.userId, u!.id)))
    .get();
  assert.equal(ident?.sub, 'bob@example.com');
  const r2 = await postJson(app, '/auth/signup', { email: 'BOB@example.COM', password: 'password123' });
  assert.equal(r2.status, 409); // 大小写变体视为同一账号
});

test('password: 登录按 canonicalEmail(大小写无关)', async () => {
  const { app } = await setup();
  await postJson(app, '/auth/signup', { email: 'carol@example.com', password: 'password123' });
  const r = await postJson(app, '/auth/password', { email: 'Carol@Example.com', password: 'password123' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});

test('federated: 不挂到同 email 的已存在 password 账号(无自动并号)', async () => {
  const { app, deps, db } = await setup();
  await postJson(app, '/auth/signup', { email: 'dana@example.com', password: 'password123' });
  const before = await db.select().from(users).all();
  assert.equal(before.length, 1);
  const g = await upsertFederatedUser(deps, { provider: 'google', sub: 'google:dana', email: 'dana@example.com', emailVerified: true });
  const after = await db.select().from(users).all();
  assert.equal(after.length, 2); // 社交登录建独立新账号
  assert.notEqual(g.id, before[0]!.id);
  assert.equal(after.find((r) => r.id === g.id)!.canonicalEmail, null); // canonical 被 password 账号占用
});
