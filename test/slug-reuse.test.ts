/** 普通唯一索引(非部分索引)+ 软删改名 的语义回归。
 *
 * 这批改动把 sites_handle_slug_uq / users 的部分唯一索引(WHERE …)换成了【普通】唯一索引,
 * 以便一份 schema 跨 SQLite/PG/MySQL 通用。本测试钉住两条不能回退的语义:
 *   1) 活站之间 (owner_handle, slug) 仍唯一;软删(改墓碑名)后同名 slug 可被新站复用。
 *   2) 可空唯一列(handle/canonical_email/oidc_sub)允许多个 NULL,非空值仍唯一。
 *
 * 运行:node --import tsx --test test/slug-reuse.test.ts(见 package.json test:unit)。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { and, eq, isNull } from 'drizzle-orm';

import { sites, users } from '../src/db/index.js';
import { makeTestDb } from './helpers/db.js';
import { nowIso, tombstoneSlug, uuid } from '../src/util.js';

function liveSiteRow(id: string, ownerId: string, handle: string, slug: string) {
  const now = nowIso();
  return {
    id,
    ownerId,
    ownerHandle: handle,
    slug,
    title: null,
    visibility: 'private' as const,
    publicExpiresAt: null,
    shareKeyVersion: 1,
    guestComments: true,
    expiresAt: null,
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

test('soft-deleting a site frees its slug for reuse (plain unique index)', async () => {
  const db = await makeTestDb();
  await db.insert(users).values({ id: 'u1', handle: 'alice', createdAt: nowIso() });

  const s1 = liveSiteRow('s1', 'u1', 'alice', 'demo');
  await db.insert(sites).values(s1);

  // 活站之间仍唯一:第二个同名活站必须被唯一索引拒绝。
  await assert.rejects(
    db.insert(sites).values(liveSiteRow('s2', 'u1', 'alice', 'demo')),
    'second LIVE (alice, demo) must violate the unique index',
  );

  // 软删 = 设 deletedAt + 改墓碑名,让出活命名空间。
  await db
    .update(sites)
    .set({ deletedAt: nowIso(), slug: tombstoneSlug('demo', 's1') })
    .where(eq(sites.id, 's1'));

  // 现在同名 slug 可被新站复用,不再撞唯一索引。
  await db.insert(sites).values(liveSiteRow('s3', 'u1', 'alice', 'demo'));

  const live = (
    await db
      .select()
      .from(sites)
      .where(and(eq(sites.ownerHandle, 'alice'), eq(sites.slug, 'demo'), isNull(sites.deletedAt)))
  )[0];
  assert.equal(live?.id, 's3', 'the reused slug resolves to the new live site');

  const tomb = (await db.select().from(sites).where(eq(sites.id, 's1')))[0];
  assert.equal(tomb?.slug, 'demo:deleted:s1', 'tombstone keeps a mangled, collision-free slug');
});

test('nullable-unique columns allow many NULLs but keep non-null values unique', async () => {
  const db = await makeTestDb();

  // 多个 handle/canonical_email/oidc_sub 全空的用户 → 普通唯一索引允许(三方言一致)。
  await db.insert(users).values({ id: 'n1', createdAt: nowIso() });
  await db.insert(users).values({ id: 'n2', createdAt: nowIso() });

  // 非空值仍唯一:第二个 handle='bob' 必须被拒。
  await db.insert(users).values({ id: 'b1', handle: 'bob', createdAt: nowIso() });
  await assert.rejects(
    db.insert(users).values({ id: 'b2', handle: 'bob', createdAt: nowIso() }),
    'duplicate non-null handle must violate the unique index',
  );
});
