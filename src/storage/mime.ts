/** 扩展名 → Content-Type(对齐 Python mimetypes 常用面;text/* 自动补 charset)。 */

const MIME: Record<string, string> = {
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  ico: 'image/vnd.microsoft.icon',
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
  xml: 'application/xml',
  pdf: 'application/pdf',
  zip: 'application/zip',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/x-wav',
  wasm: 'application/wasm',
  map: 'application/json',
  yaml: 'application/yaml',
  yml: 'application/yaml',
};

export function guessContentType(path: string): string {
  const name = path.split('/').pop() ?? '';
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  let ct = MIME[ext] ?? 'application/octet-stream';
  if (ct.startsWith('text/') && !ct.includes('charset')) ct += '; charset=utf-8';
  return ct;
}
