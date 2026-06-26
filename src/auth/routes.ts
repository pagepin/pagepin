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
import { consoleBase, type Config } from '../config.js';
import { identities, invites, users, type UserRow } from '../db/index.js';
import { effectiveRegistrationMode } from '../instance-settings.js';
import type { AppDeps, AppEnv } from '../types.js';
import { canonicalEmail, nowIso, uuid, validEmail } from '../util.js';
import { buildAuthorizeUrl, exchangeCode, OidcError, type OidcIdentity } from './oidc.js';
import { hashPassword, verifyPassword } from './password.js';
import { exchangeSocialCode, socialAuthorizeUrl } from './social.js';
import { reconcileByVerifiedEmail } from './reconcile.js';
import { readVerifyToken, sendVerificationEmail } from '../mail/verify.js';
import { verifyTurnstile } from './turnstile.js';
import {
  clearLoginCookies,
  consumeOauthNonce,
  readSession,
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
  secret: string, plane: Plane, nextPath: string, nonce: string, link?: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  // non = 与 host-only cookie 比对的登录态绑定 nonce(防 login CSRF);lnk = sign-in-to-link 的目标 userId
  const payload: Record<string, unknown> = { pln: plane, nxt: nextPath, non: nonce, iat: now, exp: now + STATE_TTL };
  if (link) payload.lnk = link;
  return sign(payload, secret, 'HS256');
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
  const existing = (await deps.db.select().from(users).where(eq(users.email, 'dev@localhost')))[0];
  if (existing) {
    await deps.db.update(users).set({ lastLoginAt: now }).where(eq(users.id, existing.id));
    return existing;
  }
  return (await deps.db
    .insert(users)
    .values({
      id: uuid(),
      email: 'dev@localhost',
      displayName: 'Dev User',
      isAdmin: true,
      createdAt: now,
      lastLoginAt: now,
    })
    .returning())[0]!;
}

/** canonical email 是否空闲(没被别的账号占用);决定「建新账号 / 刷资料时能否落这个邮箱键」。
 * **不按 email 并号** —— 被占即返回 null(该账号落 canonical=null,成为独立账号),绝不抢别人的 canonical 槽。
 * selfId = 自身 id(刷新时排除自己)。 */
async function canonicalFreeOrNull(
  deps: AppDeps, canonical: string | null, selfId: string | null,
): Promise<string | null> {
  if (!canonical) return null;
  const owner = (await deps.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.canonicalEmail, canonical))
    )[0];
  return owner && owner.id !== selfId ? null : canonical;
}

interface FederatedLogin {
  provider: string; // 'google' | 'github' | 'oidc'
  sub: string; // social/oidc 命名空间 sub(与历史 oidc_sub 同值,如 'google:123')
  name?: string;
  email?: string;
  emailVerified?: boolean;
}

/** 社交 / OIDC 登录解析(取代旧 upsertOidcUser):恒按 (provider, sub) 查 identities → 解析 userId。
 * **绝不**按 email 并入已存在账号(IdP 验证过的 email 只证明掌握邮箱、不证明拥有账号;唯一跨账号挂载
 * 路径是 Phase 2 的「登录进目标账号后在设置里连接」)。从未见过的身份 → 建独立新账号(首个用户给 admin;
 * canonical 被占则该账号落 email=null,独立存在)。D1 无交互事务:靠 identities_provider_sub_uq /
 * users_canonical_email_uq 唯一索引兜并发,冲突即回查那行。 */
