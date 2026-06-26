/** MySQL 驱动(自托管 Node;PAGEPIN_DB_URL=mysql://… 时启用)。
 *
 * mysql2 是 optionalDependency 且懒加载 —— 仅选 mysql 方言时才动态 import,默认 SQLite 部署不装。
 * 启动应用 drizzle/mysql 迁移。表结构来自工厂(schema.mysql.ts),与 sqlite 的 schema.ts 一一对应;
 * db/index.ts 在 mysql 方言下导出的也正是 schema.mysql.ts 的同一批 table 对象。
 * MySQL 无 RETURNING、upsert 语法不同 —— 这些差异已在 db/ops.ts 按方言收口,业务代码不感知。
 * 需要 MySQL 8.0+(json / 默认 utf8mb4 / 3072B 索引前缀)。
 */
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';

import type { Db } from './index.js';
import * as schema from './schema.mysql.js';

export async function createMysqlDb(url: string): Promise<Db> {
  // CJS interop:Node ESM 下 createPool 可能挂在 default 上,两处都兜。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m: any = await import('mysql2/promise');
  const createPool = m.createPool ?? m.default?.createPool;
  const pool = createPool(url);
  const db = drizzle(pool, { schema, mode: 'default' });
  await migrate(db, { migrationsFolder: './drizzle/mysql' });
  return db as unknown as Db;
}
