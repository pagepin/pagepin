/** 分享链接的「凭链接可看」访问层(edge-safe)。
 *
 * 两代链接、同一套浏览器会话:
 *   短码(现行)—— /s/<code>,落库 share_links 表;默认永不过期,撤销是主要管控。
 *   ?key= JWT(旧)—— 无状态 HS256,绑定 (sid, skv);已发出的链接兼容到自然过期,不再新铸。
 *
 * 会话令牌(plane 'shares',同一 HS256 秘钥,plane 隔离防跨用):
 *   验链接后种给「单个浏览器」的会话 Cookie,内嵌本浏览器专属 guest 身份
 *   (链接是群发的,guest 身份必须 per-浏览器,不能放进链接本身)。
 *   短码兑换的会话另嵌 lnk=短码,固定 TTL 滑动续期,与链接的 expires_at 解耦
 *   (链接过期只挡新访客,不踢已进来的人);旧 JWT 兑换的会话仍继承 key 的绝对到期。
 *
 * 撤销两级,都即时踢会话:
 *   单条 —— share_links.revoked_at 非空 → 兑换与既有会话(readActiveShareSession 查库)都拒;
 *   全站 —— sites.share_key_version 自增 → 所有会话/旧 key 的 skv 不再相等,零查库即拒。
 * Cookie 名按站点区分(pp_share_<siteId 前缀>),Path=/:评论 API(/api/comments/*)
 * 与站点路径不同前缀,path-scoped cookie 到不了,只能全路径 + 名字隔离。
 */

import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { setCookie } from 'hono/cookie';
import { sign, verify as jwtVerify } from 'hono/jwt';

import type { Config } from './config.js';
import { shareLinks, type Db, type ShareLinkRow } from './db/index.js';
import { shortId } from './util.js';

export const SHARE_COOKIE_PREFIX = 'pp_share_';

/** 短码兑换的会话 TTL(滑动):每次访问剩余不足一半就续满,常来常新;
 *  两周不来才需要重点一次链接(链接默认永久,重点即重进)。 */
export const SHARE_SESSION_TTL_S = 14 * 24 * 3600;

/** URL 里的分享 key(群发,无个体身份)。 */
export interface ShareKeyClaims {
  pln: 'share';
  sid: string; // sites.id(防跨站点重放)
  skv: number; // 签发时的 share_key_version(撤销判定)
  iat: number;
  exp: number;
  [k: string]: unknown; // hono/jwt JWTPayload 兼容
}

/** 验链接后种下的浏览器会话(个体 guest 身份在此)。 */
export interface ShareSessionClaims {
  pln: 'shares';
  sid: string;
  skv: number;
  gst: string; // 'guest:<id>' —— 本浏览器在本站点的稳定访客身份
  lnk?: string; // 短码兑换的会话记来源链接;单条撤销时据此查库踢会话。旧 JWT 会话无此字段
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

/** 铸浏览器会话。旧 JWT 兑换:exp 传 key 的绝对到期、lnk 不传;
 *  短码兑换/续期:exp 传 now+SHARE_SESSION_TTL_S、lnk 传短码。
 *  gst 可选:重复兑换/续期时传入既有 gst 以保持「本浏览器稳定访客身份」不变
 *  (否则每次都换新身份,旧评论作者权/限频桶全丢)。不传则新铸一个。 */
export async function mintShareSession(
  cfg: Config,
  siteId: string,
  keyVersion: number,
  exp: number,
  gst?: string,
  lnk?: string,
): Promise<string> {
  const claims: ShareSessionClaims = {
    pln: 'shares',
    sid: siteId,
    skv: keyVersion,
    gst: gst ?? `guest:${shortId(10)}`,
    iat: Math.floor(Date.now() / 1000),
    exp,
  };
  if (lnk) claims.lnk = lnk;
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

/** readShareSession + 单条撤销判定:lnk 会话查 share_links 一行(pk),链接被单条撤销即拒。
 *  链接的 expires_at 在此**不**看 —— 过期只挡新兑换,已进来的会话由自身 exp(滑动)管生死。
 *  serving 与评论 API 的访客鉴权都必须走这里,否则撤销的链接还能评论。 */
export async function readActiveShareSession(
  c: Context,
  cfg: Config,
  db: Db,
  site: { id: string; shareKeyVersion: number },
): Promise<ShareSessionClaims | null> {
  const claims = await readShareSession(c, cfg, site);
  if (!claims) return null;
  if (claims.lnk) {
    const link = (await db.select().from(shareLinks).where(eq(shareLinks.id, claims.lnk)))[0];
    if (!link || link.siteId !== site.id || link.revokedAt !== null) return null;
  }
  return claims;
}

/** 短码兑换判定:行存在、属本站可另比对、未撤销、未过期(过期只在这一步挡)。 */
export function shareLinkRedeemable(
  link: ShareLinkRow | undefined,
  now: Date,
): link is ShareLinkRow {
  if (!link || link.revokedAt !== null) return false;
  return link.expiresAt === null || link.expiresAt > now.toISOString();
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

/** 与 setShareCookie 同一属性口径的序列化值 —— 给「响应已成品后补头」的路径用
 *  (serve() 直接 new Response 返回,hono 的 setCookie 预备头会被丢弃)。 */
export function shareCookieHeader(cfg: Config, siteId: string, token: string, exp: number): string {
  const maxAge = Math.max(1, exp - Math.floor(Date.now() / 1000));
  return (
    `${shareCookieName(siteId)}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax` +
    (cfg.secureCookies ? '; Secure' : '')
  );
}
