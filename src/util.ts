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

/** 邮箱粗校验：@ 两侧非空、域名带点（拦下 a@b 这类）。与前端 EMAIL_RE 同义。 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function validEmail(email: string): boolean {
  return EMAIL_RE.test(email);
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

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** 短 id:12 位 base62 ≈ 71 bit 随机。会进分享链接的对象(评论线程等)用,
 * UUID 36 位太长;站点/用户等纯内部 id 仍用 uuid()。拒绝采样去模偏。 */
export function shortId(len = 12): string {
  let out = '';
  while (out.length < len) {
    const buf = crypto.getRandomValues(new Uint8Array(len * 2));
    for (const b of buf) {
      if (b >= 248) continue; // 248 = 4×62,只取均匀覆盖区
      out += B62[b % 62]!;
      if (out.length === len) break;
    }
  }
  return out;
}
