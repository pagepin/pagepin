/** 控制平面认证中间件。
 *
 * 浏览器走 pp_session Cookie + CSRF 双提交;AI/脚本走 PAT Bearer。
 * Bearer 头不可被跨站伪造(浏览器不会自动附带),天然无 CSRF 攻击面 → 跳过 CSRF 校验。
 * token 管理接口必须 Cookie 会话(token 不能造/吊销/查看 token,限制泄露半径)。
 * 数据平面完全不认 token(serving 不引用本模块)。
 */

import type { Context, MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import { and, eq, isNull } from 'drizzle-orm';

import { csrfOk, readSession } from '../auth/sessions.js';
import { apiTokens, identities, users } from '../db/index.js';
import type { UserRow } from '../db/index.js';
import type { AppDeps, AppEnv } from '../types.js';
import { nowIso } from '../util.js';

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 能否发布内容(claim handle / 建站 / 发 token)。判定 = 已验证邮箱,或持有 IdP 验证过的社交身份
 *  (社交账号天生过关)。豁免:dev 模式 / admin / 未配邮件的实例(否则把自托管单人实例锁死)。
 *  也用于 /api/me 的 can_publish 下发,与 requireVerified 同一判定。 */
export async function canPublish(deps: AppDeps, user: UserRow): Promise<boolean> {
  const { db, config: cfg } = deps;
  if (cfg.authMode === 'none' || user.isAdmin || user.emailVerified || !deps.mailer) return true;
  const ident = (await db
    .select({ id: identities.id })
    .from(identities)
    .where(and(eq(identities.userId, user.id), eq(identities.emailVerified, true)))
    )[0];
  return !!ident;
}

export interface AuthMiddleware {
  /** Cookie 会话或 PAT Bearer 任一即可(只读接口)。 */
  currentUser: MiddlewareHandler<AppEnv>;
  /** currentUser + Cookie 路径强制 CSRF 双提交(写接口)。 */
  mutatingUser: MiddlewareHandler<AppEnv>;
  /** 仅 Cookie 会话(token 管理读)。 */
  cookieUser: MiddlewareHandler<AppEnv>;
  /** 仅 Cookie 会话 + CSRF(token 管理写)。 */
  cookieMutatingUser: MiddlewareHandler<AppEnv>;
  /** currentUser + 管理员校验(admin 只读接口)。 */
  adminUser: MiddlewareHandler<AppEnv>;
  /** 仅 Cookie 会话 + CSRF + 管理员校验(admin 写接口;PAT 不能做管理动作,限制泄露半径)。 */
  adminMutatingUser: MiddlewareHandler<AppEnv>;
  /** 须先认证(链在某个 *User 之后):账号未验证邮箱 → 403,挡住未验证账号攒内容(handle/站点/token)。 */
  requireVerified: MiddlewareHandler<AppEnv>;
}

export function makeAuthMiddleware(deps: AppDeps): AuthMiddleware {
  const { db, config: cfg } = deps;

  async function tokenUser(c: Context<AppEnv>, token: string): Promise<Response | undefined> {
    if (!token.startsWith('pp_')) {
      return c.json({ detail: 'token 无效（应为 pp_ 开头的 PAT）' }, 401);
    }
    const h = await sha256Hex(token);
    const rec = (await db
      .select()
      .from(apiTokens)
      .where(and(eq(apiTokens.tokenHash, h), isNull(apiTokens.revokedAt)))
      )[0];
    if (!rec) return c.json({ detail: 'token 无效或已吊销' }, 401);
    if (rec.expiresAt && Date.parse(rec.expiresAt) <= Date.now()) {
      return c.json({ detail: 'token 已过期，请重新登录获取' }, 401);
    }
    const user = (await db.select().from(users).where(eq(users.id, rec.userId)))[0];
    if (!user) return c.json({ detail: 'token 对应用户不存在' }, 401);
    if (user.disabled) return c.json({ detail: '账号已被禁用' }, 403);
    c.set('authVia', 'token');
    // last_used_at 节流写(5 分钟粒度足够审计,省掉每请求一次写库)
    if (!rec.lastUsedAt || Date.now() - Date.parse(rec.lastUsedAt) > 300_000) {
      await db.update(apiTokens).set({ lastUsedAt: nowIso() }).where(eq(apiTokens.id, rec.id));
    }
    c.set('user', user);
    return undefined;
  }

  /** 认证主体:成功把 user/authVia(/sessionClaims) 放进 c,失败返回 401 Response。 */
  async function authenticate(c: Context<AppEnv>): Promise<Response | undefined> {
    const authz = c.req.header('authorization') ?? '';
    if (authz.startsWith('Bearer ')) {
      return tokenUser(c, authz.slice(7).trim());
    }
    const claims = await readSession(c, cfg, 'session');
    if (!claims) return c.json({ detail: '未登录' }, 401);
    const user = (await db.select().from(users).where(eq(users.id, claims.sub)))[0];
    if (!user) return c.json({ detail: '用户不存在，请重新登录' }, 401);
    if (user.disabled) return c.json({ detail: '账号已被禁用' }, 403);
    // sessionEpoch 比对:断开身份/禁用会 bump epoch,旧会话(epo 不匹配)即失效(?? 0 兼容旧 token)
    if ((claims.epo ?? 0) !== user.sessionEpoch) return c.json({ detail: '会话已失效，请重新登录' }, 401);
    c.set('sessionClaims', claims);
    c.set('authVia', 'cookie');
    c.set('user', user);
    return undefined;
  }

  /** Cookie 路径强制 CSRF;token 路径跳过。 */
  function csrfGuard(c: Context<AppEnv>): Response | undefined {
    if (c.get('authVia') === 'token') return undefined;
    const claims = c.get('sessionClaims');
    if (!claims || !csrfOk(c, claims)) return c.json({ detail: 'CSRF 校验失败' }, 403);
    return undefined;
  }

  function requireCookie(c: Context<AppEnv>): Response | undefined {
    if (c.get('authVia') !== 'cookie') {
      return c.json({ detail: '请在控制台浏览器里操作（API token 不能管理 token）' }, 403);
    }
    return undefined;
  }

  function requireAdmin(c: Context<AppEnv>): Response | undefined {
    if (!c.get('user').isAdmin) return c.json({ detail: '需要管理员权限' }, 403);
    return undefined;
  }

  const currentUser = createMiddleware<AppEnv>(async (c, next) => {
    const err = await authenticate(c);
    if (err) return err;
    await next();
  });

  const mutatingUser = createMiddleware<AppEnv>(async (c, next) => {
    const err = (await authenticate(c)) ?? csrfGuard(c);
    if (err) return err;
    await next();
  });

  const cookieUser = createMiddleware<AppEnv>(async (c, next) => {
    const err = (await authenticate(c)) ?? requireCookie(c);
    if (err) return err;
    await next();
  });

  // 校验顺序:先 CSRF(mutatingUser)再 requireCookie
  const cookieMutatingUser = createMiddleware<AppEnv>(async (c, next) => {
    const err = (await authenticate(c)) ?? csrfGuard(c) ?? requireCookie(c);
    if (err) return err;
    await next();
  });

  const adminUser = createMiddleware<AppEnv>(async (c, next) => {
    const err = (await authenticate(c)) ?? requireAdmin(c);
    if (err) return err;
    await next();
  });

  // admin 写接口强制浏览器 Cookie 会话:权能高(设/撤管理员、签发邀请),PAT 不得操作
  const adminMutatingUser = createMiddleware<AppEnv>(async (c, next) => {
    const err = (await authenticate(c)) ?? csrfGuard(c) ?? requireCookie(c) ?? requireAdmin(c);
    if (err) return err;
    await next();
  });

  // 须链在某个 *User 之后(读 c.get('user'));未验证账号(且无验证社交身份)拒创建内容。
  const requireVerified = createMiddleware<AppEnv>(async (c, next) => {
    if (!(await canPublish(deps, c.get('user')))) {
      return c.json({ detail: '请先验证邮箱后再创建内容', code: 'email_unverified' }, 403);
    }
    await next();
  });

  return {
    currentUser,
    mutatingUser,
    cookieUser,
    cookieMutatingUser,
    adminUser,
    adminMutatingUser,
    requireVerified,
  };
}
