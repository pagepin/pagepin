/** Node 入口(Node 专有依赖只允许出现在这里与 db/node.ts、storage/fs.ts)。
 *
 * 启动流程:secret 落盘/读取 → loadConfig → SQLite → Storage →
 * admin bootstrap(可选)→ createApp → @hono/node-server。
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serve } from '@hono/node-server';

import { createApp } from './app.js';
import { MemoryRateLimiter } from './ratelimit.js';
import { mountConsoleStatic } from './console-static.js';
import { bootstrapAdmin } from './auth/admin-bootstrap.js';
import { consoleBase, contentBase, loadConfig } from './config.js';
import { createLibsqlDb } from './db/libsql.js';
import { createMailer } from './mail/factory.js';
import { resumeSweep } from './auth/reconcile.js';
import { createStorage } from './storage/factory.js';

async function main(): Promise<void> {
  // secret:env 优先;否则持久化在 {dataDir}/secret(首启生成,0600)——
  // 重启不换 secret,会话/CSRF 不失效。
  const dataDir = process.env.PAGEPIN_DATA_DIR || './data';
  let secret = process.env.PAGEPIN_SECRET || '';
  if (!secret) {
    const secretFile = join(dataDir, 'secret');
    if (existsSync(secretFile)) {
      secret = readFileSync(secretFile, 'utf-8').trim();
    }
    if (!secret) {
      secret = randomBytes(24).toString('hex'); // 48 hex
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(secretFile, secret, { mode: 0o600 });
      console.log(`已生成会话密钥:${secretFile}`);
    }
  }

  const cfg = loadConfig({ ...process.env, PAGEPIN_SECRET: secret });
  // libSQL(纯 JS,无 native 构建);启动自动应用 drizzle 迁移(./drizzle,cwd 相对)。
  // 默认本地文件(开箱即用);PAGEPIN_DB_URL 可指向 Turso 等托管 libSQL(配 PAGEPIN_DB_AUTH_TOKEN)。
  mkdirSync(cfg.dataDir, { recursive: true }); // 本地 file: 模式 libSQL 不会自建父目录
  const db = await createLibsqlDb(
    cfg.dbUrl ?? `file:${join(cfg.dataDir, 'pagepin.db')}`,
    cfg.dbAuthToken,
  );
  const storage = await createStorage(cfg);

  // admin bootstrap:配置了邮箱+密码则 upsert(存在则刷新密码哈希并确保 isAdmin,不动其他字段);
  // 未配置时回落「首个注册用户为 admin」(signup 逻辑负责)。Node 启动无条件跑(进程内一次)。
  if (await bootstrapAdmin({ config: cfg, db, storage })) {
    console.log(`admin 账号就绪:${cfg.adminEmail}`);
  }

  // 续跑任何卡在中途的账号合并(崩溃恢复;无 moving 行即 no-op)。
  await resumeSweep({ config: cfg, db, storage }).catch((e) => console.error('reconcile resumeSweep 失败:', e));

  // skills/pagepin/SKILL.md 与 console/dist 均相对仓库根定位;src/index.ts 与 dist/index.js
  // 距仓库根同深(一层),'../' 在两种形态下都成立。
  const skillMd = readFileSync(new URL('../skills/pagepin/SKILL.md', import.meta.url), 'utf-8');
  const apiMd = readFileSync(new URL('../skills/pagepin/references/api.md', import.meta.url), 'utf-8');
  const consoleDistUrl = new URL('../console/dist', import.meta.url);
  const consoleDist = existsSync(consoleDistUrl) ? fileURLToPath(consoleDistUrl) : undefined;

  const app = await createApp(
    { config: cfg, db, storage, mailer: createMailer(cfg.mail), rateLimiter: new MemoryRateLimiter() },
    { consoleDist, skillMd, apiMd, mountConsole: mountConsoleStatic },
  );

  serve({ fetch: app.fetch, port: cfg.port }, (info) => {
    console.log(
      `pagepin 已启动:mode=${cfg.mode} auth=${cfg.authMode} storage=${cfg.storage} port=${info.port}`,
    );
    if (cfg.mode === 'dual') {
      console.log(`console=${consoleBase(cfg)} content=${contentBase(cfg)}`);
    } else {
      console.log(`地址:${cfg.baseUrl}(本机 http://localhost:${info.port})`);
      if (!/\/\/(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/.test(cfg.baseUrl)) {
        console.warn(
          '⚠️ 单域模式下托管页面与控制台同源:页面内 JS 可以已登录访问者的身份调用管理 API(含读取 API token)。' +
            '仅适合信任环境(本地/团队内网);公网部署请改用 PAGEPIN_CONSOLE_HOST + PAGEPIN_CONTENT_HOST 双域隔离。',
        );
      }
    }
    if (!consoleDist) console.log('console dist 未构建:控制台前端走 vite 代理(pnpm -C console dev)');
  });
}

main().catch((e) => {
  console.error('pagepin 启动失败:', e);
  process.exit(1);
});
