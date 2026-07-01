/** 账号与设置页（Settings.tsx）文案域:资料 / 修改密码 / 用量配额 / 已连接账号 / 验证邮件。
 *
 * 与服务端约定一致:en/zh key 集合须一致、跨域不重复;通用动作(保存/关闭等)复用 common.*。
 */

import type { Locale } from '../index';

export const settings: Record<Locale, Record<string, string>> = {
  en: {
    // —— 页头 ——
    'settings.backToSites': 'Back to sites',
    'settings.pageTitle': 'Account & settings',

    // —— 资料卡片 ——
    'settings.profile': 'Profile',
    'settings.handle': 'Handle',
    'settings.handleDesc': 'Permanent — appears in every share link.',
    'settings.notSetYet': 'Not set yet',
    'settings.locked': 'Locked',
    'settings.displayName': 'Display name',
    'settings.displayNameDesc': 'Shown in this console only.',
    'settings.email': 'Email',
    'settings.emailDesc': 'Used for sign-in.',
    'settings.password': 'Password',
    'settings.passwordDesc': 'Your sign-in password.',
    'settings.changePassword': 'Change password',
    'settings.profileSaved': 'Profile saved',
    'settings.saveFailed': 'Save failed',

    // —— 已连接账号 ——
    'settings.connectedAccounts': 'Connected accounts',
    'settings.connectedAccountsSub': 'Ways to sign in to this account',
    'settings.failedLoadAccounts': 'Failed to load connected accounts',
    'settings.connectedProvider': 'Connected {provider}',
    'settings.linkConflict': 'That account is already linked to a different pagepin user.',
    'settings.linkError': 'Could not connect that account.',
    'settings.connectFailed': 'Connect failed',
    'settings.disconnected': 'Disconnected',
    'settings.disconnectFailed': 'Disconnect failed',
    'settings.connectedDesc': 'Connected',
    'settings.primary': 'Primary',
    'settings.disconnectHint': 'Add another sign-in method before disconnecting this one',
    'settings.disconnect': 'Disconnect',
    'settings.notConnected': 'Not connected',
    'settings.connect': 'Connect',
    'settings.providerPassword': 'Password',
    'settings.providerSso': 'SSO',

    // —— 验证邮箱横幅 ——
    'settings.verifyEmailTitle': 'Verify your email.',
    'settings.verifyEmailBefore': 'Confirm',
    'settings.verifyEmailAfter': 'to secure your account.',
    'settings.resendEmail': 'Resend email',
    'settings.verifyEmailSent': 'Verification email sent',
    'settings.verifyEmailNotConfigured': 'Email sending is not configured on this instance',
    'settings.verifyEmailFailed': 'Could not send verification email',

    // —— API token 卡片 ——
    'settings.apiTokens': 'API tokens',
    'settings.apiTokensSub': 'Deploy credentials for agents & CI',

    // —— 用量卡片 ——
    'settings.usage': 'Usage',
    'settings.usageSub': "Against this instance's limits",
    'settings.failedLoadUsage': 'Failed to load usage',
    'settings.statSites': 'Sites',
    'settings.statSitesSub': 'hosted here',
    'settings.statStorage': 'Storage',
    'settings.statStorageSub': 'across all versions',
    'settings.perSiteLimit': 'Per-site limit',
    'settings.mbPerFile': 'MB/file',
    'settings.perSiteStorage': 'Per-site storage',
    'settings.filesUnit.one': 'file',
    'settings.filesUnit.other': 'files',
  },
  zh: {
    // —— 页头 ——
    'settings.backToSites': '返回站点',
    'settings.pageTitle': '账号与设置',

    // —— 资料卡片 ——
    'settings.profile': '资料',
    'settings.handle': 'Handle',
    'settings.handleDesc': '永久不变 —— 出现在每个分享链接中。',
    'settings.notSetYet': '尚未设置',
    'settings.locked': '已锁定',
    'settings.displayName': '显示名称',
    'settings.displayNameDesc': '仅在此控制台中显示。',
    'settings.email': '邮箱',
    'settings.emailDesc': '用于登录。',
    'settings.password': '密码',
    'settings.passwordDesc': '你的登录密码。',
    'settings.changePassword': '修改密码',
    'settings.profileSaved': '资料已保存',
    'settings.saveFailed': '保存失败',

    // —— 已连接账号 ——
    'settings.connectedAccounts': '已连接账号',
    'settings.connectedAccountsSub': '登录此账号的方式',
    'settings.failedLoadAccounts': '加载已连接账号失败',
    'settings.connectedProvider': '已连接 {provider}',
    'settings.linkConflict': '该账号已关联到另一个 pagepin 用户。',
    'settings.linkError': '无法连接该账号。',
    'settings.connectFailed': '连接失败',
    'settings.disconnected': '已断开连接',
    'settings.disconnectFailed': '断开连接失败',
    'settings.connectedDesc': '已连接',
    'settings.primary': '主登录方式',
    'settings.disconnectHint': '断开此登录方式前，请先添加另一种登录方式',
    'settings.disconnect': '断开连接',
    'settings.notConnected': '未连接',
    'settings.connect': '连接',
    'settings.providerPassword': '密码',
    'settings.providerSso': 'SSO',

    // —— 验证邮箱横幅 ——
    'settings.verifyEmailTitle': '验证你的邮箱。',
    'settings.verifyEmailBefore': '确认',
    'settings.verifyEmailAfter': '以保护你的账号。',
    'settings.resendEmail': '重新发送邮件',
    'settings.verifyEmailSent': '验证邮件已发送',
    'settings.verifyEmailNotConfigured': '本实例未配置邮件发送',
    'settings.verifyEmailFailed': '无法发送验证邮件',

    // —— API token 卡片 ——
    'settings.apiTokens': 'API token',
    'settings.apiTokensSub': '供 agent 与 CI 部署的凭证',

    // —— 用量卡片 ——
    'settings.usage': '用量',
    'settings.usageSub': '相对本实例的限额',
    'settings.failedLoadUsage': '加载用量失败',
    'settings.statSites': '站点',
    'settings.statSitesSub': '托管于此',
    'settings.statStorage': '存储',
    'settings.statStorageSub': '所有版本合计',
    'settings.perSiteLimit': '单站点上限',
    'settings.mbPerFile': 'MB/文件',
    'settings.perSiteStorage': '单站点存储',
    'settings.filesUnit.one': '个文件',
    'settings.filesUnit.other': '个文件',
  },
};
