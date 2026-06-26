/** PostgreSQL 端到端集成测试 —— 对着真实 PG 验证驱动 + 迁移 + 方言切换 + await 风格查询。
 *
 * 默认跳过;设 PAGEPIN_TEST_PG_URL 才跑(CI/本地起 Docker PG 时):
 *   docker run -d --name pagepin-pg -e POSTGRES_PASSWORD=pagepin -e POSTGRES_USER=pagepin \
 *     -e POSTGRES_DB=pagepin -p 55432:5432 postgres:16-alpine
 *   PAGEPIN_TEST_PG_URL=postgres://pagepin:pagepin@localhost:55432/pagepin \
 *     node --import tsx --test test/pg-integration.test.ts
 *
 * 必须【单文件】跑:db/index.ts 在模块加载期按 PAGEPIN_DB_URL 选方言表,若其他测试先 import 了它
 * 会按 sqlite 缓存,这里就切不到 pg。本文件顶层不 import db/index.ts,改在用例里设好 env 后动态 import。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

const PG_URL = process.env.PAGEPIN_TEST_PG_URL;

function liveSite(id: string, slug: string) {
  const now = new Date().toISOString();
  return {
    id,
    ownerId: 'u1',
    ownerHandle: 'alice',
    slug,
    title: null,
    visibility: 'private' as const,
    publicExpiresAt: null,
    spaFallback: false,
    commentsEnabled: true,
    currentVersionId: null,
    versions: [],
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    suspendedAt: null,
    suspendedReason: null,
  };
}

test('postgres end-to-end: migrations + dialect-switched tables + core semantics', { skip: !PG_URL }, async () => {
  process.env.PAGEPIN_DB_URL = PG_URL; // db/index.ts 据此在模块加载期选 pg 表
  const { sites, users } = await import('../src/db/index.js');
  const { createPostgresDb } = await import('../src/db/postgres.js');
  const { and, eq, isNull } = await import('drizzle-orm');
  const { tombstoneSlug } = await import('../src/util.js');

  const db = await createPostgresDb(PG_URL!); // 启动应用 drizzle/pg 迁移

  // 干净起点(可重复跑)
  await db.delete(sites);
  await db.delete(users);

  // 1) 建用户 + 站点(await 风格在真实 PG 上生效)
  await db.insert(users).values({ id: 'u1', handle: 'alice', createdAt: new Date().toISOString() });
  await db.insert(sites).values(liveSite('s1', 'demo'));

  // 2) 活站之间普通唯一索引在 PG 上强制
  await assert.rejects(
    db.insert(sites).values(liveSite('s2', 'demo')),
    'duplicate live (alice, demo) must violate the unique index on PG',
  );

  // 3) 软删改名 → 同名 slug 复用
  await db
    .update(sites)
    .set({ deletedAt: new Date().toISOString(), slug: tombstoneSlug('demo', 's1') })
    .where(eq(sites.id, 's1'));
  await db.insert(sites).values(liveSite('s3', 'demo'));
  const live = (
    await db
      .select()
      .from(sites)
      .where(and(eq(sites.ownerHandle, 'alice'), eq(sites.slug, 'demo'), isNull(sites.deletedAt)))
  )[0];
  assert.equal(live?.id, 's3', 'reused slug resolves to the new live site on PG');

  // 4) 可空唯一列:多个 NULL handle 允许,非空值唯一
  await db.insert(users).values({ id: 'n1', createdAt: new Date().toISOString() });
  await db.insert(users).values({ id: 'n2', createdAt: new Date().toISOString() });
  await db.insert(users).values({ id: 'b1', handle: 'bob', createdAt: new Date().toISOString() });
  await assert.rejects(
    db.insert(users).values({ id: 'b2', handle: 'bob', createdAt: new Date().toISOString() }),
    'duplicate non-null handle must violate the unique index on PG',
  );

  // 5) jsonb 列(versions)往返:drizzle 映射成 JS 对象
  await db
    .update(sites)
    .set({
      versions: [
        { id: 'v1', storage_prefix: 'x/', file_count: 1, total_bytes: 3, uploaded_by: 'u1', created_at: new Date().toISOString() },
      ],
    })
    .where(eq(sites.id, 's3'));
  const withVer = (await db.select().from(sites).where(eq(sites.id, 's3')))[0];
  assert.equal(withVer?.versions[0]?.id, 'v1', 'jsonb round-trips to a JS object on PG');

  // 6) 乐观锁 CAS(.returning() 在 PG 上):守 currentVersionId
  const ok = await db
    .update(sites)
    .set({ currentVersionId: 'v1' })
    .where(and(eq(sites.id, 's3'), isNull(sites.currentVersionId)))
    .returning({ id: sites.id });
  assert.equal(ok.length, 1, 'guarded CAS update returns the row when the guard holds');
  const conflict = await db
    .update(sites)
    .set({ currentVersionId: 'v2' })
    .where(and(eq(sites.id, 's3'), isNull(sites.currentVersionId)))
    .returning({ id: sites.id });
  assert.equal(conflict.length, 0, 'guarded CAS update returns [] when the guard fails (conflict)');

  // 7) boolean 列映射成 JS true
  const b = (await db.select({ ce: sites.commentsEnabled }).from(sites).where(eq(sites.id, 's3')))[0];
  assert.equal(b?.ce, true, 'boolean column maps to JS true on PG');
});
