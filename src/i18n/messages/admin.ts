/** 管理域文案:/api/admin/* —— 用户审核、站点审核、注册模式、邀请。
 *
 * 约定见 common.ts:key 点分命名空间、en/zh 同 key 集合、占位符同名同位、跨域文件不得重名。
 * 复用 common 的 site.notFound / request.body.malformed 等共享 key,本文件只放管理域专有 key。
 */

import type { Locale } from '../index.js';

export const admin: Record<Locale, Record<string, string>> = {
  en: {
    // —— 用户审核 ——
    'admin.user.patchEmpty': 'Provide is_admin or disabled',
    'admin.user.isAdmin.notBool': 'is_admin must be a boolean',
    'admin.user.disabled.notBool': 'disabled must be a boolean',
    'admin.user.notFound': 'User not found',
    'admin.user.disableSelf': 'You cannot disable your own account',
    'admin.user.lastAdmin': 'At least one enabled administrator must remain',

    // —— 实例设置:注册模式 ——
    'admin.settings.registrationLocked':
      'Registration mode is locked by an environment variable and cannot be changed here',
    'admin.settings.registrationMode.invalid':
      'registration_mode must be one of open/invite/closed',

    // —— 邀请 ——
    'admin.invite.passwordModeOnly':
      'Invite-based registration is only available in password login mode',
    'admin.invite.registrationClosed':
      'Registration is closed; cannot issue invites (switch registration mode to invite or open first)',
    'admin.invite.email.invalid': 'Invalid email format',
    'admin.invite.notFound': 'Invite not found',
  },
  zh: {
    // —— 用户审核 ——
    'admin.user.patchEmpty': '需提供 is_admin 或 disabled',
    'admin.user.isAdmin.notBool': 'is_admin 必须是布尔值',
    'admin.user.disabled.notBool': 'disabled 必须是布尔值',
    'admin.user.notFound': '用户不存在',
    'admin.user.disableSelf': '不能禁用自己',
    'admin.user.lastAdmin': '至少保留一名启用的管理员',

    // —— 实例设置:注册模式 ——
    'admin.settings.registrationLocked': '注册模式由环境变量锁定，不能在此修改',
    'admin.settings.registrationMode.invalid': 'registration_mode 只能是 open/invite/closed',

    // —— 邀请 ——
    'admin.invite.passwordModeOnly': '邀请注册仅在密码登录模式可用',
    'admin.invite.registrationClosed':
      '注册已关闭，无法签发邀请（先把注册模式切到 invite 或 open）',
    'admin.invite.email.invalid': '邮箱格式不正确',
    'admin.invite.notFound': '邀请不存在',
  },
};
