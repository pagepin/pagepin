/** /api/tokens 路由测试 —— 重点回归 show-once:明文只在创建/轮换响应出现一次,
 * 列表接口不带 token 字段,库中只存 sha256(schema 已无明文列)。
 *
 * 同 device-flow.test.ts 的做法:内存 libSQL + 注入式 auth 桩,专测 token 管理逻辑本身。
 * 运行:node --import tsx --test test/tokens.test.ts(见 package.json test:unit)。
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';

import { makeAuthMiddleware } from '../src/api/deps.js';
import { makeSiteRoutes } from '../src/api/sites.js';
import { makeTokenRoutes, type AuthMw } from '../src/api/tokens.js';
import { loadConfig } from '../src/config.js';
import { apiTokens, commentThreads, sites, users } from '../src/db/index.js';
import { makeTestDb } from './helpers/db.js';
import type { Storage } from '../src/storage/index.js';
import type { AppDeps, AppEnv } from '../src/types.js';
import { nowIso } from '../src/util.js';

const cfg = loadConfig({
  PAGEPIN_SECRET: 'test-secret',
  PAGEPIN_BASE_URL: 'http://localhost:8000',
});

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** 内存 DB(自动迁移)+ 注入式 mw 的 token 路由。 */
async function setup(): Promise<{ app: Hono<AppEnv>; deps: AppDeps }> {
  const db = await makeTestDb();
  await db.insert(users).values({
    id: 'u-test',
    email: 'owner@example.com',
    passwordHash: null,
    oidcSub: null,
    handle: 'owner',
    displayName: 'Owner',
    isAdmin: false,
    disabled: false,
    createdAt: nowIso(),
    lastLoginAt: null,
  });
  const seeded = (await db.select().from(users).where(eq(users.id, 'u-test')))[0];
  if (!seeded) throw new Error('seed user failed');

  const inject = createMiddleware<AppEnv>(async (c, next) => {
    c.set('user', seeded);
    c.set('authVia', 'cookie');
    await next();
  });
  const mw: AuthMw = {
    currentUser: inject,
    mutatingUser: inject,
    cookieUser: inject,
    cookieMutatingUser: inject,
    requireVerified: inject,
  };

  const deps: AppDeps = { config: cfg, db, storage: {} as unknown as Storage };
  return { app: makeTokenRoutes(deps, mw), deps };
}

