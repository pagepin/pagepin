/** DB 方言推断 —— 自托管 Node 按 PAGEPIN_DB_URL 的 scheme 选驱动(PAGEPIN_DB_DRIVER 可显式覆盖)。
 *
 * 纯函数、零依赖:供 config.ts(构建 Config)与 db/index.ts(模块加载期按方言选 table 对象)共用,
 * 不引入任何模块循环。方言固定于部署期(改了要重启,与 mode 同语义)。
 */
export type DbDriver = 'sqlite' | 'postgres' | 'mysql';

export function inferDbDriver(url?: string, explicit?: string): DbDriver {
  const e = (explicit ?? '').trim().toLowerCase();
  if (e === 'sqlite' || e === 'postgres' || e === 'mysql') return e;
  const u = (url ?? '').trim().toLowerCase();
  if (u.startsWith('postgres://') || u.startsWith('postgresql://')) return 'postgres';
  if (u.startsWith('mysql://') || u.startsWith('mysql2://')) return 'mysql';
  // file:、libsql://、http(s)://(libsql/Turso)或未设置 → 本地/远程 libSQL(开箱即用默认)
  return 'sqlite';
}
