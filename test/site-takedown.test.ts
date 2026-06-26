/** 站点下架 / 强删 / 存储回收 测试 —— 内存 libSQL + 注入式 auth 中间件(同 device-flow 套路)。
 *
 * 覆盖:管理员下架 → serving 对所有访问者返回 451;恢复 → 回到登录墙;
 *      管理员强删 → 软删 + 调用 storage.deletePrefix;FsStorage.deletePrefix 真清盘。
 *
 * 运行:node --import tsx --test test/site-takedown.test.ts(见 package.json test:unit)。
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';

import { makeAdminRoutes } from '../src/api/admin.js';
import type { AuthMiddleware } from '../src/api/deps.js';
import { loadConfig } from '../src/config.js';
import { sites, users } from '../src/db/index.js';
import { makeTestDb } from './helpers/db.js';
import { makeServingRoutes } from '../src/serving.js';
import { FsStorage } from '../src/storage/fs.js';
import type { Storage } from '../src/storage/index.js';
import type { AppDeps, AppEnv } from '../src/types.js';
import { nowIso, uuid } from '../src/util.js';

const cfg = loadConfig({
  PAGEPIN_SECRET: 'test-secret',
  PAGEPIN_BASE_URL: 'http://localhost:8000',
});

/** 注入式 mw:绕过真实 Cookie/CSRF,直接放一个已登录管理员进 context。 */
function injectAdmin(admin: typeof users.$inferSelect): AuthMiddleware {
  const inject = createMiddleware<AppEnv>(async (c, next) => {
    c.set('user', admin);
    c.set('authVia', 'cookie');
    await next();
  });
  return {
    currentUser: inject,
    mutatingUser: inject,
    cookieUser: inject,
    cookieMutatingUser: inject,
    requireVerified: inject,
    adminUser: inject,
    adminMutatingUser: inject,
  } as AuthMiddleware;
}

async function seed(storage: Storage) {
  const db = await makeTestDb();
  const admin = {
    id: 'u-admin',
    email: 'admin@example.com',
    passwordHash: null,
    oidcSub: null,
    handle: 'alice', // 'admin' 是 serving 的保留段,内容 handle 不能用
    displayName: 'Admin',
    isAdmin: true,
    disabled: false,
    createdAt: nowIso(),
    lastLoginAt: null,
  };
  await db.insert(users).values(admin);

  const vid = uuid();
  const site = {
    id: 's-1',
    ownerId: admin.id,
    ownerHandle: 'alice',
    slug: 'demo',
    title: 'Demo',
    visibility: 'private' as const,
    publicExpiresAt: null,
    spaFallback: false,
    commentsEnabled: true,
    currentVersionId: vid,
    versions: [
      {
        id: vid,
        storage_prefix: `sites/${admin.id}/demo/${vid}/`,
        file_count: 1,
        total_bytes: 3,
        uploaded_by: admin.id,
        created_at: nowIso(),
      },
    ],
    createdAt: nowIso(),
    updatedAt: nowIso(),
    deletedAt: null,
    suspendedAt: null,
    suspendedReason: null,
  };
  await db.insert(sites).values(site);

  const deps: AppDeps = { config: cfg, db, storage };
  const adminApp = makeAdminRoutes(deps, injectAdmin(admin));
  const servingApp = makeServingRoutes(deps);
  return { db, deps, adminApp, servingApp };
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

/** 浏览器导航式 GET(Accept: text/html);serving 单域前缀 /p。 */
function getPage(app: Hono<AppEnv>, path: string): Promise<Response> {
  return Promise.resolve(
    app.fetch(new Request('http://localhost' + path, { headers: { accept: 'text/html' } })),
  );
}

test('admin suspend → serving 451 for everyone; unsuspend → back to gate', async () => {
  const { adminApp, servingApp } = await seed({} as unknown as Storage);

  // 下架前:私有站匿名访问 = 登录墙(200 品牌门页,不是 451)
  const before = await getPage(servingApp, '/p/alice/demo/');
  assert.equal(before.status, 200);

  const susp = await post(adminApp, '/api/admin/sites/s-1/suspend', { reason: 'phishing' });
  assert.equal(susp.status, 200);
  const body = (await susp.json()) as { suspended: boolean; suspended_reason: string };
  assert.equal(body.suspended, true);
  assert.equal(body.suspended_reason, 'phishing');

  // 下架后:任何访问者(含匿名)= 451
  const after = await getPage(servingApp, '/p/alice/demo/');
  assert.equal(after.status, 451);

  const un = await post(adminApp, '/api/admin/sites/s-1/unsuspend');
  assert.equal(un.status, 200);
  assert.equal(((await un.json()) as { suspended: boolean }).suspended, false);

  const restored = await getPage(servingApp, '/p/alice/demo/');
  assert.equal(restored.status, 200); // 回到登录墙,不再 451
});

test('admin delete → soft-deletes the row and calls storage.deletePrefix', async () => {
  let purged: string | null = null;
  const storage = {
    deletePrefix: async (prefix: string) => {
      purged = prefix;
    },
  } as unknown as Storage;
  const { db, adminApp } = await seed(storage);

  const res = await Promise.resolve(
    adminApp.fetch(new Request('http://localhost/api/admin/sites/s-1', { method: 'DELETE' })),
  );
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { ok: boolean }).ok, true);

  const row = (await db.select().from(sites).where(eq(sites.id, 's-1')))[0];
  assert.ok(row?.deletedAt, 'site is soft-deleted (tombstone kept)');
  assert.equal(purged, 'sites/u-admin/demo/', 'storage回收用站点前缀,覆盖所有版本');
});

test('admin delete on a missing site → 404', async () => {
  const { adminApp } = await seed({} as unknown as Storage);
  const res = await Promise.resolve(
    adminApp.fetch(new Request('http://localhost/api/admin/sites/nope', { method: 'DELETE' })),
  );
  assert.equal(res.status, 404);
});

test('FsStorage.deletePrefix removes the whole site subtree', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pagepin-purge-'));
  const storage = new FsStorage(dir);
  // sites-data/<root>;写两个版本下的文件
  const base = join(dir, 'sites-data', 'sites', 'u1', 'demo');
  await mkdir(join(base, 'v1'), { recursive: true });
  await mkdir(join(base, 'v2'), { recursive: true });
  await writeFile(join(base, 'v1', 'index.html'), '<h1>a</h1>');
  await writeFile(join(base, 'v2', 'index.html'), '<h1>b</h1>');

  assert.equal(await storage.exists('sites/u1/demo/v1/index.html'), true);
  await storage.deletePrefix('sites/u1/demo/');
  assert.equal(await storage.exists('sites/u1/demo/v1/index.html'), false);
  assert.equal(await storage.exists('sites/u1/demo/v2/index.html'), false);

  // 不存在的前缀再删一次不报错(force)
  await storage.deletePrefix('sites/u1/demo/');
});
