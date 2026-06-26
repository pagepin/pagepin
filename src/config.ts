/** 环境配置 —— 全部经 env 注入;loadConfig 只读传入的 env 对象,保持 edge-safe。 */

import { isSupportedSocialProvider, SOCIAL_PROVIDER_IDS } from './auth/social.js';
import { inferDbDriver, type DbDriver } from './db/driver.js';

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

/** Cloudflare Turnstile 人机校验（可选，默认关）。 */
export interface TurnstileConfig {
  siteKey: string; // 公开：随 /api/auth/config 下发给前端渲染
  secretKey: string; // 服务端 siteverify 用，绝不下发前端
}

/** 邮件发送(可选,默认关)。provider=resend 需 from + resendApiKey(secret);log 仅需 from(打日志兜底)。 */
export interface MailConfig {
  provider: 'resend' | 'log';
  from: string;
  resendApiKey?: string;
}

export interface Config {
  port: number;
  dataDir: string;
  /** DB 方言 —— 由 PAGEPIN_DB_URL 的 scheme 推断(或 PAGEPIN_DB_DRIVER 显式覆盖):
   *  sqlite(默认,含 libSQL/Turso)| postgres | mysql。Workers 恒为 sqlite(D1)。 */
  dbDriver: DbDriver;
  /** DB 连接串(Node 自托管)。未设置 → 本地文件 file:{dataDir}/pagepin.db(开箱即用默认)。
   *  libsql://… / https://…(Turso,配 dbAuthToken)| postgres://… | mysql://…。Workers 用 D1,忽略此项。 */
  dbUrl?: string;
  /** 远程 libSQL/Turso 的鉴权 token;本地 file:、无鉴权 sqld、或 pg/mysql(凭据在 URL 里)留空。 */
  dbAuthToken?: string;
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
  /** Cloudflare Turnstile 人机校验(可选,默认关);配齐 site+secret 才启用,加在 signup/login。 */
  turnstile?: TurnstileConfig;
  /** 邮件发送(可选,默认关);未配置则不发验证信、邮箱保持未验证(安全降级)。 */
  mail?: MailConfig;
  secret: string;
  sessionTtlH: number;
  oidc?: OidcConfig;
  storage: 'fs' | 's3';
  s3?: S3Config;
  maxFileMb: number;
  maxSiteMb: number;
  maxFiles: number;
  /** 每用户总存储配额(MB);0 = 不限。免费档硬顶,管理员豁免;
   *  统计本人名下所有未删站点、所有版本的字节和(= 真实占用的存储量)。 */
  freeUserMb: number;
  /** 每站点保留的版本数;0 = 不限。部署后裁到最近 N 版,超出的旧版本从存储回收(尽力而为)。 */
  keepVersions: number;
  /** 分批上传草稿会话的有效期(小时);超期未 commit 的草稿在后续 begin 时被回收。 */
  deployTtlH: number;
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
      throw new Error(
        'oidc 模式需设置 PAGEPIN_OIDC_ISSUER / PAGEPIN_OIDC_CLIENT_ID / PAGEPIN_OIDC_CLIENT_SECRET',
      );
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
      throw new Error(
        's3 存储需设置 PAGEPIN_S3_ENDPOINT / PAGEPIN_S3_BUCKET / PAGEPIN_S3_ACCESS_KEY / PAGEPIN_S3_SECRET_KEY',
      );
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
      throw new Error(
        `PAGEPIN_OAUTH_PROVIDERS 含未知 provider:${id}(支持 ${SOCIAL_PROVIDER_IDS.join('/')})`,
      );
    }
    const up = id.toUpperCase();
    const clientId = env[`PAGEPIN_OAUTH_${up}_CLIENT_ID`];
    const clientSecret = env[`PAGEPIN_OAUTH_${up}_CLIENT_SECRET`];
    if (!clientId || !clientSecret) {
      throw new Error(
        `社交登录 ${id} 需设置 PAGEPIN_OAUTH_${up}_CLIENT_ID 与 PAGEPIN_OAUTH_${up}_CLIENT_SECRET`,
      );
    }
    socialProviders.push({ id, clientId, clientSecret });
  }

  // Turnstile 人机校验(可选,默认关):两值齐全才启用,缺一即报错(避免半配置静默放过机器人)。
  let turnstile: TurnstileConfig | undefined;
  const tsSite = env.PAGEPIN_TURNSTILE_SITE_KEY;
  const tsSecret = env.PAGEPIN_TURNSTILE_SECRET_KEY;
  if (tsSite || tsSecret) {
    if (!tsSite || !tsSecret) {
      throw new Error(
        'Turnstile 需同时设置 PAGEPIN_TURNSTILE_SITE_KEY 与 PAGEPIN_TURNSTILE_SECRET_KEY',
      );
    }
    turnstile = { siteKey: tsSite, secretKey: tsSecret };
  }

  // 邮件发送(可选):PAGEPIN_MAIL_PROVIDER=resend|log;resend 需 PAGEPIN_MAIL_FROM + PAGEPIN_RESEND_API_KEY。
  let mail: MailConfig | undefined;
  const mailProvider = (env.PAGEPIN_MAIL_PROVIDER || '').trim().toLowerCase();
  if (mailProvider && mailProvider !== 'none') {
    if (!['resend', 'log'].includes(mailProvider)) {
      throw new Error(`PAGEPIN_MAIL_PROVIDER 只能是 resend/log/none,收到:${mailProvider}`);
    }
    const from = env.PAGEPIN_MAIL_FROM;
    if (!from) throw new Error('启用邮件需设置 PAGEPIN_MAIL_FROM(发件地址)');
    if (mailProvider === 'resend') {
      const key = env.PAGEPIN_RESEND_API_KEY;
      if (!key) throw new Error('PAGEPIN_MAIL_PROVIDER=resend 需设置 PAGEPIN_RESEND_API_KEY');
      mail = { provider: 'resend', from, resendApiKey: key };
    } else {
      mail = { provider: 'log', from };
    }
  }

  const secret = str(env, 'PAGEPIN_SECRET', '');
  if (!secret) {
    // Node 入口会先从 {dataDir}/secret 落盘/读取后再调本函数;走到这说明两边都没给
    throw new Error('缺少 PAGEPIN_SECRET(会话签名密钥)');
  }

  return {
    port: num(env, 'PAGEPIN_PORT', 8000),
    dataDir: str(env, 'PAGEPIN_DATA_DIR', './data'),
    dbDriver: inferDbDriver(env.PAGEPIN_DB_URL, env.PAGEPIN_DB_DRIVER),
    dbUrl: env.PAGEPIN_DB_URL || undefined,
    dbAuthToken: env.PAGEPIN_DB_AUTH_TOKEN || undefined,
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
    turnstile,
    mail,
    secret,
    sessionTtlH: num(env, 'PAGEPIN_SESSION_TTL_H', 8),
    oidc,
    storage,
    s3,
    // 面向公开免费档的偏紧默认；自托管/团队实例按需用 env 调大。
    maxFileMb: num(env, 'PAGEPIN_MAX_FILE_MB', 25),
    maxSiteMb: num(env, 'PAGEPIN_MAX_SITE_MB', 200),
    maxFiles: num(env, 'PAGEPIN_MAX_FILES', 2000),
    freeUserMb: num(env, 'PAGEPIN_FREE_USER_MB', 1024),
    keepVersions: num(env, 'PAGEPIN_KEEP_VERSIONS', 3),
    deployTtlH: num(env, 'PAGEPIN_DEPLOY_TTL_H', 2),
    publicMaxHours: num(env, 'PAGEPIN_PUBLIC_MAX_HOURS', 168),
    deviceTokenTtlDays: num(env, 'PAGEPIN_DEVICE_TOKEN_TTL_DAYS', 90),
    secureCookies: mode === 'dual' ? externalScheme === 'https' : baseUrl.startsWith('https://'),
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
