/** 部署面板文案域:拖拽投放区(DropZone)、AI agent 自助部署副卡(AgentDeployCard)。
 *
 * 与服务端约定一致:en/zh key 集合须一致、跨域不重复;通用动作复用 common.*(复制/取消等)。
 * 占位符名在 en/zh 间保持一致;无 ICU,英文单复数用 .one/.other 两个 key 由调用方按 count 选取。
 */

import type { Locale } from '../index';

export const deploy: Record<Locale, Record<string, string>> = {
  en: {
    // —— 前端 limits 预校验提示 ——
    'deploy.problem.slug':
      'Slug must be 1–64 chars: lowercase letters, digits, or hyphens, starting with a letter or digit',
    'deploy.problem.tooManyFiles': '{count} files exceeds the limit of {max}',
    'deploy.problem.fileTooBig':
      '{count} file(s) exceed the {mb} MB per-file limit (e.g. {example})',
    'deploy.problem.siteTooBig': 'Total size {size} exceeds the {mb} MB site limit',

    // —— toast ——
    'deploy.toast.deployed': 'Deployed',
    'deploy.toast.deployFailed': 'Deploy failed',
    'deploy.toast.linkCopied': 'Link copied',
    'deploy.toast.copyFailed': 'Copy failed',

    // —— 文件计数(单/复数) ——
    'deploy.fileCount.one': '{count} file',
    'deploy.fileCount.other': '{count} files',

    // —— 成功态 ——
    'deploy.done.title': 'Deployed',
    'deploy.done.deployAnother': 'Deploy another',
    'deploy.done.copyLink': 'Copy link',
    'deploy.done.open': 'Open',

    // —— 待确认 / 上传中 ——
    'deploy.pending.folder': 'Folder “{name}”',
    'deploy.pending.filesToDeploy': 'Files to deploy',
    'deploy.clear': 'Clear',
    'deploy.moreFiles': '… and {count} more files',
    'deploy.field.slug': 'Slug (link path)',
    'deploy.field.slugLocked': ' · locked to update target',
    'deploy.field.slugPlaceholder': 'my-page',
    'deploy.field.title': 'Title (optional)',
    'deploy.field.titlePlaceholder': 'Name this page',
    'deploy.uploading': 'Uploading…',
    'deploy.updateSite': 'Update site {slug}',
    'deploy.deployTo': 'Deploy to {slug}',

    // —— slug 撞站提示(分段拼接,中间夹 <b> 站点名/“new version”) ——
    'deploy.existing.prefix': 'Slug “{slug}” is already taken by your site ',
    'deploy.existing.mid': ' — this deploy will publish as a ',
    'deploy.existing.newVersion': 'new version',
    'deploy.existing.detail':
      ' of it (currently {count} files, updated {when}; {versions}). To create a separate site, change the slug.',
    'deploy.existing.keepLimited': 'only the last {keep} versions are kept',
    'deploy.existing.keepAll': 'older versions stay rollback-able',

    // —— 空闲投放区 ——
    'deploy.idle.title': 'Drop files or a folder here',
    'deploy.idle.hintPrefix': 'HTML · Markdown · images · build output — or ',
    'deploy.idle.chooseFolder': 'choose a whole folder',
    'deploy.idle.hintSuffix': '. Each deploy is an atomic, versioned release.',
    'deploy.idle.updating': 'Updating site {target}',
    'deploy.idle.limits':
      'Single file ≤ {fileMb} MB · up to {maxFiles} files · drop anywhere on this page',

    // —— AI agent 自助部署副卡 ——
    'deploy.agent.heading': 'Let your AI agent deploy',
    'deploy.agent.desc':
      'Install the skill once and your agent deploys, updates and resolves comments on its own — browser login, no token to paste.',
    'deploy.agent.copyFailed': 'Copy failed — copy it manually',
    'deploy.agent.copied': 'Copied — run it in your terminal',
    'deploy.agent.fetchPrefix': 'No local skill? Fetch ',
  },
  zh: {
    // —— 前端 limits 预校验提示 ——
    'deploy.problem.slug': 'Slug 需为 1–64 个字符:小写字母、数字或连字符,且以字母或数字开头',
    'deploy.problem.tooManyFiles': '{count} 个文件超出了 {max} 个的上限',
    'deploy.problem.fileTooBig': '有 {count} 个文件超出单文件 {mb} MB 上限(例如 {example})',
    'deploy.problem.siteTooBig': '总大小 {size} 超出了站点 {mb} MB 上限',

    // —— toast ——
    'deploy.toast.deployed': '已部署',
    'deploy.toast.deployFailed': '部署失败',
    'deploy.toast.linkCopied': '链接已复制',
    'deploy.toast.copyFailed': '复制失败',

    // —— 文件计数(单/复数) ——
    'deploy.fileCount.one': '{count} 个文件',
    'deploy.fileCount.other': '{count} 个文件',

    // —— 成功态 ——
    'deploy.done.title': '已部署',
    'deploy.done.deployAnother': '再部署一个',
    'deploy.done.copyLink': '复制链接',
    'deploy.done.open': '打开',

    // —— 待确认 / 上传中 ——
    'deploy.pending.folder': '文件夹“{name}”',
    'deploy.pending.filesToDeploy': '待部署的文件',
    'deploy.clear': '清除',
    'deploy.moreFiles': '……以及另外 {count} 个文件',
    'deploy.field.slug': 'Slug(链接路径)',
    'deploy.field.slugLocked': ' · 已锁定到更新目标',
    'deploy.field.slugPlaceholder': 'my-page',
    'deploy.field.title': '标题(可选)',
    'deploy.field.titlePlaceholder': '给这个页面起个名字',
    'deploy.uploading': '上传中…',
    'deploy.updateSite': '更新站点 {slug}',
    'deploy.deployTo': '部署到 {slug}',

    // —— slug 撞站提示(分段拼接,中间夹 <b> 站点名/“新版本”) ——
    'deploy.existing.prefix': 'Slug“{slug}”已被你的站点 ',
    'deploy.existing.mid': ' 占用 —— 本次部署将作为它的',
    'deploy.existing.newVersion': '新版本',
    'deploy.existing.detail':
      '发布(当前 {count} 个文件,更新于 {when};{versions})。如需创建独立站点,请修改 slug。',
    'deploy.existing.keepLimited': '仅保留最近 {keep} 个版本',
    'deploy.existing.keepAll': '旧版本仍可回滚',

    // —— 空闲投放区 ——
    'deploy.idle.title': '把文件或文件夹拖到这里',
    'deploy.idle.hintPrefix': 'HTML · Markdown · 图片 · 构建产物 —— 或',
    'deploy.idle.chooseFolder': '选择整个文件夹',
    'deploy.idle.hintSuffix': '。每次部署都是一次原子化、可版本回溯的发布。',
    'deploy.idle.updating': '正在更新站点 {target}',
    'deploy.idle.limits': '单文件 ≤ {fileMb} MB · 最多 {maxFiles} 个文件 · 可拖到本页任意位置',

    // —— AI agent 自助部署副卡 ——
    'deploy.agent.heading': '让你的 AI agent 来部署',
    'deploy.agent.desc':
      '安装一次 skill,你的 agent 就能自行部署、更新并处理评论 —— 浏览器登录,无需粘贴 token。',
    'deploy.agent.copyFailed': '复制失败 —— 请手动复制',
    'deploy.agent.copied': '已复制 —— 在终端里运行它',
    'deploy.agent.fetchPrefix': '没有本地 skill?获取 ',
  },
};
