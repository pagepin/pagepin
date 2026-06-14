/** 应用组装 —— 单域 / 双域两种模式。
 *
 * single(默认,自托管最省心):一个 Hono 同时挂控制台 API 与内容 serving,
 *   内容路由走 /p/ 前缀,viewer 复用控制台会话(plane 一律 'session')。
 * dual(安全增强):按 Host 头分流两个子 app ——
 *   content 域 → 静态 serving + 登录墙(不挂任何改数据接口)
 *   console 域 → React 控制台 + 管理 API
 *   origin 拆分是安全设计的根基(host-only Cookie 互不可达,被托管站点的 JS
 *   打不到管理 API);Host 分流只是部署省事,隔离由浏览器同源策略保证。
 *   未知 Host 一律 404(/healthz 例外,给负载均衡健康检查)。
 *
 * 本文件 edge-safe:console 静态托管(Node only)由 opts.mountConsole 注入(见 console-static.ts);
 * Workers 入口不传它(console 走 Static Assets binding)。
 */

import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';

import { makeAdminRoutes } from './api/admin.js';
import { makeAuthMiddleware } from './api/deps.js';
import { makeMeRoutes } from './api/me.js';
import { makeSiteRoutes } from './api/sites.js';
import { makeTokenRoutes } from './api/tokens.js';
import { makeAuthRoutes } from './auth/routes.js';
import { makeCommentRoutes } from './comments.js';
import { consoleBase, contentBase, siteUrl } from './config.js';
import { makeServingRoutes } from './serving.js';
import type { AppDeps, AppEnv } from './types.js';

export interface CreateAppOptions {
  /** console 前端构建产物目录(绝对路径);不存在时不挂静态,GET / 仅提示 */
  consoleDist?: string;
  /** console 静态托管挂载器(Node only,见 console-static.ts);Workers 不传 */
  mountConsole?: (app: Hono<AppEnv>, consoleDist: string) => void;
  /** skill.md 模板原文;serve 时按 config 渲染占位符 */
  skillMd?: string;
}

export interface AppHandle {
  fetch: (req: Request) => Response | Promise<Response>;
}

/** 请求日志:方法 路径 状态 耗时 ms(挂最外层,不引日志库)。 */
const requestLogger = createMiddleware(async (c, next) => {
  const start = Date.now();
  await next();
  console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - start}ms`);
});

/** Host 头去端口(按最后一个冒号截断)。 */
function stripPort(host: string): string {
  const i = host.lastIndexOf(':');
  return i === -1 ? host : host.slice(0, i);
}

/** GET /skill.md —— 给 AI/脚本的 API 使用说明(匿名可读,无敏感信息)。
 * 占位符按当前部署形态渲染一次(config 进程内不变)。 */
function mountSkillMd(app: Hono<AppEnv>, deps: AppDeps, skillMd: string): void {
  const cfg = deps.config;
  const rendered = skillMd
    .replaceAll('{{CONSOLE_BASE}}', consoleBase(cfg))
    .replaceAll('{{CONTENT_BASE}}', contentBase(cfg))
    .replaceAll('{{SITE_URL_EXAMPLE}}', siteUrl(cfg, 'your-handle', 'my-demo'));
  app.get('/skill.md', (c) => {
    c.header('Content-Type', 'text/markdown; charset=utf-8');
    return c.body(rendered);
  });
}

/** 未捕获异常统一为 JSON 500(API 消费方拿到的错误体保持 {detail} 形状)。 */
function jsonOnError(app: Hono<AppEnv>): void {
  app.onError((err, c) => {
    console.error(`未捕获异常 ${c.req.method} ${c.req.path}:`, err);
    return c.json({ detail: '服务器内部错误' }, 500);
  });
}

/** console dist 不存在(本地后端开发模式):/ 仅提示,前端走 vite 代理。 */
function mountNoConsoleHint(app: Hono<AppEnv>): void {
  console.warn('console dist 不存在(本地后端开发模式),/ 仅提示');
  app.get('/', (c) => c.json({ msg: 'pagepin console(前端未构建,dev 用 vite 代理)' }));
}

async function mountConsolePlane(
  app: Hono<AppEnv>, deps: AppDeps, opts: CreateAppOptions,
): Promise<void> {
  app.route('/', makeAuthRoutes(deps, 'session')); // 含 GET /api/auth/config
  const mw = makeAuthMiddleware(deps);
  app.route('/', makeMeRoutes(deps, mw));
  app.route('/', makeSiteRoutes(deps, mw));
  app.route('/', makeTokenRoutes(deps, mw));
  app.route('/', makeAdminRoutes(deps, mw));
  if (opts.skillMd) mountSkillMd(app, deps, opts.skillMd);
}

/** 单域模式:一个 app 全挂;评论 API 必须先于 serving 的通配路由注册。 */
async function createSingleApp(deps: AppDeps, opts: CreateAppOptions): Promise<AppHandle> {
  const app = new Hono<AppEnv>();
  jsonOnError(app);
  app.use(requestLogger);
  app.get('/healthz', (c) => c.text('ok'));
  await mountConsolePlane(app, deps, opts);
  app.route('/', makeCommentRoutes(deps)); // 数据平面 /api/viewer + /api/comments/*
  app.route('/', makeServingRoutes(deps)); // /p/:handle/:slug/* + /_pagepin/*
  if (opts.consoleDist && opts.mountConsole) {
    opts.mountConsole(app, opts.consoleDist);
  } else {
    mountNoConsoleHint(app);
  }
  return { fetch: (req) => app.fetch(req) };
}

/** 双域模式:外层按 Host 分流;/healthz 不看 Host。 */
async function createDualApp(deps: AppDeps, opts: CreateAppOptions): Promise<AppHandle> {
  const cfg = deps.config;

  const content = new Hono<AppEnv>();
  jsonOnError(content);
  content.route('/', makeAuthRoutes(deps, 'view'));
  content.route('/', makeCommentRoutes(deps)); // 须先于 serving 的通配路由
  content.route('/', makeServingRoutes(deps)); // /:handle/:slug/* + /_pagepin/*

  const consoleApp = new Hono<AppEnv>();
  jsonOnError(consoleApp);
  await mountConsolePlane(consoleApp, deps, opts);
  if (opts.consoleDist && opts.mountConsole) {
    opts.mountConsole(consoleApp, opts.consoleDist);
  } else {
    mountNoConsoleHint(consoleApp);
  }

  const consoleHost = stripPort(cfg.consoleHost!);
  const contentHost = stripPort(cfg.contentHost!);

  const outer = new Hono<AppEnv>();
  outer.use(requestLogger);
  outer.all('/healthz', (c) => c.text('ok')); // 健康检查不带业务 Host
  outer.all('*', (c) => {
    const host = stripPort(c.req.header('host') ?? '');
    if (host === consoleHost) return consoleApp.fetch(c.req.raw);
    if (host === contentHost) return content.fetch(c.req.raw);
    return c.text('unknown host', 404);
  });
  return { fetch: (req) => outer.fetch(req) };
}

export async function createApp(deps: AppDeps, opts: CreateAppOptions = {}): Promise<AppHandle> {
  return deps.config.mode === 'dual'
    ? createDualApp(deps, opts)
    : createSingleApp(deps, opts);
}
