/** OIDC RP-initiated logout (provider end-session) — route-level tests.
 *
 * Contract under test (t_768d8090, adopted variant A):
 *   1. auth-mode=password: logout matches the pre-fix behavior exactly —
 *      local cookies cleared, 302 '/', no third cookie, no IdP contact.
 *   2. auth-mode=oidc and the id-token hint cookie is present: local cookies cleared
 *      AND the browser is sent to the discovery end_session_endpoint carrying
 *      id_token_hint only (no other token material in the URL).
 *   3. auth-mode=oidc and the hint is absent (social login, pre-fix session):
 *      exactly the old behavior — the IdP is never contacted.
 *   4. auth-mode=oidc and the IdP is unreachable, or its discovery document has no
 *      end_session_endpoint: local logout still wins, 302 '/'.
 *   5. Full local fake-IdP login loop: /auth/callback plants the httpOnly hint cookie.
 *   6. Session renewal slides the hint cookie alongside pp_session.
 *
 * The fake IdP is node:http on an ephemeral port (no new dependencies); every test
 * uses a fresh issuer because src/auth/oidc.ts caches discovery per issuer.
 */
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { Hono } from 'hono';
import { sign } from 'hono/jwt';

import { makeAuthMiddleware } from '../src/api/deps.js';
import { makeAuthRoutes } from '../src/auth/routes.js';
import { ID_TOKEN_COOKIE, type SessionClaims } from '../src/auth/sessions.js';
import { loadConfig } from '../src/config.js';
import { users } from '../src/db/index.js';
import { FsStorage } from '../src/storage/fs.js';
import type { AppDeps, AppEnv } from '../src/types.js';
import { nowIso } from '../src/util.js';
import { makeTestDb } from './helpers/db.js';

const ID_TOKEN = 'fake-hdr.fake-pld.fake-sig'; // opaque to pagepin; the IdP is what verifies
const HINT = `${ID_TOKEN_COOKIE}=${ID_TOKEN}`;

const oidcEnv = (issuer: string) => ({
  PAGEPIN_AUTH_MODE: 'oidc',
  PAGEPIN_OIDC_ISSUER: issuer,
  PAGEPIN_OIDC_CLIENT_ID: 'test-client',
  PAGEPIN_OIDC_CLIENT_SECRET: 'test-idp-secret',
});

/** All pp_* Set-Cookie lines of a response. */
const setCookies = (res: Response): string[] =>
  res.headers.getSetCookie().filter((v) => v.startsWith('pp_'));

/** Set-Cookie lines to a name→value map (cookie deletions map to the empty string). */
function cookieJar(lines: string[]): Map<string, string> {
  const jar = new Map<string, string>();
  for (const line of lines) {
    const [pair] = line.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
  }
  return jar;
}

/** Map back to a request Cookie header; deletion markers (empty values) are skipped. */
function cookieHeader(jar: Map<string, string>): string {
  return [...jar]
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

function postLogout(app: Hono<AppEnv>, cookie: string): Promise<Response> {
  return Promise.resolve(
    app.fetch(new Request('http://localhost/auth/logout', { method: 'POST', headers: { cookie } })),
  );
}

interface FakeIdp {
  issuer: string;
  endSession: string;
  requests: string[];
  close(): Promise<void>;
}

/** Minimal local OIDC provider on an ephemeral port: discovery + token + userinfo. */
async function fakeIdp(withEndSession: boolean): Promise<FakeIdp> {
  const requests: string[] = [];
  const s: Server = createServer((req, res) => {
    const base = `http://127.0.0.1:${(s.address() as { port: number }).port}`;
    const url = new URL(req.url ?? '/', base);
    requests.push(`${req.method} ${url.pathname}`);
    if (url.pathname === '/.well-known/openid-configuration') {
      const doc: Record<string, string> = {
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        userinfo_endpoint: `${base}/userinfo`,
      };
      if (withEndSession) doc.end_session_endpoint = `${base}/end-session/`;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(doc));
      return;
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      req.resume(); // drain the token-request body so the socket does not stall
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({ access_token: 'fake-at', token_type: 'Bearer', id_token: ID_TOKEN }),
        );
      });
      return;
    }
    if (url.pathname === '/userinfo') {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          sub: 'oidc:fake-1',
          name: 'Fake IdP User',
          email: 'fake@idp.example',
          email_verified: true,
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end(`unexpected ${req.method} ${url.pathname}`);
  });
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
  const port = (s.address() as { port: number }).port;
  const issuer = `http://127.0.0.1:${port}`;
  return {
    issuer,
    endSession: withEndSession ? `${issuer}/end-session/` : '',
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        s.close(() => resolve());
      }),
  };
}

