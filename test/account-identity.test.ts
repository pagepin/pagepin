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
import { createMiddleware } from 'hono/factory';

import { attachIdentity, makeAuthRoutes, upsertFederatedUser } from '../src/auth/routes.js';
import { reconcileByVerifiedEmail } from '../src/auth/reconcile.js';
import type { AuthMw } from '../src/api/me.js';
import { makeMeRoutes } from '../src/api/me.js';
import { canPublish } from '../src/api/deps.js';
import { loadConfig } from '../src/config.js';
import { accountMerges, identities, sites, users } from '../src/db/index.js';
import { nowIso, uuid } from '../src/util.js';
import type { UserRow } from '../src/db/index.js';
import { createLibsqlDb } from '../src/db/libsql.js';
import type { MailMessage, Mailer } from '../src/mail/index.js';
import { FsStorage } from '../src/storage/fs.js';
import type { AppDeps, AppEnv } from '../src/types.js';

/** 注入式 mw:绕过 Cookie/CSRF,直接放一个已登录用户进 context(测 /api/me/* 用)。 */
function injectUser(user: UserRow): AuthMw {
  const inject = createMiddleware<AppEnv>(async (c, next) => {
    c.set('user', user);
    c.set('authVia', 'cookie');
    await next();
  });
  return { currentUser: inject, mutatingUser: inject, cookieUser: inject, cookieMutatingUser: inject, requireVerified: inject };
}

function del(app: Hono<AppEnv>, path: string): Promise<Response> {
  return Promise.resolve(app.fetch(new Request('http://localhost' + path, { method: 'DELETE' })));
}