export async function upsertFederatedUser(deps: AppDeps, fed: FederatedLogin): Promise<UserRow> {
  const now = nowIso();
  const canonical = fed.emailVerified ? canonicalEmail(fed.email) : null;

  const existing = (await deps.db
    .select()
    .from(identities)
    .where(and(eq(identities.provider, fed.provider), eq(identities.sub, fed.sub)))
    )[0];
  if (existing) {
    const user = (await deps.db.select().from(users).where(eq(users.id, existing.userId)))[0];
    if (!user) throw new Error(`身份 ${fed.provider}:${fed.sub} 指向不存在的用户`);
    await deps.db
      .update(identities)
      .set({ email: canonical ?? existing.email, lastLoginAt: now })
      .where(eq(identities.id, existing.id));
    // 账号资料顺手刷新:缺名补名;账号尚无 canonical 且当前 email 空闲时认领它(仅自己,不抢别人)。
    const claim = canonical && !user.canonicalEmail ? await canonicalFreeOrNull(deps, canonical, user.id) : null;
    await deps.db
      .update(users)
      .set({
        displayName: user.displayName ?? fed.name ?? null,
        email: claim ? fed.email ?? user.email : user.email,
        canonicalEmail: user.canonicalEmail ?? claim,
        emailVerified: user.emailVerified || !!claim,
        lastLoginAt: now,
      })
      .where(eq(users.id, user.id));
    return ((await deps.db.select().from(users).where(eq(users.id, user.id)))[0])!;
  }

  // 自动合并(两边邮箱都已验证才安全):新身份的 verified 邮箱命中一个 emailVerified 的已有账号 →
  // 挂上并登录进它(= Resend 那种「同邮箱直接进同一账号」)。已有账号邮箱「未验证」**绝不**作目标:
  // 攻击者验证不了不属于自己的邮箱,其抢注账号 emailVerified 恒为 false,故挡住未验证邮箱抢注。
  if (canonical) {
    const match = (await deps.db
      .select()
      .from(users)
      .where(and(eq(users.canonicalEmail, canonical), eq(users.emailVerified, true)))
      )[0];
    if (match && !match.disabled) {
      const attached = await attachIdentity(deps, match.id, {
        provider: fed.provider,
        sub: fed.sub,
        email: fed.email,
        emailVerified: fed.emailVerified,
      });
      if (attached === 'ok') {
        await deps.db
          .update(users)
          .set({ displayName: match.displayName ?? fed.name ?? null, lastLoginAt: now })
          .where(eq(users.id, match.id));
        return ((await deps.db.select().from(users).where(eq(users.id, match.id)))[0])!;
      }
    }
  }

  // 从未见过的身份 → 建独立新账号
  const freeCanonical = await canonicalFreeOrNull(deps, canonical, null);
  const n = ((await deps.db.select({ n: sql<number>`count(*)` }).from(users))[0])?.n ?? 0;
  const userId = uuid();
  const base = {
    id: userId,
    oidcSub: fed.sub, // 影子列(一版后删)
    email: freeCanonical ? fed.email ?? null : null,
    canonicalEmail: freeCanonical,
    emailVerified: !!freeCanonical,
    displayName: fed.name ?? null,
    isAdmin: n === 0,
    createdAt: now,
    lastLoginAt: now,
  };
  try {
    await deps.db.insert(users).values(base);
  } catch {
    // 并发:identities 已被抢建 → 返回那行用户;否则 canonical/oidc_sub 撞 → 去键重插,保持独立账号
    const taken = (await deps.db
      .select()
      .from(identities)
      .where(and(eq(identities.provider, fed.provider), eq(identities.sub, fed.sub)))
      )[0];
    if (taken) {
      const u = (await deps.db.select().from(users).where(eq(users.id, taken.userId)))[0];
      if (u) return u;
    }
    await deps.db.insert(users).values({ ...base, email: null, canonicalEmail: null, oidcSub: null });
  }
  try {
    await deps.db
      .insert(identities)
      .values({
        id: uuid(),
        userId,
        provider: fed.provider,
        sub: fed.sub,
        email: canonical,
        emailVerified: !!canonical,
        createdAt: now,
        lastLoginAt: now,
      });
  } catch {
    const taken = (await deps.db
      .select()
      .from(identities)
      .where(and(eq(identities.provider, fed.provider), eq(identities.sub, fed.sub)))
      )[0];
    if (taken) {
      const u = (await deps.db.select().from(users).where(eq(users.id, taken.userId)))[0];
      if (u) return u;
    }
  }
  return ((await deps.db.select().from(users).where(eq(users.id, userId)))[0])!;
}

/** 为 password 账号补登 identities 行(provider='password', sub=canonicalEmail)。
 * 用户行建好后调用;identities_provider_sub_uq 兜并发,已存在即忽略(不阻断注册成功)。 */
async function ensurePasswordIdentity(
  deps: AppDeps, userId: string, canonical: string, now: string,
): Promise<void> {
  try {
    await deps.db
      .insert(identities)
      .values({
        id: uuid(),
        userId,
        provider: 'password',
        sub: canonical,
        email: canonical,
        emailVerified: false,
        createdAt: now,
        lastLoginAt: now,
      });
  } catch {
    /* 并发/重复 → 唯一索引兜底,忽略 */
  }
}

