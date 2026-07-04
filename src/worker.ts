/** Cloudflare Workers 入口(官方服务)。Node 自托管入口在 index.ts。
 * 绑定:D1=DB、R2=BUCKET、Static Assets=ASSETS(console SPA,由平台直接服务)。
 * config 从 env(wrangler vars + secrets)读;迁移走 `wrangler d1 migrations apply`(不在运行时建表)。 */

import type { D1Database, R2Bucket, Fetcher, ExecutionContext } from '@cloudflare/workers-types';

import { createApp, type AppHandle } from './app.js';
import { bootstrapAdmin } from './auth/admin-bootstrap.js';
import { loadConfig } from './config.js';
import { createD1Db } from './db/d1.js';
import { createMailer } from './mail/factory.js';
import { resumeSweep } from './auth/reconcile.js';
import { SKILL_MD, API_MD } from './generated/edge-assets.js';
import { htmlRewriterInject } from './serving-inject.js';
import { R2Storage } from './storage/r2.js';
import { MemoryRateLimiter } from './ratelimit.js';
import { sweepExpiredTrialSites } from './trial.js';
import type { AppDeps } from './types.js';

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  [k: string]: unknown; // PAGEPIN_* vars / secrets(字符串)
}

// 每 isolate 构一次(loadConfig 纯函数,deps 依赖注入)
let appPromise: Promise<AppHandle> | null = null;
function getApp(env: Env): Promise<AppHandle> {
  // 构建失败不缓存:清空 appPromise,下个请求重试干净的 build。
  // 否则 ??= 会把 rejected promise 永久缓存,一次瞬时 D1 抖动就毒化整个 isolate 直到回收。
  return (appPromise ??= buildApp(env).catch((e) => {
    appPromise = null;
    throw e;
  }));
}
async function buildApp(env: Env): Promise<AppHandle> {
  const cfg = loadConfig(env as unknown as Record<string, string | undefined>);
  const deps: AppDeps = {
    config: cfg,
    db: createD1Db(env.DB),
    storage: new R2Storage(env.BUCKET),
    mailer: createMailer(cfg.mail), // 邮箱验证(未配置 PAGEPIN_MAIL_PROVIDER → undefined,不发信)
    // per-isolate 尽力而为限流；边缘真正防护用 CF Rate Limiting Rules。
    rateLimiter: new MemoryRateLimiter(),
  };
  // admin bootstrap:每 isolate 一次(buildApp 经 appPromise 记忆化);
  // guarded —— 密码与库内哈希吻合即跳过,不每次冷启都重跑 scrypt+写库(见 admin-bootstrap.ts)。
  // 尽力而为:provisioning 失败只记日志、不拖垮 app 构建(serving 不依赖 admin 就绪),下次冷启重试。
  try {
    await bootstrapAdmin(deps, { guarded: true });
  } catch (e) {
    console.error('admin bootstrap 失败(继续启动,下次冷启重试):', e);
  }
  // 续跑卡在中途的账号合并(尽力而为;无 moving 行即一次轻量查询)。
  try {
    await resumeSweep(deps);
  } catch (e) {
    console.error('reconcile resumeSweep 失败:', e);
  }
  // console SPA 走 Static Assets binding(env.ASSETS):未命中 API/serving 的 GET 转交它(host 感知,
  //   故 wrangler run_worker_first=true 全量过 worker,再按 Host 决定 console/content)。
  // injectHtmlStream —— >5MB HTML 用 HTMLRewriter 流式注入(Node 无此 API,故仅 Workers 注入)。
  return createApp(deps, {
    skillMd: SKILL_MD,
    apiMd: API_MD,
    // env.ASSETS.fetch 用 workers-types 的 Request/Response;createApp 回调签名用全局(WebWorker lib)
    // 的同名类型 —— 两套结构互不完全兼容(getSetCookie vs getAll),此处桥接一次。
    serveAssets: (req) =>
      env.ASSETS.fetch(
        req as unknown as Parameters<Fetcher['fetch']>[0],
      ) as unknown as Promise<Response>,
    injectHtmlStream: htmlRewriterInject,
  });
}

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const app = await getApp(env);
    return app.fetch(req) as Promise<Response>;
  },
  /** cron(wrangler.jsonc triggers):到期试用站清理(线程 + 存储 + 站点行硬删)。 */
  async scheduled(_event: unknown, env: Env, _ctx: ExecutionContext): Promise<void> {
    try {
      await sweepExpiredTrialSites(createD1Db(env.DB), new R2Storage(env.BUCKET));
    } catch (e) {
      console.error('trial sweep 失败:', e);
    }
  },
};
