import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import * as schema from './schema.js';

export * from './schema.js';

/** 运行时中立的 async DB 类型 —— libSQL(自托管)与 D1(官方服务)都满足。
 * RunResult=any 抹平两驱动 .run() 结果形状差异;影响行数检测一律走 .returning()。 */
export type Db = BaseSQLiteDatabase<'async', any, typeof schema>;
