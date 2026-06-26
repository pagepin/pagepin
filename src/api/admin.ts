/** /api/admin/* —— 实例管理(仅 isAdmin)。
 *
 * 守卫:mw.adminUser(读)/ mw.adminMutatingUser(写),均在认证后校验 isAdmin。
 * 不提供硬删用户(设计只做禁用/恢复);禁用即认证拒绝(deps.ts)。
 * 邀请 token 只存 sha256,明文在生成响应里展示一次。
 */

import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';

import { consoleBase, siteUrl } from '../config.js';
import {
  currentVersion,
  identities,
  invites,
  sites,
  users,
  type InviteRow,
  type SiteRow,
  type UserRow,
} from '../db/index.js';
import { purgeSiteStorage } from '../storage/index.js';
import {
  effectiveRegistrationMode,
  isRegistrationMode,
  registrationModeLocked,
  setRegistrationMode,
} from '../instance-settings.js';
import type { AppDeps, AppEnv } from '../types.js';
import { nowIso, tombstoneSlug, uuid, validEmail } from '../util.js';
import type { AuthMiddleware } from './deps.js';
import { reconcileByVerifiedEmail } from '../auth/reconcile.js';

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
    email_verified: u.emailVerified,
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

function adminSiteOut(cfg: AppDeps['config'], s: SiteRow, owner: UserRow | undefined) {
  const cur = currentVersion(s);
  return {
    id: s.id,
    slug: s.slug,
    title: s.title,
    owner_id: s.ownerId,
    owner_handle: s.ownerHandle,
    owner_email: owner?.email ?? null,
    url: siteUrl(cfg, s.ownerHandle, s.slug),
    visibility: s.visibility,
    suspended: s.suspendedAt !== null,
    suspended_at: s.suspendedAt,
    suspended_reason: s.suspendedReason,
    file_count: cur ? cur.file_count : 0,
    total_bytes: cur ? cur.total_bytes : 0,
    version_count: s.versions.length,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  };
}

