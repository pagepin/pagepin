/** Admin bootstrap —— 配置了 PAGEPIN_ADMIN_EMAIL + PAGEPIN_ADMIN_PASSWORD 时确保 admin 账号存在。
 *
 * 两个入口共用同一套 upsert(存在则刷新密码哈希 + 确保 isAdmin;不存在则建号,
 * users_email_uq 唯一索引兜并发双建):
 *   Node(index.ts):启动无条件跑(进程内一次;重启即刷新)。
 *   Workers(worker.ts):首请求惰性跑(buildApp 每 isolate 一次)。guarded=true 时先用
 *     verifyPassword 比对已有账号 —— 密码与 admin 身份都没变就跳过(省一次写库)。
 *     ★ 不在库里另存任何密码派生标记:那会是一个比 scrypt 更易离线爆破的指纹。
 *
 * edge-safe:只用 scrypt(@noble/hashes)+ drizzle。 */

import { eq } from 'drizzle-orm';

import { identities, users, type UserRow } from '../db/index.js';
import type { AppDeps } from '../types.js';
import { canonicalEmail, nowIso, uuid } from '../util.js';
import { hashPassword, verifyPassword } from './password.js';

/** admin upsert:存在则刷新密码哈希并确保 isAdmin;不存在则建号。并发双建由 users_canonical_email_uq
 * 拦下,捕获后改 update。建号/认领后补登 password identity(账号统一模型;连接账号列表用)。
 * existing 由调用方预取(按 canonicalEmail);仅 insert 撞唯一索引时才二次 select。 */
async function upsertAdmin(
  deps: AppDeps,
  email: string,
  canonical: string,
  password: string,
  existing: UserRow | undefined,
): Promise<void> {
  const passwordHash = await hashPassword(password);
  if (existing) {
    await deps.db
      .update(users)
      .set({ passwordHash, isAdmin: true, canonicalEmail: existing.canonicalEmail ?? canonical })
      .where(eq(users.id, existing.id))
      .run();
    await ensureAdminPasswordIdentity(deps, existing.id, canonical);
    return;
  }
  const id = uuid();
  try {
    await deps.db
      .insert(users)
      .values({
        id,
        email,
        canonicalEmail: canonical,
        passwordHash,
        displayName: email.split('@')[0] || email,
        isAdmin: true,
        createdAt: nowIso(),
      })
      .run();
  } catch (e) {
    // 唯一索引兜并发同邮箱:落库失败后该 canonical 已存在 → 改 update;否则真异常上抛
    const now = await deps.db.select().from(users).where(eq(users.canonicalEmail, canonical)).get();
    if (!now) throw e;
    await deps.db.update(users).set({ passwordHash, isAdmin: true }).where(eq(users.id, now.id)).run();
    await ensureAdminPasswordIdentity(deps, now.id, canonical);
    return;
  }
  await ensureAdminPasswordIdentity(deps, id, canonical);
}

/** admin 账号的 password 身份(provider='password', sub=canonicalEmail);唯一索引兜并发,已存在即忽略。 */
async function ensureAdminPasswordIdentity(
  deps: AppDeps, userId: string, canonical: string,
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
        createdAt: nowIso(),
      })
      .run();
  } catch {
    /* 已存在 → 忽略 */
  }
}

/** 确保 admin 存在。返回是否实际跑了 upsert(供入口打日志)。
 * guarded=true(Workers 冷启):账号已是 admin 且配置密码与库内哈希吻合 → 跳过,不重复 scrypt+写库。 */
export async function bootstrapAdmin(
  deps: AppDeps,
  opts: { guarded?: boolean } = {},
): Promise<boolean> {
  const cfg = deps.config;
  if (!cfg.adminEmail || !cfg.adminPassword) return false;
  const email = cfg.adminEmail;
  const canonical = canonicalEmail(email);
  if (!canonical) return false; // admin 邮箱配置无效
  const password = cfg.adminPassword;
  const existing = await deps.db.select().from(users).where(eq(users.canonicalEmail, canonical)).get();
  if (
    opts.guarded &&
    existing &&
    existing.isAdmin &&
    existing.passwordHash &&
    (await verifyPassword(password, existing.passwordHash))
  ) {
    return false; // 已就绪、密码未变:跳过
  }
  await upsertAdmin(deps, email, canonical, password, existing);
  return true;
}
