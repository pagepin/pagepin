/** 签名分享链接 —— 无状态、可撤销的「凭链接可看」访问層(edge-safe,零 I/O)。
 *
 * 两种令牌,同一 HS256 秘钥(cfg.secret),plane 隔离防跨用:
 *   share  —— URL 里的 ?key=,站长签发、可转发给任意评审者;绑定 (sid, skv)。
 *   shares —— 首次验 key 后种给「单个浏览器」的会话 Cookie,内嵌本浏览器专属 guest 身份。
 *     key 是群发的,guest 身份必须 per-浏览器,故不能放进 key 本身。
 *
 * 撤销:sites.share_key_version 自增 → 旧 key/旧会话的 skv 不再相等,全部立即失效。
 * Cookie 名按站点区分(pp_share_<siteId 前缀>),Path=/:评论 API(/api/comments/*)
 * 与站点路径不同前缀,path-scoped cookie 到不了,只能全路径 + 名字隔离。
 */

import type { Context } from 'hono';
import { setCookie } from 'hono/cookie';
import { sign, verify as jwtVerify } from 'hono/jwt';

import type { Config } from './config.js';
import { shortId } from './util.js';

export const SHARE_COOKIE_PREFIX = 'pp_share_';

/** URL 里的分享 key(群发,无个体身份)。 */
export interface ShareKeyClaims {
  pln: 'share';
  sid: string; // sites.id(防跨站点重放)
  skv: number; // 签发时的 share_key_version(撤销判定)
  iat: number;
  exp: number;
  [k: string]: unknown; // hono/jwt JWTPayload 兼容
}

/** 验 key 后种下的浏览器会话(个体 guest 身份在此)。 */
export interface ShareSessionClaims {
  pln: 'shares';
  sid: string;
  skv: number;
  gst: string; // 'guest:<id>' —— 本浏览器在本站点的稳定访客身份
  iat: number;
  exp: number;
  [k: string]: unknown;
}

/** Cookie 名 = 前缀 + siteId 头 12 个字母数字(uuid 去连字符),站点间互不覆盖。 */
export function shareCookieName(siteId: string): string {
  return SHARE_COOKIE_PREFIX + siteId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
}

export async function mintShareKey(
  cfg: Config,
  siteId: string,
  keyVersion: number,
  hours: number,
): Promise<{ token: string; expiresAt: string }> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + hours * 3600;
  const claims: ShareKeyClaims = { pln: 'share', sid: siteId, skv: keyVersion, iat: now, exp };
  return {
    token: await sign(claims, cfg.secret, 'HS256'),
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

/** 签名/过期/plane 任一不对 → null(撤销版本比对留给调用方,它有 site 行)。 */
export async function verifyShareKey(cfg: Config, token: string): Promise<ShareKeyClaims | null> {
  try {
    const claims = (await jwtVerify(token, cfg.secret, 'HS256')) as ShareKeyClaims;
    if (
      claims.pln !== 'share' ||
      typeof claims.sid !== 'string' ||
      typeof claims.skv !== 'number'
    ) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}

/** 会话继承 key 的到期时刻(链接失效,进来的人同刻失效)。 */
export async function mintShareSession(
  cfg: Config,
  siteId: string,
  keyVersion: number,
  exp: number,
): Promise<string> {
  const claims: ShareSessionClaims = {
    pln: 'shares',
    sid: siteId,
    skv: keyVersion,
    gst: `guest:${shortId(10)}`,
    iat: Math.floor(Date.now() / 1000),
    exp,
  };
  return sign(claims, cfg.secret, 'HS256');
}

export async function verifyShareSession(
  cfg: Config,
  token: string,
): Promise<ShareSessionClaims | null> {
  try {
    const claims = (await jwtVerify(token, cfg.secret, 'HS256')) as ShareSessionClaims;
    if (
      claims.pln !== 'shares' ||
      typeof claims.sid !== 'string' ||
      typeof claims.skv !== 'number' ||
      typeof claims.gst !== 'string'
    ) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}

/** 读并校验「本站点」的分享会话:名字定位 → 验签 → sid/skv 与当前站点行比对。 */
export async function readShareSession(
  c: Context,
  cfg: Config,
  site: { id: string; shareKeyVersion: number },
): Promise<ShareSessionClaims | null> {
  // hono/cookie 的 getCookie 逐名取;名字是确定的,直接算
  const raw = c.req.header('cookie');
  if (!raw) return null;
  const name = shareCookieName(site.id);
  let token: string | undefined;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) {
      token = part.slice(i + 1).trim();
      break;
    }
  }
  if (!token) return null;
  const claims = await verifyShareSession(cfg, token);
  if (!claims || claims.sid !== site.id || claims.skv !== site.shareKeyVersion) return null;
  return claims;
}

export function setShareCookie(
  c: Context,
  cfg: Config,
  siteId: string,
  token: string,
  exp: number,
): void {
  setCookie(c, shareCookieName(siteId), token, {
    httpOnly: true,
    secure: cfg.secureCookies,
    sameSite: 'Lax',
    maxAge: Math.max(1, exp - Math.floor(Date.now() / 1000)),
    path: '/',
  });
}