async function setup(env: Record<string, string> = {}) {
  const storage = new FsStorage(await mkdtemp(join(tmpdir(), 'pagepin-logout-')));
  const db = await makeTestDb();
  const cfg = loadConfig({
    PAGEPIN_SECRET: 'test-secret',
    PAGEPIN_BASE_URL: 'http://localhost:8000',
    ...env,
  });
  const deps: AppDeps = { config: cfg, db, storage };
  const app = makeAuthRoutes(deps, 'session');
  return { db, cfg, deps, app };
}

test('password mode: logout clears the local session cookies and contacts no IdP', async () => {
  const { app } = await setup();
  const res = await postLogout(app, 'pp_session=x; pp_csrf=y');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/');
  const lines = setCookies(res);
  assert.equal(lines.length, 2, 'exactly the two pre-fix deletion headers');
  assert.ok(lines.every((v) => /Max-Age=0/.test(v)));
  const jar = cookieJar(lines);
  assert.equal(jar.get('pp_session'), '');
  assert.equal(jar.get('pp_csrf'), '');
  assert.ok(!jar.has(ID_TOKEN_COOKIE), 'password logout never touches the id-token cookie');
});

test('oidc mode without the hint cookie: logout keeps the old behavior exactly', async () => {
  const idp = await fakeIdp(true);
  try {
    const { app } = await setup(oidcEnv(idp.issuer));
    const res = await postLogout(app, 'pp_session=x; pp_csrf=y');
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/');
    const lines = setCookies(res);
    assert.equal(lines.length, 2, 'exactly the two pre-fix deletion headers');
    assert.ok(!cookieJar(lines).has(ID_TOKEN_COOKIE));
    assert.deepEqual(idp.requests, [], 'the IdP is never contacted without the hint');
  } finally {
    await idp.close();
  }
});

test('oidc mode, unreachable IdP: local logout still wins', async () => {
  const { app } = await setup(oidcEnv('http://127.0.0.1:1/')); // nothing listens there
  const res = await postLogout(app, 'pp_session=x; pp_csrf=y;' + HINT);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/');
  const jar = cookieJar(setCookies(res));
  assert.equal(jar.get('pp_session'), '');
  assert.equal(jar.get(ID_TOKEN_COOKIE), '', 'the hint cookie is dropped even on degrade');
});

test('oidc mode, discovery without end_session_endpoint: local logout still wins', async () => {
  const idp = await fakeIdp(false);
  try {
    const { app } = await setup(oidcEnv(idp.issuer));
    const res = await postLogout(app, 'pp_session=x; pp_csrf=y;' + HINT);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/');
    assert.equal(cookieJar(setCookies(res)).get(ID_TOKEN_COOKIE), '');
    assert.deepEqual(idp.requests, ['GET /.well-known/openid-configuration']);
  } finally {
    await idp.close();
  }
});

