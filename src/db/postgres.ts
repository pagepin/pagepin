/** PostgreSQL 驱动(自托管 Node;PAGEPIN_DB_URL=postgres://… 时启用)。
 *
 * postgres(postgres.js)是 optionalDependency 且懒加载 —— 仅选 pg 方言时才动态 import,
 * 默认 SQLite 部署既不安装也不进 Node 包。启动时应用 drizzle/pg 迁移(cwd 相对,同 libSQL)。
 * 表结构来自跨方言工厂(schema.pg.ts),与 sqlite 的 schema.ts 一一对应;db/index.ts 在 pg 方言下
 * 导出的也正是 schema.pg.ts 的同一批 table 对象,故查询用的对象与此处 drizzle 的 schema 一致。
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

import type { Db } from './index.js';
import * as schema from './schema.pg.js';

export async function createPostgresDb(url: string): Promise<Db> {
  const { default: postgres } = await import('postgres');
  const client = postgres(url, { onnotice: () => {} });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: './drizzle/pg' });
  return db as unknown as Db;
}
