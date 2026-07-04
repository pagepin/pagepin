/** 匿名试用(trial.ts)域文案。 */

import type { Locale } from '../index.js';

export const trial: Record<Locale, Record<string, string>> = {
  en: {
    'trial.disabled': 'Anonymous trial is not enabled on this instance',
    'trial.rateLimited': 'Too many trial uploads from this address, please try again later',
    'trial.file.missing': 'Provide a single HTML or Markdown file in the "file" field',
    'trial.file.notHtml': 'Trial accepts a single .html or .md file',
    'trial.file.tooLarge': 'File too large (≤{mb}MB)',
    'trial.claim.invalid': 'Claim token is invalid or expired',
    'trial.notFound': 'Trial page not found or expired',
  },
  zh: {
    'trial.disabled': '本实例未开启匿名试用',
    'trial.rateLimited': '该地址试用上传太频繁，请稍后再试',
    'trial.file.missing': '请在 file 字段提供一个 HTML 或 Markdown 文件',
    'trial.file.notHtml': '试用仅接受单个 .html 或 .md 文件',
    'trial.file.tooLarge': '文件过大（≤{mb}MB）',
    'trial.claim.invalid': 'claim token 无效或已过期',
    'trial.notFound': '试用页不存在或已过期',
  },
};
