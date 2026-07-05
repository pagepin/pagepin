/** 测试用 DB 夹具 —— 让同一批路由级测试既能跑内存 SQLite,也能对着真实 PG/MySQL 跑。
 *
 * 默认(未设 PAGEPIN_TEST_DB_URL):每次返回全新的内存 libSQL(隔离、零成本,保持原行为)。
 * 设了 PAGEPIN_TEST_DB_URL(postgres:// / mysql://):复用单个连接(避免每用例新建连接池耗尽),
 * 每次调用先清空所有表 → 干净起点,等价于内存库的「每用例全新」。
 *
 * 重要:跑 PG/MySQL 时,进程启动前必须同时设 PAGEPIN_DB_URL=<同一 URL>,db/index.ts 才会在
 * 模块加载期选对方言的 table(见 test:routes:pg / test:routes:mysql 脚本)。务必单并发跑
 * (--test-concurrency=1),因为 pg/mysql 复用同一库、清表会互相影响。
 */
import {
  accountMerges,
  apiTokens,
  commentThreads,
  deploySessions,
  deviceAuths,
  handoffCodes,
  identities,
  instanceSettings,
  invites,
  sites,
  users,
  type Db,
} from '../../src/db/index.js';
import { createLibsqlDb } from '../../src/db/libsql.js';

const url = process.env.PAGEPIN_TEST_DB_URL;
let cached: Db | null = null;

export async function makeTestDb(): Promise<Db> {
  if (!url) return createLibsqlDb(':memory:'); // 默认:每次全新内存 SQLite
  if (!cached) {
    if (url.startsWith('postgres')) {
      cached = await (await import('../../src/db/postgres.js')).createPostgresDb(url);
    } else if (url.startsWith('mysql')) {
      cached = await (await import('../../src/db/mysql.js')).createMysqlDb(url);
    } else {
      cached = await createLibsqlDb(url);
    }
  }
  await resetDb(cached);
  return cached;
}

/** 清空所有表(无外键,顺序随意)—— pg/mysql 复用连接时每用例还原干净。 */
async function resetDb(db: Db): Promise<void> {
  await db.delete(commentThreads);
  await db.delete(deploySessions);
  await db.delete(deviceAuths);
  await db.delete(handoffCodes);
  await db.delete(apiTokens);
  await db.delete(invites);
  await db.delete(accountMerges);
  await db.delete(identities);
  await db.delete(sites);
  await db.delete(instanceSettings);
  await db.delete(users);
}
