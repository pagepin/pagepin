/** 线程越站回归 —— 站点软删(slug 墓碑化)后同 slug 重建,overlay 线程接口不得带出旧站线程。
 *
 * 根因:线程行自带 (ownerHandle, slug) 且不随站点软删改写;overlay GET 曾按 (handle, slug)
 * 过滤,新站复用 slug 即"继承"旧站评论(PAT 导出一直按 siteId,两口径不一)。线上已复现。
 * 修复:overlay 查询按 siteId 收口(resolveCommenter 已加载 site,零额外查询)。
 *
 * 运行:node --import tsx --test test/thread-slug-reuse.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';

import { mint } from '../src/auth/sessions.js';
import { makeCommentRoutes } from '../src/comments.js';
import { loadConfig } from '../src/config.js';
import { sites, users, type Db } from '../src/db/index.js';
import type { AppDeps, AppEnv } from '../src/types.js';
import { nowIso, tombstoneSlug, uuid } from '../src/util.js';
import { makeTestDb } from './helpers/db.js';

const cfg = loadConfig({
  PAGEPIN_SECRET: 'test-secret',
  PAGEPIN_BASE_URL: 'http://localhost:8000',
});

async function seedSite(db: Db, id: string, slug: string): Promise<string> {
  const vid = uuid();
  await db.insert(sites).values({
    id,
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
        total_bytes: 10,
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
  return vid;
}

test('threads never leak from a soft-deleted site into a new site reusing the slug', async () => {
  const db = await makeTestDb();
  await db.insert(users).values({
    id: 'u-owner',
    email: 'alice@example.com',
    handle: 'alice',
    displayName: 'Alice',
    createdAt: nowIso(),
  });
  await seedSite(db, 's-old', 'demo');
  const deps = { config: cfg, db, storage: null as never } as AppDeps; // 评论面不触 storage
  const app = new Hono<AppEnv>();
  app.route('/', makeCommentRoutes(deps));
  const cookie = `pp_session=${await mint(cfg, 'session', 'u-owner', 'alice', 0, 'csrf')}`;

  // 旧站落一条线程(线程行快照 ownerHandle+slug='alice'/'demo',软删不会改写它)
  const create = await app.fetch(
    new Request('http://localhost/api/comments/alice/demo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        path: 'index.html',
        selector: '#title',
        rx: 0.5,
        ry: 0.5,
        kind: null,
        anchor_text: null,
        text: '旧站的评论',
      }),
    }),
  );
  assert.equal(create.status, 200);

  // 软删旧站(同 DELETE 处理器语义:deletedAt + slug 墓碑化),同 slug 重建新站
  await db
    .update(sites)
    .set({ deletedAt: nowIso(), slug: tombstoneSlug('demo', 's-old') })
    .where(eq(sites.id, 's-old'));
  const newVid = await seedSite(db, 's-new', 'demo');

  const list = await app.fetch(
    new Request('http://localhost/api/comments/alice/demo?path=index.html', {
      headers: { Cookie: cookie },
    }),
  );
  assert.equal(list.status, 200);
  const body = (await list.json()) as { threads: unknown[]; site_version: string };
  assert.deepEqual(body.threads, []); // 旧站线程不得漂到新站
  assert.equal(body.site_version, newVid); // site_version 指向新站当前版本
});
