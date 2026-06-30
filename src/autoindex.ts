/** 部署缺 index.html 时自动生成的索引页(纯字符串构建,edge-safe)。
 *
 * 单文件 → 秒跳该文件(图片/md 由 serving 的查看器壳接住,评论层随之可用);
 * 多文件 → 统一文件卡片网格(评论层照常注入 —— 「扔一组设计图收评论」场景)。
 * 生成页不计入 file_count/total_bytes(与单 HTML 自动别名同一口径)。
 */

import { FAVICON } from './brand-gate.js';
import { t as tr, type Locale } from './i18n/index.js';

const IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif']);
const CODE_EXTS = new Set([
  '.js',
  '.ts',
  '.jsx',
  '.tsx',
  '.css',
  '.html',
  '.htm',
  '.json',
  '.md',
  '.markdown',
  '.py',
  '.go',
  '.rs',
  '.sh',
  '.yml',
  '.yaml',
  '.toml',
  '.xml',
  '.svg',
]);

// 文件类型显示名(meta 行 "size · TYPE")
const TYPE_LABELS: Record<string, string> = {
  '.md': 'Markdown',
  '.markdown': 'Markdown',
  '.html': 'HTML',
  '.htm': 'HTML',
  '.css': 'CSS',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.json': 'JSON',
  '.png': 'PNG',
  '.jpg': 'JPEG',
  '.jpeg': 'JPEG',
  '.gif': 'GIF',
  '.webp': 'WebP',
  '.svg': 'SVG',
  '.avif': 'AVIF',
  '.pdf': 'PDF',
  '.txt': 'Text',
  '.yml': 'YAML',
  '.yaml': 'YAML',
  '.xml': 'XML',
  '.csv': 'CSV',
};

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');
}

/** 站内相对 href:逐段 URL 编码(路径已 normalizeSitePath,无 ../)。 */
export function relHref(rel: string): string {
  return rel.split('/').map(encodeURIComponent).join('/');
}

export function extOf(rel: string): string {
  const name = rel.split('/').pop() ?? '';
  return name.includes('.') ? '.' + name.split('.').pop()!.toLowerCase() : '';
}

