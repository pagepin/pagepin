/** /auth/* 路由(两个平面同构,
 * 差异仅在落哪个 Cookie 与 password 登录页形态)。
 *
 * 三种 authMode:
 *   password —— 邮箱+密码。GET /auth/login:session 平面 303 → /login(console SPA);
 *               view 平面(双域内容域)渲染极简自包含 HTML 表单。
 *   oidc     —— 标准授权码流程;state = 短时 JWT{pln,nxt}(防 CSRF 兼带回跳路径,无服务端状态)。
 *   none     —— 开发模式:GET /auth/login 直接以 dev@localhost 登录。
 *
 * 单域模式下调用方只会传 plane='session'(viewer 复用控制台会话)。
 */

import type { Context } from 'hono';
import { Hono } from 'hono';
import { sign, verify as jwtVerify } from 'hono/jwt';
import { eq, sql } from 'drizzle-orm';

import type { Config } from '../config.js';
import { users, type UserRow } from '../db/index.js';
import type { AppDeps, AppEnv } from '../types.js';
import { nowIso, uuid } from '../util.js';
import { buildAuthorizeUrl, exchangeCode, OidcError, type OidcIdentity } from './oidc.js';
import { hashPassword, verifyPassword } from './password.js';
import { clearLoginCookies, setLoginCookies, type Plane } from './sessions.js';

const STATE_TTL = 600; // OIDC state 有效期 10 分钟

async function stateEncode(secret: string, plane: Plane, nextPath: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ pln: plane, nxt: nextPath, iat: now, exp: now + STATE_TTL }, secret, 'HS256');
}

async function stateDecode(secret: string, state: string): Promise<Record<string, unknown> | null> {
  try {
    return await jwtVerify(state, secret, 'HS256');
  } catch {
    return null;
  }
}

/** 只允许站内相对路径,防 open redirect。 */
function safeNext(raw: string | null | undefined): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/';
}

/** OIDC 回调地址:dual 按请求 Host 拼(两个回调都需在 IdP 注册);single 用 baseUrl。 */
function redirectUri(c: Context, cfg: Config): string {
  if (cfg.mode === 'dual') {
    const host = c.req.header('host') ?? '';
    return `${cfg.externalScheme}://${host}/auth/callback`;
  }
  return `${cfg.baseUrl}/auth/callback`;
}

