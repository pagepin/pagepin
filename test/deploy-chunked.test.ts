/** 分批上传 + 版本 GC + 每用户配额 集成测试 —— 内存 libSQL + 真 FsStorage + 注入式 auth。
 *
 * 覆盖:begin→files(多批)→commit 累计发布;重传同路径去重;keepVersions 裁剪并回收旧版存储;
 *      每用户配额超限 413;abort 回收草稿;begin 顺手清理过期草稿。
 *
 * 运行:node --import tsx --test test/deploy-chunked.test.ts(见 package.json test:unit)。
 */
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';

import type { AuthMiddleware } from '../src/api/deps.js';
import { makeSiteRoutes } from '../src/api/sites.js';
import { loadConfig } from '../src/config.js';
import { deploySessions, sites, users } from '../src/db/index.js';
import type { UserRow } from '../src/db/index.js';
import { createLibsqlDb } from '../src/db/libsql.js';
import { FsStorage } from '../src/storage/fs.js';
import type { AppDeps, AppEnv } from '../src/types.js';
import { nowIso } from '../src/util.js';

/** 注入式 mw:绕过 Cookie/CSRF,直接放一个已登录用户进 context。 */
function injectUser(user: UserRow): AuthMiddleware {
  const inject = createMiddleware<AppEnv>(async (c, next) => {
    c.set('user', user);
    c.set('authVia', 'cookie');
    await next();
  });
  return {
    currentUser: inject,
    mutatingUser: inject,
    cookieUser: inject,
    cookieMutatingUser: inject,
    adminUser: inject,
    adminMutatingUser: inject,
  } as AuthMiddleware;
}

async function setup(env: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'pagepin-chunk-'));
  const storage = new FsStorage(dir);
  const db = await createLibsqlDb(':memory:'); // 自动应用 drizzle 迁移(含 deploy_sessions)
  const user: UserRow = {
    id: 'u1',
    email: 'u@example.com',
    passwordHash: null,
    oidcSub: null,
    handle: 'alice',
    displayName: 'Alice',
    isAdmin: false, // 非管理员 → 配额生效
    disabled: false,
    createdAt: nowIso(),
    lastLoginAt: null,
  };
  await db.insert(users).values(user).run();
  const cfg = loadConfig({ PAGEPIN_SECRET: 'test', PAGEPIN_BASE_URL: 'http://localhost:8000', ...env });
  const deps: AppDeps = { config: cfg, db, storage };
  const app = makeSiteRoutes(deps, injectUser(user));
  return { storage, db, cfg, app };
}

/** 构造 multipart 表单:files/paths 成对;bytes 为数字时填等长 'x',为字符串时原样。 */
function form(items: { path: string; bytes: number | string }[], title?: string): FormData {
  const fd = new FormData();
  for (const it of items) {
    const data = typeof it.bytes === 'string' ? it.bytes : 'x'.repeat(it.bytes);
    fd.append('files', new File([data], it.path.split('/').pop() ?? it.path));
    fd.append('paths', it.path);
  }
  if (title) fd.append('title', title);
  return fd;
}