export function makeAdminRoutes(deps: AppDeps, mw: AuthMiddleware): Hono<AppEnv> {
  const { db, config: cfg, storage } = deps;
  const r = new Hono<AppEnv>().basePath('/api/admin');

  // ---- 概览统计卡 ----
  r.get('/overview', mw.adminUser, async (c) => {
    const allSites = await db.select().from(sites).where(isNull(sites.deletedAt));
    let storageBytes = 0;
    let versionCount = 0;
    for (const s of allSites) {
      const cur = currentVersion(s);
      storageBytes += cur ? cur.total_bytes : 0;
      versionCount += s.versions.length;
    }
    const userCount = ((await db.select({ n: count() }).from(users))[0])?.n ?? 0;
    const adminCount = ((await db.select({ n: count() }).from(users).where(eq(users.isAdmin, true)))[0])?.n ?? 0;
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
    const rows = await db.select().from(users).orderBy(desc(users.createdAt));
    const allSites = await db.select().from(sites).where(isNull(sites.deletedAt));
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
    const target = (await db.select().from(users).where(eq(users.id, c.req.param('id'))))[0];
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
      const enabled = ((await db
        .select({ n: count() })
        .from(users)
        .where(and(eq(users.isAdmin, true), eq(users.disabled, false)))
        )[0])?.n ?? 0;
      if (enabled <= 1) return c.json({ detail: '至少保留一名启用的管理员' }, 400);
    }

    await db.update(users)
      .set({ isAdmin: resAdmin, disabled: resDisabled })
      .where(eq(users.id, target.id));
    const allSites = await db.select().from(sites).where(isNull(sites.deletedAt));
    const usage = ownerUsage(allSites).get(target.id) ?? { count: 0, bytes: 0 };
    return c.json(userOut({ ...target, isAdmin: resAdmin, disabled: resDisabled }, usage));
  });

  /** 管理员手动标记某用户邮箱已验证 —— 救援:邮箱退信 / 死域 / GitHub noreply 等无法自助验证时,
   *  否则该账号会被门槛永久挡在「不能建站」之外。置 users.emailVerified + password 身份 verified。 */
  r.post('/users/:id/verify-email', mw.adminMutatingUser, async (c) => {
    const target = (await db.select().from(users).where(eq(users.id, c.req.param('id'))))[0];
    if (!target) return c.json({ detail: '用户不存在' }, 404);
    await db.update(users).set({ emailVerified: true }).where(eq(users.id, target.id));
    await db
      .update(identities)
      .set({ emailVerified: true })
      .where(and(eq(identities.userId, target.id), eq(identities.provider, 'password')));
    // 管理员手动验证也是可信的「掌握邮箱」证明 → 顺手收编同邮箱的空账号。
    await reconcileByVerifiedEmail(deps, target.canonicalEmail);
    return c.json({ ok: true });
  });

  // ---- 站点审核(列出全实例站点 / 下架 / 恢复 / 强删) ----
  // 下架=可逆,serving 返回 451;强删=软删 + 回收存储(尽力而为)。下架/强删均留审计线。
  r.get('/sites', mw.adminUser, async (c) => {
    const rows = await db
      .select()
      .from(sites)
      .where(isNull(sites.deletedAt))
      .orderBy(desc(sites.updatedAt));
    const us = await db.select().from(users);
    const umap = new Map(us.map((u) => [u.id, u]));
    return c.json({ sites: rows.map((s) => adminSiteOut(cfg, s, umap.get(s.ownerId))) });
  });

  /** id 定位未删站点;不存在返回 null(调用方回 404)。 */
  async function liveSite(id: string): Promise<SiteRow | null> {
    return (
      ((await db.select().from(sites).where(and(eq(sites.id, id), isNull(sites.deletedAt))))[0]) ??
      null
    );
  }

  async function siteOutById(c: Context<AppEnv>, id: string): Promise<Response> {
    const fresh = (await db
      .select()
      .from(sites)
      .where(and(eq(sites.id, id), isNull(sites.deletedAt)))
      )[0];
    if (!fresh) return c.json({ detail: '站点不存在' }, 404);
    const owner = (await db.select().from(users).where(eq(users.id, fresh.ownerId)))[0];
    return c.json(adminSiteOut(cfg, fresh, owner ?? undefined));
  }

  r.post('/sites/:id/suspend', mw.adminMutatingUser, async (c) => {
    const body = await readJson<{ reason?: unknown }>(c);
    const reason =
      body && typeof body.reason === 'string' && body.reason.trim()
        ? body.reason.trim().slice(0, 500)
        : null;
    const site = await liveSite(c.req.param('id'));
    if (!site) return c.json({ detail: '站点不存在' }, 404);
    const now = nowIso();
    // 已下架则保留首次下架时间,仅更新原因(幂等)
    await db
      .update(sites)
      .set({ suspendedAt: site.suspendedAt ?? now, suspendedReason: reason, updatedAt: now })
      .where(eq(sites.id, site.id));
    console.log(`admin-suspend site=${site.id} handle=${site.ownerHandle} slug=${site.slug} by=${c.get('user').id}`);
    return siteOutById(c, site.id);
  });

  r.post('/sites/:id/unsuspend', mw.adminMutatingUser, async (c) => {
    const site = await liveSite(c.req.param('id'));
    if (!site) return c.json({ detail: '站点不存在' }, 404);
    await db
      .update(sites)
      .set({ suspendedAt: null, suspendedReason: null, updatedAt: nowIso() })
      .where(eq(sites.id, site.id));
    console.log(`admin-unsuspend site=${site.id} handle=${site.ownerHandle} slug=${site.slug} by=${c.get('user').id}`);
    return siteOutById(c, site.id);
  });

  r.delete('/sites/:id', mw.adminMutatingUser, async (c) => {
    const site = await liveSite(c.req.param('id'));
    if (!site) return c.json({ detail: '站点不存在' }, 404);
    const now = nowIso();
    // 软删:slug 改墓碑名让出活命名空间(同 sites.ts 软删),普通唯一索引下同名 slug 可复用。
    await db
      .update(sites)
      .set({ deletedAt: now, updatedAt: now, slug: tombstoneSlug(site.slug, site.id) })
      .where(eq(sites.id, site.id));
    await purgeSiteStorage(storage, site.ownerId, site.slug);
    console.log(`admin-delete site=${site.id} handle=${site.ownerHandle} slug=${site.slug} by=${c.get('user').id}`);
    return c.json({ ok: true });
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
      .orderBy(desc(invites.createdAt));
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
    await db.insert(invites).values(inv);
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
    const inv = (await db.select().from(invites).where(eq(invites.id, c.req.param('id'))))[0];
    if (!inv || inv.acceptedAt !== null) return c.json({ detail: '邀请不存在' }, 404);
    await db.delete(invites).where(eq(invites.id, inv.id));
    return c.json({ ok: true });
  });

  return r;
}
