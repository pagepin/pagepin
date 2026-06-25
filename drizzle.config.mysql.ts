import { defineConfig } from 'drizzle-kit';

// MySQL 迁移源(自托管 Node 用 PAGEPIN_DB_DRIVER=mysql 时)。
// schema.mysql.ts 由跨方言工厂生成,与 sqlite 的 drizzle.config.ts 同一套表结构。
// 生成:pnpm drizzle-kit generate --config drizzle.config.mysql.ts
export default defineConfig({
  dialect: 'mysql',
  schema: './src/db/schema.mysql.ts',
  out: './drizzle/mysql',
});
