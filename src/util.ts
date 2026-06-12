/** slug/handle/路径校验 —— 安全边界集中在这一个文件。 */

// 数据平面 URL 的第一段是 handle:这些顶级段保留给系统路由/常见探测,handle 不可取
export const RESERVED_SEGMENTS = new Set([
  'auth', 'api', 'healthz', 'favicon.ico', 'robots.txt', '.well-known',
  'static', 'assets', 'login', 'logout', 'admin', 'pagepin', 'pages',
  'p', '_pagepin', 'skill.md', 'console',
]);

const HANDLE_RE = /^[a-z][a-z0-9-]{1,31}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function validHandle(handle: string): boolean {
  return HANDLE_RE.test(handle) && !RESERVED_SEGMENTS.has(handle);
}

export function validSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

/**
 * 站点内相对路径归一化;非法(穿越/绝对/空段)返回 null。
 * 上传与 serving 都必须经这一个函数 —— 存储 key 永远落在
 * sites/<owner>/<slug>/<vid>/ 前缀之下。
 */
export function normalizeSitePath(raw: string): string | null {
  if (!raw || raw.includes('\\') || raw.includes('\0')) return null;
  const stack: string[] = [];
  for (const seg of raw.replace(/^\/+/, '').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (stack.length === 0) return null; // 越过根 = 穿越企图
      stack.pop();
      continue;
    }
    stack.push(seg);
  }
  const p = stack.join('/');
  if (!p || p.length > 512) return null;
  return p;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function uuid(): string {
  return crypto.randomUUID();
}
