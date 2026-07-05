/** 跨域登录接力 + AI agent 发现线索 路由测试(双域全 app,按 Host 分流)。
 *
 * 覆盖:
 *   1. 私有页匿名抓取 → 登录墙携带 agent 线索(doctype 前注释 / head meta / 可见小字)
 *      + X-Pagepin-* 响应头 + 「Sign in」指向 console /auth/handoff;
 *   2. handoff 全链路(authMode=none):console 登录一次 → 铸一次性 code → 内容域
 *      /auth/accept 兑换种 pp_view → 落回原页;重放同一 code 必败(先删后用);
 *   3. /llms.txt 双域都答,指到 skill.md;
 *   4. /api/me/handle/suggest GET/POST 双收;deploy 无 handle 的 409 错误体带自愈 hint。
 *
 * 运行:node --import tsx --test test/handoff.test.ts(已并入 test:unit)。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';

import { createApp } from '../src/app.js';
import { makeMeRoutes, type AuthMw } from '../src/api/me.js';
import { makeSiteRoutes } from '../src/api/sites.js';
import type { AuthMiddleware } from '../src/api/deps.js';
import { loadConfig } from '../src/config.js';
import { sites, users, type Db, type UserRow } from '../src/db/index.js';
import { makeTestDb } from './helpers/db.js';
import { NotFoundError, type Storage } from '../src/storage/index.js';
import type { AppDeps, AppEnv } from '../src/types.js';
import { nowIso } from '../src/util.js';

const dualCfg = loadConfig({
  PAGEPIN_SECRET: 'test-secret',
  PAGEPIN_CONSOLE_HOST: 'console.test',
  PAGEPIN_CONTENT_HOST: 'pages.test',
  PAGEPIN_AUTH_MODE: 'none', // GET /auth/login 直接落 dev 会话,测接力不测 IdP
});

/** 空存储:authorized 路径 open/exists 一律未命中 → 404 品牌页(足以区分「过了墙」与「登录墙」)。 */
const emptyStorage = {
  exists: async () => false,
  open: async () => {
    throw new NotFoundError('nope');
  },
} as unknown as Storage;

