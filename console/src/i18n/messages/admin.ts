/** 实例管理（Admin.tsx）文案域:概览统计、用户表、站点审核、注册模式、邀请。
 *
 * 与服务端约定一致:en/zh key 集合须完全一致;命名空间 admin.* 不与其他域重复。
 * 通用动作(取消/复制/加载中等)复用 common.*，本文件不再重定义。
 */

import type { Locale } from '../index';

export const admin: Record<Locale, Record<string, string>> = {
  en: {
    // —— 加载失败兜底 ——
    'admin.load.overview': 'Failed to load overview',
    'admin.load.settings': 'Failed to load settings',
    'admin.load.users': 'Failed to load users',
    'admin.load.sites': 'Failed to load sites',

    // —— 页头 / 标题 ——
    'admin.badge': 'Admin',
    'admin.backToSites': 'Back to sites',
    'admin.title': 'Instance admin',
    'admin.subtitle':
      "Manage who can sign in and keep an eye on what's stored. Only admins see this.",

    // —— 概览统计卡 ——
    'admin.stat.sites': 'Sites',
    'admin.stat.sitesSub': 'across all users',
    'admin.stat.users': 'Users',
    'admin.stat.adminsSub.one': '{n} admin',
    'admin.stat.adminsSub.other': '{n} admins',
    'admin.stat.storage': 'Storage',
    'admin.stat.storageSub': 'across all sites',
    'admin.stat.versions': 'Versions',
    'admin.stat.versionsSub': 'immutable deploys',

    // —— 注册模式 ——
    'admin.reg.heading': 'Registration',
    'admin.reg.authPrefix': 'This instance uses',
    'admin.reg.authSuffix': 'sign-in; registration mode and invites apply to password mode only.',
    'admin.reg.lockedPre': 'Locked by',
    'admin.reg.lockedPost': '— unset it to change here.',
    'admin.reg.changed': 'Registration: {mode}',
    'admin.reg.changeFailed': 'Could not change mode',
    'admin.reg.closed.label': 'Closed',
    'admin.reg.closed.desc': 'No new accounts. Existing users only.',
    'admin.reg.invite.label': 'Invite-only',
    'admin.reg.invite.desc': 'Join only via a one-time invite link you generate.',
    'admin.reg.open.label': 'Open',
    'admin.reg.open.desc': 'Anyone with the URL can self-register. Best for trusted networks.',

    // —— 邀请 ——
    'admin.invite.heading': 'Invite a user',
    'admin.invite.oneTimeNote': '· one-time link, expires soon',
    'admin.invite.emailPlaceholder': 'teammate@email.com (optional)',
    'admin.invite.asAdmin': 'as admin',
    'admin.invite.generate': 'Generate link',
    'admin.invite.copyNow': 'Copy it now — shown only once.',
    'admin.invite.sendTo': ' Send it to {email}; ',
    'admin.invite.worksOnce': 'works a single time.',
    'admin.invite.linkCopied': 'Invite link copied',
    'admin.invite.copyFailed': 'Copy failed',
    'admin.invite.linksHeading': 'Invite links',
    'admin.invite.anyEmail': '(any email)',
    'admin.invite.adminTag': '· admin',
    'admin.invite.expired': 'expired',
    'admin.invite.expiresIn': 'expires {when}',
    'admin.invite.revoke': 'Revoke',
    'admin.invite.revokeTitle': 'Revoke invite?',
    'admin.invite.revokeBody': 'The link{target} stops working immediately.',
    'admin.invite.revokeFor': ' for {email}',
    'admin.invite.revoked': 'Invite revoked',
    'admin.invite.revokeFailed': 'Revoke failed',
    'admin.invite.createFailed': 'Could not create invite',

    // —— 角色徽标 ——
    'admin.role.disabled': 'disabled',
    'admin.role.admin': 'admin',
    'admin.role.member': 'member',

    // —— 用户表 ——
    'admin.users.heading': 'Users',
    'admin.users.total': '{n} total',
    'admin.users.noHandle': '(no handle)',
    'admin.users.you': 'you',
    'admin.users.sites.one': '{n} site',
    'admin.users.sites.other': '{n} sites',
    'admin.users.never': 'never',
    'admin.users.active': 'active {when}',
    'admin.users.verifyEmail': 'Verify email',
    'admin.users.verifyTitle': 'Mark this email verified (rescue: bounced/dead address)',
    'admin.users.removeAdmin': 'Remove admin',
    'admin.users.makeAdmin': 'Make admin',
    'admin.users.ownRoleTitle': "You can't change your own role here",
    'admin.users.enable': 'Enable',
    'admin.users.disable': 'Disable',
    'admin.users.ownAccessTitle': "You can't change your own access here",

    // —— 用户操作(确认框 / toast) ——
    'admin.user.thisUser': 'this user',
    'admin.user.disableTitle': 'Disable {target}?',
    'admin.user.disableBody':
      'They lose access immediately — across the console, private pages and the comment layer.',
    'admin.user.disableConfirm': 'Disable',
    'admin.user.reEnabled': 'User re-enabled',
    'admin.user.disabled': 'User disabled',
    'admin.user.updateFailed': 'Update failed',
    'admin.user.emailVerified': 'Email verified',
    'admin.user.verifyFailed': 'Verify failed',
    'admin.user.adminRemoved': 'Admin removed',
    'admin.user.promoted': 'Promoted to admin',

    // —— 站点审核 ——
    'admin.sitesSection.heading': 'Sites',
    'admin.sitesSection.note':
      'Disable a page to make it return 451 to everyone (reversible). Delete also purges its stored files.',
    'admin.sitesSection.empty': 'No sites yet.',
    'admin.sitesSection.openPage': 'Open page',
    'admin.sitesSection.reEnable': 'Re-enable',
    'admin.sitesSection.deleteTitle': 'Delete site & purge files',
    'admin.sitesSection.files.one': '{n} file',
    'admin.sitesSection.files.other': '{n} files',
    'admin.sitesSection.updated': 'updated {when}',

    'admin.site.badgeDisabled': 'disabled',
    'admin.site.public': 'public',
    'admin.site.private': 'private',
    'admin.site.disableTitle': 'Disable “{slug}”?',
    'admin.site.disableBody':
      "The page returns 451 to everyone immediately — owner, public links, all of it. Redeploys won't bring it back; you can re-enable it here anytime.",
    'admin.site.disableConfirm': 'Disable page',
    'admin.site.disableReasonLabel': 'Reason (optional — shown to the owner)',
    'admin.site.disableReasonPlaceholder': 'e.g. phishing page reported via abuse@',
    'admin.site.disabled': 'Page disabled',
    'admin.site.disableFailed': 'Could not disable',
    'admin.site.reEnabled': 'Page re-enabled',
    'admin.site.reEnableFailed': 'Could not re-enable',
    'admin.site.deleteTitle': 'Delete “{slug}” (@{handle})?',
    'admin.site.deleteBody':
      'Removes the site and purges its stored files. The owner loses it and the link dies. This cannot be undone.',
    'admin.site.deleteConfirm': 'Delete site',
    'admin.site.deleted': 'Site deleted',
    'admin.site.deleteFailed': 'Delete failed',

    // —— 实例限制(只读) ——
    'admin.limits.heading': 'Instance limits',
    'admin.limits.note': 'Set via environment variables at boot.',
  },
  zh: {
    // —— 加载失败兜底 ——
    'admin.load.overview': '加载概览失败',
    'admin.load.settings': '加载设置失败',
    'admin.load.users': '加载用户失败',
    'admin.load.sites': '加载站点失败',

    // —— 页头 / 标题 ——
    'admin.badge': '管理员',
    'admin.backToSites': '返回站点',
    'admin.title': '实例管理',
    'admin.subtitle': '管理谁可以登录，并关注已存储的内容。仅管理员可见。',

    // —— 概览统计卡 ——
    'admin.stat.sites': '站点',
    'admin.stat.sitesSub': '所有用户合计',
    'admin.stat.users': '用户',
    'admin.stat.adminsSub.one': '{n} 名管理员',
    'admin.stat.adminsSub.other': '{n} 名管理员',
    'admin.stat.storage': '存储',
    'admin.stat.storageSub': '所有站点合计',
    'admin.stat.versions': '版本',
    'admin.stat.versionsSub': '不可变部署',

    // —— 注册模式 ——
    'admin.reg.heading': '注册',
    'admin.reg.authPrefix': '本实例使用',
    'admin.reg.authSuffix': '登录方式；注册模式与邀请仅对密码模式生效。',
    'admin.reg.lockedPre': '已被',
    'admin.reg.lockedPost': '锁定 —— 取消该环境变量后方可在此修改。',
    'admin.reg.changed': '注册模式：{mode}',
    'admin.reg.changeFailed': '无法切换模式',
    'admin.reg.closed.label': '关闭',
    'admin.reg.closed.desc': '不接受新账号，仅限现有用户。',
    'admin.reg.invite.label': '仅限邀请',
    'admin.reg.invite.desc': '只能通过你生成的一次性邀请链接加入。',
    'admin.reg.open.label': '开放',
    'admin.reg.open.desc': '任何拿到 URL 的人都可自助注册，适合可信网络。',

    // —— 邀请 ——
    'admin.invite.heading': '邀请用户',
    'admin.invite.oneTimeNote': '· 一次性链接，即将过期',
    'admin.invite.emailPlaceholder': 'teammate@email.com（可选）',
    'admin.invite.asAdmin': '设为管理员',
    'admin.invite.generate': '生成链接',
    'admin.invite.copyNow': '立即复制 —— 仅显示一次。',
    'admin.invite.sendTo': '发送给 {email}；',
    'admin.invite.worksOnce': '仅可使用一次。',
    'admin.invite.linkCopied': '邀请链接已复制',
    'admin.invite.copyFailed': '复制失败',
    'admin.invite.linksHeading': '邀请链接',
    'admin.invite.anyEmail': '（任意邮箱）',
    'admin.invite.adminTag': '· 管理员',
    'admin.invite.expired': '已过期',
    'admin.invite.expiresIn': '{when}过期',
    'admin.invite.revoke': '吊销',
    'admin.invite.revokeTitle': '吊销邀请？',
    'admin.invite.revokeBody': '该链接{target}将立即失效。',
    'admin.invite.revokeFor': '（{email}）',
    'admin.invite.revoked': '邀请已吊销',
    'admin.invite.revokeFailed': '吊销失败',
    'admin.invite.createFailed': '无法创建邀请',

    // —— 角色徽标 ——
    'admin.role.disabled': '已禁用',
    'admin.role.admin': '管理员',
    'admin.role.member': '成员',

    // —— 用户表 ——
    'admin.users.heading': '用户',
    'admin.users.total': '共 {n} 个',
    'admin.users.noHandle': '（无 handle）',
    'admin.users.you': '你',
    'admin.users.sites.one': '{n} 个站点',
    'admin.users.sites.other': '{n} 个站点',
    'admin.users.never': '从未',
    'admin.users.active': '活跃于 {when}',
    'admin.users.verifyEmail': '验证邮箱',
    'admin.users.verifyTitle': '将此邮箱标记为已验证（救援：退信/失效地址）',
    'admin.users.removeAdmin': '移除管理员',
    'admin.users.makeAdmin': '设为管理员',
    'admin.users.ownRoleTitle': '无法在此更改自己的角色',
    'admin.users.enable': '启用',
    'admin.users.disable': '禁用',
    'admin.users.ownAccessTitle': '无法在此更改自己的访问权限',

    // —— 用户操作(确认框 / toast) ——
    'admin.user.thisUser': '该用户',
    'admin.user.disableTitle': '禁用 {target}？',
    'admin.user.disableBody': '他们将立即失去访问权限 —— 包括控制台、私有页面和评论层。',
    'admin.user.disableConfirm': '禁用',
    'admin.user.reEnabled': '已重新启用用户',
    'admin.user.disabled': '已禁用用户',
    'admin.user.updateFailed': '更新失败',
    'admin.user.emailVerified': '邮箱已验证',
    'admin.user.verifyFailed': '验证失败',
    'admin.user.adminRemoved': '已移除管理员',
    'admin.user.promoted': '已提升为管理员',

    // —— 站点审核 ——
    'admin.sitesSection.heading': '站点',
    'admin.sitesSection.note':
      '停用页面后，它会对所有人返回 451（可逆）。删除还会清除其存储的文件。',
    'admin.sitesSection.empty': '暂无站点。',
    'admin.sitesSection.openPage': '打开页面',
    'admin.sitesSection.reEnable': '重新启用',
    'admin.sitesSection.deleteTitle': '删除站点并清除文件',
    'admin.sitesSection.files.one': '{n} 个文件',
    'admin.sitesSection.files.other': '{n} 个文件',
    'admin.sitesSection.updated': '更新于 {when}',

    'admin.site.badgeDisabled': '已停用',
    'admin.site.public': '公开',
    'admin.site.private': '私有',
    'admin.site.disableTitle': '停用“{slug}”？',
    'admin.site.disableBody':
      '该页面会立即对所有人返回 451 —— 所有者、公开链接，全部如此。重新部署也无法恢复；你随时可以在此重新启用。',
    'admin.site.disableConfirm': '停用页面',
    'admin.site.disableReasonLabel': '原因（可选 —— 会展示给所有者）',
    'admin.site.disableReasonPlaceholder': '例如：通过 abuse@ 举报的钓鱼页面',
    'admin.site.disabled': '页面已停用',
    'admin.site.disableFailed': '无法停用',
    'admin.site.reEnabled': '页面已重新启用',
    'admin.site.reEnableFailed': '无法重新启用',
    'admin.site.deleteTitle': '删除“{slug}”（@{handle}）？',
    'admin.site.deleteBody':
      '移除该站点并清除其存储的文件。所有者将失去它且链接失效。此操作不可撤销。',
    'admin.site.deleteConfirm': '删除站点',
    'admin.site.deleted': '站点已删除',
    'admin.site.deleteFailed': '删除失败',

    // —— 实例限制(只读) ——
    'admin.limits.heading': '实例限制',
    'admin.limits.note': '在启动时通过环境变量设置。',
  },
};
