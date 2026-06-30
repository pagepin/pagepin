/** 认证流文案域:auth.*(密码登录/注册、邀请、OIDC/社交回调)。
 *
 * 仅放 src/auth/routes.ts / oidc.ts / social.ts 的 JSON 错误体专有 key;
 * 与多处复用的 auth.account.disabled 等(见 common.ts)互不重复(test/i18n.test.ts 守护)。
 * 约定见 messages/common.ts 顶注:en/zh 同 key 集、占位符 {name} 同名同位、code === key。
 */

import type { Locale } from '../index.js';

export const authflow: Record<Locale, Record<string, string>> = {
  en: {
    // —— 密码登录 / 注册(routes.ts) ——
    'auth.password.notEnabled': 'Password login is not enabled',
    'auth.password.badCredentials': 'Incorrect email or password',
    'auth.password.tooShort': 'Password must be at least 8 characters',
    'auth.login.rateLimited': 'Too many attempts, please try again later',
    'auth.turnstile.failed': 'CAPTCHA verification failed, please try again',
    'auth.signup.notOpen': 'Sign-ups are not open',
    'auth.signup.rateLimited': 'Too many sign-ups, please try again later',
    'auth.signup.closed': 'Sign-ups are closed',
    'auth.email.invalid': 'Invalid email address',
    'auth.email.taken': 'This email is already registered',

    // —— 邀请注册(routes.ts) ——
    'auth.invite.notSupported': 'This instance does not support invite-based sign-up',
    'auth.invite.tokenMissing': 'Missing invite token',
    'auth.invite.invalidOrExpired': 'Invite is invalid or expired',
    'auth.invite.alreadyUsed': 'Invite has already been used',

    // —— OIDC / 社交回调(routes.ts) ——
    'auth.oidc.notEnabled': 'OIDC login is not enabled',
    'auth.social.notEnabled': 'This sign-in method is not enabled',
    'auth.oauth.missingCodeState': 'Missing code/state',
    'auth.oauth.stateInvalid': 'State is invalid or expired, please sign in again',

    // —— OIDC 交换(oidc.ts,OidcError → 502) ——
    'auth.oidc.discoveryFailed': 'OIDC discovery request failed',
    'auth.oidc.discoveryHttp': 'OIDC discovery failed (HTTP {status})',
    'auth.oidc.discoveryMissingEndpoints': 'OIDC discovery document is missing required endpoints',
    'auth.oidc.tokenRequestFailed': 'Request to the IdP token endpoint failed',
    'auth.oidc.tokenHttp': 'IdP token endpoint returned HTTP {status}',
    'auth.oidc.noAccessToken': 'The IdP did not return an access_token',
    'auth.oidc.userinfoRequestFailed': 'Request to the IdP userinfo endpoint failed',
    'auth.oidc.userinfoHttp': 'IdP userinfo endpoint returned HTTP {status}',
    'auth.oidc.userinfoMissingSub': 'IdP userinfo is missing sub',

    // —— 社交登录交换(social.ts,OidcError → 502) ——
    'auth.social.endpointRequestFailed': 'Request to the social login provider endpoint failed',
    'auth.social.endpointHttp': 'Social login provider endpoint returned HTTP {status}',
    'auth.social.googleMissingSub': 'Google userinfo is missing sub',
    'auth.social.githubMissingId': 'GitHub user is missing id',
    'auth.social.unknownProvider': 'Unknown social login provider: {id}',
    'auth.social.tokenRequestFailed': 'Request to the social login token endpoint failed',
    'auth.social.tokenHttp': 'Social login token endpoint returned HTTP {status}',
    'auth.social.noAccessToken': 'Social login provider did not return an access_token',
  },
  zh: {
    // —— 密码登录 / 注册(routes.ts) ——
    'auth.password.notEnabled': '未启用密码登录',
    'auth.password.badCredentials': '邮箱或密码不正确',
    'auth.password.tooShort': '密码至少 8 位',
    'auth.login.rateLimited': '尝试过于频繁，请稍后再试',
    'auth.turnstile.failed': '人机校验失败，请重试',
    'auth.signup.notOpen': '注册未开放',
    'auth.signup.rateLimited': '注册过于频繁，请稍后再试',
    'auth.signup.closed': '注册已关闭',
    'auth.email.invalid': '邮箱格式不正确',
    'auth.email.taken': '该邮箱已注册',

    // —— 邀请注册(routes.ts) ——
    'auth.invite.notSupported': '当前实例不支持邀请注册',
    'auth.invite.tokenMissing': '缺少邀请 token',
    'auth.invite.invalidOrExpired': '邀请无效或已过期',
    'auth.invite.alreadyUsed': '邀请已被使用',

    // —— OIDC / 社交回调(routes.ts) ——
    'auth.oidc.notEnabled': '未启用 OIDC 登录',
    'auth.social.notEnabled': '未启用该登录方式',
    'auth.oauth.missingCodeState': '缺 code/state',
    'auth.oauth.stateInvalid': 'state 无效或过期，请重新登录',

    // —— OIDC 交换(oidc.ts,OidcError → 502) ——
    'auth.oidc.discoveryFailed': 'OIDC discovery 请求失败',
    'auth.oidc.discoveryHttp': 'OIDC discovery 失败（HTTP {status}）',
    'auth.oidc.discoveryMissingEndpoints': 'OIDC discovery 文档缺少必要端点',
    'auth.oidc.tokenRequestFailed': 'IdP token 端点请求失败',
    'auth.oidc.tokenHttp': 'IdP token 端点返回 HTTP {status}',
    'auth.oidc.noAccessToken': 'IdP 未返回 access_token',
    'auth.oidc.userinfoRequestFailed': 'IdP userinfo 端点请求失败',
    'auth.oidc.userinfoHttp': 'IdP userinfo 端点返回 HTTP {status}',
    'auth.oidc.userinfoMissingSub': 'IdP userinfo 缺 sub',

    // —— 社交登录交换(social.ts,OidcError → 502) ——
    'auth.social.endpointRequestFailed': '社交登录 provider 端点请求失败',
    'auth.social.endpointHttp': '社交登录 provider 端点返回 HTTP {status}',
    'auth.social.googleMissingSub': 'Google userinfo 缺 sub',
    'auth.social.githubMissingId': 'GitHub user 缺 id',
    'auth.social.unknownProvider': '未知社交登录 provider：{id}',
    'auth.social.tokenRequestFailed': '社交登录 token 端点请求失败',
    'auth.social.tokenHttp': '社交登录 token 端点返回 HTTP {status}',
    'auth.social.noAccessToken': '社交登录 provider 未返回 access_token',
  },
};
