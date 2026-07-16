/** 站点管理 API 文案域(sites.ts):部署 / 分批上传 / 配额限额 / 可见性 / 版本回滚 / 回复。
 *
 * 约定见 messages/common.ts 顶注;此处只放 sites.ts 专有的新 key,
 * 与 common 中已存在的共享 key(site.notFound / site.path.invalid / request.* / comment.* / auth.*)不重复。
 */

import type { Locale } from '../index.js';

export const site: Record<Locale, Record<string, string>> = {
  en: {
    // —— 部署表单 / 批文件校验 ——
    'site.deploy.form.notMultipart': 'Malformed request body (multipart form required)',
    'site.deploy.paths.notString': 'paths field must be strings',
    'site.deploy.countMismatch': 'files and paths counts do not match',
    'site.deploy.noFiles': 'No files provided',
    'site.deploy.files.notFile': 'files field must be files',
    'site.deploy.pathInvalid': 'Invalid path: {path}',
    'site.deploy.pathDuplicate': 'Duplicate path: {path}',
    'site.file.tooLarge': 'File too large (≤{mb}MB): {path}',

    // —— 限额 / 配额 ——
    'site.fileCount.exceeded': 'Too many files (≤{max})',
    'site.size.exceeded': 'Site total size exceeds limit (≤{mb}MB)',
    'site.quota.exceeded':
      'Out of storage: account quota {quota}MB, currently using about {used}MB, this deployment would exceed it. Delete old sites or reduce content and retry.',

    // —— slug / handle ——
    'site.handle.required': 'Please set a handle first',
    'site.slug.taken': 'You already have a site with this name',
    'site.slug.invalid':
      'Site name must be lowercase letters, digits, or hyphens, and ≤64 characters',

    // —— 分批部署会话 ——
    'site.deploy.session.notFound': 'Upload session not found or expired',

    // —— 可见性 / 标题 / 开关 patch ——
    'site.visibility.invalid': 'visibility must be private or public',
    'site.publicHours.notInteger': 'public_hours must be an integer',
    'site.publicHours.tooSmall': 'Public duration must be at least 1 hour',
    'site.title.notString': 'title must be a string',
    'site.spaFallback.notBool': 'spa_fallback must be a boolean',
    'site.commentsEnabled.notBool': 'comments_enabled must be a boolean',
    'site.guestComments.notBool': 'guest_comments must be a boolean',

    // —— 分享链接 ——
    'site.shareHours.notInteger': 'hours must be an integer',
    'site.shareHours.tooSmall': 'Share link duration must be at least 1 hour',
    'site.shareLabel.notString': 'label must be a string',
    'site.shareLabel.tooLong': 'Label too long (≤{max} chars)',
    'site.shareLink.notFound': 'Share link not found',

    // —— 回复 ——
    'site.reply.empty': 'Reply cannot be empty',
    'site.reply.tooLong': 'Reply too long (≤{max} chars)',

    // —— 版本 / 回滚 ——
    'site.version.missingId': 'Missing version_id',
    'site.version.notFound': 'Version not found',
  },
  zh: {
    // —— 部署表单 / 批文件校验 ——
    'site.deploy.form.notMultipart': '请求体格式错误（需 multipart 表单）',
    'site.deploy.paths.notString': 'paths 字段必须是字符串',
    'site.deploy.countMismatch': 'files 与 paths 数量不一致',
    'site.deploy.noFiles': '没有文件',
    'site.deploy.files.notFile': 'files 字段必须是文件',
    'site.deploy.pathInvalid': '非法路径：{path}',
    'site.deploy.pathDuplicate': '路径重复：{path}',
    'site.file.tooLarge': '单文件超限（≤{mb}MB）：{path}',

    // —— 限额 / 配额 ——
    'site.fileCount.exceeded': '文件数超限（≤{max}）',
    'site.size.exceeded': '站点总大小超限（≤{mb}MB）',
    'site.quota.exceeded':
      '存储空间不足：账户配额 {quota}MB，当前已用约 {used}MB，本次部署后将超出。请删除旧站点或减小内容后重试。',

    // —— slug / handle ——
    'site.handle.required': '请先设置 handle',
    'site.slug.taken': '你已有同名站点',
    'site.slug.invalid': '站点名需小写字母/数字/中划线，≤64 位',

    // —— 分批部署会话 ——
    'site.deploy.session.notFound': '上传会话不存在或已过期',

    // —— 可见性 / 标题 / 开关 patch ——
    'site.visibility.invalid': 'visibility 只能是 private/public',
    'site.publicHours.notInteger': 'public_hours 必须是整数',
    'site.publicHours.tooSmall': '公开时长至少 1 小时',
    'site.title.notString': 'title 必须是字符串',
    'site.spaFallback.notBool': 'spa_fallback 必须是布尔值',
    'site.commentsEnabled.notBool': 'comments_enabled 必须是布尔值',
    'site.guestComments.notBool': 'guest_comments 必须是布尔值',

    // —— 分享链接 ——
    'site.shareHours.notInteger': 'hours 必须是整数',
    'site.shareHours.tooSmall': '分享链接时长至少 1 小时',
    'site.shareLabel.notString': 'label 必须是字符串',
    'site.shareLabel.tooLong': '备注过长（≤{max} 字）',
    'site.shareLink.notFound': '分享链接不存在',

    // —— 回复 ——
    'site.reply.empty': '回复内容不能为空',
    'site.reply.tooLong': '回复过长（≤{max} 字）',

    // —— 版本 / 回滚 ——
    'site.version.missingId': '缺少 version_id',
    'site.version.notFound': '版本不存在',
  },
};
