/** 品牌门页外壳 —— 私有登录墙 / 链接已过期 / 404 / 内容域登录表单 共用同一套视觉。
 *
 * 单点定义,杜绝样式漂移:此前 serving.ts 的门页与 auth/routes.ts 的 loginPage 各写一套
 * (teal vs 蓝、品牌字体 vs system-ui、英文 vs 中文),同一登录流程里视觉割裂。统一收口于此。
 *
 * edge-safe:纯字符串拼接,无运行时依赖;字体走公共 CDN(非控制台资产,被托管的内容域可引)。 */

import type { Locale } from './i18n/index.js';

/** html.escape(quote=True) 等价 */
export function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');
}

/** 品牌字体(Hanken Grotesk + JetBrains Mono),公共 CDN。门页与内容域查看器壳共用。 */
export const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">`;

/** pagepin 品牌 favicon(v3 mark),内联 data-URI —— 内容域门页/登录页标签页同样显示新 logo。
 *  与 console/index.html 同一份 SVG;edge-safe,无静态资源依赖。 */
export const FAVICON = `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cpath fill='%230f7c72' d='M24,2 H76 A22,22 0 0 1 98,24 V76 A22,22 0 0 1 76,98 H24 A22,22 0 0 1 2,76 V24 A22,22 0 0 1 24,2 Z'/%3E%3Cpath fill='%23fff' d='M24,52 A26,26 0 1 1 50,78 L27,78 A2,2 0 0 1 25,76 Z'/%3E%3Crect x='37' y='42' width='26' height='4.6' rx='2.3' fill='%230f7c72'/%3E%3Crect x='37' y='52' width='17' height='4.6' rx='2.3' fill='%237fcabf'/%3E%3C/svg%3E">`;

export const LOCK_SVG = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
export const CLOCK_SVG = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;

/** 居中卡片 + 点阵底纹的品牌门页外壳。含表单控件样式,供内容域登录表单复用同一品牌。 */
export function gateDoc(title: string, inner: string, locale: Locale = 'en'): string {
  return `<!doctype html>
<html lang="${locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${FAVICON}${FONTS}<title>${title}</title>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;
  font-family:'Hanken Grotesk',system-ui,sans-serif;color:#11161b;background:#ECEEEF;
  background-image:radial-gradient(rgba(15,124,114,.05) 1px,transparent 1px);background-size:22px 22px}
.card{width:100%;max-width:380px;background:#fff;border:1px solid #e7e9eb;border-radius:16px;
  padding:28px 30px;box-shadow:0 18px 44px -26px rgba(17,22,27,.3)}
.chip{width:52px;height:52px;border-radius:14px;display:grid;place-items:center;margin-bottom:18px}
.chip-teal{background:#e6f4f2;color:#0b6358}.chip-amber{background:#fef6e7;color:#b06a08}
h1{margin:0;font-size:19px;font-weight:700;letter-spacing:-.01em}
.body{margin:8px 0 0;font-size:13.5px;line-height:1.6;color:#6b7480}
.mono{font-family:'JetBrains Mono',monospace}.teal{color:#0f7c72}
.btn{display:flex;align-items:center;justify-content:center;width:100%;margin-top:18px;padding:10px;
  border-radius:9px;font-size:13px;font-weight:600;text-decoration:none;cursor:pointer}
.btn-primary{background:#0f7c72;color:#fff}.btn-primary:hover{background:#0b6358}
.btn-ghost{background:#fff;border:1px solid #e1e4e6;color:#3a424b}.btn-ghost:hover{border-color:#0f7c72;color:#0f7c72}
/* 社交登录按钮 + or 分隔线 —— 内容域登录墙复用,与控制台社交按钮同一视觉(白底描边) */
.btn-social{background:#fff;border:1px solid #e1e4e6;color:#1b2127;gap:9px}.btn-social:hover{border-color:#0f7c72;color:#0f7c72}
.social{margin-top:18px}.social .btn{margin-top:0}.social .btn + .btn{margin-top:10px}
.or{display:flex;align-items:center;gap:10px;margin:16px 0 0;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#9aa1a9}.or::before,.or::after{content:"";flex:1;height:1px;background:#e7e9eb}
.row{display:flex;align-items:center;gap:8px;margin-top:14px;font-size:12.5px;color:#9aa1a9}
.avatar{width:22px;height:22px;border-radius:999px;background:#0f7c72;color:#fff;display:grid;place-items:center;font-size:10px;font-weight:700}
.foot{margin-top:16px;font-size:11px;color:#c3c8cd}
/* 表单控件 —— 内容域登录表单复用,与上面同一品牌(此前是另一套蓝/灰样式) */
form{margin:0}
label{display:block;text-align:left;font-size:12px;font-weight:600;color:#6b7480;margin-top:14px}
input{display:block;width:100%;margin-top:6px;padding:9px 11px;border:1px solid #e1e4e6;border-radius:9px;
  font-size:13.5px;font-family:inherit;color:#11161b;background:#fff;-webkit-appearance:none}
input:focus{outline:none;border-color:#0f7c72;box-shadow:0 0 0 3px rgba(15,124,114,.12)}
button.btn{border:0;font-family:inherit}
button.btn:disabled{opacity:.6;cursor:default}
.err{margin-top:14px;padding:8px 11px;border-radius:8px;background:#fef2f2;border:1px solid #fde0e0;
  color:#b42318;font-size:12.5px;line-height:1.5;text-align:left}
</style></head>
<body><div class="card">${inner}</div></body></html>`;
}
