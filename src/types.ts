/** 跨模块共享类型:依赖注入容器与 Hono 环境。 */

import type { Config } from './config.js';
import type { Db, UserRow } from './db/index.js';
import type { Storage } from './storage/index.js';
import type { Mailer } from './mail/index.js';
import type { RateLimiter } from './ratelimit.js';
import type { SessionClaims } from './auth/sessions.js';

export interface AppDeps {
  config: Config;
  db: Db;
  storage: Storage;
  /** 可选限流器（login/signup 防刷）；两个 entry 各注入实现，缺省=不限流。 */
  rateLimiter?: RateLimiter;
  /** 可选邮件发送器（邮箱验证）；未注入 = 不发信、邮箱保持未验证（安全降级）。 */
  mailer?: Mailer;
}

export type AppEnv = {
  Variables: {
    user: UserRow;
    authVia: 'cookie' | 'token';
    sessionClaims?: SessionClaims;
  };
};
