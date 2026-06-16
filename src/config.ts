/** 环境配置 —— 全部经 env 注入;loadConfig 只读传入的 env 对象,保持 edge-safe。 */

import { isSupportedSocialProvider, SOCIAL_PROVIDER_IDS } from './auth/social.js';

/** 社交登录 provider(与 password/oidc 并存,独立配置)。 */
export interface SocialProvider {
  id: string; // 'google' | 'github'(社交注册表支持的 id)
  clientId: string;
  clientSecret: string;
}

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  /** 附加到 authorize URL 的额外 query(如 Casdoor 的 provider_hint),JSON 对象 */
  authParams: Record<string, string>;
}

export interface S3Config {
  endpoint: string; // 含或不含 scheme,默认补 https://
  bucket: string;
  prefix: string;
  accessKey: string;
  secretKey: string;
  region: string;
  forcePathStyle: boolean;
}

export interface Config {
  port: number;
  dataDir: string;
  /** 单域模式对外地址(含 scheme,无尾斜杠) */
  baseUrl: string;
  consoleHost?: string;
  contentHost?: string;
  externalScheme: string;
  mode: 'single' | 'dual';
  authMode: 'password' | 'oidc' | 'none';
  allowSignup: boolean;
  /** 注册模式的 env 覆盖;显式设置则锁定(管理员不能在 UI 改),未设置时由 DB instance_settings 决定。 */
  registrationMode?: 'open' | 'invite' | 'closed';
  adminEmail?: string;
  adminPassword?: string;
  /** 社交登录(可与 password/oidc 同时启用);空数组 = 未配置 */
  socialProviders: SocialProvider[];
  secret: string;
  sessionTtlH: number;
  oidc?: OidcConfig;
  storage: 'fs' | 's3';
  s3?: S3Config;
  maxFileMb: number;
  maxSiteMb: number;
  maxFiles: number;
  publicMaxHours: number;
  /** 设备授权(/api/device)铸出的 token 的有效期(天);0 = 不过期。普通 PAT 不受此限。 */
  deviceTokenTtlDays: number;
  secureCookies: boolean;
}

type Env = Record<string, string | undefined>;

function str(env: Env, key: string, dflt: string): string {
  const v = env[key];
  return v === undefined || v === '' ? dflt : v;
}

function num(env: Env, key: string, dflt: number): number {
  const v = env[key];
  if (v === undefined || v === '') return dflt;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`配置 ${key} 不是数字:${v}`);
  return n;
}

