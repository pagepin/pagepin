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
import { and, eq, isNull, sql } from 'drizzle-orm';

import { escapeHtml, gateDoc, LOCK_SVG } from '../brand-gate.js';
import type { Config } from '../config.js';
import { invites, users, type UserRow } from '../db/index.js';
import { effectiveRegistrationMode } from '../instance-settings.js';
import type { AppDeps, AppEnv } from '../types.js';
import { nowIso, uuid, validEmail } from '../util.js';
import { buildAuthorizeUrl, exchangeCode, OidcError, type OidcIdentity } from './oidc.js';
import { hashPassword, verifyPassword } from './password.js';
import { exchangeSocialCode, socialAuthorizeUrl } from './social.js';
import { verifyTurnstile } from './turnstile.js';
import {
  clearLoginCookies,
  consumeOauthNonce,
  setLoginCookies,
  setOauthNonce,
  type Plane,
} from './sessions.js';

const STATE_TTL = 600; // OIDC state 有效期 10 分钟

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function stateEncode(
  secret: string, plane: Plane, nextPath: string, nonce: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  // non = 与 host-only cookie 比对的登录态绑定 nonce(防 login CSRF)
  return sign({ pln: plane, nxt: nextPath, non: nonce, iat: now, exp: now + STATE_TTL }, secret, 'HS256');
}

async function stateDecode(secret: string, state: string): Promise<Record<string, unknown> | null> {
  try {
    return await jwtVerify(state, secret, 'HS256');
  } catch {
    return null;
  }
}

/** 只允许站内相对路径,防 open redirect。
 * 拒 //evil(协议相对)、javascript:(无前导 /),以及 /\evil(浏览器把反斜杠归一成 / → //evil)。 */
function safeNext(raw: string | null | undefined): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\')) return raw;
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

/** 社交登录回调地址(每家一条 `/auth/social/<provider>/callback`,需在各 provider 注册)。
 * authorize 与 token 交换必须用同一个 redirect_uri,故两处都走本函数。 */
