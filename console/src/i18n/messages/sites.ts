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
    'sites.toast.rolledBack': '已回滚到所选版本',
    'sites.toast.deleted': '站点已删除',
    'sites.delete.title': '删除站点“{slug}”？',
    'sites.delete.body': '站点及其全部版本历史都会被删除，链接立即失效，且无法撤销。',
    'sites.delete.confirm': '删除站点',
  },
};
