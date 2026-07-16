/** MySQL schema 入口 —— drizzle-kit 迁移生成与运行时 mysql 驱动共用。
 *  表结构由跨方言工厂(schema-factory.ts)生成,与 sqlite 的 schema.ts 一一对应。 */
import { mysqlKit } from './columns.js';
import { buildSchema } from './schema-factory.js';

export const {
  users,
  identities,
  sites,
  commentThreads,
  shareLinks,
  apiTokens,
  invites,
  instanceSettings,
  deviceAuths,
  handoffCodes,
  deploySessions,
  accountMerges,
} = buildSchema(mysqlKit);
