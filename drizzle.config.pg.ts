import { defineConfig } from 'drizzle-kit';

// PostgreSQL 迁移源(自托管 Node 用 PAGEPIN_DB_DRIVER=postgres 时)。
// schema.pg.ts 由跨方言工厂生成,与 sqlite 的 drizzle.config.ts 同一套表结构。
// 生成:pnpm drizzle-kit generate --config drizzle.config.pg.ts
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.pg.ts',
  out: './drizzle/pg',
});
