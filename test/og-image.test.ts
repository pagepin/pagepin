/** OG 卡片(轻量版)测试 —— 固定静态品牌图 + 从内容抓标题/描述 + 注入。覆盖:
 *   ① 公开 md shell:og:title 取 H1、og:description 取首段、og:image 指向静态图;
 *   ② 静态品牌图端点 /_pagepin/og.png(en)、/_pagepin/og-zh.png(zh)返回 PNG;
 *   ③ 公开 HTML 直传页:head 注入 og:image 缩略图,但不覆盖用户的 <title>;
 *   ④ 用户 HTML 自带 og:image → 一律不注入(尊重字节);
 *   ⑤ 私有站匿名走门页:放通用品牌卡(og:title=pagepin),不泄露真实标题;
 *   ⑥ locale:zh 请求 → og:image 用 og-zh.png。
 *
 * 无 wasm/字体依赖;需先 pnpm gen:assets 生成 edge-assets(内联静态图)。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Hono } from 'hono';

import { loadConfig } from '../src/config.js';
import { sites, users } from '../src/db/index.js';
import type { Db } from '../src/db/index.js';
import { makeServingRoutes } from '../src/serving.js';
import { makeLocaleMiddleware } from '../src/i18n/locale.js';
import { makeTestDb } from './helpers/db.js';
import { NotFoundError } from '../src/storage/index.js';
import type { ObjectMeta, Storage } from '../src/storage/index.js';
import type { AppDeps, AppEnv } from '../src/types.js';
import { nowIso, uuid } from '../src/util.js';

const cfg = loadConfig({
  PAGEPIN_SECRET: 'test-secret',
  PAGEPIN_BASE_URL: 'http://localhost:8000',
});

class MemStorage implements Storage {
  private readonly objects = new Map<string, { data: Uint8Array; contentType: string }>();
  async put(key: string, data: ReadableStream<Uint8Array> | Uint8Array, ct: string): Promise<void> {
    const bytes =
      data instanceof Uint8Array
        ? data
        : new Uint8Array(await new Response(data as unknown as BodyInit).arrayBuffer());
    this.objects.set(key, { data: bytes, contentType: ct });
  }
  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }
  async open(key: string): Promise<{ meta: ObjectMeta; body: ReadableStream<Uint8Array> }> {
    const o = this.objects.get(key);
    if (!o) throw new NotFoundError(key);
    return {
      meta: { contentType: o.contentType, contentLength: o.data.byteLength },
      body: new Response(o.data as unknown as BodyInit).body!,
    };
  }
}

async function seed(
  db: Db,
  storage: Storage,
  slug: string,
  opts: { title?: string | null; isPublic: boolean; file: string; content: string; ct: string },
) {
  const vid = uuid();
  await db.insert(sites).values({
    id: `s-${slug}`,
    ownerId: 'u-owner',
    ownerHandle: 'alice',
    slug,
    title: opts.title ?? null,
    visibility: opts.isPublic ? 'public' : 'private',
    publicExpiresAt: opts.isPublic ? new Date(Date.now() + 365 * 86400000).toISOString() : null,
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
        total_bytes: opts.content.length,
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
    `sites/u-owner/${slug}/${vid}/${opts.file}`,
    new TextEncoder().encode(opts.content),
    opts.ct,
  );
}

const MD_H1 = '季度增长复盘';
const MD_DESC = '本季度净增站点用户显著,评审闭环使用率上升。';

async function setup() {
  const db = await makeTestDb();
  const storage = new MemStorage();
  await db.insert(users).values({
    id: 'u-owner',
    email: 'a@e.com',
    handle: 'alice',
    displayName: 'Alice',
    createdAt: nowIso(),
  });
  await seed(db, storage, 'mdpub', {
    isPublic: true,
    file: 'report.md',
    content: `# ${MD_H1}\n\n${MD_DESC}\n`,
    ct: 'text/markdown',
  });
  await seed(db, storage, 'htmlpub', {
    isPublic: true,
    file: 'index.html',
    content:
      '<!doctype html><html><head><title>用户自己的标题</title></head><body>hi</body></html>',
    ct: 'text/html; charset=utf-8',
  });
  await seed(db, storage, 'htmlown', {
    isPublic: true,
    file: 'index.html',
    content:
      '<!doctype html><html><head><meta property="og:image" content="https://cdn.example/own.png"><title>T</title></head><body>hi</body></html>',
    ct: 'text/html; charset=utf-8',
  });
  await seed(db, storage, 'mdpriv', {
    title: '机密并购尽调纪要',
    isPublic: false,
    file: 'report.md',
    content: '# 机密\n\n正文。',
    ct: 'text/markdown',
  });
  const deps: AppDeps = { config: cfg, db, storage };
  const app = new Hono<AppEnv>();
  app.use('*', makeLocaleMiddleware('en', false)); // 同 app.ts:解析 ?lang/cookie/Accept-Language
  app.route('/', makeServingRoutes(deps));
  return app;
}

const getPage = (app: Hono<AppEnv>, path: string, lang = 'en') =>
  app.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: 'text/html', 'accept-language': lang },
    }),
  );

const isPng = (b: Uint8Array) =>
  b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

test('public md shell: og:title from H1, description from first paragraph, static image', async () => {
  const app = await setup();
  const html = await (await getPage(app, '/p/alice/mdpub/report.md')).text();
  assert.ok(html.includes('pp-md-content'), 'md shell served');
  assert.ok(html.includes(`content="${MD_H1}"`), 'og:title uses the markdown H1');
  assert.ok(html.includes(MD_DESC.slice(0, 20)), 'og:description carries the first paragraph');
  assert.ok(html.includes('/_pagepin/og.png'), 'og:image points at the static brand card (en)');
});

test('static brand card endpoints return PNG (en + zh)', async () => {
  const app = await setup();
  for (const path of ['/_pagepin/og.png', '/_pagepin/og-zh.png']) {
    const res = await app.fetch(new Request(`http://localhost${path}`));
    assert.equal(res.status, 200, `${path} 200`);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.ok(isPng(new Uint8Array(await res.arrayBuffer())), `${path} is a PNG`);
  }
});

test('public HTML: injects og:image thumbnail without overriding the page <title>', async () => {
  const app = await setup();
  const html = await (await getPage(app, '/p/alice/htmlpub/')).text();
  assert.ok(html.includes('/_pagepin/og.png'), 'og:image injected into head');
  assert.ok(html.includes('summary_large_image'), 'twitter card injected');
  assert.ok(html.includes('<title>用户自己的标题</title>'), 'user title preserved');
  assert.ok(!html.includes('og:title'), 'does not inject og:title (respects the page <title>)');
});

test('public HTML that ships its own og:image is left untouched', async () => {
  const app = await setup();
  const html = await (await getPage(app, '/p/alice/htmlown/')).text();
  assert.ok(html.includes('https://cdn.example/own.png'), "user's own og:image kept");
  assert.ok(
    !html.includes('/_pagepin/og.png'),
    'pagepin does not inject over the existing og:image',
  );
});

test('private site anon: gate page carries a generic brand card, no title leak', async () => {
  const app = await setup();
  const html = await (await getPage(app, '/p/alice/mdpriv/report.md')).text();
  assert.ok(!html.includes('pp-md-content'), 'anon gets the gate, not the shell');
  assert.ok(!html.includes('机密并购尽调纪要'), 'private title never leaks');
  assert.ok(html.includes('og:image'), 'gate still carries a brand card');
  assert.ok(
    html.includes('content="pagepin"'),
    'gate og:title is the generic brand, not the real title',
  );
});

test('locale zh: shell references the zh brand card', async () => {
  const app = await setup();
  const html = await (await getPage(app, '/p/alice/mdpub/report.md', 'zh-CN')).text();
  assert.ok(html.includes('/_pagepin/og-zh.png'), 'zh locale uses the zh card');
});
