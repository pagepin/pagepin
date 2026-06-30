/** console 核心域文案:API 错误兜底(api.ts)、Toast、确认/改密弹窗、相对时间格式化(lib/format.ts)。
 *
 * 与服务端约定一致:catalog 按域拆到 messages/<域>.ts,messages.ts 聚合;各域文件 en/zh key 集合须一致、跨域不重复。
 * 通用动作(取消/确认 等)复用 common.*,本文件不重定义。
 */

import type { Locale } from '../index';

export const core: Record<Locale, Record<string, string>> = {
  en: {
    // —— API 错误兜底(api.ts,translate) ——
    'core.requestFailed': 'Request failed (HTTP {status})',
    'core.sessionExpiredRedirect': 'Session expired, redirecting…',
    'core.sessionExpired': 'Session expired',
    'core.responseParseFailed': 'Failed to parse response',
    'core.contentTooLarge': 'Content exceeds the size limit',
    'core.invalidPathOrParams': 'Invalid path or parameters',
    'core.deployFailed': 'Deploy failed (HTTP {status})',
    'core.networkUploadError': 'Network error, upload failed',

    // —— Toast 兜底 ——
    'core.actionFailed': 'Action failed',

    // —— 改密弹窗(PasswordDialog.tsx) ——
    'core.changePassword': 'Change password',
    'core.updatePassword': 'Update password',
    'core.passwordUpdated': 'Password updated',
    'core.passwordUpdateFailed': 'Could not update password',
    'core.currentPasswordPlaceholder': 'Enter current password',
    'core.newPasswordPlaceholder': 'At least 8 characters',
    'core.confirmPasswordPlaceholder': 'Re-enter new password',
    'core.passwordTooShort': 'New password must be at least 8 characters.',
    'core.passwordMismatch': "New passwords don't match.",
    'core.passwordsMatch': 'Passwords match.',

    // —— 相对时间 / 剩余时长(lib/format.ts,translate) ——
    'core.justNow': 'just now',
    'core.minutesAgo': '{n}m ago',
    'core.hoursAgo': '{n}h ago',
    'core.daysAgo': '{n}d ago',
    'core.daysHoursLeft': '{d}d {h}h left',
    'core.daysLeft': '{d}d left',
    'core.hoursMinutesLeft': '{h}h {m}m left',
    'core.hoursLeft': '{h}h left',
    'core.minutesLeft': '{m}m left',
  },
  zh: {
    // —— API 错误兜底(api.ts,translate) ——
    'core.requestFailed': '请求失败（HTTP {status}）',
    'core.sessionExpiredRedirect': '登录已过期，正在跳转…',
    'core.sessionExpired': '登录已过期',
    'core.responseParseFailed': '响应解析失败',
    'core.contentTooLarge': '内容超出大小限制',
    'core.invalidPathOrParams': '路径或参数非法',
    'core.deployFailed': '部署失败（HTTP {status}）',
    'core.networkUploadError': '网络错误，上传失败',

    // —— Toast 兜底 ——
    'core.actionFailed': '操作失败',

    // —— 改密弹窗(PasswordDialog.tsx) ——
    'core.changePassword': '修改密码',
    'core.updatePassword': '更新密码',
    'core.passwordUpdated': '密码已更新',
    'core.passwordUpdateFailed': '无法更新密码',
    'core.currentPasswordPlaceholder': '输入当前密码',
    'core.newPasswordPlaceholder': '至少 8 个字符',
    'core.confirmPasswordPlaceholder': '再次输入新密码',
    'core.passwordTooShort': '新密码至少需要 8 个字符。',
    'core.passwordMismatch': '两次输入的新密码不一致。',
    'core.passwordsMatch': '密码一致。',

    // —— 相对时间 / 剩余时长(lib/format.ts,translate) ——
    'core.justNow': '刚刚',
    'core.minutesAgo': '{n} 分钟前',
    'core.hoursAgo': '{n} 小时前',
    'core.daysAgo': '{n} 天前',
    'core.daysHoursLeft': '剩 {d} 天 {h} 小时',
    'core.daysLeft': '剩 {d} 天',
    'core.hoursMinutesLeft': '剩 {h} 小时 {m} 分钟',
    'core.hoursLeft': '剩 {h} 小时',
    'core.minutesLeft': '剩 {m} 分钟',
  },
};