function typeLabel(ext: string): string {
  if (TYPE_LABELS[ext]) return TYPE_LABELS[ext];
  return ext ? ext.slice(1).toUpperCase() : 'File';
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export interface IndexEntry {
  rel: string;
  size: number;
}

/** pagepin 品牌字体(Hanken Grotesk + JetBrains Mono),离线优雅降级到系统字体。 */
const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">`;

/** 单文件:meta refresh 秒跳(查看器壳/原文件由 serving 按 Accept 决定)。 */
export function redirectIndexHtml(rel: string, locale: Locale = 'en'): string {
  const href = relHref(rel);
  const name = escapeHtml(rel);
  const link = `<a href="./${escapeHtml(href)}" style="color:#0f7c72;font-family:'JetBrains Mono',monospace">${name}</a>`;
  return `<!doctype html>
<html lang="${locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="0;url=./${escapeHtml(href)}">
${FAVICON}${FONTS}
<title>${name}</title></head>
<body style="font-family:'Hanken Grotesk',system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;color:#6b7480;font-size:14px">
<p>${tr(locale, 'dirIndex.redirect.opening', { name: link })}</p>
</body></html>`;
}

// SVG 缩略图标(image / code / generic file)
const ICON_IMAGE = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="1.6"/><path d="m21 15-5-5L5 21"/></svg>`;
const ICON_CODE = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/></svg>`;
const ICON_FILE = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>`;

/** 多文件:统一文件卡片网格(图片显示缩略图,其他显示类型图标)。 */
export function galleryIndexHtml(
  title: string,
  entries: IndexEntry[],
  locale: Locale = 'en',
): string {
  const sorted = [...entries].sort((a, b) => a.rel.localeCompare(b.rel));
  const t = escapeHtml(title);

  const cards = sorted
    .map((e) => {
      const href = escapeHtml(relHref(e.rel));
      const name = escapeHtml(e.rel);
      const ext = extOf(e.rel);
      const isImg = IMG_EXTS.has(ext);
      const isCode = CODE_EXTS.has(ext);
      const meta = `${fmtBytes(e.size)} · ${typeLabel(ext)}`;
      const thumb = isImg
        ? `<span class="thumb thumb-img"><img src="${href}" loading="lazy" alt="${name}"></span>`
        : `<span class="thumb thumb-icon ${isCode ? 'is-code' : 'is-file'}">${isCode ? ICON_CODE : ICON_FILE}</span>`;
      return `<a class="card" href="${href}">${thumb}<span class="foot"><span class="fname">${name}</span><span class="fmeta">${escapeHtml(meta)}</span></span></a>`;
    })
    .join('\n');

  const countKey =
    entries.length === 1 ? 'dirIndex.gallery.count.one' : 'dirIndex.gallery.count.other';
  return `<!doctype html>
<html lang="${locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${FAVICON}${FONTS}
<title>${t}</title>
<style>
:root{color-scheme:light}
*{box-sizing:border-box}
body{font-family:'Hanken Grotesk',system-ui,sans-serif;color:#1b2127;max-width:1080px;
  margin:0 auto;padding:34px 28px 96px;background:#fafafa;
  background-image:radial-gradient(rgba(15,124,114,.05) 1px,transparent 1px);background-size:22px 22px}
.head{display:flex;align-items:center;gap:10px;margin-bottom:22px;flex-wrap:wrap}
.folder{font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:600;color:#0f7c72}
.folder .sl{color:#b3b9bf}
.count{font-size:12.5px;color:#9aa1a9}
.badge{margin-left:auto;display:inline-flex;align-items:center;gap:5px;background:#f1f3f4;
  border:1px solid #e7e9eb;border-radius:999px;padding:4px 10px;font-size:11.5px;color:#9aa1a9}
.badge svg{color:#0f7c72}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px}
.card{display:flex;flex-direction:column;background:#fff;border:1px solid #eef0f1;border-radius:11px;
  overflow:hidden;text-decoration:none;color:inherit;transition:box-shadow .15s,transform .15s,border-color .15s}
.card:hover{box-shadow:0 8px 22px -10px rgba(17,22,27,.18);transform:translateY(-2px);border-color:#d7dadd}
.thumb{display:grid;place-items:center;height:92px}
.thumb-img{background:repeating-conic-gradient(#f3f4f5 0 25%,#fff 0 50%) 0 0/18px 18px}
.thumb-img img{max-width:100%;max-height:92px;object-fit:contain}
.thumb-icon.is-code{background:#f4f7f6;color:#5a8c84}
.thumb-icon.is-file{background:#f4f5f6;color:#9aa1a9}
.thumb-icon.is-code:has(+ .foot),.thumb-icon{}
.foot{padding:9px 11px;border-top:1px solid #f4f5f6}
.fname{display:block;font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:600;color:#11161b;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fmeta{display:block;margin-top:2px;font-size:11px;color:#9aa1a9}
</style>
</head>
<body>
<div class="head">
  <span class="folder">${t}<span class="sl">/</span></span>
  <span class="count">${tr(locale, countKey, { n: entries.length })}</span>
  <span class="badge"><svg width="14" height="14" viewBox="0 0 100 100"><path fill="#0f7c72" d="M24,2 H76 A22,22 0 0 1 98,24 V76 A22,22 0 0 1 76,98 H24 A22,22 0 0 1 2,76 V24 A22,22 0 0 1 24,2 Z"/><path fill="#fff" d="M24,52 A26,26 0 1 1 50,78 L27,78 A2,2 0 0 1 25,76 Z"/><circle cx="49.7" cy="51" r="9" fill="#0f7c72"/></svg>${escapeHtml(tr(locale, 'dirIndex.gallery.badge'))}</span>
</div>
<div class="grid">
${cards}
</div>
</body></html>`;
}
