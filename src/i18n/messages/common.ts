/** 通用 / 共享文案域:server.* / request.* / auth.* / comment.* / site.*。
 *
 * catalog 按域拆分到 messages/<域>.ts,由 messages.ts 聚合;拆分让各面并行落地时各占一文件、互不写冲突。
 * 约定(全域统一):
 *   - key 用点分命名空间 `<域>.<对象>.<问题>`,段内 camelCase(如 comment.text.tooLong)。
 *   - 占位符用 {name}(见 i18n/index.ts 的 t());务必 en/zh 同名同位。
 *   - en 与 zh 必须是「完全相同的 key 集合」;跨域文件不得定义同名 key(test/i18n.test.ts 做 parity + 无碰撞断言)。
 *   - code === key:错误体的 machine-readable code 即此处的 key,跨语言恒定。
 *
 * 本文件放被多处复用的共享 key(鉴权/账号/会话/请求体/站点)。各 API/HTML/邮件专有 key 见同目录其他文件。
 */

import type { Locale } from '../index.js';

export const common: Record<Locale, Record<string, string>> = {
  en: {
    // —— 通用 / 请求体 ——
    'server.internalError': 'Internal server error',
    'request.body.invalidJson': 'Request body is not valid JSON',
    'request.body.malformed': 'Malformed request body',

    // —— 鉴权 / 账号 / 会话 / token(deps.ts + 各 API 共用) ——
    'auth.unauthenticated': 'Not signed in',
    'auth.userNotFound': 'User not found, please sign in again',
    'auth.sessionExpired': 'Session expired, please sign in again',
    'auth.account.disabled': 'Account is disabled',
    'auth.csrf.failed': 'CSRF validation failed',
    'auth.token.consoleOnly':
      'Please use the console in a browser (API tokens cannot manage tokens)',
    'auth.adminRequired': 'Administrator privileges required',
    'auth.emailUnverified': 'Please verify your email before creating content',
    'auth.token.malformed': 'Invalid token (expected a pp_-prefixed PAT)',
    'auth.token.invalidOrRevoked': 'Token is invalid or revoked',
    'auth.token.expired': 'Token expired, sign in again to obtain a new one',
    'auth.token.userNotFound': 'Token refers to a non-existent user',

    // —— 评论(comments.ts) ——
    'comment.text.empty': 'Comment cannot be empty',
    'comment.text.tooLong': 'Comment too long (≤{max} chars)',
    'comment.text.notString': 'text must be a string',
    'comment.path.notString': 'path must be a string',
    'comment.path.missing': 'Missing path parameter',
    'comment.selector.length': 'selector length must be between 1 and {max} characters',
    'comment.coord.range': '{field} must be a number between 0 and 1',
    'comment.rect.pairRequired': 'rw/rh must be provided together',
    'comment.kind.notString': 'kind must be a string',
    'comment.kind.invalid': 'kind must be one of {kinds}',
    'comment.kind.invalidOrNull': 'kind must be one of {kinds} or null',
    'comment.anchorText.notString': 'anchor_text must be a string',
    'comment.anchorText.tooLong': 'anchor_text too long (≤{max} chars)',
    'comment.patch.empty': 'Provide resolved or kind',
    'comment.resolved.notBool': 'resolved must be a boolean',
    'comment.delete.forbidden': 'Only the comment author or site owner can delete',
    'comment.notFound': 'Comment not found',
    'comment.site.disabled': 'Comments are not enabled for this site',
    'comment.anonymousAuthor': 'Member',

    // —— 站点(comments.ts + sites.ts 共用) ——
    'site.notFound': 'Site not found',
    'site.path.invalid': 'Invalid path',
  },
  zh: {
    // —— 通用 / 请求体 ——
    'server.internalError': '服务器内部错误',
    'request.body.invalidJson': '请求体不是合法 JSON',
    'request.body.malformed': '请求体格式错误',

    // —— 鉴权 / 账号 / 会话 / token(deps.ts + 各 API 共用) ——
    'auth.unauthenticated': '未登录',
    'auth.userNotFound': '用户不存在，请重新登录',
    'auth.sessionExpired': '会话已失效，请重新登录',
    'auth.account.disabled': '账号已被禁用',
    'auth.csrf.failed': 'CSRF 校验失败',
    'auth.token.consoleOnly': '请在控制台浏览器里操作（API token 不能管理 token）',
    'auth.adminRequired': '需要管理员权限',
    'auth.emailUnverified': '请先验证邮箱后再创建内容',
    'auth.token.malformed': 'token 无效（应为 pp_ 开头的 PAT）',
    'auth.token.invalidOrRevoked': 'token 无效或已吊销',
    'auth.token.expired': 'token 已过期，请重新登录获取',
    'auth.token.userNotFound': 'token 对应用户不存在',

    // —— 评论(comments.ts) ——
    'comment.text.empty': '评论内容不能为空',
    'comment.text.tooLong': '评论过长（≤{max} 字）',
    'comment.text.notString': 'text 必须是字符串',
    'comment.path.notString': 'path 必须是字符串',
    'comment.path.missing': '缺少 path 参数',
    'comment.selector.length': 'selector 长度需在 1~{max} 字符之间',
    'comment.coord.range': '{field} 必须是 0~1 之间的数字',
    'comment.rect.pairRequired': 'rw/rh 必须成对出现',
    'comment.kind.notString': 'kind 必须是字符串',
    'comment.kind.invalid': 'kind 只能是 {kinds}',
    'comment.kind.invalidOrNull': 'kind 只能是 {kinds} 或 null',
    'comment.anchorText.notString': 'anchor_text 必须是字符串',
    'comment.anchorText.tooLong': 'anchor_text 过长（≤{max} 字）',
    'comment.patch.empty': '需提供 resolved 或 kind',
    'comment.resolved.notBool': 'resolved 必须是布尔值',
    'comment.delete.forbidden': '只有评论作者或站点所有者可以删除',
    'comment.notFound': '评论不存在',
    'comment.site.disabled': '该站点未开启评论',
    'comment.anonymousAuthor': '成员',

    // —— 站点(comments.ts + sites.ts 共用) ——
    'site.notFound': '站点不存在',
    'site.path.invalid': '非法路径',
  },
};
