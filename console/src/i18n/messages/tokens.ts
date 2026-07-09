/** PAT token 管理文案域:TokenManager + TokenDialog(创建/轮换/吊销/复制、到期标签、AI 部署提示)。
 * 与其他域约定一致:en/zh key 集合须一致、跨域不重复。占位符名称两语言保持一致。
 */

import type { Locale } from '../index';

export const tokens: Record<Locale, Record<string, string>> = {
  en: {
    // —— 弹窗 / 标题 ——
    'tokens.dialogTitle': 'API tokens',

    // —— AI 部署提示段落(含内联链接) ——
    'tokens.hintLead': 'Deploy credentials for agents & CI, scoped to your sites. The ',
    'tokens.hintButtonCopies': ' button copies the one-line ',
    'tokens.hintNpxSkills': 'npx skills',
    'tokens.hintInstallCmd': ' install command (or read the ',
    'tokens.hintSkillGuide': 'skill guide',
    'tokens.hintTail':
      '). The token stays out of it — the agent gets it via browser login, so it never lands in a chat.',

    // —— 创建 ——
    'tokens.namePlaceholder': 'Label, e.g. claude-deploy',
    'tokens.createButton': 'Create token',
    'tokens.created': '“{name}” created',
    'tokens.createFailed': 'Create failed',

    // —— show-once 高亮卡片(创建/轮换后列表上方,常驻直到手动关闭) ——
    'tokens.createdCardTitle': '“{name}” created',
    'tokens.copyButton': 'Copy',
    'tokens.showOnceWarning':
      'This is the only time the full token is shown. Copy and store it now — afterwards you can only rotate it for a new value.',
    'tokens.savedIt': 'I’ve saved it',

    // —— 列表 / 空态 ——
    'tokens.empty': 'No tokens yet — create one.',
    'tokens.hiddenSuffix': '… (shown only once at creation — rotate for a new value)',
    'tokens.lastUsed': 'Last used {time}',
    'tokens.neverUsed': 'Never used',
    'tokens.expires': ' · expires {date}',

    // —— 行内动作按钮 title ——
    'tokens.copyInstallTitle': 'Copy install command (token-free)',
    'tokens.copyTokenTitle': 'Copy token',
    'tokens.rotateActionTitle': 'Rotate (new value; the old one stops working)',
    'tokens.revokeActionTitle': 'Revoke',

    // —— 复制反馈 ——
    'tokens.copyFailed': 'Copy failed — select and copy manually',
    'tokens.loadFailed': 'Failed to load tokens',

    // —— 轮换 ——
    'tokens.rotateTitle': 'Rotate “{name}”?',
    'tokens.rotateBody':
      'The old token stops working immediately; any agent or script using it needs the new value.',
    'tokens.rotateConfirm': 'Rotate',
    'tokens.rotated': 'Rotated',
    'tokens.rotateFailed': 'Rotate failed',

    // —— 吊销 ——
    'tokens.revokeTitle': 'Revoke “{name}”?',
    'tokens.revokeBody':
      'Any agent or script using it stops working immediately, and this cannot be undone.',
    'tokens.revokeConfirm': 'Revoke',
    'tokens.revoked': 'Revoked',
    'tokens.revokeFailed': 'Revoke failed',
  },
  zh: {
    // —— 弹窗 / 标题 ——
    'tokens.dialogTitle': 'API token',

    // —— AI 部署提示段落(含内联链接) ——
    'tokens.hintLead': '面向 agent 与 CI 的部署凭证，权限限定在你的站点。点击 ',
    'tokens.hintButtonCopies': ' 按钮可复制这条一行 ',
    'tokens.hintNpxSkills': 'npx skills',
    'tokens.hintInstallCmd': ' 安装命令（或阅读',
    'tokens.hintSkillGuide': 'skill 指南',
    'tokens.hintTail': '）。命令本身不含 token —— agent 会通过浏览器登录获取，绝不会出现在聊天里。',

    // —— 创建 ——
    'tokens.namePlaceholder': '标签，例如 claude-deploy',
    'tokens.createButton': '创建 token',
    'tokens.created': '已创建 “{name}”',
    'tokens.createFailed': '创建失败',

    // —— show-once 高亮卡片(创建/轮换后列表上方,常驻直到手动关闭) ——
    'tokens.createdCardTitle': '“{name}” 已创建',
    'tokens.copyButton': '复制',
    'tokens.showOnceWarning': '这是唯一一次显示完整 token。请立即复制并保存；之后只能轮换拿新值。',
    'tokens.savedIt': '我已保存好了',

    // —— 列表 / 空态 ——
    'tokens.empty': '还没有 token —— 创建一个吧。',
    'tokens.hiddenSuffix': '… （仅创建时显示一次；需要新值请轮换）',
    'tokens.lastUsed': '上次使用于 {time}',
    'tokens.neverUsed': '从未使用',
    'tokens.expires': ' · {date} 到期',

    // —— 行内动作按钮 title ——
    'tokens.copyInstallTitle': '复制安装命令（不含 token）',
    'tokens.copyTokenTitle': '复制 token',
    'tokens.rotateActionTitle': '轮换（生成新值；旧值随即失效）',
    'tokens.revokeActionTitle': '吊销',

    // —— 复制反馈 ——
    'tokens.copyFailed': '复制失败 —— 请手动选择并复制',
    'tokens.loadFailed': '加载 token 失败',

    // —— 轮换 ——
    'tokens.rotateTitle': '轮换 “{name}”？',
    'tokens.rotateBody': '旧 token 会立即失效；任何使用它的 agent 或脚本都需要换用新值。',
    'tokens.rotateConfirm': '轮换',
    'tokens.rotated': '已轮换',
    'tokens.rotateFailed': '轮换失败',

    // —— 吊销 ——
    'tokens.revokeTitle': '吊销 “{name}”？',
    'tokens.revokeBody': '任何使用它的 agent 或脚本会立即停止工作，且无法撤销。',
    'tokens.revokeConfirm': '吊销',
    'tokens.revoked': '已吊销',
    'tokens.revokeFailed': '吊销失败',
  },
};