function postForm(app: Hono<AppEnv>, path: string, fd: FormData): Promise<Response> {
  return Promise.resolve(app.fetch(new Request('http://localhost' + path, { method: 'POST', body: fd })));
}
function postJson(app: Hono<AppEnv>, path: string, body: unknown = {}): Promise<Response> {
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
function del(app: Hono<AppEnv>, path: string): Promise<Response> {
  return Promise.resolve(app.fetch(new Request('http://localhost' + path, { method: 'DELETE' })));
}

test('chunked: begin → 2 batches → commit 发布两批的并集', async () => {
  const { app, db, storage } = await setup();

  const begin = await postJson(app, '/api/sites/big/deploys', { title: 'Big' });
  assert.equal(begin.status, 200);
  const { deploy_id } = await begin.json();
  assert.ok(deploy_id, '返回 deploy_id');

  // 第 1 批
  let r = await postForm(
    app,
    `/api/sites/big/deploys/${deploy_id}/files`,
    form([
      { path: 'index.html', bytes: '<h1>hi</h1>' },
      { path: 'a.css', bytes: 100 },
    ]),
  );
  assert.equal(r.status, 200);
  assert.equal((await r.json()).file_count, 2);

  // 第 2 批(累计)
  r = await postForm(app, `/api/sites/big/deploys/${deploy_id}/files`, form([{ path: 'assets/app.js', bytes: 200 }]));
  assert.equal(r.status, 200);
  const batch2 = await r.json();
  assert.equal(batch2.file_count, 3);
  assert.equal(batch2.total_bytes, '<h1>hi</h1>'.length + 100 + 200);

  // commit
  r = await postJson(app, `/api/sites/big/deploys/${deploy_id}/commit`, {});
  assert.equal(r.status, 200);
  const site = await r.json();
  assert.equal(site.file_count, 3, 'commit 发布全部 3 个文件');
  assert.equal(site.version_count, 1);

  // 文件真的落在该版本前缀下
  const row = await db.select().from(sites).where(eq(sites.slug, 'big')).get();
  const prefix = row!.versions[0]!.storage_prefix;
  assert.equal(await storage.exists(prefix + 'index.html'), true);
  assert.equal(await storage.exists(prefix + 'assets/app.js'), true);

  // 草稿会话已删
  const sess = await db.select().from(deploySessions).where(eq(deploySessions.id, deploy_id)).get();
  assert.equal(sess, undefined, 'commit 后草稿行清除');
});

test('chunked: 跨批重传同路径按 rel 去重(不重复计数)', async () => {
  const { app } = await setup();
  const { deploy_id } = await (await postJson(app, '/api/sites/dd/deploys')).json();
  await postForm(app, `/api/sites/dd/deploys/${deploy_id}/files`, form([{ path: 'index.html', bytes: 'v1' }]));
  const r = await postForm(
    app,
    `/api/sites/dd/deploys/${deploy_id}/files`,
    form([{ path: 'index.html', bytes: 'version-two' }]),
  );
  const body = await r.json();
  assert.equal(body.file_count, 1, '同路径只算一个');
  assert.equal(body.total_bytes, 'version-two'.length, '大小取最后一次');
});

test('GC: keepVersions=2,部署 3 次裁掉最旧版本并回收其存储', async () => {
  const { app, db, storage } = await setup({ PAGEPIN_KEEP_VERSIONS: '2' });
  const prefixes: string[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await postForm(app, '/api/sites/gc/deploy', form([{ path: 'index.html', bytes: `v${i}` }], 'GC'));
    assert.equal(r.status, 200);
    // 第 3 次(i=2)发布触达上限 → 响应里 pruned_versions=1;前两次为 0
    assert.equal((await r.json()).pruned_versions, i < 2 ? 0 : 1, 'pruned_versions 透出被回收版本数');
    const row = await db.select().from(sites).where(eq(sites.slug, 'gc')).get();
    prefixes.push(row!.versions[row!.versions.length - 1]!.storage_prefix);
  }
  const row = await db.select().from(sites).where(eq(sites.slug, 'gc')).get();
  assert.equal(row!.versions.length, 2, '裁到 keepVersions');
  assert.equal(await storage.exists(prefixes[0]! + 'index.html'), false, '最旧版本存储被回收');
  assert.equal(await storage.exists(prefixes[2]! + 'index.html'), true, '最新版本保留');
});

test('配额: 部署累计超过 PAGEPIN_FREE_USER_MB 即 413', async () => {
  const { app } = await setup({ PAGEPIN_FREE_USER_MB: '1', PAGEPIN_KEEP_VERSIONS: '0' });
  // 站点 1 ~0.6MB:通过
  let r = await postForm(app, '/api/sites/q1/deploy', form([{ path: 'index.html', bytes: 600 * 1024 }]));
  assert.equal(r.status, 200);
  // 站点 2 ~0.6MB:总和 ~1.2MB > 1MB → 413
  r = await postForm(app, '/api/sites/q2/deploy', form([{ path: 'index.html', bytes: 600 * 1024 }]));
  assert.equal(r.status, 413, '超配额被拒');
});

test('abort: 丢弃草稿并回收已上传的存储', async () => {
  const { app, db, storage } = await setup();
  const begin = await (await postJson(app, '/api/sites/ab/deploys')).json();
  const { deploy_id, storage_prefix } = begin;
  await postForm(app, `/api/sites/ab/deploys/${deploy_id}/files`, form([{ path: 'index.html', bytes: 'draft' }]));
  assert.equal(await storage.exists(storage_prefix + 'index.html'), true);

  const r = await del(app, `/api/sites/ab/deploys/${deploy_id}`);
  assert.equal(r.status, 200);
  assert.equal(await storage.exists(storage_prefix + 'index.html'), false, '草稿存储被回收');
  const sess = await db.select().from(deploySessions).where(eq(deploySessions.id, deploy_id)).get();
  assert.equal(sess, undefined, '草稿行已删');
});

test('begin: 顺手清理本人过期未提交草稿', async () => {
  const { app, db, storage } = await setup();
  const stalePrefix = 'sites/u1/old/stale-vid/';
  await storage.put(stalePrefix + 'index.html', new TextEncoder().encode('old'), 'text/html');
  await db
    .insert(deploySessions)
    .values({
      id: 'stale-vid',
      siteId: 's-old',
      ownerId: 'u1',
      slug: 'old',
      storagePrefix: stalePrefix,
      title: null,
      manifest: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      expiresAt: new Date(Date.now() - 1000).toISOString(), // 已过期
    })
    .run();

  await postJson(app, '/api/sites/fresh/deploys'); // 任一 begin 触发清理
  const gone = await db.select().from(deploySessions).where(eq(deploySessions.id, 'stale-vid')).get();
  assert.equal(gone, undefined, '过期草稿行被清');
  assert.equal(await storage.exists(stalePrefix + 'index.html'), false, '过期草稿存储被回收');
});