function call(app: Hono<AppEnv>, method: string, path: string, body?: unknown): Promise<Response> {
  return Promise.resolve(
    app.fetch(
      new Request('http://localhost' + path, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    ),
  );
}

test('tokens: create returns plaintext once; list and DB never carry it again', async () => {
  const { app, deps } = await setup();

  const created = (await (
    await call(app, 'POST', '/api/tokens', { name: 'ci-deploy' })
  ).json()) as Record<string, string>;
  assert.match(created.token!, /^pp_[0-9a-f]{40}$/);
  assert.equal(created.prefix, created.token!.slice(0, 15));

  // 库中只有 hash(schema 已无 token 列),且 hash 与交付的明文对得上
  const rows = await deps.db.select().from(apiTokens);
  assert.equal(rows.length, 1);
  assert.ok(!('token' in rows[0]!), 'plaintext must not be stored');
  assert.equal(rows[0]!.tokenHash, sha256(created.token!));

  // 列表响应不带 token 字段 —— show-once 的对外承诺
  const listed = (await (await call(app, 'GET', '/api/tokens')).json()) as {
    tokens: Record<string, unknown>[];
  };
  assert.equal(listed.tokens.length, 1);
  assert.ok(!('token' in listed.tokens[0]!), 'list must not expose plaintext');
  assert.equal(listed.tokens[0]!.prefix, created.prefix);
});

test('tokens: rotate delivers new plaintext once and invalidates the old hash', async () => {
  const { app, deps } = await setup();

  const created = (await (
    await call(app, 'POST', '/api/tokens', { name: 'agent' })
  ).json()) as Record<string, string>;

  const rotated = (await (
    await call(app, 'POST', `/api/tokens/${created.id}/rotate`)
  ).json()) as Record<string, string>;
  assert.match(rotated.token!, /^pp_[0-9a-f]{40}$/);
  assert.notEqual(rotated.token, created.token);

  const row = (await deps.db.select().from(apiTokens))[0]!;
  assert.equal(row.tokenHash, sha256(rotated.token!), 'stored hash must match the new value');
  assert.notEqual(row.tokenHash, sha256(created.token!), 'old plaintext must stop matching');
  assert.equal(row.prefix, rotated.token!.slice(0, 15));
});

// ---- scopes minting / validation / echo / rotation preservation (stubs) ----

test('tokens: mint with scopes stores the normalized list and shows it', async () => {
  const { app, deps } = await setup();

  const created = (await (
    await call(app, 'POST', '/api/tokens', {
      name: 'scoped',
      scopes: ['comment', 'read', 'comment'],
    })
  ).json()) as { id: string; scopes: string[] | null };
  assert.deepEqual(created.scopes, ['comment', 'read']); // normalized: deduped, order kept

  const full = (await (await call(app, 'POST', '/api/tokens', { name: 'full' })).json()) as {
    id: string;
    scopes: string[] | null;
  };
  assert.equal(full.scopes, null); // missing = full access; nothing narrowed

  const listed = (await (await call(app, 'GET', '/api/tokens')).json()) as {
    tokens: Record<string, unknown>[];
  };
  const byId = (id: string) => listed.tokens.find((tk) => tk.id === id)!;
  assert.deepEqual(byId(created.id)['scopes'], ['comment', 'read']); // the list response echoes scopes too
  assert.equal(byId(full.id)['scopes'], null);

  const dbScoped = (await deps.db.select().from(apiTokens)).find((tk) => tk.id === created.id)!;
  assert.deepEqual(dbScoped.scopes, ['comment', 'read']); // the stored row holds the normalized list
});

test('tokens: invalid scopes input returns 400; an empty array stays full access', async () => {
  const { app, deps } = await setup();
  assert.equal(
    (await call(app, 'POST', '/api/tokens', { name: 'ok', scopes: ['publish'] })).status,
    200,
  );
  assert.equal(
    (await call(app, 'POST', '/api/tokens', { name: 'x', scopes: ['admin'] })).status,
    400,
  ); // unknown value
  assert.equal(
    (await call(app, 'POST', '/api/tokens', { name: 'x', scopes: ['comment', 42] })).status,
    400,
  ); // non-string member
  assert.equal(
    (await call(app, 'POST', '/api/tokens', { name: 'x', scopes: 'publish' })).status,
    400,
  ); // not an array
  assert.equal(
    (await call(app, 'POST', '/api/tokens', { name: 'x', scopes: { a: 1 } })).status,
    400,
  ); // an object

  const emptyRes = await call(app, 'POST', '/api/tokens', { name: 'x', scopes: [] });
  assert.equal(emptyRes.status, 200); // an empty array normalizes to null = full access
  const minted = (await emptyRes.json()) as { scopes: string[] | null };
  assert.equal(minted.scopes, null);
  const toks = await deps.db.select().from(apiTokens);
  assert.ok(toks.some((tk) => tk.scopes === null));
});

test('tokens: rotate preserves the stored scopes list', async () => {
  const { app, deps } = await setup();
  const full = (await (await call(app, 'POST', '/api/tokens', { name: 'full' })).json()) as {
    id: string;
  };
  const scoped = (await (
    await call(app, 'POST', '/api/tokens', { name: 'scoped', scopes: ['comment'] })
  ).json()) as { id: string };

  const rotFull = (await (await call(app, 'POST', `/api/tokens/${full.id}/rotate`)).json()) as {
    scopes: string[] | null;
  };
  assert.equal(rotFull.scopes, null); // null stays null

  const rotScoped = (await (await call(app, 'POST', `/api/tokens/${scoped.id}/rotate`)).json()) as {
    scopes: string[] | null;
  };
  assert.deepEqual(rotScoped.scopes, ['comment']); // the stored list is preserved verbatim

  const rows = await deps.db.select().from(apiTokens);
  assert.deepEqual(rows.find((tk) => tk.id === scoped.id)!.scopes, ['comment']); // rotation leaves the stored scope untouched
  assert.equal(rows.find((tk) => tk.id === full.id)!.scopes, null);
});

// ---- the requireScope surface (real makeAuthMiddleware + real site routes; same shape as case 4 in device-flow.test.ts) ----

test('requireScope: deploy family pins publish, comment threads pin comment, reads stay open', async () => {
  const db = await makeTestDb();
  await db.insert(users).values({
    id: 'u2',
    email: 'e@x.com',
    passwordHash: null,
    oidcSub: null,
    handle: 'eee',
    displayName: 'E',
    isAdmin: true,
    disabled: false,
    createdAt: nowIso(),
    lastLoginAt: null,
  });
  const deps: AppDeps = { config: cfg, db, storage: {} as unknown as Storage };
  const app = makeSiteRoutes(deps, makeAuthMiddleware(deps));

  const sha = async (s: string) => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  };
  const seedPat = async (raw: string, scopes: string[] | null) => {
    await db.insert(apiTokens).values({
      id: 'tok-' + raw.slice(3, 11),
      userId: 'u2',
      name: 't',
      tokenHash: await sha(raw),
      prefix: raw.slice(0, 15),
      createdAt: nowIso(),
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: null,
      scopes,
    });
  };
  const pubTok = 'pp_publish0000000000000000000000000000000';
  const comTok = 'pp_comment0000000000000000000000000000000';
  const readTok = 'pp_readread00000000000000000000000000000';
  await seedPat(pubTok, ['publish']);
  await seedPat(comTok, ['comment']);
  await seedPat(readTok, ['read']);

  // the 200 assertions use a seeded row; the publish-family 403 assertions do not need one (the gate runs before every DB query)
  const versionId = 'v-1';
  const now = nowIso();
  await db.insert(sites).values({
    id: 'site-1',
    ownerId: 'u2',
    ownerHandle: 'eee',
    slug: 'my-site',
    title: null,
    visibility: 'private',
    publicExpiresAt: null,
    shareKeyVersion: 1,
    guestComments: true,
    expiresAt: null,
    spaFallback: false,
    commentsEnabled: true,
    currentVersionId: versionId,
    versions: [
      {
        id: versionId,
        storage_prefix: 'sites/u2/my-site/v-1/',
        file_count: 1,
        total_bytes: 1,
        uploaded_by: 'u2',
        created_at: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    suspendedAt: null,
    suspendedReason: null,
  });
  await db.insert(commentThreads).values({
    id: 't-1',
    siteId: 'site-1',
    ownerHandle: 'eee',
    slug: 'my-site',
    pagePath: 'index.html',
    versionId,
    selector: '@page',
    rx: 0.5,
    ry: 0.5,
    rw: null,
    rh: null,
    kind: null,
    anchorText: null,
    quote: null,
    resolved: false,
    comments: [],
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });

  const req = (method: string, path: string, tok: string, body?: unknown) =>
    app.fetch(
      new Request('http://localhost' + path, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          Authorization: `Bearer ${tok}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );

  // comment PAT: all six publish routes answer 403 (the gate lands first; a present site row would still be rejected)
  for (const [method, path] of [
    ['POST', '/api/sites/my-site/deploy'],
    ['POST', '/api/sites/my-site/deploys'],
    ['POST', '/api/sites/my-site/deploys/d1/files'],
    ['POST', '/api/sites/my-site/deploys/d1/commit'],
    ['DELETE', '/api/sites/my-site/deploys/d1'],
    ['POST', '/api/sites/my-site/rollback'],
  ] as const) {
    assert.equal((await req(method, path, comTok)).status, 403, `${method} ${path}`);
  }
  // comment PAT: thread resolve / reply succeed
  assert.equal(
    (await req('PATCH', '/api/sites/my-site/comments/t-1', comTok, { resolved: true })).status,
    200,
  );
  assert.equal(
    (await req('POST', '/api/sites/my-site/comments/t-1/replies', comTok, { text: 'done' })).status,
    200,
  );

  // publish PAT: rollback succeeds (the seeded site has versions); thread writes answer 403
  assert.equal(
    (await req('POST', '/api/sites/my-site/rollback', pubTok, { version_id: versionId })).status,
    200,
  );
  assert.equal(
    (await req('PATCH', '/api/sites/my-site/comments/t-1', pubTok, { resolved: false })).status,
    403,
  );
  assert.equal(
    (await req('POST', '/api/sites/my-site/comments/t-1/replies', pubTok, { text: 'no' })).status,
    403,
  );

  // read PAT: every write path answers 403; reads always pass (comment export 200 — scopes never cut reads)
  assert.equal(
    (await req('PATCH', '/api/sites/my-site/comments/t-1', readTok, { resolved: false })).status,
    403,
  );
  assert.equal(
    (await req('POST', '/api/sites/my-site/comments/t-1/replies', readTok, { text: 'no' })).status,
    403,
  );
  assert.equal((await req('POST', '/api/sites/my-site/deploy', readTok)).status, 403);
  assert.equal((await req('GET', '/api/sites/my-site/comments', readTok)).status, 200);
});
