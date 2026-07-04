/** 匿名试用(/api/try*)路由测试 —— 内存 libSQL + 内存 Storage。
 *
 * 覆盖:开关默认关(404);匿名上传 → 带 ?key= 的限时链接 → 303 换 Cookie → 出内容
 * (含试用缎带 + 评论层注入);文件校验(缺失/非 html/超限);per-IP 限频;
 * 凭 key 拉评论导出;claim 认领(移入账号、TTL 清零、旧链接作废、slug 冲突 409);
 * 到期即 404 + sweepExpiredTrialSites 硬删(线程/存储/站点行)。
 *
 * 运行:node --import tsx --test test/trial.test.ts(无外部 DB 时以内存 SQLite 直跑)。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Hono } from 'hono';

import { makeAuthMiddleware } from '../src/api/deps.js';
import { mint } from '../src/auth/sessions.js';
import { makeCommentRoutes } from '../src/comments.js';
import { loadConfig } from '../src/config.js';
import { commentThreads, sites, users, type Db } from '../src/db/index.js';
import { MemoryRateLimiter } from '../src/ratelimit.js';
import { makeServingRoutes } from '../src/serving.js';
import { NotFoundError } from '../src/storage/index.js';
import type { ObjectMeta, Storage } from '../src/storage/index.js';
import {
  makeTrialRoutes,
  sweepExpiredTrialSites,
  TRIAL_HANDLE,
  TRIAL_OWNER,
} from '../src/trial.js';
import type { AppDeps, AppEnv } from '../src/types.js';
import { eq } from 'drizzle-orm';
import { nowIso } from '../src/util.js';
import { makeTestDb } from './helpers/db.js';

const CSRF = 'test-csrf';
const HTML = '<html><head><title>t</title></head><body><h1>Trial</h1></body></html>';

class MemStorage implements Storage {
  readonly objects = new Map<string, { data: Uint8Array; contentType: string }>();

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

  async deletePrefix(prefix: string): Promise<void> {
    for (const k of [...this.objects.keys()]) if (k.startsWith(prefix)) this.objects.delete(k);
  }
}

async function setup(opts: { trial?: boolean; rateLimiter?: boolean } = {}) {
  // 直接覆盖 trialEnabled 而非走 PAGEPIN_TRIAL env:loadConfig 现在强制 trial 只能
  // 双域 + 配 Turnstile(见 config.ts 守卫);这里用单域 serving 路径('/p/…')测路由逻辑,
  // config 守卫本身另有 'loadConfig 守卫' 用例覆盖。
  const cfg = {
    ...loadConfig({ PAGEPIN_SECRET: 'test-secret', PAGEPIN_BASE_URL: 'http://localhost:8000' }),
    trialEnabled: opts.trial !== false,
  };
  const db = await makeTestDb();
  const storage = new MemStorage();
  await db.insert(users).values({
    id: 'u-owner',
    email: 'alice@example.com',
    handle: 'alice',
    displayName: 'Alice',
    createdAt: nowIso(),
  });
  const deps: AppDeps = { config: cfg, db, storage };
  if (opts.rateLimiter) deps.rateLimiter = new MemoryRateLimiter();
  const app = new Hono<AppEnv>();
  app.route('/', makeTrialRoutes(deps, makeAuthMiddleware(deps)));
  app.route('/', makeCommentRoutes(deps));
  app.route('/', makeServingRoutes(deps));
  const ownerCookie = `pp_session=${await mint(cfg, 'session', 'u-owner', 'alice', 0, CSRF)}`;
  return { cfg, db, storage, deps, app, ownerCookie };
}

function dropForm(name = 'report.html', content = HTML): FormData {
  const form = new FormData();
  form.append('file', new File([content], name, { type: 'text/html' }));
  return form;
}

async function drop(app: Hono<AppEnv>, form = dropForm()) {
  return app.fetch(new Request('http://localhost/api/try', { method: 'POST', body: form }));
}

interface TryOut {
  site_id: string;
  url: string;
  expires_at: string;
  claim_token: string;
  comments_api: string;
}

/** 从 drop 响应提取 (slug, key, path)。url 形如 http://localhost:8000/p/try/<slug>/?key=<key> */
function parseTryUrl(out: TryOut): { slug: string; key: string; path: string } {
  const u = new URL(out.url);
  const slug = u.pathname.split('/')[3]!;
  return { slug, key: u.searchParams.get('key')!, path: u.pathname };
}

/** 走一次 ?key= 303 拿访客 Cookie。 */
async function redeem(app: Hono<AppEnv>, path: string, key: string): Promise<string> {
  const r = await app.fetch(new Request(`http://localhost${path}?key=${key}`));
  assert.equal(r.status, 303);
  const setCookie = r.headers.get('set-cookie') ?? '';
  const m = /(pp_share_[^=]+)=([^;]+)/.exec(setCookie);
  assert.ok(m, 'share cookie set');
  return `${m![1]}=${m![2]}`;
}

