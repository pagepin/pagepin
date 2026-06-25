/** 同邮箱账号收编(reconcile)—— 把「因当时本账号未验证而被迫独立」的【空】账号,在邮箱被验证后
 *  自动并入【有内容】的那个幸存账号。edge-safe、D1 无事务:全是幂等的条件 UPDATE + account_merges 闩锁。
 *
 * 安全红线(评审 CRITICAL):**只能由「点验证信 / 管理员手动验证」触发**(本账号自证掌握邮箱),
 *   绝不由社交登录的 IdP 断言触发。**只吸收空账号**(无 handle、无站点);有内容的账号永远只当幸存者,
 *   两边都有内容 → 记 conflict、不自动合并(两个 handle 都在 URL 里,只能人工双向确认)。
 */

import { and, eq, isNull, or } from 'drizzle-orm';

import {
  accountMerges,
  apiTokens,
  deploySessions,
  deviceAuths,
  identities,
  sites,
  users,
  type UserRow,
} from '../db/index.js';
import type { AppDeps } from '../types.js';
import { nowIso, uuid } from '../util.js';

interface Candidate extends UserRow {
  hasContent: boolean;
}

/** 幸存者选择 —— 纯函数,只看不可变/单调字段(绝不看会随并发漂移的计数,否则两次可选反 → 互相禁用)。
 *  顺序:有内容 > 无内容;有 handle > 无;占着 canonical 槽 > 没占;id 最小。调用前已保证至多 1 个有内容。 */
export function pickSurvivor(cands: Candidate[], email: string): Candidate {
  return [...cands].sort((a, b) => {
    if (a.hasContent !== b.hasContent) return a.hasContent ? -1 : 1;
    const ah = a.handle != null, bh = b.handle != null;
    if (ah !== bh) return ah ? -1 : 1;
    const ac = a.canonicalEmail === email, bc = b.canonicalEmail === email;
    if (ac !== bc) return ac ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  })[0]!;
}

async function hasContent(deps: AppDeps, userId: string, handle: string | null): Promise<boolean> {
  if (handle != null) return true;
  const site = await deps.db
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.ownerId, userId), isNull(sites.deletedAt)))
    .get();
  return !!site;
}

/** 把一个【空】loser 并入 survivor —— 幂等、可恢复的固定步骤序列(account_merges 作闩锁)。 */
async function reconcileOne(deps: AppDeps, survivor: UserRow, loser: UserRow, email: string): Promise<void> {
  const { db } = deps;
  if (survivor.id === loser.id) return;
  const now = nowIso();

  // 闩锁:loser_id 唯一。已有不同 survivor 的闩 → 退避(防对向并发把两个都禁用);已 done → 结束。
  try {
    await db
      .insert(accountMerges)
      .values({ id: uuid(), loserId: loser.id, survivorId: survivor.id, emailKey: email, status: 'moving', createdAt: now })
      .run();
  } catch {
    const ex = await db.select().from(accountMerges).where(eq(accountMerges.loserId, loser.id)).get();
    if (!ex) return;
    if (ex.survivorId !== survivor.id || ex.status === 'done' || ex.status === 'conflict') return;
  }

  // 先保管理员位(并到 survivor)再禁 loser,实例永不丢最后一个 admin。
  if (loser.isAdmin) await db.update(users).set({ isAdmin: true }).where(eq(users.id, survivor.id)).run();

  // 杀掉 loser:disabled 是 PAT 鉴权唯一看的开关(deps.ts),故先 disabled + 吊销 token 才真正停掉它的 CLI。
  await db.update(users).set({ disabled: true, sessionEpoch: loser.sessionEpoch + 1 }).where(eq(users.id, loser.id)).run();
  await db.update(apiTokens).set({ revokedAt: now }).where(and(eq(apiTokens.userId, loser.id), isNull(apiTokens.revokedAt))).run();

  // 禁用后复查 loser 仍为空(防极小窗口内 loser 抢着发了内容)。若有内容 → 解禁 + 记 conflict,不破坏数据。
  if (await hasContent(deps, loser.id, loser.handle)) {
    await db.update(users).set({ disabled: false }).where(eq(users.id, loser.id)).run();
    await db.update(accountMerges).set({ status: 'conflict' }).where(eq(accountMerges.loserId, loser.id)).run();
    return;
  }

  // 搬身份(provider,sub 全局唯一,重指不冲突);survivor 没密码而 loser 有 → 带过去(保留密码登录)。
  await db.update(identities).set({ userId: survivor.id }).where(eq(identities.userId, loser.id)).run();
  if (!survivor.passwordHash && loser.passwordHash) {
    await db
      .update(users)
      .set({ passwordHash: loser.passwordHash })
      .where(and(eq(users.id, survivor.id), isNull(users.passwordHash)))
      .run();
  }

  // 搬站点/草稿/设备授权/token(loser 为空 → 站点 0 行;写成通用形以兼容历史数据)。
  await db.update(sites).set({ ownerId: survivor.id, ownerHandle: survivor.handle ?? '' }).where(eq(sites.ownerId, loser.id)).run();
  await db.update(apiTokens).set({ userId: survivor.id }).where(eq(apiTokens.userId, loser.id)).run();
  await db.update(deploySessions).set({ ownerId: survivor.id }).where(eq(deploySessions.ownerId, loser.id)).run();
  await db.update(deviceAuths).set({ userId: survivor.id }).where(eq(deviceAuths.userId, loser.id)).run();

  // canonical 槽:先腾空 loser(若它占着),再让 survivor 认领(部分唯一索引保证只一个 owner;email 取自触发参数不依赖 loser 行)。
  await db.update(users).set({ canonicalEmail: null, oidcSub: null }).where(eq(users.id, loser.id)).run();
  await db
    .update(users)
    .set({ canonicalEmail: email, emailVerified: true, email: survivor.email ?? loser.email ?? email })
    .where(and(eq(users.id, survivor.id), or(isNull(users.canonicalEmail), eq(users.canonicalEmail, email))))
    .run();

  await db.update(accountMerges).set({ status: 'done', finishedAt: nowIso() }).where(eq(accountMerges.loserId, loser.id)).run();
}