/** sign-in-to-link:把一条社交/OIDC 身份挂到「已登录的目标账号」(state 里签入的 userId)。
 * 这是唯一的跨账号挂载路径 —— 调用方已确保请求者已登录进该账号。返回:
 *   'ok'       已挂上(或幂等已属于该账号);
 *   'conflict' 该 (provider, sub) 已绑到别的账号 —— 不抢;
 *   'failed'   目标账号不存在/被禁用,或落库异常。 */
export async function attachIdentity(
  deps: AppDeps,
  userId: string,
  fed: { provider: string; sub: string; email?: string; emailVerified?: boolean },
): Promise<'ok' | 'conflict' | 'failed'> {
  const now = nowIso();
  const canonical = fed.emailVerified ? canonicalEmail(fed.email) : null;
  const target = (await deps.db.select().from(users).where(eq(users.id, userId)))[0];
  if (!target || target.disabled) return 'failed';

  const existing = (await deps.db
    .select()
    .from(identities)
    .where(and(eq(identities.provider, fed.provider), eq(identities.sub, fed.sub)))
    )[0];
  if (existing) {
    if (existing.userId !== userId) return 'conflict';
    await deps.db
      .update(identities)
      .set({ email: canonical ?? existing.email, lastLoginAt: now })
      .where(eq(identities.id, existing.id));
    return 'ok';
  }
  try {
    await deps.db
      .insert(identities)
      .values({
        id: uuid(),
        userId,
        provider: fed.provider,
        sub: fed.sub,
        email: canonical,
        emailVerified: !!canonical,
        createdAt: now,
        lastLoginAt: now,
      });
  } catch {
    const taken = (await deps.db
      .select()
      .from(identities)
      .where(and(eq(identities.provider, fed.provider), eq(identities.sub, fed.sub)))
      )[0];
    if (taken) return taken.userId === userId ? 'ok' : 'conflict';
    return 'failed';
  }
  // 目标账号若还没 canonicalEmail 且该 email 空闲,顺手认领(展示用;条件 UPDATE 防并发抢占)
  if (canonical && !target.canonicalEmail) {
    const free = await canonicalFreeOrNull(deps, canonical, userId);
    if (free) {
      await deps.db
        .update(users)
        .set({ canonicalEmail: free, email: target.email ?? fed.email ?? null, emailVerified: true })
        .where(and(eq(users.id, userId), isNull(users.canonicalEmail)));
    }
  }
  return 'ok';
}

