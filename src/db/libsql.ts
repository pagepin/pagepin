/** libSQL 驱动(自托管用)—— 纯 JS、async,取代 better-sqlite3 的 db/node.ts。
 * 启动自动应用 drizzle 迁移(零接触,保留「开箱即用」UX)。
 * url 例:`file:./data/pagepin.db`(本地)或 `libsql://...`(Turso 托管,需 authToken)。 */

import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';

import type { Db } from './index.js';
import * as schema from './schema.js';

export async function createLibsqlDb(url: string, authToken?: string): Promise<Db> {
  const db = drizzle(createClient(authToken ? { url, authToken } : { url }), { schema });
  await migrate(db, { migrationsFolder: './drizzle' });
  return db as unknown as Db;
}