test('loadConfig 守卫:trial 需双域 + Turnstile', () => {
  const base = { PAGEPIN_SECRET: 's', PAGEPIN_BASE_URL: 'https://x.example' };
  const dual = {
    ...base,
    PAGEPIN_CONSOLE_HOST: 'app.example',
    PAGEPIN_CONTENT_HOST: 'pages.example',
  };
  const ts = {
    PAGEPIN_TURNSTILE_SITE_KEY: '0xsite',
    PAGEPIN_TURNSTILE_SECRET_KEY: '0xsecret',
  };
  // 单域 + trial → 抛(同源接管风险)
  assert.throws(() => loadConfig({ ...base, PAGEPIN_TRIAL: 'true' }), /双域/);
  // 双域但无 Turnstile → 抛
  assert.throws(() => loadConfig({ ...dual, PAGEPIN_TRIAL: 'true' }), /Turnstile/);
  // 双域 + Turnstile → 通过,trialEnabled=true
  const ok = loadConfig({ ...dual, ...ts, PAGEPIN_TRIAL: 'true' });
  assert.equal(ok.trialEnabled, true);
  // 默认关:不设 PAGEPIN_TRIAL,单域也不抛
  assert.equal(loadConfig(base).trialEnabled, false);
});

test('试用开关默认关:POST /api/try → 404 trial.disabled', async () => {
  const { app } = await setup({ trial: false });
  const r = await drop(app);
  assert.equal(r.status, 404);
  assert.equal(((await r.json()) as { code: string }).code, 'trial.disabled');
});

test('匿名 drop → 限时链接 → 缎带 + 评论层;文件校验', async () => {
  const { app } = await setup();
  const r = await drop(app);
  assert.equal(r.status, 200);
  const out = (await r.json()) as TryOut;
  assert.ok(out.url.includes('/p/try/') && out.url.includes('?key='));
  assert.ok(out.claim_token.length > 20);
  const { key, path } = parseTryUrl(out);

  // ?key= 兑换会话,凭 Cookie 出内容:缎带 + guest 评论层都注入
  const cookie = await redeem(app, path, key);
  const page = await app.fetch(new Request(`http://localhost${path}`, { headers: { cookie } }));
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes('Trial'), '原内容在');
  assert.ok(html.includes('pp-trial-ribbon'), '试用缎带已注入');
  assert.ok(html.includes('/_pagepin/comments.js'), 'guest 评论层已注入');
  assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');

  // 校验:缺 file / 非 html / 超 2MB
  const empty = new FormData();
  empty.append('other', 'x');
  const r1 = await app.fetch(
    new Request('http://localhost/api/try', { method: 'POST', body: empty }),
  );
  assert.equal(r1.status, 422);
  assert.equal(((await r1.json()) as { code: string }).code, 'trial.file.missing');

  const r2 = await drop(app, dropForm('notes.txt'));
  assert.equal(r2.status, 422);
  assert.equal(((await r2.json()) as { code: string }).code, 'trial.file.notHtml');

  const r3 = await drop(app, dropForm('big.html', 'x'.repeat(2 * 1024 * 1024 + 1)));
  assert.equal(r3.status, 413);
  assert.equal(((await r3.json()) as { code: string }).code, 'trial.file.tooLarge');
});

test('markdown drop:链接直指 index.md;查看器壳带缎带 + 评论层;目录 URL 回退', async () => {
  const { app } = await setup();
  const r = await drop(app, dropForm('notes.md', '# Trial Notes\n\nhello **md**'));
  assert.equal(r.status, 200);
  const out = (await r.json()) as TryOut;
  const u = new URL(out.url);
  assert.ok(u.pathname.endsWith('/index.md'), 'URL 直指 index.md');
  const slug = u.pathname.split('/')[3]!;
  const key = u.searchParams.get('key')!;
  const cookie = await redeem(app, u.pathname, key);

  // 浏览器导航(Accept: text/html)→ markdown 查看器壳:原文 + 缎带 + guest 评论层
  const page = await app.fetch(
    new Request(`http://localhost${u.pathname}`, { headers: { cookie, accept: 'text/html' } }),
  );
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes('Trial Notes'), 'md 原文进壳');
  assert.ok(html.includes('pp-trial-ribbon'), '试用缎带注入查看器壳');
  assert.ok(html.includes('/_pagepin/comments.js'), 'guest 评论层已注入');

  // 目录式 URL 无 index.html → 302 回退 index.md(裁掉 index.md 的裸链接也可用)
  const root = await app.fetch(
    new Request(`http://localhost/p/${TRIAL_HANDLE}/${slug}/`, {
      headers: { cookie, accept: 'text/html' },
    }),
  );
  assert.equal(root.status, 302);
  assert.ok((root.headers.get('location') ?? '').endsWith('/index.md'), '回退到 index.md');
});

test('per-IP 限频:同源第 6 次上传 429', async () => {
  const { app } = await setup({ rateLimiter: true });
  for (let i = 0; i < 5; i++) assert.equal((await drop(app)).status, 200);
  const r = await drop(app);
  assert.equal(r.status, 429);
  assert.equal(((await r.json()) as { code: string }).code, 'trial.rateLimited');
});

