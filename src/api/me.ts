/** /api/me —— 当前用户信息与 handle 首登确认。
 *
 * handle 是分享 URL 的用户段,一经确认不可改 —— 改名会打断已分享链接。
 */

import { and, count, eq, inArray, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';

import { contentBase } from '../config.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { sendVerificationEmail } from '../mail/verify.js';
import { canPublish } from './deps.js';
import { jsonError, localeOf } from '../i18n/locale.js';
import { setLoginCookies } from '../auth/sessions.js';
import {
  apiTokens,
  commentThreads,
  currentVersion,
  identities,
  sites,
  users,
} from '../db/index.js';
import type { AppDeps, AppEnv } from '../types.js';
import { validHandle } from '../util.js';

/** makeAuthMiddleware(deps) 的产出形状(结构匹配 api/deps.ts,集成时对齐)。 */
export interface AuthMw {
  currentUser: MiddlewareHandler<AppEnv>;
  mutatingUser: MiddlewareHandler<AppEnv>;
  cookieUser: MiddlewareHandler<AppEnv>;
  cookieMutatingUser: MiddlewareHandler<AppEnv>;
  requireVerified: MiddlewareHandler<AppEnv>;
}

/** 读 JSON body 里的 handle 字段;缺失/非法 JSON/非字符串 → null(对应 pydantic 422)。 */
async function readHandleField(c: Context<AppEnv>): Promise<string | null> {
  try {
    const body = (await c.req.json()) as unknown;
    if (typeof body === 'object' && body !== null) {
      const h = (body as Record<string, unknown>).handle;
      if (typeof h === 'string') return h;
    }
    return null;
  } catch {
    return null;
  }
}

export function makeMeRoutes(deps: AppDeps, mw: AuthMw): Hono<AppEnv> {
  const { config: cfg, db } = deps;
  const app = new Hono<AppEnv>();

  const handleTaken = async (handle: string): Promise<boolean> =>
    (await db.select({ id: users.id }).from(users).where(eq(users.handle, handle)))[0] !==
    undefined;

  const limitsJson = () => ({
    max_file_mb: cfg.maxFileMb,
    max_site_mb: cfg.maxSiteMb,
    max_files: cfg.maxFiles,
    free_user_mb: cfg.freeUserMb, // 每用户总存储配额(MB);0 = 不限。部署超配额回 413
    keep_versions: cfg.keepVersions,
    public_max_hours: cfg.publicMaxHours,
  });

  app.get('/api/me', mw.currentUser, async (c) => {
    const user = c.get('user');
    return c.json({
      sub: user.id,
      handle: user.handle,
      display_name: user.displayName,
      email: user.email,
      email_verified: user.emailVerified,
      has_password: !!user.passwordHash,
      is_admin: user.isAdmin,
      auth_mode: cfg.authMode,
      social_providers: cfg.socialProviders.map((p) => p.id), // 设置页据此渲染「连接账号」按钮
      mail_enabled: !!deps.mailer, // 配了邮件才显示「验证邮箱」入口
      can_publish: await canPublish(deps, user), // false → 前端把 claim handle/建站 引导去验证邮箱
      needs_handle: user.handle === null,
      content_base: contentBase(cfg),
      limits: limitsJson(),
    });
  });

  /** 改显示名(仅本控制台展示用;handle/email 不可经此改)。仅 Cookie 会话,PAT 不改资料。 */
  app.patch('/api/me', mw.cookieMutatingUser, async (c) => {
    const raw = (await c.req.json().catch(() => null)) as unknown;
    if (typeof raw !== 'object' || raw === null || !('display_name' in raw)) {
      return jsonError(c, 422, 'me.body.fieldRequired', { field: 'display_name' });
    }
    const v = (raw as Record<string, unknown>).display_name;
    let displayName: string | null;
    if (v === null) displayName = null;
    else if (typeof v === 'string') {
      const t = v.trim();
      if (t.length > 64) return jsonError(c, 422, 'me.displayName.tooLong');
      displayName = t || null;
    } else return jsonError(c, 422, 'me.displayName.invalidType');
    const user = c.get('user');
    await db.update(users).set({ displayName }).where(eq(users.id, user.id));
    return c.json({ display_name: displayName });
  });

  /** 改密码 —— 仅 password 模式 + 本地有密码;校验旧密码,新密码 ≥8 位。
   * 仅 Cookie 会话可调(PAT 不能改密);会话是无状态 JWT,改密后旧会话仍有效至 TTL 过期。 */
  app.post('/api/me/password', mw.cookieMutatingUser, async (c) => {
    if (cfg.authMode !== 'password') {
      return jsonError(c, 400, 'me.password.disabled');
    }
    const user = c.get('user');
    if (!user.passwordHash) {
      return jsonError(c, 400, 'me.password.noLocal');
    }
    const raw = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const cur = raw?.current_password;
    const next = raw?.new_password;
    if (typeof cur !== 'string' || typeof next !== 'string') {
      return jsonError(c, 422, 'me.password.fieldsRequired');
    }
    if (next.length < 8) return jsonError(c, 422, 'me.password.tooShort');
    if (!(await verifyPassword(cur, user.passwordHash))) {
      return jsonError(c, 403, 'me.password.currentIncorrect');
    }
    const passwordHash = await hashPassword(next);
    await db.update(users).set({ passwordHash }).where(eq(users.id, user.id));
    return c.json({ ok: true });
  });

  /** 已连接的登录身份(password / google / github)。Account & Settings 的「连接账号」区。 */
  app.get('/api/me/identities', mw.currentUser, async (c) => {
    const user = c.get('user');
    const rows = await db.select().from(identities).where(eq(identities.userId, user.id));
    return c.json({
      identities: rows
        .map((r) => ({
          id: r.id,
          provider: r.provider,
          email: r.email,
          email_verified: r.emailVerified,
          created_at: r.createdAt,
          last_login_at: r.lastLoginAt,
        }))
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    });
  });

  /** 断开一个登录身份。不能断开最后一个(否则锁死账号);断开 password 同时清掉本地密码。
   *  断开后 bump session_epoch 使其它会话失效,并给当前会话重发 Cookie(当前会话不掉线)。
   *  仅 Cookie 会话可调(PAT 不管身份,限制泄露半径)。 */
  app.delete('/api/me/identities/:id', mw.cookieMutatingUser, async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const rows = await db.select().from(identities).where(eq(identities.userId, user.id));
    const target = rows.find((r) => r.id === id);
    if (!target) return jsonError(c, 404, 'me.identity.notFound');
    // 邮箱密码是账号的主登录方式 / 锚点,不可断开(断了没有重设入口,且 canonicalEmail 挂在它上)。
    // 只允许断开社交方式。
    if (target.provider === 'password')
      return jsonError(c, 409, 'me.identity.passwordUndetachable');
    if (rows.length <= 1) return jsonError(c, 409, 'me.identity.lastOne');
    await db.delete(identities).where(and(eq(identities.id, id), eq(identities.userId, user.id)));
    const newEpoch = user.sessionEpoch + 1; // 使其它会话(旧 epo)失效
    await db.update(users).set({ sessionEpoch: newEpoch }).where(eq(users.id, user.id));
    await setLoginCookies(c, cfg, 'session', user.id, user.handle, newEpoch); // 当前会话重发新 epo
    return c.json({ ok: true });
  });

  /** 重发邮箱验证信(password 账号、邮箱未验证、实例配了邮件时)。仅 Cookie 会话。
   *  sent=false:无需验证 / 已验证 / 未配邮件 —— 都按成功返回,前端据此提示。 */
  app.post('/api/me/verify-email/resend', mw.cookieMutatingUser, async (c) => {
    const user = c.get('user');
    if (cfg.authMode !== 'password' || !user.passwordHash) {
      return jsonError(c, 400, 'me.verifyEmail.notRequired');
    }
    if (user.emailVerified || !deps.mailer || !user.canonicalEmail) {
      return c.json({ ok: true, sent: false });
    }
    try {
      const sent = await sendVerificationEmail(deps, user, localeOf(c));
      return c.json({ ok: true, sent });
    } catch (e) {
      console.error('重发验证邮件失败:', e);
      return jsonError(c, 502, 'me.verifyEmail.sendFailed');
    }
  });

  /** 本人用量聚合(Account & Settings 的 Usage 区)。 */
  app.get('/api/me/usage', mw.currentUser, async (c) => {
    const user = c.get('user');
    const rows = await db
      .select()
      .from(sites)
      .where(and(eq(sites.ownerId, user.id), isNull(sites.deletedAt)));
    let storageBytes = 0;
    let files = 0;
    let versions = 0;
    const perSite = rows.map((s) => {
      const cur = currentVersion(s);
      const bytes = cur ? cur.total_bytes : 0;
      const fc = cur ? cur.file_count : 0;
      storageBytes += bytes;
      files += fc;
      versions += s.versions.length;
      return { slug: s.slug, total_bytes: bytes, file_count: fc };
    });
    perSite.sort((a, b) => b.total_bytes - a.total_bytes);
    const tok = (
      await db
        .select({ n: count() })
        .from(apiTokens)
        .where(and(eq(apiTokens.userId, user.id), isNull(apiTokens.revokedAt)))
    )[0];
    let unresolved = 0;
    if (rows.length > 0) {
      const r = (
        await db
          .select({ n: count() })
          .from(commentThreads)
          .where(
            and(
              inArray(
                commentThreads.siteId,
                rows.map((x) => x.id),
              ),
              eq(commentThreads.resolved, false),
              isNull(commentThreads.deletedAt),
            ),
          )
      )[0];
      unresolved = r?.n ?? 0;
    }
    return c.json({
      sites: rows.length,
      storage_bytes: storageBytes,
      files,
      versions,
      tokens: tok?.n ?? 0,
      unresolved_comments: unresolved,
      limits: limitsJson(),
      per_site: perSite,
    });
  });

  /** 首登确认 handle。一经确认不可改。须先验证邮箱(handle 是不可变 URL 前缀,不让未验证账号占)。 */
  app.post('/api/me/handle', mw.mutatingUser, mw.requireVerified, async (c) => {
    const raw = await readHandleField(c);
    if (raw === null) return jsonError(c, 422, 'me.body.fieldRequired', { field: 'handle' });
    const user = c.get('user');
    if (user.handle !== null) return jsonError(c, 409, 'me.handle.alreadySet');
    const handle = raw.trim().toLowerCase();
    if (!validHandle(handle)) {
      return jsonError(c, 422, 'me.handle.invalid');
    }
    if (await handleTaken(handle)) return jsonError(c, 409, 'me.handle.taken');
    await db.update(users).set({ handle }).where(eq(users.id, user.id));
    // handle 进了会话 JWT —— 旧 Cookie 里 hdl=null,刷新一份
    await setLoginCookies(c, cfg, 'session', user.id, handle, user.sessionEpoch);
    return c.json({ handle });
  });

  app.post('/api/me/handle/check', mw.currentUser, async (c) => {
    const raw = await readHandleField(c);
    if (raw === null) return jsonError(c, 422, 'me.body.fieldRequired', { field: 'handle' });
    const handle = raw.trim().toLowerCase();
    // reason 返回稳定 code(invalid / taken),由前端按 locale 翻译 —— 不在内部 API 里塞本地化字符串。
    if (!validHandle(handle)) return c.json({ ok: false, reason: 'invalid' });
    const taken = await handleTaken(handle);
    return c.json({ ok: !taken, reason: taken ? 'taken' : null });
  });

  /** 从邮箱/姓名推一个默认 handle 建议(可能为空,前端兜底让用户自己输)。
   *  GET/POST 双收:纯读操作,且早期文档写过 GET —— 已缓存旧文档的 agent 也能自愈。 */
  app.on(['GET', 'POST'], '/api/me/handle/suggest', mw.currentUser, async (c) => {
    const user = c.get('user');
    const cands: string[] = [];
    if (user.email && user.email.includes('@')) cands.push(user.email.split('@')[0]!);
    if (user.displayName) cands.push(user.displayName);
    for (const cand of cands) {
      const h = cand
        .toLowerCase()
        .replace(/[_.]/g, '-')
        .replace(/[^a-z0-9-]/g, '');
      if (validHandle(h) && !(await handleTaken(h))) return c.json({ suggestion: h });
    }
    return c.json({ suggestion: null });
  });

  return app;
}