async function setup(env: Record<string, string> = {}, mailer?: Mailer) {
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
  const deps: AppDeps = { config: cfg, db, storage, mailer };
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

test('federated: 同一 verified email 跨 provider → 自动合并进同一账号', async () => {
  const { deps, db } = await setup();
  // google 建号即 emailVerified=true(verified 邮箱);github 同 verified 邮箱进来 → 两边都验证 → 自动合并
  const g = await upsertFederatedUser(deps, { provider: 'google', sub: 'google:1', email: 'same@x.com', emailVerified: true });
  const h = await upsertFederatedUser(deps, { provider: 'github', sub: 'github:9', email: 'same@x.com', emailVerified: true });
  assert.equal(g.id, h.id); // 合并为同一账号
  assert.equal((await db.select().from(users).all()).length, 1);
  const ids = await db.select().from(identities).where(eq(identities.userId, g.id)).all();
  assert.deepEqual(ids.map((i) => i.provider).sort(), ['github', 'google']);
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

test('attach: 把第二个 provider 连接到已登录账号 → 同账号多身份', async () => {
  const { deps, db } = await setup();
  const u = await upsertFederatedUser(deps, { provider: 'google', sub: 'google:1', email: 'a@x.com', emailVerified: true });
  assert.equal(await attachIdentity(deps, u.id, { provider: 'github', sub: 'github:2', email: 'a@x.com', emailVerified: true }), 'ok');
  const ids = await db.select().from(identities).where(eq(identities.userId, u.id)).all();
  assert.equal(ids.length, 2);
  assert.deepEqual(ids.map((i) => i.provider).sort(), ['github', 'google']);
});

test('attach: 幂等(已属于本账号)与冲突(属于别的账号)', async () => {
  const { deps } = await setup();
  const a = await upsertFederatedUser(deps, { provider: 'google', sub: 'google:1', emailVerified: false });
  await upsertFederatedUser(deps, { provider: 'github', sub: 'github:2', emailVerified: false });
  assert.equal(await attachIdentity(deps, a.id, { provider: 'google', sub: 'google:1' }), 'ok'); // 幂等
  assert.equal(await attachIdentity(deps, a.id, { provider: 'github', sub: 'github:2' }), 'conflict'); // 已绑别人
});

test('disconnect: password 不可断开;社交可断开(非最后一个),断开 bump epoch', async () => {
  const { app, deps, db } = await setup();
  await postJson(app, '/auth/signup', { email: 'eve@example.com', password: 'password123' });
  const u = (await db.select().from(users).get())!;
  const me = makeMeRoutes(deps, injectUser(u));
  const list = (await (await me.fetch(new Request('http://localhost/api/me/identities'))).json()) as {
    identities: { id: string; provider: string }[];
  };
  const pwId = list.identities.find((i) => i.provider === 'password')!.id;
  assert.equal((await del(me, `/api/me/identities/${pwId}`)).status, 409); // password 不可断开

  await attachIdentity(deps, u.id, { provider: 'google', sub: 'google:eve', email: 'eve@example.com', emailVerified: true });
  const me2 = makeMeRoutes(deps, injectUser(u));
  assert.equal((await del(me2, `/api/me/identities/${pwId}`)).status, 409); // 仍不可断开 password
  const gid = (await db
    .select()
    .from(identities)
    .where(and(eq(identities.userId, u.id), eq(identities.provider, 'google')))
    .get())!.id;
  assert.equal((await del(me2, `/api/me/identities/${gid}`)).status, 200); // 社交可断开
  const after = (await db.select().from(users).where(eq(users.id, u.id)).get())!;
  assert.equal(after.sessionEpoch, 1); // 断开社交也使其它会话失效
  assert.notEqual(after.passwordHash, null); // password 仍在
  const ids = await db.select().from(identities).where(eq(identities.userId, u.id)).all();
  assert.equal(ids.length, 1);
  assert.equal(ids[0]!.provider, 'password');
});

test('auto-link: 两边邮箱都已验证 → 社交登录直接进同一账号', async () => {
  const { app, deps, db } = await setup();
  await postJson(app, '/auth/signup', { email: 'henry@example.com', password: 'password123' });
  const u = (await db.select().from(users).where(eq(users.canonicalEmail, 'henry@example.com')).get())!;
  await db.update(users).set({ emailVerified: true }).where(eq(users.id, u.id)).run(); // 模拟已验证邮箱
  const r = await upsertFederatedUser(deps, { provider: 'github', sub: 'github:henry', email: 'henry@example.com', emailVerified: true });
  assert.equal(r.id, u.id); // 进同一账号
  assert.equal((await db.select().from(users).all()).length, 1); // 没新建
  const ids = await db.select().from(identities).where(eq(identities.userId, u.id)).all();
  assert.deepEqual(ids.map((i) => i.provider).sort(), ['github', 'password']);
});

test('auto-link 不触发:已有账号邮箱未验证 → 仍建独立账号(挡抢注)', async () => {
  const { app, deps, db } = await setup();
  await postJson(app, '/auth/signup', { email: 'iris@example.com', password: 'password123' }); // 未验证
  const before = (await db.select().from(users).get())!;
  const r = await upsertFederatedUser(deps, { provider: 'github', sub: 'github:iris', email: 'iris@example.com', emailVerified: true });
  assert.equal((await db.select().from(users).all()).length, 2); // 独立账号
  assert.notEqual(r.id, before.id);
});

test('verify-email: 注册发验证信,点链接置 emailVerified(user + password identity)', async () => {
  const sent: MailMessage[] = [];
  const mailer: Mailer = { send: async (m) => void sent.push(m) };
  const { app, db } = await setup({}, mailer);
  await postJson(app, '/auth/signup', { email: 'frank@example.com', password: 'password123' });
  assert.equal(sent.length, 1); // 注册触发一封验证信
  let u = (await db.select().from(users).where(eq(users.canonicalEmail, 'frank@example.com')).get())!;
  assert.equal(u.emailVerified, false); // 注册时未验证

  const tok = /verify-email\?token=([^\s&"]+)/.exec(sent[0]!.text ?? sent[0]!.html)?.[1];
  assert.ok(tok, '邮件含验证链接');
  assert.equal((await app.fetch(new Request(`http://localhost/auth/verify-email?token=${tok}`))).status, 200);

  u = (await db.select().from(users).where(eq(users.id, u.id)).get())!;
  assert.equal(u.emailVerified, true);
  const ident = await db
    .select()
    .from(identities)
    .where(and(eq(identities.userId, u.id), eq(identities.provider, 'password')))
    .get();
  assert.equal(ident?.emailVerified, true);
});

test('verify-email: 篡改/过期 token → 400,不改状态', async () => {
  const { app, db } = await setup({}, { send: async () => {} });
  await postJson(app, '/auth/signup', { email: 'grace@example.com', password: 'password123' });
  const r = await app.fetch(new Request('http://localhost/auth/verify-email?token=not-a-real-token'));
  assert.equal(r.status, 400);
  const u = (await db.select().from(users).where(eq(users.canonicalEmail, 'grace@example.com')).get())!;
  assert.equal(u.emailVerified, false);
});

test('gate: 非 admin 未验证 password + 配邮件 → canPublish false;验证后 true', async () => {
  const { app, deps, db } = await setup({}, { send: async () => {} } as Mailer);
  await postJson(app, '/auth/signup', { email: 'admin@example.com', password: 'password123' }); // 首个=admin
  await postJson(app, '/auth/signup', { email: 'user@example.com', password: 'password123' });
  const u = (await db.select().from(users).where(eq(users.canonicalEmail, 'user@example.com')).get())!;
  assert.equal(u.isAdmin, false);
  assert.equal(await canPublish(deps, u), false); // 未验证 + 配邮件 + 非 admin → 挡
  assert.equal(await canPublish(deps, { ...u, emailVerified: true }), true); // 验证后放行
  assert.equal(await canPublish(deps, { ...u, isAdmin: true }), true); // admin 豁免
});

test('gate: 无邮件实例 no-op;有 IdP 验证社交身份 → 放行', async () => {
  const noMail = await setup(); // 无 mailer
  await postJson(noMail.app, '/auth/signup', { email: 'a@example.com', password: 'password123' });
  await postJson(noMail.app, '/auth/signup', { email: 'b@example.com', password: 'password123' });
  const ub = (await noMail.db.select().from(users).where(eq(users.canonicalEmail, 'b@example.com')).get())!;
  assert.equal(await canPublish(noMail.deps, ub), true); // 没配邮件 → 不锁死

  const wm = await setup({}, { send: async () => {} } as Mailer);
  await postJson(wm.app, '/auth/signup', { email: 'admin2@example.com', password: 'password123' });
  await postJson(wm.app, '/auth/signup', { email: 'soc@example.com', password: 'password123' });
  const us = (await wm.db.select().from(users).where(eq(users.canonicalEmail, 'soc@example.com')).get())!;
  assert.equal(await canPublish(wm.deps, us), false); // 未验证
  await attachIdentity(wm.deps, us.id, { provider: 'google', sub: 'google:soc', email: 'soc@example.com', emailVerified: true });
  assert.equal(await canPublish(wm.deps, us), true); // 有 IdP 验证身份 → 放行(users.emailVerified 仍 false)
});

test('reconcile: 验证时把【空】password 账号并入【有内容】的社交账号(主 bug 修复)', async () => {
  const { app, deps, db } = await setup({}, { send: async () => {} } as Mailer);
  await postJson(app, '/auth/signup', { email: 'admin0@example.com', password: 'password123' }); // 首个=admin
  await postJson(app, '/auth/signup', { email: 'zoe@example.com', password: 'password123' });
  const A = (await db.select().from(users).where(eq(users.canonicalEmail, 'zoe@example.com')).get())!;
  // 同邮箱社交登录:因 A 未验证 → 建独立账号 B
  const B = await upsertFederatedUser(deps, { provider: 'github', sub: 'github:zoe', email: 'zoe@example.com', emailVerified: true });
  assert.notEqual(A.id, B.id);
  // B 有内容:handle + 站点
  await db.update(users).set({ handle: 'zoe' }).where(eq(users.id, B.id)).run();
  await db.insert(sites).values({ id: uuid(), ownerId: B.id, ownerHandle: 'zoe', slug: 's1', createdAt: nowIso(), updatedAt: nowIso() }).run();
  // 模拟点验证信:A.emailVerified=true,然后 reconcile
  await db.update(users).set({ emailVerified: true }).where(eq(users.id, A.id)).run();
  await reconcileByVerifiedEmail(deps, 'zoe@example.com');

  const aRow = (await db.select().from(users).where(eq(users.id, A.id)).get())!;
  const bRow = (await db.select().from(users).where(eq(users.id, B.id)).get())!;
  assert.equal(aRow.disabled, true); // 空账号 A 被吸收(禁用)
  assert.equal(bRow.canonicalEmail, 'zoe@example.com'); // canonical 槽搬到了 B
  assert.ok(bRow.passwordHash, 'B 带走了 A 的密码,可继续密码登录'); // 密码搬到 B
  const bIds = await db.select().from(identities).where(eq(identities.userId, B.id)).all();
  assert.deepEqual(bIds.map((i) => i.provider).sort(), ['github', 'password']); // 身份都在 B
  assert.equal((await db.select().from(identities).where(eq(identities.userId, A.id)).all()).length, 0);
});

test('reconcile: 两边都有内容(两个 handle)→ 记 conflict,绝不自动合并', async () => {
  const { deps, db } = await setup({}, { send: async () => {} } as Mailer);
  const a = await upsertFederatedUser(deps, { provider: 'google', sub: 'google:t', email: 't@x.com', emailVerified: true });
  await db.update(users).set({ handle: 'aaa' }).where(eq(users.id, a.id)).run();
  await db.insert(sites).values({ id: uuid(), ownerId: a.id, ownerHandle: 'aaa', slug: 's', createdAt: nowIso(), updatedAt: nowIso() }).run();
  // 第二个账号(模拟 pre-gate 历史):同 verified 邮箱身份 + 自己的 handle+站点
  const bId = uuid();
  await db.insert(users).values({ id: bId, email: 't@x.com', handle: 'bbb', createdAt: nowIso() }).run();
  await db.insert(identities).values({ id: uuid(), userId: bId, provider: 'github', sub: 'github:t', email: 't@x.com', emailVerified: true, createdAt: nowIso() }).run();
  await db.insert(sites).values({ id: uuid(), ownerId: bId, ownerHandle: 'bbb', slug: 's', createdAt: nowIso(), updatedAt: nowIso() }).run();

  await reconcileByVerifiedEmail(deps, 't@x.com');

  assert.equal((await db.select().from(users).where(eq(users.id, a.id)).get())!.disabled, false); // 两边都活
  assert.equal((await db.select().from(users).where(eq(users.id, bId)).get())!.disabled, false);
  const conflicts = await db.select().from(accountMerges).where(eq(accountMerges.status, 'conflict')).all();
  assert.ok(conflicts.length >= 1, '记了 conflict 等人工');
});
