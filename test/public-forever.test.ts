/** 永久公开(public_forever)—— 谓词三态 + PATCH 分支 + 匿名 serving。
 *
 *   1) isPubliclyVisible 三态:永久(publicExpiresAt=null)/ 限时未过期 / 限时已过期。
 *   2) PATCH /api/sites/:slug:forever → public_expires_at=null;forever 压过 public_hours;
 *      不带 visibility:"public" 的 forever → 422;缺省/false 走原有 24h 与 publicMaxHours 上限。
 *   3) serving:永久公开站点匿名可看,回私有后立刻收回。
 *
 * 运行:node --import tsx --test test/public-forever.test.ts(内存 SQLite 直跑,无外部依赖)。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { makeAuthMiddleware } from '../src/api/deps.js';
import { makeSiteRoutes } from '../src/api/sites.js';
import { mint } from '../src/auth/sessions.js';
import { loadConfig } from '../src/config.js';
import { isPubliclyVisible, sites, users, type Db, type SiteRow } from '../src/db/index.js';
import { makeServingRoutes } from '../src/serving.js';
import { NotFoundError } from '../src/storage/index.js';
import type { ObjectMeta, Storage } from '../src/storage/index.js';
import type { AppDeps, AppEnv } from '../src/types.js';
import { nowIso, uuid } from '../src/util.js';
import { makeTestDb } from './helpers/db.js';

const cfg = loadConfig({
  PAGEPIN_SECRET: 'test-secret',
  PAGEPIN_BASE_URL: 'http://localhost:8000',
});
const CSRF = 'test-csrf';
const PAGE_HTML = '<html><head><title>demo</title></head><body><h1>Forever</h1></body></html>';

/** 内存 Storage:serving 只需要 open/exists。 */
class MemStorage implements Storage {
  private readonly objects = new Map<string, { data: Uint8Array; contentType: string }>();

  async put(
    key: string,
    data: ReadableStream<Uint8Array> | Uint8Array,
    contentType: string,
  ): Promise<void> {
    const bytes =
      data instanceof Uint8Array
        ? data
        : new Uint8Array(await new Response(data as unknown as BodyInit).arrayBuffer());
    this.objects.set(key, { data: bytes, contentType });
  }

