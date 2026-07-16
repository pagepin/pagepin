/** sites 文案域:站点列表(SitesView)与单站点卡片(SiteCard)。
 *
 * 约定见 messages/common.ts:en/zh key 集合须一致、跨域不重复;通用动作复用 common.*。
 */

import type { Locale } from '../index';

export const sites: Record<Locale, Record<string, string>> = {
  en: {
    // —— 列表外壳(SitesView) ——
    'sites.heading': 'My sites',
    'sites.empty.title': 'No sites yet',
    'sites.empty.desc':
      "Drop an HTML or Markdown file — or a whole folder — to publish your first page. You'll get a shareable link the moment it lands.",
    'sites.empty.pick': 'Drop your first file',
    'sites.empty.agent': 'Deploying from an agent?',
    'sites.search.placeholder': 'Search slug / title',
    'sites.deploy': 'Deploy',
    'sites.noMatch': 'No sites match “{query}”',
    'sites.drop.release': 'Release to deploy',
    'sites.drop.hint': 'Drop anywhere — new site, or a new version of a matching slug',

    // —— 列表 toast ——
    'sites.toast.noFiles': 'No files were collected',
    'sites.toast.dropFailed': 'Failed to read dropped content',
    'sites.toast.installCopied': 'Copied — run it in your terminal',
    'sites.toast.copyFailed': 'Copy failed',
    'sites.toast.linkCopied': 'Link copied',

    // —— 站点卡片:徽标 ——
    'sites.unresolved.one': '{n} unresolved comment',
    'sites.unresolved.other': '{n} unresolved comments',
    'sites.badge.disabledTitle': 'Disabled by an administrator — returns 451 to everyone',
    'sites.badge.disabled': 'Disabled',
    'sites.badge.public': 'Public · {remaining}',
    'sites.badge.revertedTitle': 'Public window ended — reverted to private',
    'sites.badge.reverted': 'Reverted',
    'sites.badge.private': 'Private',
    'sites.copyLink': 'Copy link',
    'sites.open': 'Open',

    // —— 站点卡片:停用提示 ——
    'sites.suspended.title': 'This page has been disabled by an administrator.',
    'sites.suspended.body': "It returns 451 to all visitors and redeploys won't restore it.",
    'sites.suspended.reason': ' Reason: {reason}.',
    'sites.suspended.appeal': ' Contact the instance operator to appeal.',

    // —— 站点卡片:元信息 ——
    'sites.fileCount.one': '{n} file',
    'sites.fileCount.other': '{n} files',
    'sites.updatedAt': 'updated {time}',

    // —— 站点卡片:操作 ——
    'sites.action.makePrivate': 'Extend / make private',
    'sites.action.makePublic': 'Make public',
    'sites.action.shareLink': 'Share link',
    'sites.action.redeploy': 'Redeploy',
    'sites.action.versions': 'Versions · {count}',
    'sites.action.settings': 'Settings',
    'sites.action.deleteTitle': 'Delete site',

    // —— 站点卡片:公开分享面板 ——
    'sites.share.extend': 'Extend window (restarts the clock)',
    'sites.share.publicFor': 'Public for (auto-reverts to private)',
    'sites.share.revertNow': 'Revert to private now',
    'sites.window.1h': '1 hour',
    'sites.window.6h': '6 hours',
    'sites.window.24h': '24 hours',
    'sites.window.72h': '3 days',
    'sites.window.168h': '7 days',

    // —— 分享链接弹窗(ShareLinkDialog) ——
    'sites.shareLink.title': 'Share “{slug}”',
    'sites.shareLink.desc':
      'Anyone with the link can view this page — no account needed. Links never expire by default; revoke one (or all) here whenever you want. Visitors stay signed in as long as they keep visiting.',
    'sites.shareLink.expiresIn': 'Link valid for',
    'sites.shareLink.hPerm': 'Until revoked',
    'sites.shareLink.h24': '24 hours',
    'sites.shareLink.h72': '3 days',
    'sites.shareLink.h168': '7 days',
    'sites.shareLink.h720': '30 days',
    'sites.shareLink.labelPlaceholder': 'Note, e.g. “for the design review” (optional)',
    'sites.shareLink.create': 'Create link',
    'sites.shareLink.createAnother': 'Create another link',
    'sites.shareLink.createFailed': 'Failed to create share link',
    'sites.shareLink.expiresAt': 'Expires {time}',
    'sites.shareLink.never': 'Never expires — revoke it anytime',
    'sites.shareLink.listTitle': 'Active links',
    'sites.shareLink.listEmpty': 'No active links yet.',
    'sites.shareLink.listExpired': 'Expired',
    'sites.shareLink.listNever': 'Never expires',
    'sites.shareLink.listExpires': 'Expires {time}',
    'sites.shareLink.revokeOne': 'Revoke',
    'sites.shareLink.revokeOneFailed': 'Failed to revoke the link',
    'sites.shareLink.guestComments': 'Allow guests to comment',
    'sites.shareLink.guestCommentsDesc':
      'Visitors arriving via a share link can pin review comments on the page, no account needed.',
    'sites.shareLink.revokeDesc':
      'Revoking invalidates every share link ever issued for this site, including guest sessions already in progress.',
    'sites.shareLink.revokeAll': 'Revoke all links',
    'sites.shareLink.revokeTitle': 'Revoke all share links for “{slug}”?',
    'sites.shareLink.revokeBody':
      'Every share link ever created for this site stops working immediately, including guest sessions already in progress. This cannot be undone — you can create new links afterwards.',
    'sites.shareLink.revokeConfirm': 'Revoke all',

    // —— 站点卡片:设置面板 ——
    'sites.settings.comments': 'Page comments',
    'sites.settings.commentsDesc':
      'Signed-in visitors can pin review comments on the page (hidden from anonymous public visitors).',
    'sites.settings.spa': 'SPA fallback',
    'sites.settings.spaDesc': 'Single-page app routing: serve index.html on a 404.',

    // —— 站点卡片:版本面板 ——
    'sites.versions.loading': 'Loading versions…',
    'sites.versions.current': 'Current',
    'sites.versions.rollback': 'Roll back',
    'sites.versions.empty': 'No previous versions',
    'sites.versions.keepNote':
      'Keeping the last {n} versions — older ones are removed automatically (files deleted, not recoverable).',

    // —— 站点卡片:toast / 确认 ——
    'sites.toast.loadVersionsFailed': 'Failed to load versions',
    'sites.toast.public': 'Public now — auto-reverts to private in {window}',
    'sites.toast.private': 'Switched to private',
    'sites.toast.spaOn': 'SPA fallback enabled',
    'sites.toast.spaOff': 'SPA fallback disabled',
    'sites.toast.commentsOn': 'Page comments enabled',
    'sites.toast.commentsOff': 'Page comments disabled',
    'sites.toast.shareLinkCreated': 'Share link created',
    'sites.toast.shareLinkRevoked': 'Share link revoked',
    'sites.toast.shareLinksRevoked': 'All share links revoked',
    'sites.toast.guestCommentsOn': 'Guest comments enabled',
    'sites.toast.guestCommentsOff': 'Guest comments disabled',
    'sites.toast.rolledBack': 'Rolled back to the selected version',
    'sites.toast.deleted': 'Site deleted',
    'sites.delete.title': 'Delete site “{slug}”?',
    'sites.delete.body':
      'The site and all its version history will be deleted, the link stops working immediately, and this cannot be undone.',
    'sites.delete.confirm': 'Delete site',
  },
  zh: {
    // —— 列表外壳(SitesView) ——
    'sites.heading': '我的站点',
    'sites.empty.title': '还没有站点',
    'sites.empty.desc':
      '拖入一个 HTML 或 Markdown 文件——或整个文件夹——即可发布你的第一个页面。文件一落地，你就能拿到可分享的链接。',
    'sites.empty.pick': '投放第一个文件',
    'sites.empty.agent': '想从 agent 部署？',
    'sites.search.placeholder': '搜索 slug / 标题',
    'sites.deploy': '部署',
    'sites.noMatch': '没有匹配“{query}”的站点',
    'sites.drop.release': '松开即部署',
    'sites.drop.hint': '拖到任意位置——新建站点，或为同名 slug 发布新版本',

    // —— 列表 toast ——
    'sites.toast.noFiles': '没有收集到任何文件',
    'sites.toast.dropFailed': '读取拖入内容失败',
    'sites.toast.installCopied': '已复制——在终端里运行它',
    'sites.toast.copyFailed': '复制失败',
    'sites.toast.linkCopied': '链接已复制',

    // —— 站点卡片:徽标 ——
    'sites.unresolved.one': '{n} 条未解决评论',
    'sites.unresolved.other': '{n} 条未解决评论',
    'sites.badge.disabledTitle': '已被管理员停用——对所有人返回 451',
    'sites.badge.disabled': '已停用',
    'sites.badge.public': '公开 · {remaining}',
    'sites.badge.revertedTitle': '公开窗口已结束——已恢复为私有',
    'sites.badge.reverted': '已恢复',
    'sites.badge.private': '私有',
    'sites.copyLink': '复制链接',
    'sites.open': '打开',

    // —— 站点卡片:停用提示 ——
    'sites.suspended.title': '此页面已被管理员停用。',
    'sites.suspended.body': '它会对所有访问者返回 451，重新部署也无法恢复。',
    'sites.suspended.reason': ' 原因：{reason}。',
    'sites.suspended.appeal': ' 联系实例运营者进行申诉。',

    // —— 站点卡片:元信息 ——
    'sites.fileCount.one': '{n} 个文件',
    'sites.fileCount.other': '{n} 个文件',
    'sites.updatedAt': '更新于 {time}',

    // —— 站点卡片:操作 ——
    'sites.action.makePrivate': '延长 / 设为私有',
    'sites.action.makePublic': '设为公开',
    'sites.action.shareLink': '分享链接',
    'sites.action.redeploy': '重新部署',
    'sites.action.versions': '版本 · {count}',
    'sites.action.settings': '设置',
    'sites.action.deleteTitle': '删除站点',

    // —— 站点卡片:公开分享面板 ——
    'sites.share.extend': '延长窗口（重新计时）',
    'sites.share.publicFor': '公开时长（到期自动恢复私有）',
    'sites.share.revertNow': '立即恢复为私有',
    'sites.window.1h': '1 小时',
    'sites.window.6h': '6 小时',
    'sites.window.24h': '24 小时',
    'sites.window.72h': '3 天',
    'sites.window.168h': '7 天',

    // —— 分享链接弹窗(ShareLinkDialog) ——
    'sites.shareLink.title': '分享“{slug}”',
    'sites.shareLink.desc':
      '拿到链接的人无需账号即可查看此页面。链接默认永久有效，可随时在这里单条或全部撤销；常来的访客会自动保持登录状态。',
    'sites.shareLink.expiresIn': '链接有效期',
    'sites.shareLink.hPerm': '直到撤销',
    'sites.shareLink.h24': '24 小时',
    'sites.shareLink.h72': '3 天',
    'sites.shareLink.h168': '7 天',
    'sites.shareLink.h720': '30 天',
    'sites.shareLink.labelPlaceholder': '备注，如“给设计评审的”（可选）',
    'sites.shareLink.create': '生成链接',
    'sites.shareLink.createAnother': '再生成一条',
    'sites.shareLink.createFailed': '生成分享链接失败',
    'sites.shareLink.expiresAt': '{time} 过期',
    'sites.shareLink.never': '永不过期——可随时撤销',
    'sites.shareLink.listTitle': '已生成的链接',
    'sites.shareLink.listEmpty': '还没有生成过链接。',
    'sites.shareLink.listExpired': '已过期',
    'sites.shareLink.listNever': '永不过期',
    'sites.shareLink.listExpires': '{time} 过期',
    'sites.shareLink.revokeOne': '撤销',
    'sites.shareLink.revokeOneFailed': '撤销链接失败',
    'sites.shareLink.guestComments': '允许访客评论',
    'sites.shareLink.guestCommentsDesc': '凭分享链接进来的访客无需账号即可在页面上钉选评审评论。',
    'sites.shareLink.revokeDesc': '撤销会让该站点已发出的全部分享链接失效，包括已进入的访客会话。',
    'sites.shareLink.revokeAll': '撤销所有链接',
    'sites.shareLink.revokeTitle': '撤销“{slug}”的所有分享链接？',
    'sites.shareLink.revokeBody':
      '该站点已发出的全部分享链接会立即失效，包括已进入的访客会话。此操作无法撤销——之后可以再生成新链接。',
    'sites.shareLink.revokeConfirm': '全部撤销',

    // —— 站点卡片:设置面板 ——
    'sites.settings.comments': '页面评论',
    'sites.settings.commentsDesc': '登录的访问者可以在页面上钉选评审评论（对匿名公开访问者隐藏）。',
    'sites.settings.spa': 'SPA 回退',
    'sites.settings.spaDesc': '单页应用路由：404 时返回 index.html。',

    // —— 站点卡片:版本面板 ——
    'sites.versions.loading': '正在加载版本…',
    'sites.versions.current': '当前',
    'sites.versions.rollback': '回滚',
    'sites.versions.empty': '没有历史版本',
    'sites.versions.keepNote':
      '只保留最近 {n} 个版本——更早的会被自动删除（文件一并删除，不可恢复）。',

    // —— 站点卡片:toast / 确认 ——
    'sites.toast.loadVersionsFailed': '加载版本失败',
    'sites.toast.public': '已公开——将在 {window}后自动恢复为私有',
    'sites.toast.private': '已切换为私有',
    'sites.toast.spaOn': '已启用 SPA 回退',
    'sites.toast.spaOff': '已禁用 SPA 回退',
    'sites.toast.commentsOn': '已启用页面评论',
    'sites.toast.commentsOff': '已禁用页面评论',
    'sites.toast.shareLinkCreated': '分享链接已生成',
    'sites.toast.shareLinkRevoked': '分享链接已撤销',
    'sites.toast.shareLinksRevoked': '所有分享链接已撤销',
    'sites.toast.guestCommentsOn': '已允许访客评论',
    'sites.toast.guestCommentsOff': '已关闭访客评论',
    'sites.toast.rolledBack': '已回滚到所选版本',
    'sites.toast.deleted': '站点已删除',
    'sites.delete.title': '删除站点“{slug}”？',
    'sites.delete.body': '站点及其全部版本历史都会被删除，链接立即失效，且无法撤销。',
    'sites.delete.confirm': '删除站点',
  },
};
