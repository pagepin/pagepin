/** 内容域 / 服务端渲染 HTML 文案域:html.* / viewer.* / dirIndex.*。
 *
 * 覆盖 brand-gate.ts 的品牌门页(登录墙 / 链接过期 / 下架 / 404)、serving.ts 的查看器壳
 * (markdown / 图片导航)与相对时间,以及 autoindex.ts 的自动索引页(秒跳 / 画廊)。
 * 这些是 HTML/字符串构建器,不是 JSON 错误体;locale 由 localeOf(c) 一路下穿到各 builder。
 *
 * 约定见 common.ts:点分命名空间、{name} 占位 en/zh 同名同位、en/zh key 集合完全一致、跨域不重名。
 * 复数无 ICU:英文用 .one / .other 两个 key、由代码按 count 取;中文两条文案相同。
 */

import type { Locale } from '../index.js';

export const contentHtml: Record<Locale, Record<string, string>> = {
  en: {
    // —— 品牌门页:私有登录墙(brand-gate 外壳 + serving.loginWallHtml) ——
    'html.loginWall.title': 'Private · pagepin',
    'html.loginWall.heading': 'This page is private',
    'html.loginWall.body': 'Sign in to view {slug}.',
    'html.loginWall.button': 'Sign in to view',
    'html.loginWall.sharedBy': 'Shared by {name}',
    'html.hostedOn': 'Hosted on',

    // —— 品牌门页:公开窗口已过期(serving.linkExpiredHtml) ——
    'html.expired.title': 'Link expired · pagepin',
    'html.expired.heading': 'This link has expired',
    'html.expired.body':
      'This page was public for a limited time and has reverted to private. The share window closed {closedAgo}.',
    'html.expired.button': 'Sign in',
    'html.expired.owner': 'Owner',

    // —— 品牌门页:分享链接失效(serving.shareExpiredHtml) ——
    'html.shareExpired.title': 'Share link expired · pagepin',
    'html.shareExpired.heading': 'This share link is no longer valid',
    'html.shareExpired.body':
      'The link has expired or was revoked by the site owner. Ask the person who shared it with you for a fresh link.',
    'html.shareExpired.button': 'Sign in instead',

    // —— 试用站缎带(serving.trialRibbonHtml) ——
    'html.trial.ribbon': 'Trial page · expires in {left}',
    'html.trial.keep': 'Keep this page',
    'html.trial.minutes': '{n} min',
    'html.trial.hours': '{n} h',

    // —— 品牌门页:管理员下架 451(serving.takedownHtml) ——
    'html.takedown.title': 'Unavailable · pagepin',
    'html.takedown.heading': 'This page has been disabled',
    'html.takedown.body':
      'This page is no longer available. It was disabled by an administrator following a policy or abuse review. If you believe this is a mistake, contact the site owner or the instance operator.',

    // —— 品牌门页:404(serving.notFoundHtml) ——
    'html.notFound.title': '404 · pagepin',
    'html.notFound.heading': 'Page not found',
    'html.notFound.body': 'We couldn&rsquo;t find that page or file on this site.',
    'html.notFound.siteRoot': 'Go to site root',

    // —— 相对时间(serving.fmtAgo;复数 one/other) ——
    'html.ago.day.one': '{n} day ago',
    'html.ago.day.other': '{n} days ago',
    'html.ago.hour.one': '{n} hour ago',
    'html.ago.hour.other': '{n} hours ago',
    'html.ago.justNow': 'just now',

    // —— 查看器壳:markdown(serving.mdShell) ——
    'viewer.md.meta': 'Markdown · {size}',
    'viewer.md.viewRaw': 'View raw',
    'viewer.md.rendering': 'Rendering…',

    // —— 查看器壳:图片导航(serving.imgShell) ——
    'viewer.img.position': '{i} / {n}',
    'viewer.img.prev': 'Previous (←)',
    'viewer.img.next': 'Next (→)',
    'viewer.img.close': 'Back to index (Esc)',
    'viewer.img.viewOriginal': 'View original',
    'viewer.img.loadError': 'Image failed to load',

    // —— 自动索引页(autoindex.ts) ——
    'dirIndex.redirect.opening': 'Opening {name} …',
    'dirIndex.gallery.count.one': '{n} item',
    'dirIndex.gallery.count.other': '{n} items',
    'dirIndex.gallery.badge': 'pagepin auto-generated index',
  },
  zh: {
    // —— 品牌门页:私有登录墙 ——
    'html.loginWall.title': '私有 · pagepin',
    'html.loginWall.heading': '此页面为私有',
    'html.loginWall.body': '登录后查看 {slug}。',
    'html.loginWall.button': '登录查看',
    'html.loginWall.sharedBy': '由 {name} 分享',
    'html.hostedOn': '托管于',

    // —— 品牌门页:公开窗口已过期 ——
    'html.expired.title': '链接已过期 · pagepin',
    'html.expired.heading': '此链接已过期',
    'html.expired.body':
      '此页面曾在限定时间内公开，现已恢复为私有。分享窗口已于 {closedAgo} 关闭。',
    'html.expired.button': '登录',
    'html.expired.owner': '所有者',

    // —— 品牌门页:分享链接失效 ——
    'html.shareExpired.title': '分享链接已失效 · pagepin',
    'html.shareExpired.heading': '此分享链接已失效',
    'html.shareExpired.body': '链接已过期，或已被站点所有者撤销。请向分享给你的人索取新链接。',
    'html.shareExpired.button': '改用登录',

    // —— 试用站缎带 ——
    'html.trial.ribbon': '试用页 · {left} 后过期',
    'html.trial.keep': '保留此页',
    'html.trial.minutes': '{n} 分钟',
    'html.trial.hours': '{n} 小时',

    // —— 品牌门页:管理员下架 451 ——
    'html.takedown.title': '不可用 · pagepin',
    'html.takedown.heading': '此页面已被停用',
    'html.takedown.body':
      '此页面已不再可用。管理员在政策或滥用审查后将其停用。如果你认为这是误判，请联系站点所有者或实例运营方。',

    // —— 品牌门页:404 ——
    'html.notFound.title': '404 · pagepin',
    'html.notFound.heading': '页面未找到',
    'html.notFound.body': '在该站点上找不到该页面或文件。',
    'html.notFound.siteRoot': '前往站点根目录',

    // —— 相对时间(中文单复数同文案) ——
    'html.ago.day.one': '{n} 天前',
    'html.ago.day.other': '{n} 天前',
    'html.ago.hour.one': '{n} 小时前',
    'html.ago.hour.other': '{n} 小时前',
    'html.ago.justNow': '刚刚',

    // —— 查看器壳:markdown ——
    'viewer.md.meta': 'Markdown · {size}',
    'viewer.md.viewRaw': '查看源码',
    'viewer.md.rendering': '渲染中…',

    // —— 查看器壳:图片导航 ——
    'viewer.img.position': '{i} / {n}',
    'viewer.img.prev': '上一张 (←)',
    'viewer.img.next': '下一张 (→)',
    'viewer.img.close': '返回索引 (Esc)',
    'viewer.img.viewOriginal': '查看原图',
    'viewer.img.loadError': '图片加载失败',

    // —— 自动索引页 ——
    'dirIndex.redirect.opening': '正在打开 {name} …',
    'dirIndex.gallery.count.one': '{n} 个文件',
    'dirIndex.gallery.count.other': '{n} 个文件',
    'dirIndex.gallery.badge': 'pagepin 自动生成的索引',
  },
};