async function seedOwnerAndSite(db: Db): Promise<void> {
  await db.insert(users).values({
    id: 'u-owner',
    email: 'owner@example.com',
    handle: 'owner',
    displayName: 'Owner',
    createdAt: nowIso(),
  });
  await db.insert(sites).values({
    id: 's1',
    ownerId: 'u-owner',
    ownerHandle: 'owner',
    slug: 'site1',
    currentVersionId: 'v1',
    versions: [
      {
        id: 'v1',
        storage_prefix: 'sites/u-owner/site1/v1/',
        file_count: 1,
        total_bytes: 10,
        uploaded_by: 'u-owner',
        created_at: nowIso(),
      },
    ],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
}

async function setupDual() {
  const db = await makeTestDb();
  await seedOwnerAndSite(db);
  const deps: AppDeps = { config: dualCfg, db, storage: emptyStorage };
  return createApp(deps, { skillMd: 'stub skill' });
}

const cookiesOf = (res: Response): string =>
  res.headers
    .getSetCookie()
    .map((s) => s.split(';')[0])
    .join('; ');

/** 构造带显式 Host 头的请求:new Request(url) 不会把 host 写进 headers,
 *  而双域外层路由按 Host 分流 —— 不补则一律 404 unknown host。 */
const req = (url: string, headers: Record<string, string> = {}): Request =>
  new Request(url, { headers: { Host: new URL(url).host, ...headers } });

test('私有页匿名抓取:登录墙带 agent 线索 + X-Pagepin 头,Sign in 走 console handoff', async () => {
  const app = await setupDual();
  const res = await app.fetch(req('https://pages.test/owner/site1/'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-pagepin-site'), 'owner/site1');
  assert.equal(
    res.headers.get('x-pagepin-comments'),
    'https://console.test/api/sites/site1/comments',
  );
  assert.equal(res.headers.get('x-pagepin-agent-guide'), 'https://console.test/skill.md');
  const html = await res.text();
  // doctype 前注释(裸抓源码)/ head meta(程序化)/ 可见小字(markdown 转换管道)三形态齐全
  assert.ok(html.startsWith('<!--'), 'agent 注释置于 doctype 之前');
  assert.match(html, /NOTE FOR AI AGENTS/);
  assert.match(html, /GET https:\/\/console\.test\/api\/sites\/site1\/comments/);
  assert.match(html, /<meta name="pagepin:slug" content="site1">/);
  assert.match(html, /AI agent\?/);
  assert.ok(
    html.includes('https://console.test/auth/handoff?next=%2Fowner%2Fsite1%2F'),
    '双域「Sign in」经 console handoff 接力',
  );
});

test('handoff 全链路:登录墙起跳 → console 登录一次 → code+nonce 兑换 pp_view → 重放/无 nonce 必败', async () => {
  const app = await setupDual();

  // 0. 从登录墙起跳:拿内容域 nonce cookie(pp_oauth)与带 non= 的 handoff 链接
  const wall = await app.fetch(req('https://pages.test/owner/site1/'));
  const wallCookies = cookiesOf(wall);
  assert.match(wallCookies, /pp_oauth=/);
  const html = await wall.text();
  const handoffUrl = /https:\/\/console\.test\/auth\/handoff\?[^"]+/
    .exec(html)![0]!
    .replaceAll('&amp;', '&');
  assert.match(handoffUrl, /&non=[0-9a-f]+/);

  // 1. 无 console 会话:handoff → 302 去 console 登录,next 回接力自身(nonce 原样带着)
  const h1 = await app.fetch(req(handoffUrl));
  assert.equal(h1.status, 302);
  const loginLoc = h1.headers.get('location')!;
  assert.match(loginLoc, /^\/auth\/login\?next=%2Fauth%2Fhandoff/);
  assert.match(decodeURIComponent(loginLoc), /non=[0-9a-f]+/);

  // 2. authMode=none:登录即种 pp_session 并 302 回 handoff
  const l1 = await app.fetch(req('https://console.test' + loginLoc));
  assert.equal(l1.status, 302);
  const sessionCookies = cookiesOf(l1);
  assert.match(sessionCookies, /pp_session=/);

  // 3. 带会话再进 handoff → 302 到内容域 /auth/accept?code=…&non=…
  const h2 = await app.fetch(
    req('https://console.test' + l1.headers.get('location')!, { Cookie: sessionCookies }),
  );
  assert.equal(h2.status, 302);
  const acceptUrl = h2.headers.get('location')!;
  assert.match(
    acceptUrl,
    /^https:\/\/pages\.test\/auth\/accept\?code=[0-9a-f]{32}&next=.+&non=[0-9a-f]+/,
  );

  // 4a. 防 login CSRF:没有内容域 nonce cookie(= 受害者点了别人转发的 accept URL)→ 拒,且不烧 code
  const csrf = await app.fetch(req(acceptUrl));
  assert.equal(csrf.status, 302);
  assert.match(csrf.headers.get('location')!, /^\/auth\/login\?next=/);
  assert.equal(cookiesOf(csrf).includes('pp_view='), false);

  // 4b. 兑换(带登录墙种下的 nonce cookie):种 pp_view,302 落回原页
  const a1 = await app.fetch(req(acceptUrl, { Cookie: wallCookies }));
  assert.equal(a1.status, 302);
  assert.equal(a1.headers.get('location'), '/owner/site1/');
  const viewCookies = cookiesOf(a1);
  assert.match(viewCookies, /pp_view=/);

  // 5. 带 pp_view 再访问私有页:过墙(空存储 → 404 品牌页,而非 200 登录墙)
  const page = await app.fetch(req('https://pages.test/owner/site1/', { Cookie: viewCookies }));
  assert.equal(page.status, 404);

  // 6. 重放同一 code(nonce 仍对):一次性,回落内容域登录页
  const a2 = await app.fetch(req(acceptUrl, { Cookie: wallCookies }));
  assert.equal(a2.status, 302);
  assert.match(a2.headers.get('location')!, /^\/auth\/login\?next=/);
  assert.equal(cookiesOf(a2).includes('pp_view='), false);
});

test('/llms.txt:console 与内容域都答,指向 skill.md', async () => {
  const app = await setupDual();
  for (const host of ['console.test', 'pages.test']) {
    const res = await app.fetch(req(`https://${host}/llms.txt`));
    assert.equal(res.status, 200, host);
    const body = await res.text();
    assert.match(body, /https:\/\/console\.test\/skill\.md/);
    assert.match(body, /NOT in the page HTML/);
  }
});

test('suggest GET/POST 双收;deploy 无 handle 的 409 带自愈 hint', async () => {
  const db = await makeTestDb();
  await db.insert(users).values({
    id: 'u-nohandle',
    email: 'jane.doe@example.com',
    emailVerified: true,
    handle: null,
    createdAt: nowIso(),
  });
  const seeded = (await db.select().from(users))[0] as UserRow;
  const inject = createMiddleware<AppEnv>(async (c, next) => {
    c.set('user', seeded);
    c.set('authVia', 'token'); // PAT 视角:agent 自愈路径全程凭 Bearer
    await next();
  });
  const mw = {
    currentUser: inject,
    mutatingUser: inject,
    cookieUser: inject,
    cookieMutatingUser: inject,
    requireVerified: inject,
    adminUser: inject,
    adminMutatingUser: inject,
  } as AuthMiddleware;

  const cfg = loadConfig({ PAGEPIN_SECRET: 'test-secret' });
  const deps: AppDeps = { config: cfg, db, storage: emptyStorage };
  const app = new Hono<AppEnv>();
  app.route('/', makeMeRoutes(deps, mw as AuthMw));
  app.route('/', makeSiteRoutes(deps, mw));

  for (const method of ['GET', 'POST']) {
    const res = await app.fetch(new Request('http://x/api/me/handle/suggest', { method }));
    assert.equal(res.status, 200, method);
    const body = (await res.json()) as { suggestion: string | null };
    assert.equal(body.suggestion, 'jane-doe', method);
  }

  const dep = await app.fetch(new Request('http://x/api/sites/foo/deploy', { method: 'POST' }));
  assert.equal(dep.status, 409);
  const err = (await dep.json()) as { code: string; hint?: string };
  assert.equal(err.code, 'site.handle.required');
  assert.match(err.hint!, /POST \/api\/me\/handle\/suggest/);
  assert.match(err.hint!, /POST \/api\/me\/handle /);
});
