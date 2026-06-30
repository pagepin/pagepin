/** console 共享文案域:应用外壳(App/TopBar)、语言切换、通用动作按钮。
 *
 * 与服务端约定一致:catalog 按域拆到 messages/<域>.ts,messages.ts 聚合;各域文件 en/zh key 集合须一致、跨域不重复。
 * 本文件放被多个组件复用的 key(common.* / app.* / topbar.* / language.*);各组件专有文案见同目录其他文件。
 */

import type { Locale } from '../index';

export const common: Record<Locale, Record<string, string>> = {
  en: {
    // —— 通用动作(多组件复用) ——
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.delete': 'Delete',
    'common.confirm': 'Confirm',
    'common.close': 'Close',
    'common.copy': 'Copy',
    'common.copied': 'Copied',
    'common.loading': 'Loading…',
    'common.retry': 'Retry',

    // —— 应用外壳(App.tsx) ——
    'app.loading': 'Loading pagepin…',
    'app.failedToLoad': 'Failed to load',
    'app.unknownError': 'Unknown error',
    'app.footer': 'pagepin · static hosting with built-in review',

    // —— 顶栏(TopBar.tsx) ——
    'topbar.tagline': 'drop it in, get a link',
    'topbar.apiTokens': 'API tokens (for AI & script deploys)',
    'topbar.instanceAdmin': 'Instance admin',
    'topbar.accountSettings': 'Account & settings',
    'topbar.signOut': 'Sign out',

    // —— 语言切换 ——
    'language.label': 'Language',
    'language.en': 'English',
    'language.zh': '中文',
  },
  zh: {
    // —— 通用动作(多组件复用) ——
    'common.cancel': '取消',
    'common.save': '保存',
    'common.delete': '删除',
    'common.confirm': '确认',
    'common.close': '关闭',
    'common.copy': '复制',
    'common.copied': '已复制',
    'common.loading': '加载中…',
    'common.retry': '重试',

    // —— 应用外壳(App.tsx) ——
    'app.loading': '正在加载 pagepin…',
    'app.failedToLoad': '加载失败',
    'app.unknownError': '未知错误',
    'app.footer': 'pagepin · 内置评审的静态托管',

    // —— 顶栏(TopBar.tsx) ——
    'topbar.tagline': '拖进来，拿到链接',
    'topbar.apiTokens': 'API token（供 AI 与脚本部署）',
    'topbar.instanceAdmin': '实例管理',
    'topbar.accountSettings': '账号与设置',
    'topbar.signOut': '退出登录',

    // —— 语言切换 ——
    'language.label': '语言',
    'language.en': 'English',
    'language.zh': '中文',
  },
};
