/** 社交登录 provider 注册表 + OAuth2 授权码流程(edge-safe,只用 fetch/URLSearchParams)。
 *
 * 与 authMode=oidc(单 IdP discovery,见 oidc.ts)**并存且独立**:这里支持多家、按 id 路由,
 * 把"非 OIDC 的 OAuth2"(GitHub:无 discovery、`/user` 返回 `id` 不是 `sub`、email 另取)统一成 SocialIdentity。
 *
 * - `sub` 带 provider 前缀(`google:1234` / `github:567`)→ 与库内 `users_oidc_sub_uq` 共用、跨家不撞号。
 * - **不按 email 自动合并账号**:`email` 只在 provider 标记 verified 时透传(仅展示用);namespaced-sub 即独立身份。
 * - 错误统一抛 `OidcError`(复用),由 routes.ts 转 `{ detail }` 502。 */

import { OidcError } from './oidc.js';

export interface SocialIdentity {
  sub: string; // 带 provider 前缀
  name?: string;
  email?: string; // 仅 provider 标记 verified 才带
  emailVerified?: boolean; // email 是否已验证(有 email 即为 true;无可用 email 键时 false)
}

interface ProviderDef {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string;
  /** 拿 access token 取规范化身份(各家差异收敛在此) */
  fetchIdentity(accessToken: string): Promise<SocialIdentity>;
}

const TIMEOUT_MS = 15_000;

/** GET 一个 JSON 端点;非 2xx 抛 OidcError。返回 unknown,调用方自行收窄。 */
async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  let resp: Response;
  try {
    resp = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new OidcError('auth.social.endpointRequestFailed');
  }
  if (!resp.ok) throw new OidcError('auth.social.endpointHttp', { status: resp.status });
  return resp.json();
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}
function str(o: Record<string, unknown>, k: string): string | undefined {
  const v = o[k];
  return typeof v === 'string' && v ? v : undefined;
}

const GOOGLE: ProviderDef = {
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  scopes: 'openid email profile',
  async fetchIdentity(token) {
    const u = asRecord(
      await fetchJson('https://openidconnect.googleapis.com/v1/userinfo', {
        authorization: `Bearer ${token}`,
      }),
    );
    const sub = str(u, 'sub');
    if (!sub) throw new OidcError('auth.social.googleMissingSub');
    const verified = u.email_verified === true;
    return {
      sub: `google:${sub}`,
      name: str(u, 'name'),
      email: verified ? str(u, 'email') : undefined, // 仅 verified 才透传
      emailVerified: verified && !!str(u, 'email'),
    };
  },
};

const GITHUB: ProviderDef = {
  authorizeUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  scopes: 'read:user user:email',
  async fetchIdentity(token) {
    // ★ GitHub API 必须带 User-Agent,否则 403
    const headers = {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'pagepin',
    };
    const u = asRecord(await fetchJson('https://api.github.com/user', headers));
    const id = u.id;
    if (typeof id !== 'number' && typeof id !== 'string')
      throw new OidcError('auth.social.githubMissingId');
    // email 仅取 primary+verified(/user 的 email 可能为 null;需 user:email scope);
    // 排除 *.users.noreply.github.com —— 非真实可达邮箱,不能作账号键/连接提示(安全评审要求)。
    let email: string | undefined;
    try {
      const list = await fetchJson('https://api.github.com/user/emails', headers);
      if (Array.isArray(list)) {
        const rows = list.map(asRecord);
        const pick = rows.find((e) => e.primary === true && e.verified === true);
        const picked = pick ? str(pick, 'email') : undefined;
        if (picked && !picked.toLowerCase().endsWith('.users.noreply.github.com')) email = picked;
      }
    } catch {
      /* email 取不到不阻断登录 */
    }
    return {
      sub: `github:${id}`,
      name: str(u, 'name') ?? str(u, 'login'),
      email,
      emailVerified: !!email, // 仅 primary+verified 才落 email,故有 email 即已验证
    };
  },
};

const SOCIAL_PROVIDERS: Record<string, ProviderDef> = { google: GOOGLE, github: GITHUB };

/** config.ts 校验 PAGEPIN_OAUTH_PROVIDERS 用;也是 console 能渲染的全集。 */
export const SOCIAL_PROVIDER_IDS = Object.keys(SOCIAL_PROVIDERS);
export function isSupportedSocialProvider(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(SOCIAL_PROVIDERS, id);
}

/** 拼授权跳转 URL。 */
export function socialAuthorizeUrl(
  id: string,
  clientId: string,
  redirectUri: string,
  state: string,
): string {
  const p = SOCIAL_PROVIDERS[id];
  if (!p) throw new OidcError('auth.social.unknownProvider', { id });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: p.scopes,
    state,
  });
  return `${p.authorizeUrl}?${params.toString()}`;
}

/** code 换 token 再取规范化身份。 */
export async function exchangeSocialCode(
  id: string,
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<SocialIdentity> {
  const p = SOCIAL_PROVIDERS[id];
  if (!p) throw new OidcError('auth.social.unknownProvider', { id });
  let tokenResp: Response;
  try {
    tokenResp = await fetch(p.tokenUrl, {
      method: 'POST',
      // accept:application/json —— GitHub 默认回 form 编码,显式要 JSON
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new OidcError('auth.social.tokenRequestFailed');
  }
  if (!tokenResp.ok) throw new OidcError('auth.social.tokenHttp', { status: tokenResp.status });
  const tok = asRecord(await tokenResp.json());
  const accessToken = str(tok, 'access_token');
  if (!accessToken) throw new OidcError('auth.social.noAccessToken');
  return p.fetchIdentity(accessToken);
}
