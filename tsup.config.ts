import { defineConfig } from 'tsup';

// 数据库驱动(postgres / mysql2)是 optionalDependency 且懒加载(db/postgres.ts、db/mysql.ts):
// 必须保持 external,不能被 esbuild 打进 ESM 产物 —— 尤其 mysql2 含 CJS 动态 require,
// 打包后会在运行时抛 "Dynamic require of \"buffer\" is not supported"。
// 保持 external 后,await import('mysql2/promise') 在运行时从 node_modules 正常加载(CJS)。
//
// package.json 的 `tsup …` 与 Dockerfile build 阶段的 `npx tsup …` 都会自动读取本配置。
export default defineConfig({
  external: ['postgres', 'mysql2'],
});
