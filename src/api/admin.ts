/** /api/admin/* —— 实例管理(仅 isAdmin)。
 *
 * 守卫:mw.adminUser(读)/ mw.adminMutatingUser(写),均在认证后校验 isAdmin。
 * 不提供硬删用户(设计只做禁用/恢复);禁用即认证拒绝(deps.ts)。
 * 邀请 token 只存 sha256,明文在生成响应里展示一次。
 */

import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';

import { consoleBase } from '../config.js';
import {
  currentVersion,
  invites,
  sites,
  users,
  type InviteRow,
  type SiteRow,
  type UserRow,
} from '../db/index.js';
import {
  effectiveRegistrationMode,
  isRegistrationMode,
  registrationModeLocked,
  setRegistrationMode,
} from '../instance-settings.js';
import type { AppDeps, AppEnv } from '../types.js';
import { nowIso, uuid, validEmail } from '../util.js';
import type { AuthMiddleware } from './deps.js';

const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

function newInviteToken(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return 'inv_' + [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function readJson<T>(c: Context<AppEnv>): Promise<T | null> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return null;
  }
}

/** 各 owner 的站点数与占用字节(只读全表一次,管理列表 N 小,JS 内聚合)。 */
function ownerUsage(allSites: SiteRow[]): Map<string, { count: number; bytes: number }> {
  const m = new Map<string, { count: number; bytes: number }>();
  for (const s of allSites) {
    const cur = currentVersion(s);
    const e = m.get(s.ownerId) ?? { count: 0, bytes: 0 };
    e.count += 1;
    e.bytes += cur ? cur.total_bytes : 0;
    m.set(s.ownerId, e);
  }
  return m;
}

function userOut(u: UserRow, usage: { count: number; bytes: number }) {
  return {
    id: u.id,
    handle: u.handle,
    email: u.email,
    display_name: u.displayName,
    is_admin: u.isAdmin,
    disabled: u.disabled,
    created_at: u.createdAt,
    last_login_at: u.lastLoginAt,
    site_count: usage.count,
    storage_bytes: usage.bytes,
  };
}

function inviteOut(inv: InviteRow, nowMs: number) {
  return {
    id: inv.id,
    email: inv.email,
    is_admin: inv.isAdmin,
    created_at: inv.createdAt,
    expires_at: inv.expiresAt,
    accepted_at: inv.acceptedAt,
    expired: inv.acceptedAt === null && Date.parse(inv.expiresAt) <= nowMs,
  };
}