test('凭 key 拉评论导出;错 key 401', async () => {
  const { app } = await setup();
  const out = (await (await drop(app)).json()) as TryOut;
  const { slug, key, path } = parseTryUrl(out);
  const cookie = await redeem(app, path, key);

  // 访客打一个 pin
  const created = await app.fetch(
    new Request(`http://localhost/api/comments/${TRIAL_HANDLE}/${slug}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        path: 'index.html',
        selector: 'h1',
        rx: 0.5,
        ry: 0.5,
        rw: null,
        rh: null,
        kind: 'bug',
        anchor_text: null,
        text: 'Trial pin',
        author_name: 'Visitor',
      }),
    }),
  );
  assert.equal(created.status, 200);

  const exp = await app.fetch(
    new Request(`http://localhost/api/try/${out.site_id}/comments?key=${key}`),
  );
  assert.equal(exp.status, 200);
  const data = (await exp.json()) as {
    threads: Array<{ kind: string; comments: Array<{ author: string; text: string }> }>;
  };
  assert.equal(data.threads.length, 1);
  assert.equal(data.threads[0]!.kind, 'bug');
  assert.equal(data.threads[0]!.comments[0]!.author, 'Visitor');

  const bad = await app.fetch(
    new Request(`http://localhost/api/try/${out.site_id}/comments?key=tampered`),
  );
  assert.equal(bad.status, 401);
});

test('claim:移入账号、TTL 清零、旧链接作废;冲突 409;坏 token 422', async () => {
  const { app, db, ownerCookie } = await setup();
  const out = (await (await drop(app)).json()) as TryOut;
  const { key, path } = parseTryUrl(out);

  const claim = (body: unknown) =>
    app.fetch(
      new Request(`http://localhost/api/try/${out.site_id}/claim`, {
        method: 'POST',
        headers: { cookie: ownerCookie, 'x-csrf-token': CSRF, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

  // 坏 token
  const badTok = await claim({ claim_token: 'garbage' });
  assert.equal(badTok.status, 422);

  // 认领成新 slug
  const ok = await claim({ claim_token: out.claim_token, slug: 'kept-report' });
  assert.equal(ok.status, 200);
  const claimed = (await ok.json()) as { slug: string; url: string };
  assert.equal(claimed.slug, 'kept-report');
  assert.ok(claimed.url.includes('/p/alice/kept-report/'));

  const row = (await db.select().from(sites).where(eq(sites.id, out.site_id)))[0]!;
  assert.equal(row.ownerHandle, 'alice');
  assert.equal(row.ownerId, 'u-owner');
  assert.equal(row.expiresAt, null);
  assert.equal(row.shareKeyVersion, 2); // 试用期分享链接全部作废

  // 旧 key 不再可兑换(skv 不匹配 → 无 303)
  const stale = await app.fetch(new Request(`http://localhost${path}?key=${key}`));
  assert.notEqual(stale.status, 303);

  // 再上传一个试用站,认领到已占用的 slug → 409
  const out2 = (await (await drop(app)).json()) as TryOut;
  const conflict = await app.fetch(
    new Request(`http://localhost/api/try/${out2.site_id}/claim`, {
      method: 'POST',
      headers: { cookie: ownerCookie, 'x-csrf-token': CSRF, 'content-type': 'application/json' },
      body: JSON.stringify({ claim_token: out2.claim_token, slug: 'kept-report' }),
    }),
  );
  assert.equal(conflict.status, 409);
  assert.equal(((await conflict.json()) as { code: string }).code, 'site.slug.taken');
});

test('到期:请求即 404;sweep 硬删线程/存储/站点行', async () => {
  const { app, db, storage } = await setup();
  const out = (await (await drop(app)).json()) as TryOut;
  const { slug, key, path } = parseTryUrl(out);
  const cookie = await redeem(app, path, key);

  // 打一个 pin,留存证据给 sweep 清
  await app.fetch(
    new Request(`http://localhost/api/comments/${TRIAL_HANDLE}/${slug}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        path: 'index.html',
        selector: 'h1',
        rx: 0.1,
        ry: 0.1,
        rw: null,
        rh: null,
        kind: null,
        anchor_text: null,
        text: 'to be swept',
      }),
    }),
  );

  // 把过期时间拨到过去:请求即 404(不等清理)
  await db
    .update(sites)
    .set({ expiresAt: new Date(Date.now() - 60_000).toISOString() })
    .where(eq(sites.id, out.site_id));
  const gone = await app.fetch(new Request(`http://localhost${path}`, { headers: { cookie } }));
  assert.equal(gone.status, 404);

  // sweep:站点行、线程、存储对象全部硬删
  const removed = await sweepExpiredTrialSites(db as Db, storage);
  assert.equal(removed, 1);
  assert.equal((await db.select().from(sites).where(eq(sites.id, out.site_id))).length, 0);
  assert.equal(
    (await db.select().from(commentThreads).where(eq(commentThreads.siteId, out.site_id))).length,
    0,
  );
  const leftovers = [...storage.objects.keys()].filter((k) =>
    k.startsWith(`sites/${TRIAL_OWNER}/${slug}/`),
  );
  assert.deepEqual(leftovers, []);
});