/** body 双格式:JSON 或 form(urlencoded/multipart);只收 string 字段。 */
async function readBody(c: Context): Promise<{ body: Record<string, string>; isJson: boolean }> {
  const ct = c.req.header('content-type') ?? '';
  if (ct.includes('application/json')) {
    const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const body: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') body[k] = v;
    return { body, isJson: true };
  }
  const form = await c.req.parseBody();
  const body: Record<string, string> = {};
  for (const [k, v] of Object.entries(form)) if (typeof v === 'string') body[k] = v;
  return { body, isJson: false };
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 双域内容平面的 password 登录页:自包含、无外部资源(被托管站点域上不能引控制台资产)。 */
function loginPage(next: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>登录 - pagepin</title>
<style>
  body{font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#f5f6f8;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  form{background:#fff;padding:32px 36px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08);width:320px}
  h1{font-size:18px;margin:0 0 20px;color:#222}
  label{display:block;font-size:13px;color:#555;margin-bottom:14px}
  input{display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:8px 10px;border:1px solid #d0d4da;border-radius:6px;font-size:14px}
  button{width:100%;padding:9px 0;border:0;border-radius:6px;background:#3b82f6;color:#fff;font-size:14px;cursor:pointer}
  button:hover{background:#2f6fe0}
  p.tip{font-size:12px;color:#999;margin:14px 0 0;text-align:center}
</style>
</head>
<body>
<form method="post" action="/auth/password">
  <h1>登录后查看此页面</h1>
  <input type="hidden" name="next" value="${escHtml(next)}">
  <label>邮箱<input name="email" type="email" autocomplete="username" required></label>
  <label>密码<input name="password" type="password" autocomplete="current-password" required></label>
  <button type="submit">登录</button>
  <p class="tip">登录后自动跳回原页面</p>
</form>
</body>
</html>`;
}

/** none 模式:upsert 开发用户(每次登录刷新 last_login_at)。 */
function upsertDevUser(deps: AppDeps): UserRow {
  const now = nowIso();
  const existing = deps.db.select().from(users).where(eq(users.email, 'dev@localhost')).get();
  if (existing) {
    deps.db.update(users).set({ lastLoginAt: now }).where(eq(users.id, existing.id)).run();
    return existing;
  }
  return deps.db
    .insert(users)
    .values({
      id: uuid(),
      email: 'dev@localhost',
      displayName: 'Dev User',
      isAdmin: true,
      createdAt: now,
      lastLoginAt: now,
    })
    .returning()
    .get();
}

/** OIDC upsert:按 oidc_sub 查;资料字段顺手刷新(handle 不动 —— 它是本地身份,
 * 一经确认不随 IdP 变);首个用户给 admin(与 signup 同一条「首个注册用户为 admin」规则)。 */
function upsertOidcUser(deps: AppDeps, info: OidcIdentity): UserRow {
  const now = nowIso();
  return deps.db.transaction((tx): UserRow => {
    const existing = tx.select().from(users).where(eq(users.oidcSub, info.sub)).get();
    if (existing) {
      return tx
        .update(users)
        .set({
          displayName: info.name || existing.displayName,
          email: info.email || existing.email,
          lastLoginAt: now,
        })
        .where(eq(users.id, existing.id))
        .returning()
        .get();
    }
    const n = tx.select({ n: sql<number>`count(*)` }).from(users).get()?.n ?? 0;
    return tx
      .insert(users)
      .values({
        id: uuid(),
        oidcSub: info.sub,
        displayName: info.name ?? info.preferredUsername ?? null,
        email: info.email ?? null,
        isAdmin: n === 0,
        createdAt: now,
        lastLoginAt: now,
      })
      .returning()
      .get();
  });
}

export function makeAuthRoutes(deps: AppDeps, plane: Plane): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const cfg = deps.config;

  app.get('/auth/login', async (c) => {
    const next = safeNext(c.req.query('next'));

    if (cfg.authMode === 'none') {
      const user = upsertDevUser(deps);
      await setLoginCookies(c, cfg, plane, user.id, user.handle);
      return c.redirect(next, 302);
    }

    if (cfg.authMode === 'oidc') {
      const state = await stateEncode(cfg.secret, plane, next);
      try {
        const url = await buildAuthorizeUrl(cfg.oidc!, redirectUri(c, cfg), state);
        return c.redirect(url, 302);
      } catch (e) {
        if (e instanceof OidcError) return c.json({ detail: e.detail }, 502);
        throw e;
      }
    }

    // password:view 平面(双域内容域)直接渲染表单;session 平面 303 给 console SPA 的 /login
    if (plane === 'view') return c.html(loginPage(next));
    return c.redirect(`/login?next=${encodeURIComponent(next)}`, 303);
  });

  app.post('/auth/password', async (c) => {
    if (cfg.authMode !== 'password') return c.json({ detail: '未启用密码登录' }, 403);
    const { body, isJson } = await readBody(c);
    const email = (body.email ?? '').trim();
    const password = body.password ?? '';
    const user = email ? deps.db.select().from(users).where(eq(users.email, email)).get() : undefined;
    if (!user || !user.passwordHash || !password || !(await verifyPassword(password, user.passwordHash))) {
      return c.json({ detail: '邮箱或密码不正确' }, 401);
    }
    deps.db.update(users).set({ lastLoginAt: nowIso() }).where(eq(users.id, user.id)).run();
    await setLoginCookies(c, cfg, plane, user.id, user.handle);
    if (isJson) return c.json({ ok: true });
    return c.redirect(safeNext(body.next), 302);
  });

  app.post('/auth/signup', async (c) => {
    if (cfg.authMode !== 'password' || !cfg.allowSignup) {
      return c.json({ detail: '注册未开放' }, 403);
    }
    const { body } = await readBody(c);
    const email = (body.email ?? '').trim();
    const password = body.password ?? '';
    const displayName = (body.display_name ?? '').trim();
    if (!/.+@.+/.test(email)) return c.json({ detail: '邮箱格式不正确' }, 422);
    if (password.length < 8) return c.json({ detail: '密码至少 8 位' }, 422);

    const passwordHash = await hashPassword(password);
    const now = nowIso();
    // 事务内查重 + 数首个用户(count==0 → admin),并发注册不会产生双 admin/双邮箱
    const created = deps.db.transaction((tx): UserRow | null => {
      const dup = tx.select().from(users).where(eq(users.email, email)).get();
      if (dup) return null;
      const n = tx.select({ n: sql<number>`count(*)` }).from(users).get()?.n ?? 0;
      return tx
        .insert(users)
        .values({
          id: uuid(),
          email,
          passwordHash,
          displayName: displayName || null,
          isAdmin: n === 0,
          createdAt: now,
          lastLoginAt: now,
        })
        .returning()
        .get();
    });
    if (!created) return c.json({ detail: '该邮箱已注册' }, 409);
    await setLoginCookies(c, cfg, plane, created.id, created.handle);
    return c.json({ ok: true });
  });

  app.get('/auth/callback', async (c) => {
    if (cfg.authMode !== 'oidc') return c.json({ detail: '未启用 OIDC 登录' }, 404);
    const code = c.req.query('code');
    const state = c.req.query('state');
    if (!code || !state) return c.json({ detail: '缺 code/state' }, 400);
    const st = await stateDecode(cfg.secret, state);
    if (!st || st.pln !== plane) {
      return c.json({ detail: 'state 无效或过期，请重新登录' }, 400);
    }
    let info: OidcIdentity;
    try {
      info = await exchangeCode(cfg.oidc!, code, redirectUri(c, cfg));
    } catch (e) {
      if (e instanceof OidcError) return c.json({ detail: e.detail }, 502);
      throw e;
    }
    const user = upsertOidcUser(deps, info);
    await setLoginCookies(c, cfg, plane, user.id, user.handle);
    return c.redirect(safeNext(typeof st.nxt === 'string' ? st.nxt : null), 302);
  });

  app.post('/auth/logout', (c) => {
    clearLoginCookies(c, plane);
    return c.redirect('/', 302);
  });

  // console 登录 UI 用:匿名可读,决定渲染密码表单还是跳 OIDC
  app.get('/api/auth/config', (c) => c.json({ mode: cfg.authMode, allow_signup: cfg.allowSignup }));

  return app;
}
