/** 部署缺 index.html 时自动生成的索引页(纯字符串构建,edge-safe)。
 *
 * 单文件 → 秒跳该文件(图片/md 由 serving 的查看器壳接住,评论层随之可用);
 * 多文件 → 图片画廊 + 文件列表(评论层照常注入 —— 「扔一组设计图收评论」场景)。
 * 生成页不计入 file_count/total_bytes(与单 HTML 自动别名同一口径)。
 */

const IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif']);

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

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export interface IndexEntry {
  rel: string;
  size: number;
}

/** 单文件:meta refresh 秒跳(查看器壳/原文件由 serving 按 Accept 决定)。 */
export function redirectIndexHtml(rel: string): string {
  const href = relHref(rel);
  const name = escapeHtml(rel);
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="0;url=./${escapeHtml(href)}">
<title>${name}</title></head>
<body style="font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0;color:#57606a">
<p>正在打开 <a href="./${escapeHtml(href)}">${name}</a> …</p>
</body></html>`;
}

/** 多文件:图片画廊(点击进查看器壳)+ 其他文件列表。 */
export function galleryIndexHtml(title: string, entries: IndexEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.rel.localeCompare(b.rel));
  const images = sorted.filter((e) => IMG_EXTS.has(extOf(e.rel)));
  const others = sorted.filter((e) => !IMG_EXTS.has(extOf(e.rel)));
  const t = escapeHtml(title);

  const cards = images
    .map((e) => {
      const href = escapeHtml(relHref(e.rel));
      const name = escapeHtml(e.rel);
      return `<a class="card" href="${href}"><img src="${href}" loading="lazy" alt="${name}"><span class="cap">${name}</span></a>`;
    })
    .join('\n');

  const rows = others
    .map((e) => {
      const href = escapeHtml(relHref(e.rel));
      const name = escapeHtml(e.rel);
      return `<li><a href="${href}">${name}</a><small>${fmtBytes(e.size)}</small></li>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t}</title>
<style>
:root{color-scheme:light}
body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#24292f;
  max-width:1080px;margin:0 auto;padding:36px 28px 120px;background:#faf9f7}
h1{font-size:1.35em;margin:0 0 4px}
.sub{font-size:12.5px;color:#9a9183;margin-bottom:26px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:18px}
.card{display:block;background:#fff;border:1px solid #e7e2d9;border-radius:12px;overflow:hidden;
  text-decoration:none;color:inherit;transition:box-shadow .15s,transform .15s}
.card:hover{box-shadow:0 8px 24px rgba(28,26,23,.12);transform:translateY(-2px)}
.card img{display:block;width:100%;height:170px;object-fit:contain;background:
  repeating-conic-gradient(#f3f1ec 0 25%,#fff 0 50%) 0 0/22px 22px}
.cap{display:block;padding:9px 12px;font-size:12.5px;color:#57606a;border-top:1px solid #f0ece4;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
ul{list-style:none;padding:0;margin:26px 0 0}
li{display:flex;align-items:center;gap:12px;padding:10px 14px;background:#fff;
  border:1px solid #e7e2d9;border-radius:10px;margin-bottom:8px}
li a{color:#0969da;text-decoration:none;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap}
li a:hover{text-decoration:underline}
li small{color:#9a9183;font-variant-numeric:tabular-nums}
</style>
</head>
<body>
<h1>${t}</h1>
<div class="sub">${entries.length} 个文件 · pagepin 自动生成的索引页</div>
${images.length > 0 ? `<div class="grid">\n${cards}\n</div>` : ''}
${others.length > 0 ? `<ul>\n${rows}\n</ul>` : ''}
</body></html>`;
}