export function makeAdminRoutes(deps: AppDeps, mw: AuthMiddleware): Hono<AppEnv> {
  const { db, config: cfg } = deps;
  const r = new Hono<AppEnv>().basePath('/api/admin');

  // ---- 概览统计卡 ----
  r.get('/overview', mw.adminUser, async (c) => {
    const allSites = await db.select().from(sites).where(isNull(sites.deletedAt)).all();
    let storageBytes = 0;
    let versionCount = 0;
    for (const s of allSites) {
      const cur = currentVersion(s);
      storageBytes += cur ? cur.total_bytes : 0;
      versionCount += s.versions.length;
    }
    const userCount = (await db.select({ n: count() }).from(users).get())?.n ?? 0;
    const adminCount = (await db.select({ n: count() }).from(users).where(eq(users.isAdmin, true)).get())?.n ?? 0;
    return c.json({
      sites: allSites.length,
      users: userCount,
      admins: adminCount,
      storage_bytes: storageBytes,
      versions: versionCount,
    });
  });

  // ---- 用户列表(含每人站点数/占用) ----
  r.get('/users', mw.adminUser, async (c) => {
    const rows = await db.select().from(users).orderBy(desc(users.createdAt)).all();
    const allSites = await db.select().from(sites).where(isNull(sites.deletedAt)).all();
    const usage = ownerUsage(allSites);
    return c.json({
      users: rows.map((u) => userOut(u, usage.get(u.id) ?? { count: 0, bytes: 0 })),
    });
  });

  // ---- 改用户(设/撤管理员、禁用/恢复) ----
  r.patch('/users/:id', mw.adminMutatingUser, async (c) => {
    const body = await readJson<{ is_admin?: unknown; disabled?: unknown }>(c);
    if (body === null) return c.json({ detail: '请求体格式错误' }, 422);
    const hasAdmin = body.is_admin !== undefined;
    const hasDisabled = body.disabled !== undefined;
    if (!hasAdmin && !hasDisabled) return c.json({ detail: '需提供 is_admin 或 disabled' }, 422);
    if (hasAdmin && typeof body.is_admin !== 'boolean') return c.json({ detail: 'is_admin 必须是布尔值' }, 422);
    if (hasDisabled && typeof body.disabled !== 'boolean') return c.json({ detail: 'disabled 必须是布尔值' }, 422);

    const actor = c.get('user');
    const target = await db.select().from(users).where(eq(users.id, c.req.param('id'))).get();
    if (!target) return c.json({ detail: '用户不存在' }, 404);

    const resAdmin = hasAdmin ? (body.is_admin as boolean) : target.isAdmin;
    const resDisabled = hasDisabled ? (body.disabled as boolean) : target.disabled;

    // 不能禁用自己(会立刻杀掉自己的会话)
    if (target.id === actor.id && resDisabled && !target.disabled) {
      return c.json({ detail: '不能禁用自己' }, 400);
    }
    // 不能让实例失去最后一名「启用的管理员」
    const wasEnabledAdmin = target.isAdmin && !target.disabled;
    const willBeEnabledAdmin = resAdmin && !resDisabled;
    if (wasEnabledAdmin && !willBeEnabledAdmin) {
      const enabled = (await db
        .select({ n: count() })
        .from(users)
        .where(and(eq(users.isAdmin, true), eq(users.disabled, false)))
        .get())?.n ?? 0;
      if (enabled <= 1) return c.json({ detail: '至少保留一名启用的管理员' }, 400);
    }

    await db.update(users)
      .set({ isAdmin: resAdmin, disabled: resDisabled })
      .where(eq(users.id, target.id))
      .run();
    const allSites = await db.select().from(sites).where(isNull(sites.deletedAt)).all();
    const usage = ownerUsage(allSites).get(target.id) ?? { count: 0, bytes: 0 };
    return c.json(userOut({ ...target, isAdmin: resAdmin, disabled: resDisabled }, usage));
  });

  // ---- 实例设置:注册模式 ----
  r.get('/settings', mw.adminUser, async (c) =>
    c.json({
      auth_mode: cfg.authMode,
      registration_mode: await effectiveRegistrationMode(deps),
      registration_locked: registrationModeLocked(deps),
      limits: {
        max_file_mb: cfg.maxFileMb,
        max_site_mb: cfg.maxSiteMb,
        max_files: cfg.maxFiles,
        public_max_hours: cfg.publicMaxHours,
      },
    }),
  );

  r.patch('/settings', mw.adminMutatingUser, async (c) => {
    if (registrationModeLocked(deps)) {
      return c.json({ detail: '注册模式由环境变量锁定，不能在此修改' }, 400);
    }
    const body = await readJson<{ registration_mode?: unknown }>(c);
    if (!body || !isRegistrationMode(body.registration_mode)) {
      return c.json({ detail: 'registration_mode 只能是 open/invite/closed' }, 422);
    }
    await setRegistrationMode(deps, body.registration_mode);
    return c.json({ registration_mode: body.registration_mode });
  });

  // ---- 邀请 ----
  r.get('/invites', mw.adminUser, async (c) => {
    const rows = await db
      .select()
      .from(invites)
      .where(isNull(invites.acceptedAt))
      .orderBy(desc(invites.createdAt))
      .all();
    const nowMs = Date.now();
    return c.json({ invites: rows.map((inv) => inviteOut(inv, nowMs)) });
  });

  r.post('/invites', mw.adminMutatingUser, async (c) => {
    if (cfg.authMode !== 'password') {
      return c.json({ detail: '邀请注册仅在密码登录模式可用' }, 400);
    }
    if ((await effectiveRegistrationMode(deps)) === 'closed') {
      return c.json({ detail: '注册已关闭，无法签发邀请（先把注册模式切到 invite 或 open）' }, 400);
    }
    const body = await readJson<{ email?: unknown; is_admin?: unknown }>(c);
    let email: string | null = null;
    if (body && typeof body.email === 'string' && body.email.trim()) {
      email = body.email.trim();
      if (!validEmail(email)) return c.json({ detail: '邮箱格式不正确' }, 422);
    }
    const isAdmin = body?.is_admin === true;
    const raw = newInviteToken();
    const now = nowIso();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
    const inv: InviteRow = {
      id: uuid(),
      tokenHash: await sha256Hex(raw),
      email,
      isAdmin,
      createdBy: c.get('user').id,
      createdAt: now,
      expiresAt,
      acceptedAt: null,
      acceptedUserId: null,
    };
    await db.insert(invites).values(inv).run();
    return c.json({
      id: inv.id,
      token: raw, // 仅此一次返回明文
      url: `${consoleBase(cfg)}/signup?invite=${raw}`,
      email,
      is_admin: isAdmin,
      expires_at: expiresAt,
    });
  });

  r.delete('/invites/:id', mw.adminMutatingUser, async (c) => {
    const inv = await db.select().from(invites).where(eq(invites.id, c.req.param('id'))).get();
    if (!inv || inv.acceptedAt !== null) return c.json({ detail: '邀请不存在' }, 404);
    await db.delete(invites).where(eq(invites.id, inv.id)).run();
    return c.json({ ok: true });
  });

  return r;
}
