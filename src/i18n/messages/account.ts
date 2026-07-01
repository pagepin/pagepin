/** 账号域文案:me.* / token.* / device.*。
 *
 * 覆盖 /api/me(handle 确认/校验/建议、资料、改密、用量、身份、重发验证信)、
 * /api/tokens(创建/轮换/吊销)、/api/device(OAuth2 设备授权 approve/deny)。
 * 命名与占位约定见 messages/common.ts;通用 auth./request. 域 key 不在此重复定义。
 */

import type { Locale } from '../index.js';

export const account: Record<Locale, Record<string, string>> = {
  en: {
    // —— /api/me ——
    'me.body.fieldRequired': 'Request body must include the {field} field',
    'me.displayName.tooLong': 'Display name must be at most 64 characters',
    'me.displayName.invalidType': 'display_name must be a string or null',
    'me.password.disabled':
      'Password login is not enabled on this instance; cannot change password',
    'me.password.noLocal': 'This account has no local password (OIDC login)',
    'me.password.fieldsRequired': 'current_password and new_password are required',
    'me.password.tooShort': 'New password must be at least 8 characters',
    'me.password.currentIncorrect': 'Current password is incorrect',
    'me.identity.notFound': 'Identity not found',
    'me.identity.passwordUndetachable': 'The email login method cannot be disconnected',
    'me.identity.lastOne': 'Cannot disconnect the last login method',
    'me.verifyEmail.notRequired': 'This account does not require email verification',
    'me.verifyEmail.sendFailed': 'Failed to send, please try again later',
    'me.handle.alreadySet': 'Handle is already set and cannot be changed',
    'me.handle.invalid':
      'Handle must be 2-32 lowercase letters/digits/hyphens, start with a letter, and not be a reserved word',
    'me.handle.taken': 'Handle is already taken',

    // —— /api/tokens ——
    'token.name.length': 'Name must be 1-64 characters',
    'token.limit.reached': 'Token limit reached ({max}); revoke unused tokens first',
    'token.notFound': 'Token not found',

    // —— /api/device ——
    'device.deviceCode.missing': 'Missing device_code',
    'device.userCode.missing': 'Missing user_code',
    'device.notFoundOrExpired':
      'Device code not found or expired; please restart login from your tool',
    'device.alreadyHandled': 'This device code has already been handled',
  },
  zh: {
    // —— /api/me ——
    'me.body.fieldRequired': '请求体需包含 {field} 字段',
    'me.displayName.tooLong': '显示名最多 64 字',
    'me.displayName.invalidType': 'display_name 必须是字符串或 null',
    'me.password.disabled': '当前实例未启用密码登录，无法改密',
    'me.password.noLocal': '当前账号没有本地密码（OIDC 登录）',
    'me.password.fieldsRequired': '需 current_password 与 new_password',
    'me.password.tooShort': '新密码至少 8 位',
    'me.password.currentIncorrect': '当前密码不正确',
    'me.identity.notFound': '身份不存在',
    'me.identity.passwordUndetachable': '邮箱登录方式不可断开',
    'me.identity.lastOne': '不能断开最后一个登录方式',
    'me.verifyEmail.notRequired': '当前账号无需邮箱验证',
    'me.verifyEmail.sendFailed': '发送失败，请稍后再试',
    'me.handle.alreadySet': 'handle 已设置，不可修改',
    'me.handle.invalid': 'handle 需 2-32 位小写字母/数字/中划线、字母开头，且不在保留字内',
    'me.handle.taken': 'handle 已被占用',

    // —— /api/tokens ——
    'token.name.length': '名称需 1-64 字符',
    'token.limit.reached': 'token 数量已达上限（{max}），请先吊销不用的',
    'token.notFound': 'token 不存在',

    // —— /api/device ——
    'device.deviceCode.missing': '缺少 device_code',
    'device.userCode.missing': '缺少 user_code',
    'device.notFoundOrExpired': '设备码不存在或已过期，请在工具里重新发起登录',
    'device.alreadyHandled': '该设备码已被处理',
  },
};
