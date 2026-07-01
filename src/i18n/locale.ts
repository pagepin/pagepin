/** 请求级 locale 解析中间件 + 取用/出错的 Hono context 助手。
 *
 * 解析顺序:?lang= → pp_lang cookie → Accept-Language 头 → 配置默认(PAGEPIN_DEFAULT_LOCALE)。
 * 通道选 pp_lang cookie:浏览器 fetch 不能设 Accept-Language,而 cookie 顶层导航与 XHR 都自动带,
 * 故同源下同时覆盖 SPA fetch、HTML 登录墙/viewer、/skill.md。非 httpOnly,便于 console 切换器直接写。
 * 单域:console 与内容同源,切换器的选择对二者都生效。
 * 双域:pp_lang 是 host-only(不设 Domain,与会话 cookie 的隔离取向一致),故 console 域切换的语言
 *   不会带到内容域 —— 内容域按自己的 ?lang=/Accept-Language/默认独立解析(优雅降级,非错误)。
 *
 * 双域坑:outer 路由用 sub.fetch(c.req.raw) 重建 context,outer 上的中间件不传递到子 app
 * (与 requestLogger 同理),故本中间件必须挂在 single app 以及 dual 的 content/console 两个子 app 上。
 */

import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import type { AppEnv } from '../types.js';
import {
  DEFAULT_FALLBACK,
  errorBody,
  normalizeLocale,
  type Locale,
  type TParams,
} from './index.js';

export const LANG_COOKIE = 'pp_lang';
const ONE_YEAR_SECONDS = 31_536_000;

export function makeLocaleMiddleware(defaultLocale: Locale, secureCookies: boolean) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const fromQuery = normalizeLocale(c.req.query('lang'));
    const fromCookie = normalizeLocale(getCookie(c, LANG_COOKIE));
    const fromAccept = normalizeLocale(c.req.header('accept-language'));
    const locale: Locale = fromQuery ?? fromCookie ?? fromAccept ?? defaultLocale;
    c.set('locale', locale);
    // 显式 ?lang= 覆盖:回写 cookie,让后续 SPA fetch / 顶层导航与本次选择保持一致。
    if (fromQuery && fromQuery !== fromCookie) {
      setCookie(c, LANG_COOKIE, fromQuery, {
        httpOnly: false,
        secure: secureCookies,
        sameSite: 'Lax',
        path: '/',
        maxAge: ONE_YEAR_SECONDS,
      });
    }
    await next();
  });
}

/** 取已解析的请求 locale;中间件未跑到(如极早期 onError)时回落兜底语言。 */
export function localeOf(c: Context<AppEnv>): Locale {
  return c.get('locale') ?? DEFAULT_FALLBACK;
}

/** 直接产出 JSON 错误响应 { detail, code },供散落的 c.json({ detail }) 站点统一替换。 */
export function jsonError(
  c: Context<AppEnv>,
  status: ContentfulStatusCode,
  key: string,
  params?: TParams,
) {
  return c.json(errorBody(localeOf(c), key, params), status);
}
