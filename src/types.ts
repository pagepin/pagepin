/** 跨模块共享类型:依赖注入容器与 Hono 环境。 */

import type { Config } from './config.js';
import type { Db, UserRow } from './db/index.js';
import type { Storage } from './storage/index.js';
import type { SessionClaims } from './auth/sessions.js';

export interface AppDeps {
  config: Config;
  db: Db;
  storage: Storage;
}

export type AppEnv = {
  Variables: {
    user: UserRow;
    authVia: 'cookie' | 'token';
    sessionClaims?: SessionClaims;
  };
};
