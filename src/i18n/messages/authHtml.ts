/** 服务端渲染的鉴权类 HTML / 邮件文案域:auth.html.*(内容域登录墙 + 邮箱验证落地页 + 内联 JS)
 *  与 email.*(邮箱验证信:主题 / 纯文本 / HTML)。
 *
 * 这些是 HTML / 邮件字符串构建器(非 JSON 错误体),由 src/auth/routes.ts 与 src/mail/verify.ts 使用。
 * 约定见 common.ts:点分命名空间、{name} 占位 en/zh 同名同位、en/zh key 集合完全一致、跨域不得重名。
 */

import type { Locale } from '../index.js';

export const authHtml: Record<Locale, Record<string, string>> = {
  en: {
    // —— 内容域登录墙(loginPage)——
    'auth.html.signIn.title': 'Sign in · pagepin',
    'auth.html.signIn.heading': 'Sign in to view',
    'auth.html.signIn.subtitle': 'Sign in to your pagepin account to continue.',
    'auth.html.field.email': 'Email',
    'auth.html.field.password': 'Password',
    'auth.html.signIn.button': 'Sign in',
    'auth.html.hostedOn': 'Hosted on',
    // 内联 <script> 的字符串字面量(经 JSON.stringify 注入,安全转义)
    'auth.html.signingIn': 'Signing in…',
    'auth.html.signInFailed': 'Sign-in failed',
    'auth.html.networkError': 'Network error, please retry',
    // —— 社交登录按钮(socialButtonsHtml)——
    'auth.html.continueWith': 'Continue with {provider}',
    'auth.html.or': 'or',
    // —— 邮箱验证落地页(GET /auth/verify-email)——
    'auth.html.verify.failTitle': 'Verification failed · pagepin',
    'auth.html.verify.failHeading': 'Link invalid or expired',
    'auth.html.verify.goButton': 'Go to pagepin',
    'auth.html.verify.invalidExpired':
      'This verification link is invalid or has expired. Sign in and resend it from Settings.',
    'auth.html.verify.emailMismatch': 'This link no longer matches your account email.',
    'auth.html.verify.successTitle': 'Email verified · pagepin',
    'auth.html.verify.successHeading': 'Email verified',
    'auth.html.verify.successBody': 'Thanks — {email} is confirmed.',

    // —— 邮箱验证信(sendVerificationEmail)——
    'email.verify.subject': 'Verify your pagepin email',
    'email.verify.text':
      "Confirm your email for pagepin:\n\n{link}\n\nThis link expires in 24 hours. If you didn't create a pagepin account, you can ignore this email.",
    'email.verify.html.heading': 'Verify your email',
    'email.verify.html.body':
      'Confirm this address to secure your pagepin account. This link expires in 24 hours.',
    'email.verify.html.button': 'Verify email',
    'email.verify.html.orPaste': 'Or paste this link:',
    'email.verify.html.ignore': "If you didn't create a pagepin account, ignore this email.",
  },
  zh: {
    // —— 内容域登录墙(loginPage)——
    'auth.html.signIn.title': '登录 · pagepin',
    'auth.html.signIn.heading': '登录后查看',
    'auth.html.signIn.subtitle': '登录你的 pagepin 账号以继续。',
    'auth.html.field.email': '邮箱',
    'auth.html.field.password': '密码',
    'auth.html.signIn.button': '登录',
    'auth.html.hostedOn': '托管于',
    // 内联 <script> 的字符串字面量(经 JSON.stringify 注入,安全转义)
    'auth.html.signingIn': '正在登录…',
    'auth.html.signInFailed': '登录失败',
    'auth.html.networkError': '网络错误，请重试',
    // —— 社交登录按钮(socialButtonsHtml)——
    'auth.html.continueWith': '使用 {provider} 继续',
    'auth.html.or': '或',
    // —— 邮箱验证落地页(GET /auth/verify-email)——
    'auth.html.verify.failTitle': '验证失败 · pagepin',
    'auth.html.verify.failHeading': '链接无效或已过期',
    'auth.html.verify.goButton': '前往 pagepin',
    'auth.html.verify.invalidExpired': '此验证链接无效或已过期。请登录后在设置中重新发送。',
    'auth.html.verify.emailMismatch': '此链接已不再匹配你的账号邮箱。',
    'auth.html.verify.successTitle': '邮箱已验证 · pagepin',
    'auth.html.verify.successHeading': '邮箱已验证',
    'auth.html.verify.successBody': '谢谢 —— {email} 已确认。',

    // —— 邮箱验证信(sendVerificationEmail)——
    'email.verify.subject': '验证你的 pagepin 邮箱',
    'email.verify.text':
      '确认你的 pagepin 邮箱：\n\n{link}\n\n此链接将在 24 小时后失效。如果你没有创建 pagepin 账号，可以忽略此邮件。',
    'email.verify.html.heading': '验证你的邮箱',
    'email.verify.html.body':
      '确认此邮箱地址以保护你的 pagepin 账号安全。此链接将在 24 小时后失效。',
    'email.verify.html.button': '验证邮箱',
    'email.verify.html.orPaste': '或粘贴此链接：',
    'email.verify.html.ignore': '如果你没有创建 pagepin 账号，请忽略此邮件。',
  },
};
