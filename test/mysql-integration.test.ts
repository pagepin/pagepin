/** MySQL 端到端集成测试 —— 对着真实 MySQL 验证驱动 + 迁移 + 方言切换 + await 查询,
 *  并重点验证 MySQL 专属的方言收口:writtenCount(无 RETURNING → affectedRows)与
 *  upsert(ON DUPLICATE KEY UPDATE)。
 *
 * 默认跳过;设 PAGEPIN_TEST_MYSQL_URL 才跑:
 *   docker run -d --name pagepin-my -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=pagepin \
 *     -e MYSQL_USER=pagepin -e MYSQL_PASSWORD=pagepin -p 33060:3306 mysql:8
 *   PAGEPIN_TEST_MYSQL_URL=mysql://pagepin:pagepin@localhost:33060/pagepin \
 *     node --import tsx --test --test-force-exit test/mysql-integration.test.ts
 *
 * 必须【单文件】跑(同 pg-integration:db/index.ts 在模块加载期按 env 选方言表)。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

const MY_URL = process.env.PAGEPIN_TEST_MYSQL_URL;

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

test('mysql end-to-end: migrations + dialect helpers (affectedRows CAS, onDuplicateKey upsert)', { skip: !MY_URL }, async () => {
  process.env.PAGEPIN_DB_URL = MY_URL; // db/index.ts 据此选 mysql 表;dbDialect='mysql'
  const { sites, users, instanceSettings } = await import('../src/db/index.js');
  const { createMysqlDb } = await import('../src/db/mysql.js');
  const { writtenCount, upsert } = await import('../src/db/ops.js');
  const { and, eq, isNull } = await import('drizzle-orm');
  const { tombstoneSlug } = await import('../src/util.js');

  const db = await createMysqlDb(MY_URL!); // 启动应用 drizzle/mysql 迁移

  // 干净起点
  await db.delete(sites);
  await db.delete(users);
  await db.delete(instanceSettings);

  // 1) 建用户 + 站点
  await db.insert(users).values({ id: 'u1', handle: 'alice', createdAt: new Date().toISOString() });
  await db.insert(sites).values(liveSite('s1', 'demo'));

  // 2) 活站普通唯一索引
  await assert.rejects(
    db.insert(sites).values(liveSite('s2', 'demo')),
    'duplicate live (alice, demo) must violate the unique index on MySQL',
  );

  // 3) 软删改名 → slug 复用
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
  assert.equal(live?.id, 's3', 'reused slug resolves to the new live site on MySQL');

  // 4) 可空唯一:多个 NULL handle,非空唯一
  await db.insert(users).values({ id: 'n1', createdAt: new Date().toISOString() });
  await db.insert(users).values({ id: 'n2', createdAt: new Date().toISOString() });
  await db.insert(users).values({ id: 'b1', handle: 'bob', createdAt: new Date().toISOString() });
  await assert.rejects(
    db.insert(users).values({ id: 'b2', handle: 'bob', createdAt: new Date().toISOString() }),
    'duplicate non-null handle must violate the unique index on MySQL',
  );

  // 5) json 列(versions)往返 + boolean 映射
  await db
    .update(sites)
    .set({
      versions: [
        { id: 'v1', storage_prefix: 'x/', file_count: 1, total_bytes: 3, uploaded_by: 'u1', created_at: new Date().toISOString() },
      ],
    })
    .where(eq(sites.id, 's3'));
  const withVer = (await db.select().from(sites).where(eq(sites.id, 's3')))[0];
  assert.equal(withVer?.versions[0]?.id, 'v1', 'json round-trips to a JS object on MySQL');
  assert.equal(withVer?.commentsEnabled, true, 'boolean(tinyint) maps to JS true on MySQL');

  // 6) writtenCount:MySQL 无 RETURNING,走 affectedRows。守 currentVersionId IS NULL。
  const hit = await writtenCount(
    db
      .update(sites)
      .set({ currentVersionId: 'v1', updatedAt: new Date().toISOString() })
      .where(and(eq(sites.id, 's3'), isNull(sites.currentVersionId))),
  );
  assert.equal(hit, 1, 'guarded write reports 1 (affectedRows) when the guard holds on MySQL');
  const miss = await writtenCount(
    db
      .update(sites)
      .set({ currentVersionId: 'v2', updatedAt: new Date().toISOString() })
      .where(and(eq(sites.id, 's3'), isNull(sites.currentVersionId))),
  );
  assert.equal(miss, 0, 'guarded write reports 0 when the guard fails (conflict) on MySQL');

  // 7) upsert:MySQL 走 ON DUPLICATE KEY UPDATE
  await upsert(db.insert(instanceSettings).values({ key: 'k', value: 'a' }), instanceSettings.key, { value: 'a' });
  await upsert(db.insert(instanceSettings).values({ key: 'k', value: 'b' }), instanceSettings.key, { value: 'b' });
  const setting = (await db.select().from(instanceSettings).where(eq(instanceSettings.key, 'k')))[0];
  assert.equal(setting?.value, 'b', 'upsert (ON DUPLICATE KEY UPDATE) updates the value on MySQL');
});
