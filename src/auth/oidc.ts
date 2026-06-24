/** 通用 OIDC Authorization Code flow(discovery 自动发现端点)。
 *
 * 泛化点:端点不再写死,走 `{issuer}/.well-known/openid-configuration` 发现
 * (结果模块级缓存;失败不缓存,下次重试)。token 端点用 client_secret_post
 * (form 编码),userinfo 用 Bearer GET。
 * ⚠️ IdP 可能不回 email —— 身份只认 sub;email 仅展示用、可空。
 * 本文件只用 Web API(fetch/AbortSignal),edge-safe;不 import hono ——
 * 错误抛 OidcError,由 routes.ts 转成 { detail } JSON(502)。
 */

import type { OidcConfig } from '../config.js';

export class OidcError extends Error {
  constructor(public detail: string) {
    super(detail);
    this.name = 'OidcError';
  }
}

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
}

export interface OidcIdentity {
  sub: string;
  name?: string;
  /** 仅创建新用户时兜底用;刷新老用户资料不看它 */
  preferredUsername?: string;
  email?: string;
  /** IdP 是否断言该邮箱已验证(email_verified claim);未验证的邮箱不得作账号键/并号提示。 */
  emailVerified?: boolean;
}

const TIMEOUT_MS = 15_000; // IdP 请求 15s 超时

/** discovery 结果缓存(Promise 级:并发首跳只发一次请求)。 */
const discoveryCache = new Map<string, Promise<Discovery>>();

async function fetchDiscovery(issuer: string): Promise<Discovery> {
  const url = `${issuer}/.well-known/openid-configuration`;
  let resp: Response;
  try {
    resp = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new OidcError('OIDC discovery 请求失败');
  }
  if (!resp.ok) throw new OidcError(`OIDC discovery 失败(HTTP ${resp.status})`);
  const doc = (await resp.json()) as Partial<Discovery>;
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.userinfo_endpoint) {
    throw new OidcError('OIDC discovery 文档缺少必要端点');
  }
  return doc as Discovery;
}

function discover(issuer: string): Promise<Discovery> {
  let p = discoveryCache.get(issuer);
  if (!p) {
    p = fetchDiscovery(issuer);
    p.catch(() => discoveryCache.delete(issuer)); // 失败的 Promise 不留在缓存里
    discoveryCache.set(issuer, p);
  }
  return p;
}

/** 拼授权跳转 URL(client_id/response_type/redirect_uri/scope/state + 配置的附加参数)。 */
export async function buildAuthorizeUrl(
  cfg: OidcConfig,
  redirectUri: string,
  state: string,
): Promise<string> {
  const disc = await discover(cfg.issuer);
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: cfg.scopes,
    state,
  });
  for (const [k, v] of Object.entries(cfg.authParams)) params.set(k, v);
  const sep = disc.authorization_endpoint.includes('?') ? '&' : '?';
  return `${disc.authorization_endpoint}${sep}${params.toString()}`;
}

/** code 换 token 再取 userinfo;返回最小身份三元组。 */
export async function exchangeCode(
  cfg: OidcConfig,
  code: string,
  redirectUri: string,
): Promise<OidcIdentity> {
  const disc = await discover(cfg.issuer);

  let tokenResp: Response;
  try {
    tokenResp = await fetch(disc.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new OidcError('IdP token 端点请求失败');
  }
  if (!tokenResp.ok) throw new OidcError(`IdP token 端点返回 HTTP ${tokenResp.status}`);
  const tok = (await tokenResp.json()) as Record<string, unknown>;
  const accessToken = tok.access_token;
  if (typeof accessToken !== 'string' || !accessToken) {
    throw new OidcError('IdP 未返回 access_token');
  }

  let userinfoResp: Response;
  try {
    userinfoResp = await fetch(disc.userinfo_endpoint, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new OidcError('IdP userinfo 端点请求失败');
  }
  if (!userinfoResp.ok) throw new OidcError(`IdP userinfo 端点返回 HTTP ${userinfoResp.status}`);
  const info = (await userinfoResp.json()) as Record<string, unknown>;

  const sub = info.sub;
  if (typeof sub !== 'string' && typeof sub !== 'number') {
    throw new OidcError('IdP userinfo 缺 sub');
  }
  const name = typeof info.name === 'string' && info.name ? info.name : undefined;
  const preferredUsername =
    typeof info.preferred_username === 'string' && info.preferred_username
      ? info.preferred_username
      : undefined;
  const email = typeof info.email === 'string' && info.email ? info.email : undefined;
  const emailVerified = info.email_verified === true;
  return { sub: String(sub), name, preferredUsername, email, emailVerified };
}
