/** D1 binding 驱动(官方服务用)—— 迁移走 `wrangler d1 migrations apply`,运行时不建表。
 * schema.ts 原样复用(drizzle sqlite-core 方言 = D1)。
 * 注:本文件仅 Workers 构建编译(base tsconfig 排除,tsconfig.workers.json 收)。 */

import { drizzle } from 'drizzle-orm/d1';
import type { D1Database } from '@cloudflare/workers-types';

import type { Db } from './index.js';
import * as schema from './schema.js';

export function createD1Db(binding: D1Database): Db {
  return drizzle(binding, { schema }) as unknown as Db;
}
