/** /api/me —— 当前用户信息与 handle 首登确认。
 *
 * handle 是分享 URL 的用户段,一经确认不可改 —— 改名会打断已分享链接。
 */

import { and, count, eq, inArray, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';

import { contentBase } from '../config.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { setLoginCookies } from '../auth/sessions.js';
import { apiTokens, commentThreads, currentVersion, sites, users } from '../db/index.js';
import type { AppDeps, AppEnv } from '../types.js';
import { validHandle } from '../util.js';

/** makeAuthMiddleware(deps) 的产出形状(结构匹配 api/deps.ts,集成时对齐)。 */
export interface AuthMw {
  currentUser: MiddlewareHandler<AppEnv>;
  mutatingUser: MiddlewareHandler<AppEnv>;
  cookieUser: MiddlewareHandler<AppEnv>;
  cookieMutatingUser: MiddlewareHandler<AppEnv>;
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
    (await db.select({ id: users.id }).from(users).where(eq(users.handle, handle)).get()) !==
    undefined;

  const limitsJson = () => ({
    max_file_mb: cfg.maxFileMb,
    max_site_mb: cfg.maxSiteMb,
    max_files: cfg.maxFiles,
    keep_versions: cfg.keepVersions,
    public_max_hours: cfg.publicMaxHours,
  });

  app.get('/api/me', mw.currentUser, (c) => {
    const user = c.get('user');
    return c.json({
      sub: user.id,
      handle: user.handle,
      display_name: user.displayName,
      email: user.email,
      is_admin: user.isAdmin,
      auth_mode: cfg.authMode,
      needs_handle: user.handle === null,
      content_base: contentBase(cfg),
      limits: limitsJson(),
    });
  });

  /** 改显示名(仅本控制台展示用;handle/email 不可经此改)。仅 Cookie 会话,PAT 不改资料。 */
  app.patch('/api/me', mw.cookieMutatingUser, async (c) => {
    const raw = (await c.req.json().catch(() => null)) as unknown;
    if (typeof raw !== 'object' || raw === null || !('display_name' in raw)) {
      return c.json({ detail: '请求体需包含 display_name 字段' }, 422);
    }
    const v = (raw as Record<string, unknown>).display_name;
    let displayName: string | null;
    if (v === null) displayName = null;
    else if (typeof v === 'string') {
      const t = v.trim();
      if (t.length > 64) return c.json({ detail: '显示名最多 64 字' }, 422);
      displayName = t || null;
    } else return c.json({ detail: 'display_name 必须是字符串或 null' }, 422);
    const user = c.get('user');
    await db.update(users).set({ displayName }).where(eq(users.id, user.id)).run();
    return c.json({ display_name: displayName });
  });

  /** 改密码 —— 仅 password 模式 + 本地有密码;校验旧密码,新密码 ≥8 位。
   * 仅 Cookie 会话可调(PAT 不能改密);会话是无状态 JWT,改密后旧会话仍有效至 TTL 过期。 */
  app.post('/api/me/password', mw.cookieMutatingUser, async (c) => {
    if (cfg.authMode !== 'password') {
      return c.json({ detail: '当前实例未启用密码登录，无法改密' }, 400);
    }
    const user = c.get('user');
    if (!user.passwordHash) {
      return c.json({ detail: '当前账号没有本地密码（OIDC 登录）' }, 400);
    }
    const raw = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const cur = raw?.current_password;
    const next = raw?.new_password;
    if (typeof cur !== 'string' || typeof next !== 'string') {
      return c.json({ detail: '需 current_password 与 new_password' }, 422);
    }
    if (next.length < 8) return c.json({ detail: '新密码至少 8 位' }, 422);
    if (!(await verifyPassword(cur, user.passwordHash))) {
      return c.json({ detail: '当前密码不正确' }, 403);
    }
    const passwordHash = await hashPassword(next);
    await db.update(users).set({ passwordHash }).where(eq(users.id, user.id)).run();
    return c.json({ ok: true });
  });

  /** 本人用量聚合(Account & Settings 的 Usage 区)。 */
  app.get('/api/me/usage', mw.currentUser, async (c) => {
    const user = c.get('user');
    const rows = await db
      .select()
      .from(sites)
      .where(and(eq(sites.ownerId, user.id), isNull(sites.deletedAt)))
      .all();
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
    const tok = await db
      .select({ n: count() })
      .from(apiTokens)
      .where(and(eq(apiTokens.userId, user.id), isNull(apiTokens.revokedAt)))
      .get();
    let unresolved = 0;
    if (rows.length > 0) {
      const r = await db
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
        .get();
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

  /** 首登确认 handle。一经确认不可改。 */
  app.post('/api/me/handle', mw.mutatingUser, async (c) => {
    const raw = await readHandleField(c);
    if (raw === null) return c.json({ detail: '请求体需包含 handle 字段' }, 422);
    const user = c.get('user');
    if (user.handle !== null) return c.json({ detail: 'handle 已设置，不可修改' }, 409);
    const handle = raw.trim().toLowerCase();
    if (!validHandle(handle)) {
      return c.json({ detail: 'handle 需 2-32 位小写字母/数字/中划线、字母开头，且不在保留字内' }, 422);
    }
    if (await handleTaken(handle)) return c.json({ detail: 'handle 已被占用' }, 409);
    await db.update(users).set({ handle }).where(eq(users.id, user.id)).run();
    // handle 进了会话 JWT —— 旧 Cookie 里 hdl=null,刷新一份
    await setLoginCookies(c, cfg, 'session', user.id, handle);
    return c.json({ handle });
  });

  app.post('/api/me/handle/check', mw.currentUser, async (c) => {
    const raw = await readHandleField(c);
    if (raw === null) return c.json({ detail: '请求体需包含 handle 字段' }, 422);
    const handle = raw.trim().toLowerCase();
    if (!validHandle(handle)) return c.json({ ok: false, reason: '格式不合法或为保留字' });
    const taken = await handleTaken(handle);
    return c.json({ ok: !taken, reason: taken ? '已被占用' : null });
  });

  /** 从邮箱/姓名推一个默认 handle 建议(可能为空,前端兜底让用户自己输)。 */
  app.post('/api/me/handle/suggest', mw.currentUser, async (c) => {
    const user = c.get('user');
    const cands: string[] = [];
    if (user.email && user.email.includes('@')) cands.push(user.email.split('@')[0]!);
    if (user.displayName) cands.push(user.displayName);
    for (const cand of cands) {
      const h = cand.toLowerCase().replace(/[_.]/g, '-').replace(/[^a-z0-9-]/g, '');
      if (validHandle(h) && !(await handleTaken(h))) return c.json({ suggestion: h });
    }
    return c.json({ suggestion: null });
  });

  return app;
}