/** 邮箱(canonical)刚被验证后调用:找出同邮箱、已证明掌握该邮箱的账号,空账号并入有内容的幸存者。
 *  ≤1 个候选 → no-op;≥2 个有内容 → 记 conflict(人工);否则空账号逐个 reconcileOne。 */
export async function reconcileByVerifiedEmail(deps: AppDeps, email: string | null | undefined): Promise<void> {
  if (!email) return;
  const { db } = deps;

  // 候选 = 占着 canonical 槽且已验证 的账号,∪ 持有该邮箱 verified 身份 的账号。
  const byCanon = await db.select().from(users).where(and(eq(users.canonicalEmail, email), eq(users.emailVerified, true))).all();
  const identRows = await db.select({ userId: identities.userId }).from(identities).where(and(eq(identities.email, email), eq(identities.emailVerified, true))).all();
  const ids = new Set<string>([...byCanon.map((u) => u.id), ...identRows.map((r) => r.userId)]);
  if (ids.size <= 1) return;

  const rows = (
    await Promise.all([...ids].map((id) => db.select().from(users).where(eq(users.id, id)).get()))
  ).filter((u): u is UserRow => !!u && !u.disabled);
  if (rows.length <= 1) return;

  const cands: Candidate[] = await Promise.all(
    rows.map(async (u) => ({ ...u, hasContent: await hasContent(deps, u.id, u.handle) })),
  );

  // 两边都有内容(两个 handle 都在 URL 里)→ 绝不自动合并,记 conflict 等人工双向确认。
  if (cands.filter((c) => c.hasContent).length >= 2) {
    const sorted = [...cands].sort((a, b) => (a.id < b.id ? -1 : 1));
    const survivor = sorted[0]!;
    for (const loser of sorted.slice(1)) {
      try {
        await db
          .insert(accountMerges)
          .values({ id: uuid(), loserId: loser.id, survivorId: survivor.id, emailKey: email, status: 'conflict', createdAt: nowIso() })
          .run();
      } catch {
        /* 已有闩锁,忽略 */
      }
    }
    return;
  }

  const survivor = pickSurvivor(cands, email);
  for (const loser of cands) {
    if (loser.id === survivor.id || loser.hasContent) continue; // 只吸收空账号
    await reconcileOne(deps, survivor, loser, email);
  }
}

/** 恢复扫描:完成任何卡在 'moving' 的合并(进程崩在中途、且没人再点验证信时兜底)。
 *  幂等:reconcileOne 重跑安全。Node 启动调一次;Workers 每 isolate 构建时调一次(无 moving 行即 no-op)。 */
export async function resumeSweep(deps: AppDeps): Promise<void> {
  const moving = await deps.db.select().from(accountMerges).where(eq(accountMerges.status, 'moving')).all();
  for (const m of moving) {
    const survivor = await deps.db.select().from(users).where(eq(users.id, m.survivorId)).get();
    const loser = await deps.db.select().from(users).where(eq(users.id, m.loserId)).get();
    if (survivor && loser) await reconcileOne(deps, survivor, loser, m.emailKey);
  }
}
