/** 跨方言写操作助手 —— 把 RETURNING / upsert 这两类方言差异收在一处,业务代码不感知。
 *
 * SQLite/PG 原生支持 RETURNING 与 ON CONFLICT;MySQL 都没有:
 *   - 无 RETURNING → CAS 命中判定改读 affectedRows;
 *   - upsert 用 ON DUPLICATE KEY UPDATE。
 * 方言由 db/index.ts 的 dbDialect 决定(部署期固定)。
 */
import { dbDialect } from './index.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 守卫写命中的行数(CAS 冲突判定用):SQLite/PG 用 .returning() 数长度,MySQL 读 affectedRows。
 *  传入【未加 .returning()】的 update/insert 构建器。
 *  注:MySQL 的 affectedRows 计「实际改变」的行;本仓所有 CAS 写都必改 updated_at/acceptedAt,
 *  故 changed==matched,判定可靠。 */
export async function writtenCount(qb: any): Promise<number> {
  if (dbDialect === 'mysql') {
    const r: any = await qb;
    const header = Array.isArray(r) ? r[0] : r;
    return Number(header?.affectedRows ?? header?.rowsAffected ?? 0);
  }
  return ((await qb.returning()) as unknown[]).length;
}

/** 跨方言 upsert:SQLite/PG 用 onConflictDoUpdate(target),MySQL 用 onDuplicateKeyUpdate。
 *  传入【未加冲突子句】的 insert 构建器。 */
export async function upsert(
  insertQb: any,
  target: any,
  set: Record<string, unknown>,
): Promise<void> {
  if (dbDialect === 'mysql') {
    await insertQb.onDuplicateKeyUpdate({ set });
    return;
  }
  await insertQb.onConflictDoUpdate({ target, set });
}
