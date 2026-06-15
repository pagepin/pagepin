/** 会话 = 无状态签名 JWT(HS256)落 host-only Cookie。
 *
 * 双域模式两套 Cookie,互不可达(host-only + 跨 origin):
 *   pp_view    @ 内容域 —— 仅断言「已登录」,只用于看私有站点
 *   pp_session @ 控制台 —— 授权管理 API,JWT 内嵌 csrf claim 与 pp_csrf Cookie 双提交比对
 * 单域模式只有 pp_session 一套(viewer 复用控制台会话)。
 */

import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { sign, verify as jwtVerify } from 'hono/jwt';

import type { Config } from '../config.js';

export const VIEW_COOKIE = 'pp_view';
export const SESSION_COOKIE = 'pp_session';
export const CSRF_COOKIE = 'pp_csrf'; // 非 httpOnly:SPA 读它回填 X-CSRF-Token 头
export const OAUTH_NONCE_COOKIE = 'pp_oauth'; // OAuth/OIDC 登录态绑定(host-only,防 login CSRF)

export type Plane = 'view' | 'session';

export interface SessionClaims {
  sub: string; // = users.id
  hdl: string | null;
  pln: Plane;
  iat: number;
  exp: number;
  csrf?: string;
  [k: string]: unknown; // hono/jwt JWTPayload 兼容
}

const ttl = (cfg: Config) => cfg.sessionTtlH * 3600;

export async function mint(
  cfg: Config, plane: Plane, sub: string, handle: string | null, csrf?: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: SessionClaims = { sub, hdl: handle, pln: plane, iat: now, exp: now + ttl(cfg) };
  if (csrf) claims.csrf = csrf;
  return sign(claims, cfg.secret, 'HS256');
}

export async function verify(cfg: Config, token: string, plane: Plane): Promise<SessionClaims | null> {
  try {
    const claims = (await jwtVerify(token, cfg.secret, 'HS256')) as SessionClaims;
    if (claims.pln !== plane) return null;
    return claims;
  } catch {
    return null;
  }
}

export async function readSession(c: Context, cfg: Config, plane: Plane): Promise<SessionClaims | null> {
  const token = getCookie(c, plane === 'view' ? VIEW_COOKIE : SESSION_COOKIE);
  return token ? verify(cfg, token, plane) : null;
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function setLoginCookies(
  c: Context, cfg: Config, plane: Plane, sub: string, handle: string | null,
): Promise<void> {
  const common = {
    httpOnly: true, secure: cfg.secureCookies, sameSite: 'Lax' as const,
    maxAge: ttl(cfg), path: '/',
  };
  if (plane === 'view') {
    setCookie(c, VIEW_COOKIE, await mint(cfg, 'view', sub, handle), common);
  } else {
    const csrf = randomHex(16);
    setCookie(c, SESSION_COOKIE, await mint(cfg, 'session', sub, handle, csrf), common);
    // csrf cookie 给 JS 读(双提交),其余属性与会话一致
    setCookie(c, CSRF_COOKIE, csrf, { ...common, httpOnly: false });
  }
}

export function clearLoginCookies(c: Context, plane: Plane): void {
  if (plane === 'view') {
    deleteCookie(c, VIEW_COOKIE, { path: '/' });
  } else {
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    deleteCookie(c, CSRF_COOKIE, { path: '/' });
  }
}

/** OAuth/OIDC 起跳:种一个 host-only 短时 nonce,并返回它(嵌进签名 state)。
 * 回跳时要求 cookie 里的 nonce == state 内嵌 nonce —— 攻击者无法在受害者浏览器里种我们域的 cookie,
 * 故无法把"自己发起的 state+code"塞给受害者完成登录(防 login CSRF / 会话固定)。 */
export function setOauthNonce(c: Context, cfg: Config): string {
  const nonce = randomHex(16);
  setCookie(c, OAUTH_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: cfg.secureCookies,
    sameSite: 'Lax', // 回跳是顶层 GET 导航,Lax 会带上;但攻击者种不进受害者浏览器
    maxAge: 600, // 与 state TTL 一致(10 分钟)
    path: '/',
  });
  return nonce;
}

/** 回跳:取出并清除 nonce cookie,与 state 内嵌 nonce 常数时间比对。 */
export function consumeOauthNonce(c: Context, stateNonce: unknown): boolean {
  const cookie = getCookie(c, OAUTH_NONCE_COOKIE);
  deleteCookie(c, OAUTH_NONCE_COOKIE, { path: '/' });
  if (typeof cookie !== 'string' || typeof stateNonce !== 'string' || cookie.length !== stateNonce.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < cookie.length; i++) diff |= cookie.charCodeAt(i) ^ stateNonce.charCodeAt(i);
  return diff === 0;
}

export function csrfOk(c: Context, claims: SessionClaims): boolean {
  const want = claims.csrf;
  const got = c.req.header('x-csrf-token');
  if (!want || !got || want.length !== got.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}