function socialRedirectUri(c: Context, cfg: Config, provider: string): string {
  const path = `/auth/social/${provider}/callback`;
  if (cfg.mode === 'dual') {
    const host = c.req.header('host') ?? '';
    return `${cfg.externalScheme}://${host}${path}`;
  }
  return `${cfg.baseUrl}${path}`;
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

/** 取客户端 IP(限流/turnstile remoteip 用):CF 边缘给 cf-connecting-ip,其余取 x-forwarded-for 首段。 */
function clientIp(c: Context): string {
  const cf = c.req.header('cf-connecting-ip');
  if (cf) return cf.trim();
  const xff = c.req.header('x-forwarded-for');
  if (xff) return (xff.split(',')[0] ?? xff).trim();
  return 'unknown';
}

/** 从请求体取 Turnstile token:标准隐藏域 cf-turnstile-response,或 console SPA 显式传的 turnstile_token。 */
function turnstileToken(body: Record<string, string>): string {
  return body['cf-turnstile-response'] ?? body['turnstile_token'] ?? '';
}

// 社交登录品牌标(与 console/src/components/Login.tsx 同一份 SVG;内容域登录墙是纯 HTML,内联）。
const GOOGLE_MARK = `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.55-5.17 3.55-8.87Z"/><path fill="#34A853" d="M12 24c3.24 0 5.96-1.08 7.95-2.91l-3.88-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A12 12 0 0 0 12 24Z"/><path fill="#FBBC05" d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.62H1.29a12 12 0 0 0 0 10.76l3.98-3.09Z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75Z"/></svg>`;
const GITHUB_MARK = `<svg width="16" height="16" viewBox="0 0 24 24" fill="#1b2127" aria-hidden="true"><path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.95 0-1.31.47-2.39 1.24-3.23-.13-.31-.54-1.53.12-3.19 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.25 2.88.12 3.19.77.84 1.24 1.92 1.24 3.23 0 4.62-2.81 5.64-5.49 5.94.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12 12 0 0 0 12 .5Z"/></svg>`;
const SOCIAL_MARK: Record<string, string> = { google: GOOGLE_MARK, github: GITHUB_MARK };
const SOCIAL_LABEL: Record<string, string> = { google: 'Continue with Google', github: 'Continue with GitHub' };

/** 内容域登录墙的社交登录按钮区:纯 <a> GET 起跳到 /auth/social/<id>（按 Host 拼回调,
 *  从 pagepin.page 发起即回 pagepin.page;无需 JS）。无 provider 时返回空串。 */
function socialButtonsHtml(social: string[], next: string): string {
  if (!social.length) return '';
  const buttons = social
    .map((id) => {
      const mark = SOCIAL_MARK[id] ?? '';
      const label = SOCIAL_LABEL[id] ?? `Continue with ${id}`;
      const href = `/auth/social/${encodeURIComponent(id)}?next=${encodeURIComponent(next)}`;
      return `  <a class="btn btn-social" href="${href}">${mark}${escapeHtml(label)}</a>`;
    })
    .join('\n');
  return `<div class="social">\n${buttons}\n</div>\n<div class="or">or</div>\n`;
}

/** 双域内容平面的 password 登录页:复用 brand-gate 品牌壳(与私有门页同一视觉),自包含、
 * 无控制台资产依赖。提交走内联 fetch → JSON,失败行内报错(不再把 401 的 {detail} 甩成裸 JSON 页);
 * 成功跳回 next。JS 不可用时 <form> 仍原生 POST 兜底(成功 302 回跳,失败退化为旧的 JSON 页)。 */
function loginPage(next: string, social: string[], turnstileSiteKey?: string): string {
  const tsWidget = turnstileSiteKey
    ? `  <div class="cf-turnstile" data-sitekey="${escapeHtml(turnstileSiteKey)}"></div>\n`
    : '';
  const tsScript = turnstileSiteKey
    ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>\n`
    : '';
  return gateDoc(
    'Sign in · pagepin',
    `<div class="chip chip-teal">${LOCK_SVG}</div>
<h1>Sign in to view</h1>
<p class="body">Sign in to your pagepin account to continue.</p>
${socialButtonsHtml(social, next)}<form id="f" method="post" action="/auth/password">
  <input type="hidden" name="next" value="${escapeHtml(next)}">
  <label>Email<input name="email" type="email" autocomplete="username" required autofocus></label>
  <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
${tsWidget}  <div id="err" class="err" hidden></div>
  <button type="submit" class="btn btn-primary">Sign in</button>
</form>
${tsScript}<div class="foot">Hosted on <span class="mono">pagepin</span></div>
<script>
(function(){
  var f=document.getElementById('f'),err=document.getElementById('err'),btn=f.querySelector('button');
  f.addEventListener('submit',function(e){
    e.preventDefault();err.hidden=true;btn.disabled=true;btn.textContent='Signing in\\u2026';
    var p={};new FormData(f).forEach(function(v,k){p[k]=v;});
    fetch('/auth/password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(p)})
      .then(function(r){return r.json().catch(function(){return {};}).then(function(j){return {ok:r.ok,j:j};});})
      .then(function(res){
        if(res.ok){window.location.href=p.next||'/';return;}
        err.textContent=(res.j&&res.j.detail)||'Sign-in failed';err.hidden=false;
        btn.disabled=false;btn.textContent='Sign in';
      })
      .catch(function(){err.textContent='Network error, please retry';err.hidden=false;btn.disabled=false;btn.textContent='Sign in';});
  });
})();
</script>`,
  );
}

/** none 模式:upsert 开发用户(每次登录刷新 last_login_at)。 */
async function upsertDevUser(deps: AppDeps): Promise<UserRow> {
  const now = nowIso();
  const existing = await deps.db.select().from(users).where(eq(users.email, 'dev@localhost')).get();
  if (existing) {
    await deps.db.update(users).set({ lastLoginAt: now }).where(eq(users.id, existing.id)).run();
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

/** 候选 email 能否安全写入:为空、或已被「别的」账号占用 → null。
 * email 仅展示用、不按它合并账号(身份是 namespaced oidc_sub),故被占即不写,避免命中
 * users_email_uq 唯一索引 500。selfId = 自身 id(更新时排除自己)。 */
async function emailFreeOrNull(
  deps: AppDeps, candidate: string | null | undefined, selfId: string | null,
): Promise<string | null> {
  if (!candidate) return null;
  const owner = await deps.db.select({ id: users.id }).from(users).where(eq(users.email, candidate)).get();
  return owner && owner.id !== selfId ? null : candidate;
}

/** OIDC / 社交登录 upsert:按 oidc_sub 查(sub 已带 provider 前缀,跨家不撞号);资料顺手刷新
 * (handle 不动 —— 本地身份,一经确认不随 IdP 变);首个用户给 admin。
 * D1 无交互事务:email 被他人占用即不写(不按 email 合并),insert 兜并发同 sub / email 抢占 ——
 * 绝不让 users_email_uq 冲突冒成 500(混合 password+社交时,verified email 撞已有账号很常见)。 */
async function upsertOidcUser(deps: AppDeps, info: OidcIdentity): Promise<UserRow> {
  const now = nowIso();
  const existing = await deps.db.select().from(users).where(eq(users.oidcSub, info.sub)).get();
  if (existing) {
    // 新 email 可用才更新,否则保留旧值 —— 不抢别人的 email
    const fresh = info.email ? await emailFreeOrNull(deps, info.email, existing.id) : null;
    return deps.db
      .update(users)
      .set({
        displayName: info.name || existing.displayName,
        email: fresh ?? existing.email,
        lastLoginAt: now,
      })
      .where(eq(users.id, existing.id))
      .returning()
      .get();
  }
  const n = (await deps.db.select({ n: sql<number>`count(*)` }).from(users).get())?.n ?? 0;
  const values = {
    id: uuid(),
    oidcSub: info.sub,
    displayName: info.name ?? info.preferredUsername ?? null,
    email: await emailFreeOrNull(deps, info.email, null),
    isAdmin: n === 0,
    createdAt: now,
    lastLoginAt: now,
  };
  try {
    return await deps.db.insert(users).values(values).returning().get();
  } catch (e) {
    // 并发兜底:同 sub 抢先建 → 返回那行;email 在 check 与 insert 间被抢 → 去 email 重插(namespaced sub 仍独立)
    const bySub = await deps.db.select().from(users).where(eq(users.oidcSub, info.sub)).get();
    if (bySub) return bySub;
    return deps.db.insert(users).values({ ...values, email: null }).returning().get();
  }
}

export function makeAuthRoutes(deps: AppDeps, plane: Plane): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const cfg = deps.config;

  app.get('/auth/login', async (c) => {
    const next = safeNext(c.req.query('next'));

    if (cfg.authMode === 'none') {
      const user = await upsertDevUser(deps);
      await setLoginCookies(c, cfg, plane, user.id, user.handle);
      return c.redirect(next, 302);
    }

    if (cfg.authMode === 'oidc') {
      const state = await stateEncode(cfg.secret, plane, next, setOauthNonce(c, cfg));
      try {
        const url = await buildAuthorizeUrl(cfg.oidc!, redirectUri(c, cfg), state);
        return c.redirect(url, 302);
      } catch (e) {
        if (e instanceof OidcError) return c.json({ detail: e.detail }, 502);
        throw e;
      }
    }

    // password:view 平面(双域内容域)直接渲染表单;session 平面 303 给 console SPA 的 /login
    if (plane === 'view') return c.html(loginPage(next, cfg.socialProviders.map((p) => p.id), cfg.turnstile?.siteKey));
    return c.redirect(`/login?next=${encodeURIComponent(next)}`, 303);
  });

  app.post('/auth/password', async (c) => {
    if (cfg.authMode !== 'password') return c.json({ detail: '未启用密码登录' }, 403);
    const { body, isJson } = await readBody(c);
    // 限流:同一 IP 登录尝试节流(防撞库);边缘真正防护用 CF Rate Limiting Rules。
    if (deps.rateLimiter && !(await deps.rateLimiter.check(`login:${clientIp(c)}`, 10, 600))) {
      return c.json({ detail: '尝试过于频繁，请稍后再试' }, 429);
    }
    if (cfg.turnstile && !(await verifyTurnstile(cfg.turnstile.secretKey, turnstileToken(body), clientIp(c)))) {
      return c.json({ detail: '人机校验失败，请重试' }, 403);
    }
    const email = (body.email ?? '').trim();
    const password = body.password ?? '';
    const user = email
      ? await deps.db.select().from(users).where(eq(users.email, email)).get()
      : undefined;
    if (!user || !user.passwordHash || !password || !(await verifyPassword(password, user.passwordHash))) {
      return c.json({ detail: '邮箱或密码不正确' }, 401);
    }
    if (user.disabled) return c.json({ detail: '账号已被禁用' }, 403);
    await deps.db.update(users).set({ lastLoginAt: nowIso() }).where(eq(users.id, user.id)).run();
    await setLoginCookies(c, cfg, plane, user.id, user.handle);
    if (isJson) return c.json({ ok: true });
    return c.redirect(safeNext(body.next), 302);
  });

  app.post('/auth/signup', async (c) => {
    // 自助注册仅在 open 模式放行;invite 模式须走邀请链接,closed 完全关闭
    if (cfg.authMode !== 'password' || (await effectiveRegistrationMode(deps)) !== 'open') {
      return c.json({ detail: '注册未开放' }, 403);
    }
    const { body } = await readBody(c);
    // 限流:同一 IP 批量注册节流(防机器人刷号);边缘真正防护用 CF Rate Limiting Rules。
    if (deps.rateLimiter && !(await deps.rateLimiter.check(`signup:${clientIp(c)}`, 5, 3600))) {
      return c.json({ detail: '注册过于频繁，请稍后再试' }, 429);
    }
    if (cfg.turnstile && !(await verifyTurnstile(cfg.turnstile.secretKey, turnstileToken(body), clientIp(c)))) {
      return c.json({ detail: '人机校验失败，请重试' }, 403);
    }
    const email = (body.email ?? '').trim();
    const password = body.password ?? '';
    const displayName = (body.display_name ?? '').trim();
    if (!validEmail(email)) return c.json({ detail: '邮箱格式不正确' }, 422);
    if (password.length < 8) return c.json({ detail: '密码至少 8 位' }, 422);

    const passwordHash = await hashPassword(password);
    const now = nowIso();
    // D1 无交互事务:查重 + 数首个用户(count==0 → admin),靠 email 唯一索引兜并发双注册
    const dup = await deps.db.select().from(users).where(eq(users.email, email)).get();
    if (dup) return c.json({ detail: '该邮箱已注册' }, 409);
    const n = (await deps.db.select({ n: sql<number>`count(*)` }).from(users).get())?.n ?? 0;
    let created: UserRow;
    try {
      created = await deps.db
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
    } catch (e) {
      // 唯一索引兜并发同邮箱:落库失败后该邮箱已存在 → 409,否则真异常上抛
      const exists = await deps.db.select().from(users).where(eq(users.email, email)).get();
      if (exists) return c.json({ detail: '该邮箱已注册' }, 409);
      throw e;
    }
    await setLoginCookies(c, cfg, plane, created.id, created.handle);
    return c.json({ ok: true });
  });

  app.get('/auth/callback', async (c) => {
    if (cfg.authMode !== 'oidc') return c.json({ detail: '未启用 OIDC 登录' }, 404);
    const code = c.req.query('code');
    const state = c.req.query('state');
    if (!code || !state) return c.json({ detail: '缺 code/state' }, 400);
    const st = await stateDecode(cfg.secret, state);
    if (!st || st.pln !== plane || !consumeOauthNonce(c, st.non)) {
      return c.json({ detail: 'state 无效或过期，请重新登录' }, 400);
    }
    let info: OidcIdentity;
    try {
      info = await exchangeCode(cfg.oidc!, code, redirectUri(c, cfg));
    } catch (e) {
      if (e instanceof OidcError) return c.json({ detail: e.detail }, 502);
      throw e;
    }
    const user = await upsertOidcUser(deps, info);
    if (user.disabled) return c.json({ detail: '账号已被禁用' }, 403);
    await setLoginCookies(c, cfg, plane, user.id, user.handle);
    return c.redirect(safeNext(typeof st.nxt === 'string' ? st.nxt : null), 302);
  });

  // 社交登录(与 password/oidc 并存,独立配置):起跳 + 回跳,按 :provider 路由。
  // state = 短时 JWT{pln,nxt,non},起跳种 host-only nonce cookie、回跳比对(防 login CSRF + 带回跳路径)。
  app.get('/auth/social/:provider', async (c) => {
    const provider = c.req.param('provider');
    const conf = cfg.socialProviders.find((p) => p.id === provider);
    if (!conf) return c.json({ detail: '未启用该登录方式' }, 404);
    const next = safeNext(c.req.query('next'));
    const state = await stateEncode(cfg.secret, plane, next, setOauthNonce(c, cfg));
    return c.redirect(
      socialAuthorizeUrl(provider, conf.clientId, socialRedirectUri(c, cfg, provider), state),
      302,
    );
  });

  app.get('/auth/social/:provider/callback', async (c) => {
    const provider = c.req.param('provider');
    const conf = cfg.socialProviders.find((p) => p.id === provider);
    if (!conf) return c.json({ detail: '未启用该登录方式' }, 404);
    const code = c.req.query('code');
    const state = c.req.query('state');
    if (!code || !state) return c.json({ detail: '缺 code/state' }, 400);
    const st = await stateDecode(cfg.secret, state);
    if (!st || st.pln !== plane || !consumeOauthNonce(c, st.non)) {
      return c.json({ detail: 'state 无效或过期，请重新登录' }, 400);
    }
    let id: { sub: string; name?: string; email?: string };
    try {
      id = await exchangeSocialCode(
        provider,
        conf.clientId,
        conf.clientSecret,
        code,
        socialRedirectUri(c, cfg, provider),
      );
    } catch (e) {
      if (e instanceof OidcError) return c.json({ detail: e.detail }, 502);
      throw e;
    }
    // 复用 upsertOidcUser:sub 已带 provider 前缀(`google:…`/`github:…`),与 oidc_sub 唯一索引共用;
    // email 仅 verified 才带(social.ts 已把关),不按 email 跨 provider 自动合并。
    const user = await upsertOidcUser(deps, { sub: id.sub, name: id.name, email: id.email });
    if (user.disabled) return c.json({ detail: '账号已被禁用' }, 403);
    await setLoginCookies(c, cfg, plane, user.id, user.handle);
    return c.redirect(safeNext(typeof st.nxt === 'string' ? st.nxt : null), 302);
  });

  app.post('/auth/logout', (c) => {
    clearLoginCookies(c, plane);
    return c.redirect('/', 302);
  });

  // console 登录/注册 UI 用:匿名可读,决定渲染密码表单/注册入口还是跳 OIDC
  app.get('/api/auth/config', async (c) => {
    const mode = await effectiveRegistrationMode(deps);
    return c.json({
      mode: cfg.authMode,
      registration_mode: mode,
      allow_signup: mode === 'open', // 兼容旧字段
      social_providers: cfg.socialProviders.map((p) => p.id), // console 据此渲染社交登录按钮
      turnstile_site_key: cfg.turnstile?.siteKey ?? null, // 配了才下发,console 据此渲染人机校验
    });
  });

  /** 邀请校验(匿名):接受邀请屏据此回显被邀邮箱、判断是否有效。 */
  app.get('/api/auth/invite', async (c) => {
    if (cfg.authMode !== 'password') return c.json({ ok: false, reason: 'unsupported' });
    if ((await effectiveRegistrationMode(deps)) === 'closed') return c.json({ ok: false, reason: 'closed' });
    const token = (c.req.query('token') ?? '').trim();
    if (!token) return c.json({ ok: false, reason: 'missing' });
    const inv = await deps.db.select().from(invites).where(eq(invites.tokenHash, await sha256Hex(token))).get();
    if (!inv || inv.acceptedAt !== null || Date.parse(inv.expiresAt) <= Date.now()) {
      return c.json({ ok: false, reason: 'invalid' });
    }
    return c.json({ ok: true, email: inv.email, is_admin: inv.isAdmin });
  });

  /** 接受邀请:凭一次性 token 建号并登录(handle 仍走首登确认)。 */
  app.post('/auth/accept-invite', async (c) => {
    if (cfg.authMode !== 'password') return c.json({ detail: '当前实例不支持邀请注册' }, 403);
    if ((await effectiveRegistrationMode(deps)) === 'closed') return c.json({ detail: '注册已关闭' }, 403);
    const { body } = await readBody(c);
    const token = (body.token ?? '').trim();
    const password = body.password ?? '';
    const displayName = (body.display_name ?? '').trim();
    if (!token) return c.json({ detail: '缺少邀请 token' }, 422);
    if (password.length < 8) return c.json({ detail: '密码至少 8 位' }, 422);

    const tokenHash = await sha256Hex(token);
    const inv = await deps.db.select().from(invites).where(eq(invites.tokenHash, tokenHash)).get();
    if (!inv || inv.acceptedAt !== null || Date.parse(inv.expiresAt) <= Date.now()) {
      return c.json({ detail: '邀请无效或已过期' }, 400);
    }
    const email = (inv.email ?? body.email ?? '').trim();
    if (!validEmail(email)) return c.json({ detail: '邮箱格式不正确' }, 422);

    const passwordHash = await hashPassword(password);
    const now = nowIso();
    // 常见 dup 先拦(不消耗邀请)
    const dup = await deps.db.select().from(users).where(eq(users.email, email)).get();
    if (dup) return c.json({ detail: '该邮箱已注册' }, 409);
    // D1 无交互事务:① 先条件认领邀请(WHERE accepted_at IS NULL,RETURNING 检测命中=一次性语义),
    // ② 认领成功才建号,③ 建号失败则补偿释放邀请。跨进程安全,无需交互事务。
    const newUserId = uuid();
    const claimed = await deps.db
      .update(invites)
      .set({ acceptedAt: now, acceptedUserId: newUserId })
      .where(and(eq(invites.id, inv.id), isNull(invites.acceptedAt)))
      .returning({ id: invites.id })
      .get();
    if (!claimed) return c.json({ detail: '邀请已被使用' }, 400);
    let created: UserRow;
    try {
      created = await deps.db
        .insert(users)
        .values({
          id: newUserId,
          email,
          passwordHash,
          displayName: displayName || null,
          isAdmin: inv.isAdmin,
          createdAt: now,
          lastLoginAt: now,
        })
        .returning()
        .get();
    } catch (e) {
      // 建号失败(如并发同邮箱抢先)→ 释放本次认领,回错
      await deps.db
        .update(invites)
        .set({ acceptedAt: null, acceptedUserId: null })
        .where(and(eq(invites.id, inv.id), eq(invites.acceptedUserId, newUserId)))
        .run();
      const exists = await deps.db.select().from(users).where(eq(users.email, email)).get();
      if (exists) return c.json({ detail: '该邮箱已注册' }, 409);
      throw e;
    }
    await setLoginCookies(c, cfg, plane, created.id, created.handle);
    return c.json({ ok: true });
  });

  return app;
}