export function makeAuthRoutes(deps: AppDeps, plane: Plane): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const cfg = deps.config;

  app.get('/auth/login', async (c) => {
    const next = safeNext(c.req.query('next'));

    if (cfg.authMode === 'none') {
      const user = await upsertDevUser(deps);
      await setLoginCookies(c, cfg, plane, user.id, user.handle, user.sessionEpoch);
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
    const canonical = canonicalEmail(body.email);
    const password = body.password ?? '';
    const user = canonical
      ? (await deps.db.select().from(users).where(eq(users.canonicalEmail, canonical)))[0]
      : undefined;
    if (!user || !user.passwordHash || !password || !(await verifyPassword(password, user.passwordHash))) {
      return c.json({ detail: '邮箱或密码不正确' }, 401);
    }
    if (user.disabled) return c.json({ detail: '账号已被禁用' }, 403);
    await deps.db.update(users).set({ lastLoginAt: nowIso() }).where(eq(users.id, user.id));
    await setLoginCookies(c, cfg, plane, user.id, user.handle, user.sessionEpoch);
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
    const canonical = canonicalEmail(email);
    if (!canonical) return c.json({ detail: '邮箱格式不正确' }, 422);

    const passwordHash = await hashPassword(password);
    const now = nowIso();
    // D1 无交互事务:按 canonicalEmail 查重 + 数首个用户(count==0 → admin),靠 users_canonical_email_uq 兜并发双注册
    const dup = (await deps.db.select().from(users).where(eq(users.canonicalEmail, canonical)))[0];
    if (dup) return c.json({ detail: '该邮箱已注册' }, 409);
    const n = ((await deps.db.select({ n: sql<number>`count(*)` }).from(users))[0])?.n ?? 0;
    let created: UserRow;
    try {
      created = (await deps.db
        .insert(users)
        .values({
          id: uuid(),
          email,
          canonicalEmail: canonical,
          passwordHash,
          displayName: displayName || null,
          isAdmin: n === 0,
          createdAt: now,
          lastLoginAt: now,
        })
        .returning()
        )[0]!;
    } catch (e) {
      // 唯一索引兜并发同邮箱:落库失败后该 canonical 已存在 → 409,否则真异常上抛
      const exists = (await deps.db.select().from(users).where(eq(users.canonicalEmail, canonical)))[0];
      if (exists) return c.json({ detail: '该邮箱已注册' }, 409);
      throw e;
    }
    await ensurePasswordIdentity(deps, created.id, canonical, now);
    if (deps.mailer) {
      // 验证邮件尽力而为发送 —— 失败不阻断注册(邮箱保持未验证,用户可在设置里重发)
      try {
        await sendVerificationEmail(deps, created);
      } catch (e) {
        console.error('验证邮件发送失败(不阻断注册):', e);
      }
    }
    await setLoginCookies(c, cfg, plane, created.id, created.handle, created.sessionEpoch);
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
    const user = await upsertFederatedUser(deps, {
      provider: 'oidc',
      sub: info.sub,
      name: info.name ?? info.preferredUsername,
      email: info.email,
      emailVerified: info.emailVerified,
    });
    if (user.disabled) return c.json({ detail: '账号已被禁用' }, 403);
    await setLoginCookies(c, cfg, plane, user.id, user.handle, user.sessionEpoch);
    return c.redirect(safeNext(typeof st.nxt === 'string' ? st.nxt : null), 302);
  });

  // 社交登录(与 password/oidc 并存,独立配置):起跳 + 回跳,按 :provider 路由。
  // state = 短时 JWT{pln,nxt,non},起跳种 host-only nonce cookie、回跳比对(防 login CSRF + 带回跳路径)。
  app.get('/auth/social/:provider', async (c) => {
    const provider = c.req.param('provider');
    const conf = cfg.socialProviders.find((p) => p.id === provider);
    if (!conf) return c.json({ detail: '未启用该登录方式' }, 404);
    const next = safeNext(c.req.query('next'));
    // link=1:把当前登录身份「连接」到已登录账号(sign-in-to-link)。须已登录,把目标 userId 签进 state。
    let link: string | undefined;
    if (c.req.query('link') === '1') {
      const sess = await readSession(c, cfg, plane);
      if (!sess) return c.redirect(`/auth/login?next=${encodeURIComponent(next)}`, 302);
      link = sess.sub;
    }
    const state = await stateEncode(cfg.secret, plane, next, setOauthNonce(c, cfg), link);
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
    let id: { sub: string; name?: string; email?: string; emailVerified?: boolean };
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
    const back = safeNext(typeof st.nxt === 'string' ? st.nxt : null);
    // link=1 流程:把此身份挂到 state 里签入的已登录账号,不新建/不换登录态,回跳带结果参数。
    if (typeof st.lnk === 'string' && st.lnk) {
      const result = await attachIdentity(deps, st.lnk, {
        provider,
        sub: id.sub,
        email: id.email,
        emailVerified: id.emailVerified,
      });
      const sep = back.includes('?') ? '&' : '?';
      const qp = result === 'ok' ? `linked=${encodeURIComponent(provider)}` : `link_error=${result}`;
      return c.redirect(`${back}${sep}${qp}`, 302);
    }
    // 普通登录:sub 带 provider 前缀(`google:…`/`github:…`),按 (provider, sub) 查 identities 解析账号;
    // **绝不**按 email 跨 provider 自动并号(见 upsertFederatedUser)。
    const user = await upsertFederatedUser(deps, {
      provider,
      sub: id.sub,
      name: id.name,
      email: id.email,
      emailVerified: id.emailVerified,
    });
    if (user.disabled) return c.json({ detail: '账号已被禁用' }, 403);
    await setLoginCookies(c, cfg, plane, user.id, user.handle, user.sessionEpoch);
    return c.redirect(back, 302);
  });

  app.post('/auth/logout', (c) => {
    clearLoginCookies(c, plane);
    return c.redirect('/', 302);
  });

  // 邮箱验证落地页:点邮件里的链接到这里。token 无状态(同会话密钥签),用途+签发时邮箱都比对,
  // 验证后把 users.emailVerified 与该账号 password identity 一并置真(幂等:已验证再点也无碍)。
  app.get('/auth/verify-email', async (c) => {
    const token = c.req.query('token') ?? '';
    const payload = token ? await readVerifyToken(cfg.secret, token) : null;
    const fail = (msg: string) =>
      c.html(
        gateDoc(
          'Verification failed · pagepin',
          `<div class="chip chip-amber">${LOCK_SVG}</div>
<h1>Link invalid or expired</h1>
<p class="body">${escapeHtml(msg)}</p>
<a class="btn btn-primary" href="${escapeHtml(consoleBase(cfg))}">Go to pagepin</a>`,
        ),
        400,
      );
    if (!payload) {
      return fail('This verification link is invalid or has expired. Sign in and resend it from Settings.');
    }
    const user = (await deps.db.select().from(users).where(eq(users.id, payload.uid)))[0];
    if (!user || user.canonicalEmail !== payload.eml) {
      return fail('This link no longer matches your account email.');
    }
    if (!user.emailVerified) {
      await deps.db.update(users).set({ emailVerified: true }).where(eq(users.id, user.id));
      await deps.db
        .update(identities)
        .set({ emailVerified: true })
        .where(and(eq(identities.userId, user.id), eq(identities.provider, 'password')));
    }
    // 验证就是「本账号自证掌握邮箱」—— 唯一安全的收编触发点。无条件调(重新点链接也能续跑未完成的合并)。
    await reconcileByVerifiedEmail(deps, user.canonicalEmail);
    return c.html(
      gateDoc(
        'Email verified · pagepin',
        `<div class="chip chip-teal">${LOCK_SVG}</div>
<h1>Email verified</h1>
<p class="body">Thanks — <span class="mono">${escapeHtml(user.email ?? payload.eml)}</span> is confirmed.</p>
<a class="btn btn-primary" href="${escapeHtml(consoleBase(cfg))}">Go to pagepin</a>`,
      ),
      200,
    );
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
    const inv = (await deps.db.select().from(invites).where(eq(invites.tokenHash, await sha256Hex(token))))[0];
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
    const inv = (await deps.db.select().from(invites).where(eq(invites.tokenHash, tokenHash)))[0];
    if (!inv || inv.acceptedAt !== null || Date.parse(inv.expiresAt) <= Date.now()) {
      return c.json({ detail: '邀请无效或已过期' }, 400);
    }
    const email = (inv.email ?? body.email ?? '').trim();
    if (!validEmail(email)) return c.json({ detail: '邮箱格式不正确' }, 422);
    const canonical = canonicalEmail(email);
    if (!canonical) return c.json({ detail: '邮箱格式不正确' }, 422);

    const passwordHash = await hashPassword(password);
    const now = nowIso();
    // 常见 dup 先拦(不消耗邀请)
    const dup = (await deps.db.select().from(users).where(eq(users.canonicalEmail, canonical)))[0];
    if (dup) return c.json({ detail: '该邮箱已注册' }, 409);
    // D1 无交互事务:① 先条件认领邀请(WHERE accepted_at IS NULL,RETURNING 检测命中=一次性语义),
    // ② 认领成功才建号,③ 建号失败则补偿释放邀请。跨进程安全,无需交互事务。
    const newUserId = uuid();
    const claimed = (await deps.db
      .update(invites)
      .set({ acceptedAt: now, acceptedUserId: newUserId })
      .where(and(eq(invites.id, inv.id), isNull(invites.acceptedAt)))
      .returning({ id: invites.id })
      )[0];
    if (!claimed) return c.json({ detail: '邀请已被使用' }, 400);
    let created: UserRow;
    try {
      created = (await deps.db
        .insert(users)
        .values({
          id: newUserId,
          email,
          canonicalEmail: canonical,
          passwordHash,
          displayName: displayName || null,
          isAdmin: inv.isAdmin,
          createdAt: now,
          lastLoginAt: now,
        })
        .returning()
        )[0]!;
    } catch (e) {
      // 建号失败(如并发同邮箱抢先)→ 释放本次认领,回错
      await deps.db
        .update(invites)
        .set({ acceptedAt: null, acceptedUserId: null })
        .where(and(eq(invites.id, inv.id), eq(invites.acceptedUserId, newUserId)));
      const exists = (await deps.db.select().from(users).where(eq(users.canonicalEmail, canonical)))[0];
      if (exists) return c.json({ detail: '该邮箱已注册' }, 409);
      throw e;
    }
    await ensurePasswordIdentity(deps, created.id, canonical, now);
    if (deps.mailer) {
      // 验证邮件尽力而为发送 —— 失败不阻断注册(邮箱保持未验证,用户可在设置里重发)
      try {
        await sendVerificationEmail(deps, created);
      } catch (e) {
        console.error('验证邮件发送失败(不阻断注册):', e);
      }
    }
    await setLoginCookies(c, cfg, plane, created.id, created.handle, created.sessionEpoch);
    return c.json({ ok: true });
  });

  return app;
}