function bool(env: Env, key: string, dflt: boolean): boolean {
  const v = env[key];
  if (v === undefined || v === '') return dflt;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export function loadConfig(env: Env): Config {
  const consoleHost = env.PAGEPIN_CONSOLE_HOST || undefined;
  const contentHost = env.PAGEPIN_CONTENT_HOST || undefined;
  if ((consoleHost && !contentHost) || (!consoleHost && contentHost)) {
    throw new Error('双域模式需同时设置 PAGEPIN_CONSOLE_HOST 与 PAGEPIN_CONTENT_HOST');
  }
  const mode: Config['mode'] = consoleHost && contentHost ? 'dual' : 'single';
  const baseUrl = str(env, 'PAGEPIN_BASE_URL', 'http://localhost:8000').replace(/\/+$/, '');
  const externalScheme = str(env, 'PAGEPIN_EXTERNAL_SCHEME', 'https');

  const authMode = str(env, 'PAGEPIN_AUTH_MODE', 'password') as Config['authMode'];
  if (!['password', 'oidc', 'none'].includes(authMode)) {
    throw new Error(`PAGEPIN_AUTH_MODE 只能是 password/oidc/none,收到:${authMode}`);
  }

  // 注册模式 env 覆盖:仅 PAGEPIN_REGISTRATION_MODE 显式给才锁定 UI(env 启动覆盖语义)。
  // 旧开关 PAGEPIN_ALLOW_SIGNUP 不再锁 UI —— 只作 DB 无值时的兜底默认(见 instance-settings.ts)。
  let registrationMode: Config['registrationMode'];
  const rmRaw = env.PAGEPIN_REGISTRATION_MODE;
  if (rmRaw !== undefined && rmRaw !== '') {
    if (!['open', 'invite', 'closed'].includes(rmRaw)) {
      throw new Error(`PAGEPIN_REGISTRATION_MODE 只能是 open/invite/closed,收到:${rmRaw}`);
    }
    registrationMode = rmRaw as Config['registrationMode'];
  }

  let oidc: OidcConfig | undefined;
  if (authMode === 'oidc') {
    const issuer = env.PAGEPIN_OIDC_ISSUER;
    const clientId = env.PAGEPIN_OIDC_CLIENT_ID;
    const clientSecret = env.PAGEPIN_OIDC_CLIENT_SECRET;
    if (!issuer || !clientId || !clientSecret) {
      throw new Error('oidc 模式需设置 PAGEPIN_OIDC_ISSUER / PAGEPIN_OIDC_CLIENT_ID / PAGEPIN_OIDC_CLIENT_SECRET');
    }
    let authParams: Record<string, string> = {};
    if (env.PAGEPIN_OIDC_AUTH_PARAMS) {
      authParams = JSON.parse(env.PAGEPIN_OIDC_AUTH_PARAMS) as Record<string, string>;
    }
    oidc = {
      issuer: issuer.replace(/\/+$/, ''),
      clientId,
      clientSecret,
      scopes: str(env, 'PAGEPIN_OIDC_SCOPES', 'openid profile email'),
      authParams,
    };
  }

  const storage = str(env, 'PAGEPIN_STORAGE', 'fs') as Config['storage'];
  if (!['fs', 's3'].includes(storage)) {
    throw new Error(`PAGEPIN_STORAGE 只能是 fs/s3,收到:${storage}`);
  }
  let s3: S3Config | undefined;
  if (storage === 's3') {
    const endpoint = env.PAGEPIN_S3_ENDPOINT;
    const bucket = env.PAGEPIN_S3_BUCKET;
    const accessKey = env.PAGEPIN_S3_ACCESS_KEY;
    const secretKey = env.PAGEPIN_S3_SECRET_KEY;
    if (!endpoint || !bucket || !accessKey || !secretKey) {
      throw new Error('s3 存储需设置 PAGEPIN_S3_ENDPOINT / PAGEPIN_S3_BUCKET / PAGEPIN_S3_ACCESS_KEY / PAGEPIN_S3_SECRET_KEY');
    }
    s3 = {
      endpoint,
      bucket,
      prefix: str(env, 'PAGEPIN_S3_PREFIX', 'pagepin/'),
      accessKey,
      secretKey,
      region: str(env, 'PAGEPIN_S3_REGION', 'auto'),
      forcePathStyle: bool(env, 'PAGEPIN_S3_FORCE_PATH_STYLE', true),
    };
  }

  // 社交登录:PAGEPIN_OAUTH_PROVIDERS=google,github;每家 PAGEPIN_OAUTH_<ID>_CLIENT_ID/_CLIENT_SECRET。
  // 与 authMode 独立(可 password + 社交并存);两值齐全才启用,缺一即报错(避免半配置静默失效)。
  const socialProviders: SocialProvider[] = [];
  const wantProviders = (env.PAGEPIN_OAUTH_PROVIDERS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  for (const id of wantProviders) {
    if (!isSupportedSocialProvider(id)) {
      throw new Error(`PAGEPIN_OAUTH_PROVIDERS 含未知 provider:${id}(支持 ${SOCIAL_PROVIDER_IDS.join('/')})`);
    }
    const up = id.toUpperCase();
    const clientId = env[`PAGEPIN_OAUTH_${up}_CLIENT_ID`];
    const clientSecret = env[`PAGEPIN_OAUTH_${up}_CLIENT_SECRET`];
    if (!clientId || !clientSecret) {
      throw new Error(`社交登录 ${id} 需设置 PAGEPIN_OAUTH_${up}_CLIENT_ID 与 PAGEPIN_OAUTH_${up}_CLIENT_SECRET`);
    }
    socialProviders.push({ id, clientId, clientSecret });
  }

  const secret = str(env, 'PAGEPIN_SECRET', '');
  if (!secret) {
    // Node 入口会先从 {dataDir}/secret 落盘/读取后再调本函数;走到这说明两边都没给
    throw new Error('缺少 PAGEPIN_SECRET(会话签名密钥)');
  }

  return {
    port: num(env, 'PAGEPIN_PORT', 8000),
    dataDir: str(env, 'PAGEPIN_DATA_DIR', './data'),
    baseUrl,
    consoleHost,
    contentHost,
    externalScheme,
    mode,
    authMode,
    allowSignup: bool(env, 'PAGEPIN_ALLOW_SIGNUP', true),
    registrationMode,
    adminEmail: env.PAGEPIN_ADMIN_EMAIL || undefined,
    adminPassword: env.PAGEPIN_ADMIN_PASSWORD || undefined,
    socialProviders,
    secret,
    sessionTtlH: num(env, 'PAGEPIN_SESSION_TTL_H', 8),
    oidc,
    storage,
    s3,
    maxFileMb: num(env, 'PAGEPIN_MAX_FILE_MB', 25),
    maxSiteMb: num(env, 'PAGEPIN_MAX_SITE_MB', 200),
    maxFiles: num(env, 'PAGEPIN_MAX_FILES', 2000),
    publicMaxHours: num(env, 'PAGEPIN_PUBLIC_MAX_HOURS', 168),
    deviceTokenTtlDays: num(env, 'PAGEPIN_DEVICE_TOKEN_TTL_DAYS', 90),
    secureCookies:
      mode === 'dual' ? externalScheme === 'https' : baseUrl.startsWith('https://'),
  };
}

/** 站点对外 URL(带尾斜杠)。单/双域差异只允许出现在这里与 contentBase。 */
export function siteUrl(cfg: Config, handle: string, slug: string): string {
  if (cfg.mode === 'dual') {
    return `${cfg.externalScheme}://${cfg.contentHost}/${handle}/${slug}/`;
  }
  return `${cfg.baseUrl}/p/${handle}/${slug}/`;
}

/** 内容平面基地址(无尾斜杠;/api/me 的 content_base 与 skill.md 渲染用)。 */
export function contentBase(cfg: Config): string {
  if (cfg.mode === 'dual') return `${cfg.externalScheme}://${cfg.contentHost}`;
  return `${cfg.baseUrl}/p`;
}

/** 控制台基地址(无尾斜杠)。 */
export function consoleBase(cfg: Config): string {
  if (cfg.mode === 'dual') return `${cfg.externalScheme}://${cfg.consoleHost}`;
  return cfg.baseUrl;
}