  async copy(src: string, dst: string): Promise<void> {
    const o = this.objects.get(src);
    if (!o) throw new NotFoundError(src);
    this.objects.set(dst, o);
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async open(key: string): Promise<{ meta: ObjectMeta; body: ReadableStream<Uint8Array> }> {
    const o = this.objects.get(key);
    if (!o) throw new NotFoundError(key);
    const meta: ObjectMeta = { contentType: o.contentType, contentLength: o.data.byteLength };
    return { meta, body: new Response(o.data as unknown as BodyInit).body! };
  }
}

/** 谓词用的最小 SiteRow(只有 visibility / publicExpiresAt 参与判定)。 */
function siteWith(visibility: 'public' | 'private', publicExpiresAt: string | null): SiteRow {
  return { visibility, publicExpiresAt } as SiteRow;
}

const NOW = new Date('2026-08-25T00:00:00.000Z');

test('isPubliclyVisible:public + publicExpiresAt=null → 永久放行', () => {
  assert.equal(isPubliclyVisible(siteWith('public', null), NOW), true);
});

test('isPubliclyVisible:public + 未来到期 → 放行;已过期 → 拒绝', () => {
  const future = new Date(NOW.getTime() + 3600_000).toISOString();
  const past = new Date(NOW.getTime() - 1000).toISOString();
  assert.equal(isPubliclyVisible(siteWith('public', future), NOW), true);
  assert.equal(isPubliclyVisible(siteWith('public', past), NOW), false);
});

test('isPubliclyVisible:private 一律拒绝(含 publicExpiresAt=null)', () => {
  assert.equal(isPubliclyVisible(siteWith('private', null), NOW), false);
  const future = new Date(NOW.getTime() + 3600_000).toISOString();
  assert.equal(isPubliclyVisible(siteWith('private', future), NOW), false);
});

async function seedSite(db: Db, storage: Storage, slug: string): Promise<void> {
  const vid = uuid();
  await db.insert(sites).values({
    id: `s-${slug}`,
    ownerId: 'u-owner',
    ownerHandle: 'alice',
    slug,
    title: slug,
    visibility: 'private' as const,
    publicExpiresAt: null,
    shareKeyVersion: 1,
    guestComments: false,
    expiresAt: null,
    spaFallback: false,
    commentsEnabled: true,
    currentVersionId: vid,
    versions: [
      {
        id: vid,
        storage_prefix: `sites/u-owner/${slug}/${vid}/`,
        file_count: 1,
        total_bytes: PAGE_HTML.length,
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
  await storage.put(
    `sites/u-owner/${slug}/${vid}/index.html`,
    new TextEncoder().encode(PAGE_HTML),
    'text/html; charset=utf-8',
  );
}

/** 单域组装(顺序对齐 app.ts):控制台 API → serving 通配。真实 Cookie/CSRF 认证。 */
async function setup() {
  const db = await makeTestDb();
  const storage = new MemStorage();
  await db.insert(users).values({
    id: 'u-owner',
    email: 'alice@example.com',
    handle: 'alice',
    displayName: 'Alice',
    createdAt: nowIso(),
  });
  await seedSite(db, storage, 'demo');
  const deps: AppDeps = { config: cfg, db, storage };
  const app = new Hono<AppEnv>();
  app.route('/', makeSiteRoutes(deps, makeAuthMiddleware(deps)));
  app.route('/', makeServingRoutes(deps));
  const ownerCookie = `pp_session=${await mint(cfg, 'session', 'u-owner', 'alice', 0, CSRF)}`;
  return { db, storage, app, ownerCookie };
}

function patchSite(
  app: Hono<AppEnv>,
  cookie: string,
  slug: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return Promise.resolve(
    app.fetch(
      new Request(`http://localhost/api/sites/${slug}`, {
        method: 'PATCH',
        headers: { cookie, 'x-csrf-token': CSRF, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    ),
  );
}

test('PATCH public_forever:public_expires_at=null,且落库为 null', async () => {
  const { db, app, ownerCookie } = await setup();
  const res = await patchSite(app, ownerCookie, 'demo', {
    visibility: 'public',
    public_forever: true,
  });
  assert.equal(res.status, 200);
  const out = (await res.json()) as { visibility: string; public_expires_at: string | null };
  assert.equal(out.visibility, 'public');
  assert.equal(out.public_expires_at, null);
  const row = (await db.select().from(sites).where(eq(sites.slug, 'demo')))[0]!;
  assert.equal(row.publicExpiresAt, null);
});

test('PATCH public_forever 压过同请求的 public_hours(互斥,不报错)', async () => {
  const { app, ownerCookie } = await setup();
  const res = await patchSite(app, ownerCookie, 'demo', {
    visibility: 'public',
    public_hours: 72,
    public_forever: true,
  });
  assert.equal(res.status, 200);
  const out = (await res.json()) as { public_expires_at: string | null };
  assert.equal(out.public_expires_at, null);
});

test('PATCH public_forever 接受 pydantic 宽松 bool("yes" / 1)', async () => {
  const { app, ownerCookie } = await setup();
  for (const v of ['yes', 1, 'on']) {
    const res = await patchSite(app, ownerCookie, 'demo', {
      visibility: 'public',
      public_forever: v,
    });
    assert.equal(res.status, 200, `public_forever=${JSON.stringify(v)}`);
    const out = (await res.json()) as { public_expires_at: string | null };
    assert.equal(out.public_expires_at, null);
  }
});

test('PATCH public_forever 不带 visibility:"public" → 422 requiresPublic', async () => {
  const { app, ownerCookie } = await setup();
  const noVisibility = await patchSite(app, ownerCookie, 'demo', { public_forever: true });
  assert.equal(noVisibility.status, 422);
  assert.equal(
    ((await noVisibility.json()) as { code: string }).code,
    'site.publicForever.requiresPublic',
  );

  const withPrivate = await patchSite(app, ownerCookie, 'demo', {
    visibility: 'private',
    public_forever: true,
  });
  assert.equal(withPrivate.status, 422);
  assert.equal(
    ((await withPrivate.json()) as { code: string }).code,
    'site.publicForever.requiresPublic',
  );
});

test('PATCH public_forever 非法 bool → 422 notBool', async () => {
  const { app, ownerCookie } = await setup();
  const res = await patchSite(app, ownerCookie, 'demo', {
    visibility: 'public',
    public_forever: 'maybe',
  });
  assert.equal(res.status, 422);
  assert.equal(((await res.json()) as { code: string }).code, 'site.publicForever.notBool');
});

test('PATCH 无 public_forever:仍是默认 24h,且 public_hours 仍被 publicMaxHours 钳制', async () => {
  const { app, ownerCookie } = await setup();
  const dflt = await patchSite(app, ownerCookie, 'demo', { visibility: 'public' });
  assert.equal(dflt.status, 200);
  const a = (await dflt.json()) as { public_expires_at: string | null };
  assert.ok(a.public_expires_at, '缺省 public_forever 不应变成永久');
  const hours = (new Date(a.public_expires_at!).getTime() - Date.now()) / 3600_000;
  assert.ok(hours > 23.9 && hours <= 24, `默认应为 24h,实际 ${hours}`);

  const capped = await patchSite(app, ownerCookie, 'demo', {
    visibility: 'public',
    public_hours: 100000,
    public_forever: false,
  });
  assert.equal(capped.status, 200);
  const b = (await capped.json()) as { public_expires_at: string | null };
  const cappedHours = (new Date(b.public_expires_at!).getTime() - Date.now()) / 3600_000;
  assert.ok(
    cappedHours <= cfg.publicMaxHours && cappedHours > cfg.publicMaxHours - 0.1,
    `应被钳到 ${cfg.publicMaxHours}h,实际 ${cappedHours}`,
  );
});

test('serving:永久公开站点匿名可看;回私有后立刻收回', async () => {
  const { app, ownerCookie } = await setup();
  const anon = () =>
    app.fetch(new Request('http://localhost/p/alice/demo/', { headers: { accept: 'text/html' } }));

  const before = await anon();
  assert.equal(before.status, 200);
  assert.ok(!(await before.text()).includes('Forever'), '私有时匿名应看到门页而非页面内容');

  await patchSite(app, ownerCookie, 'demo', { visibility: 'public', public_forever: true });
  const open = await anon();
  assert.equal(open.status, 200);
  assert.ok((await open.text()).includes('Forever'), '永久公开后匿名应看到页面内容');

  await patchSite(app, ownerCookie, 'demo', { visibility: 'private' });
  const closed = await anon();
  assert.ok(!(await closed.text()).includes('Forever'), '回私有后匿名不应再看到内容');
});
