/** /api/me —— 当前用户信息与 handle 首登确认。
 *
 * handle 是分享 URL 的用户段,一经确认不可改 —— 改名会打断已分享链接。
 */

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';

import { contentBase } from '../config.js';
import { setLoginCookies } from '../auth/sessions.js';
import { users } from '../db/index.js';
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

  const handleTaken = (handle: string): boolean =>
    db.select({ id: users.id }).from(users).where(eq(users.handle, handle)).get() !== undefined;

  app.get('/api/me', mw.currentUser, (c) => {
    const user = c.get('user');
    return c.json({
      sub: user.id,
      handle: user.handle,
      display_name: user.displayName,
      email: user.email,
      needs_handle: user.handle === null,
      content_base: contentBase(cfg),
      limits: {
        max_file_mb: cfg.maxFileMb,
        max_site_mb: cfg.maxSiteMb,
        max_files: cfg.maxFiles,
        public_max_hours: cfg.publicMaxHours,
      },
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
    if (handleTaken(handle)) return c.json({ detail: 'handle 已被占用' }, 409);
    db.update(users).set({ handle }).where(eq(users.id, user.id)).run();
    // handle 进了会话 JWT —— 旧 Cookie 里 hdl=null,刷新一份
    await setLoginCookies(c, cfg, 'session', user.id, handle);
    return c.json({ handle });
  });

  app.post('/api/me/handle/check', mw.currentUser, async (c) => {
    const raw = await readHandleField(c);
    if (raw === null) return c.json({ detail: '请求体需包含 handle 字段' }, 422);
    const handle = raw.trim().toLowerCase();
    if (!validHandle(handle)) return c.json({ ok: false, reason: '格式不合法或为保留字' });
    const taken = handleTaken(handle);
    return c.json({ ok: !taken, reason: taken ? '已被占用' : null });
  });

  /** 从邮箱/姓名推一个默认 handle 建议(可能为空,前端兜底让用户自己输)。 */
  app.post('/api/me/handle/suggest', mw.currentUser, (c) => {
    const user = c.get('user');
    const cands: string[] = [];
    if (user.email && user.email.includes('@')) cands.push(user.email.split('@')[0]!);
    if (user.displayName) cands.push(user.displayName);
    for (const cand of cands) {
      const h = cand.toLowerCase().replace(/[_.]/g, '-').replace(/[^a-z0-9-]/g, '');
      if (validHandle(h) && !handleTaken(h)) return c.json({ suggestion: h });
    }
    return c.json({ suggestion: null });
  });

  return app;
}
