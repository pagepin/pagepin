/** console 静态托管(Node only)—— 注入给 createApp(opts.mountConsole)。
 * /assets/* 走 serve-static,其余 GET 未命中路径回 index.html(SPA fallback;已注册路由先于本通配)。
 * Workers 不传此函数:console 走 Static Assets binding,worker 只处理 API/serving。 */

import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono } from 'hono';

import type { AppEnv } from './types.js';

export function mountConsoleStatic(app: Hono<AppEnv>, consoleDist: string): void {
  // serve-static 只认相对 cwd 的 root
  const root = relative(process.cwd(), consoleDist) || '.';
  app.use('/assets/*', serveStatic({ root }));
  // 资源缺失时 404,不落 SPA fallback(静态目录的标准行为)
  app.get('/assets/*', (c) => c.text('not found', 404));
  // 生产缓存 index.html;开发态每请求现读 —— console 重新 build 后刷新即生效,免重启
  const indexPath = join(consoleDist, 'index.html');
  const cached = process.env.NODE_ENV === 'production' ? readFileSync(indexPath, 'utf-8') : null;
  app.get('*', (c) => c.html(cached ?? readFileSync(indexPath, 'utf-8')));
}