test('fake-IdP login loop plants the httpOnly hint; logout ends both sessions', async () => {
  const idp = await fakeIdp(true);
  try {
    const { app, db } = await setup(oidcEnv(idp.issuer));

    // Login start: 302 to the IdP authorize endpoint plants the nonce cookie.
    const start = await app.fetch(new Request('http://localhost/auth/login?next=/after'));
    assert.equal(start.status, 302);
    const jar = cookieJar(setCookies(start));
    const authorize = new URL(start.headers.get('location')!);
    assert.equal(`${authorize.origin}${authorize.pathname}`, `${idp.issuer}/authorize`);
    assert.equal(authorize.searchParams.get('client_id'), 'test-client');

    // Play the IdP: bounce back with code + state, carrying the nonce cookie.
    const state = authorize.searchParams.get('state')!;
    const cb = await app.fetch(
      new Request(
        `http://localhost/auth/callback?code=fake-code&state=${encodeURIComponent(state)}`,
        { headers: { cookie: `pp_oauth=${jar.get('pp_oauth') ?? ''}` } },
      ),
    );
    assert.equal(cb.status, 302);
    assert.equal(cb.headers.get('location'), '/after');
    assert.equal((await db.select().from(users)).length, 1, 'the federated login created the user');
    const loginCookies = setCookies(cb);
    const hint = loginCookies.find((v) => v.startsWith(`${ID_TOKEN_COOKIE}=`));
    assert.ok(hint, 'the callback plants the id-token hint cookie');
    assert.match(hint!, /HttpOnly/, 'the hint cookie is httpOnly');
    assert.match(hint!, /Max-Age=1209600/, 'the hint cookie carries the session TTL');

    // Logout with the login cookies: local cookies die AND the browser follows the
    // end-session redirect that kills the IdP SSO session.
    const out = await postLogout(app, cookieHeader(cookieJar(loginCookies)));
    assert.equal(out.status, 302);
    const loc = new URL(out.headers.get('location')!);
    assert.equal(`${loc.origin}${loc.pathname}`, idp.endSession);
    assert.equal(
      [...loc.searchParams.keys()].length,
      1,
      'no token material in the URL beyond id_token_hint',
    );
    assert.equal(loc.searchParams.get('id_token_hint'), ID_TOKEN);
    const outJar = cookieJar(setCookies(out));
    assert.equal(outJar.get('pp_session'), '');
    assert.equal(outJar.get('pp_csrf'), '');
    assert.equal(outJar.get(ID_TOKEN_COOKIE), '', 'the hint cookie dies with the session');
  } finally {
    await idp.close();
  }
});

test('session renewal slides the hint cookie alongside pp_session', async () => {
  const storage = new FsStorage(await mkdtemp(join(tmpdir(), 'pagepin-logout-')));
  const db = await makeTestDb();
  await db.insert(users).values({
    id: 'u1',
    email: 'a@e.com',
    handle: 'alice',
    displayName: 'Alice',
    createdAt: nowIso(),
  });
  const cfg = loadConfig({
    PAGEPIN_SECRET: 'test-secret',
    PAGEPIN_BASE_URL: 'http://localhost:8000',
    PAGEPIN_AUTH_MODE: 'oidc',
    PAGEPIN_OIDC_ISSUER: 'http://127.0.0.1:1/',
    PAGEPIN_OIDC_CLIENT_ID: 'test-client',
    PAGEPIN_OIDC_CLIENT_SECRET: 'test-idp-secret',
  });
  const deps: AppDeps = { config: cfg, db, storage };
  const app = new Hono<AppEnv>();
  const mw = makeAuthMiddleware(deps);
  app.get('/api/ping', mw.currentUser, (c) => c.json({ ok: true }));

  const now = Math.floor(Date.now() / 1000);
  const claims: SessionClaims = {
    sub: 'u1',
    hdl: 'alice',
    pln: 'session',
    epo: 0,
    iat: now - 3600,
    exp: now + 3600, // less than half the 336h TTL left → renewal fires
    csrf: 'csrf-fixed',
  };
  const token = await sign(claims, cfg.secret, 'HS256');
  const res = await app.fetch(
    new Request('http://localhost/api/ping', {
      headers: { cookie: `pp_session=${token}; pp_csrf=csrf-fixed;` + HINT },
    }),
  );
  assert.equal(res.status, 200);
  const reissued = setCookies(res).find((v) => v.startsWith(`${ID_TOKEN_COOKIE}=`));
  assert.ok(reissued, 'renewal re-issues the hint cookie');
  assert.match(reissued!, /Max-Age=1209600/, 'renewed to the full sliding TTL');
  assert.ok(reissued!.startsWith(HINT), 'same id_token, not a new one');
});
