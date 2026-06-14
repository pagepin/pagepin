import { defineConfig } from 'drizzle-kit';

// schema.ts 为唯一源 → `pnpm drizzle-kit generate` 出 drizzle/*.sql 迁移。
// 自托管(libSQL)启动 migrate() 应用;官方服务(D1)`wrangler d1 migrations apply`。
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
