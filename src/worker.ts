/** Cloudflare Workers 入口(官方服务)。Node 自托管入口在 index.ts。
 * 绑定:D1=DB、R2=BUCKET、Static Assets=ASSETS(console SPA,由平台直接服务)。
 * config 从 env(wrangler vars + secrets)读;迁移走 `wrangler d1 migrations apply`(不在运行时建表)。 */

import type { D1Database, R2Bucket, Fetcher, ExecutionContext } from '@cloudflare/workers-types';

import { createApp, type AppHandle } from './app.js';
import { loadConfig } from './config.js';
import { createD1Db } from './db/d1.js';
import { SKILL_MD } from './generated/edge-assets.js';
import { R2Storage } from './storage/r2.js';
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
  return (appPromise ??= buildApp(env));
}
async function buildApp(env: Env): Promise<AppHandle> {
  const cfg = loadConfig(env as unknown as Record<string, string | undefined>);
  const deps: AppDeps = {
    config: cfg,
    db: createD1Db(env.DB),
    storage: new R2Storage(env.BUCKET),
  };
  // consoleDist/mountConsole 不传:console SPA 由 Static Assets binding 服务,worker 只管 API/serving
  return createApp(deps, { skillMd: SKILL_MD });
}

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const app = await getApp(env);
    return app.fetch(req) as Promise<Response>;
  },
};
