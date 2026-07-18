/** 跨模块共享类型:依赖注入容器与 Hono 环境。 */

import type { Config } from './config.js';
import type { Db, UserRow } from './db/index.js';
import type { Storage } from './storage/index.js';
import type { Mailer } from './mail/index.js';
import type { RateLimiter } from './ratelimit.js';
import type { SessionClaims } from './auth/sessions.js';
import type { Locale } from './i18n/index.js';

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
    /** 请求 locale,由 makeLocaleMiddleware 解析后注入(见 i18n/locale.ts)。 */
    locale: Locale;
    /** 滑动续期要补的 Set-Cookie(序列化好的完整值;分享会话/viewer 会话共用)。serve() 内多为
     *  直接 new Response 返回,c.header 预备头会被丢弃,故经此变量交给外层中间件补到成品响应上。 */
    renewCookies?: string[];
  };
};
