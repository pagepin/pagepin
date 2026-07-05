/** DB 入口 —— 对外统一从这里导入表对象 / 行类型 / 辅助函数。
 *
 * 运行时表对象按方言选(部署期固定):sqlite/D1(及测试、Workers)用规范的 schema.ts;
 * 自托管 Node 选 postgres/mysql 时,改用工厂生成的同构 table(schema.pg.ts / schema.mysql.ts),
 * 并 cast 成 sqlite 的精确类型 —— 全部查询代码与 14 个导入方零改动。
 * 行类型与辅助函数一律以规范 sqlite schema 为准(三方言列结构一致)。
 */
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { inferDbDriver } from './driver.js';
import * as mysqlSchema from './schema.mysql.js';
import * as pgSchema from './schema.pg.js';
import * as sqliteSchema from './schema.js';

export type {
  AccountMergeRow,
  ApiTokenRow,
  CommentThreadRow,
  DeploySessionRow,
  DeviceAuthRow,
  HandoffCodeRow,
  IdentityRow,
  InviteRow,
  PendingFile,
  SiteRow,
  SiteVersion,
  ThreadComment,
  UserRow,
} from './schema.js';
export { currentVersion, isPubliclyVisible } from './schema.js';

/** 运行时中立的 async DB 类型 —— libSQL/D1/postgres-js/mysql2 都满足。
 * RunResult=any 抹平各驱动 .run()/结果形状差异;影响行数检测一律走 .returning()。 */
export type Db = BaseSQLiteDatabase<'async', any, typeof sqliteSchema>;

// 方言固定于部署期(改 PAGEPIN_DB_URL/PAGEPIN_DB_DRIVER 需重启)。
// Workers 无 process → 默认 sqlite(D1)。pg/mysql 的 table 对象与各自驱动(db/postgres.ts、
// db/mysql.ts)用的是 schema.pg.ts / schema.mysql.ts 的【同一批】对象,故查询与连接方言一致。
// 经 globalThis 取 process,避免在 Workers(无 node 类型)下引用未声明的 process 全局名。
const env: Record<string, string | undefined> =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const driver = inferDbDriver(env.PAGEPIN_DB_URL, env.PAGEPIN_DB_DRIVER);

/** 部署期固定的 DB 方言 —— 供 db/ops.ts 把 RETURNING/upsert 等方言差异收口。 */
export const dbDialect = driver;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const t: any = driver === 'postgres' ? pgSchema : driver === 'mysql' ? mysqlSchema : sqliteSchema;

export const users = t.users as typeof sqliteSchema.users;
export const identities = t.identities as typeof sqliteSchema.identities;
export const sites = t.sites as typeof sqliteSchema.sites;
export const commentThreads = t.commentThreads as typeof sqliteSchema.commentThreads;
export const apiTokens = t.apiTokens as typeof sqliteSchema.apiTokens;
export const invites = t.invites as typeof sqliteSchema.invites;
export const instanceSettings = t.instanceSettings as typeof sqliteSchema.instanceSettings;
export const deviceAuths = t.deviceAuths as typeof sqliteSchema.deviceAuths;
export const handoffCodes = t.handoffCodes as typeof sqliteSchema.handoffCodes;
export const deploySessions = t.deploySessions as typeof sqliteSchema.deploySessions;
export const accountMerges = t.accountMerges as typeof sqliteSchema.accountMerges;
