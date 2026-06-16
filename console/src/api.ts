import type {
  AdminOverview,
  AdminSettings,
  AdminSite,
  AdminUser,
  AuthConfig,
  CollectedFile,
  Invite,
  InviteCreated,
  Me,
  RegistrationMode,
  SiteOut,
  TokenItem,
  Usage,
  VersionsOut,
  Visibility,
} from './types';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function getCsrf(): string {
  const m = document.cookie.match(/(?:^|;\s*)pp_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

/** /api/auth/config 的模块级缓存；fetchAuthConfig 成功后写入 */
let authConfig: AuthConfig | null = null;

/** 拉取认证配置（模块级缓存；失败时兜底 oidc / 不开放注册） */
export async function fetchAuthConfig(): Promise<AuthConfig> {
  if (authConfig) return authConfig;
  try {
    const res = await fetch('/api/auth/config', { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    authConfig = (await res.json()) as AuthConfig;
  } catch {
    authConfig = { mode: 'oidc', allow_signup: false, registration_mode: 'closed' };
  }
  return authConfig;
}

/** 登录页路径：password 模式走 SPA 内 /login；其余走服务端 /auth/login。
 *  首次（缓存未知）先跳 /login，Login 页自己再按 config 分流。 */
function loginPath(): string {
  return !authConfig || authConfig.mode === 'password' ? '/login' : '/auth/login';
}

export function redirectToLogin(): void {
  const next = location.pathname + location.search;
  location.href = loginPath() + '?next=' + encodeURIComponent(next || '/');
}

/** 登录/注册共用：JSON POST，不带 CSRF 头（登录前没有 csrf cookie，服务端这两个端点不校验） */
async function authPost(path: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `请求失败（HTTP ${res.status}）`;
    try {
      const detail = extractDetail(await res.json());
      if (detail) msg = detail;
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, msg);
  }
}

export function login(email: string, password: string): Promise<void> {
  return authPost('/auth/password', { email, password });
}

export function signup(email: string, password: string, displayName?: string): Promise<void> {
  const body: Record<string, unknown> = { email, password };
  if (displayName && displayName.trim()) body.display_name = displayName.trim();
  return authPost('/auth/signup', body);
}

function extractDetail(body: unknown): string | null {
  if (body && typeof body === 'object' && 'detail' in body) {
    const d = (body as { detail: unknown }).detail;
    if (typeof d === 'string') return d;
  }
  return null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    headers.set('X-CSRF-Token', getCsrf());
  }
  if (init?.body && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  if (res.status === 401) {
    redirectToLogin();
    throw new ApiError(401, '登录已过期，正在跳转…');
  }
  if (!res.ok) {
    let msg = `请求失败（HTTP ${res.status}）`;
    try {
      const detail = extractDetail(await res.json());
      if (detail) msg = detail;
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  me: () => request<Me>('/api/me'),

  setHandle: (handle: string) =>
    request<{ handle: string }>('/api/me/handle', {
      method: 'POST',
      body: JSON.stringify({ handle }),
    }),

  checkHandle: (handle: string) =>
    request<{ ok: boolean; reason: string | null }>('/api/me/handle/check', {
      method: 'POST',
      body: JSON.stringify({ handle }),
    }),

  suggestHandle: () =>
    request<{ suggestion: string | null }>('/api/me/handle/suggest', { method: 'POST' }),

  listSites: () => request<{ sites: SiteOut[] }>('/api/sites'),

  patchSite: (
    slug: string,
    body: {
      visibility?: Visibility;
      public_hours?: number;
      title?: string;
      spa_fallback?: boolean;
      comments_enabled?: boolean;
    },
  ) =>
    request<SiteOut>(`/api/sites/${encodeURIComponent(slug)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteSite: (slug: string) =>
    request<{ ok: true }>(`/api/sites/${encodeURIComponent(slug)}`, { method: 'DELETE' }),

  versions: (slug: string) =>
    request<VersionsOut>(`/api/sites/${encodeURIComponent(slug)}/versions`),

  rollback: (slug: string, versionId: string) =>
    request<SiteOut>(`/api/sites/${encodeURIComponent(slug)}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ version_id: versionId }),
    }),

  listTokens: () => request<{ tokens: TokenItem[] }>('/api/tokens'),

  createToken: (name: string) =>
    request<TokenItem>('/api/tokens', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  rotateToken: (id: string) =>
    request<TokenItem>(`/api/tokens/${encodeURIComponent(id)}/rotate`, { method: 'POST' }),

  revokeToken: (id: string) =>
    request<{ ok: true }>(`/api/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // ---- device authorization (OAuth2 device grant) ----
  approveDevice: (userCode: string) =>
    request<{ ok: boolean; token_name?: string }>('/api/device/approve', {
      method: 'POST',
      body: JSON.stringify({ user_code: userCode }),
    }),

  denyDevice: (userCode: string) =>
    request<{ ok: boolean }>('/api/device/deny', {
      method: 'POST',
      body: JSON.stringify({ user_code: userCode }),
    }),

  // ---- account ----
  updateProfile: (displayName: string | null) =>
    request<{ display_name: string | null }>('/api/me', {
      method: 'PATCH',
      body: JSON.stringify({ display_name: displayName }),
    }),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>('/api/me/password', {
      method: 'POST',
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    }),

  usage: () => request<Usage>('/api/me/usage'),

  // ---- admin ----
  adminOverview: () => request<AdminOverview>('/api/admin/overview'),

  adminUsers: () => request<{ users: AdminUser[] }>('/api/admin/users'),

  patchUser: (id: string, body: { is_admin?: boolean; disabled?: boolean }) =>
    request<AdminUser>(`/api/admin/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  adminSettings: () => request<AdminSettings>('/api/admin/settings'),

  setRegistrationMode: (mode: RegistrationMode) =>
    request<{ registration_mode: RegistrationMode }>('/api/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify({ registration_mode: mode }),
    }),

  // ---- admin: site moderation ----
  adminSites: () => request<{ sites: AdminSite[] }>('/api/admin/sites'),

  suspendSite: (id: string, reason?: string) =>
    request<AdminSite>(`/api/admin/sites/${encodeURIComponent(id)}/suspend`, {
      method: 'POST',
      body: JSON.stringify(reason ? { reason } : {}),
    }),

  unsuspendSite: (id: string) =>
    request<AdminSite>(`/api/admin/sites/${encodeURIComponent(id)}/unsuspend`, { method: 'POST' }),

  adminDeleteSite: (id: string) =>
    request<{ ok: true }>(`/api/admin/sites/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  listInvites: () => request<{ invites: Invite[] }>('/api/admin/invites'),

  createInvite: (body: { email?: string; is_admin?: boolean }) =>
    request<InviteCreated>('/api/admin/invites', { method: 'POST', body: JSON.stringify(body) }),

  revokeInvite: (id: string) =>
    request<{ ok: true }>(`/api/admin/invites/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

/** 邀请校验（匿名，登录前）：回显被邀邮箱 / 是否有效。永不抛错。 */
export async function fetchInviteInfo(
  token: string,
): Promise<{ ok: boolean; email?: string | null; is_admin?: boolean; reason?: string }> {
  try {
    const res = await fetch('/api/auth/invite?token=' + encodeURIComponent(token), {
      credentials: 'same-origin',
    });
    if (!res.ok) return { ok: false, reason: 'invalid' };
    return (await res.json()) as { ok: boolean; email?: string | null; is_admin?: boolean; reason?: string };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

/** 接受邀请建号（登录前，无 CSRF）。成功后服务端已下发会话 Cookie。
 *  email 仅当邀请未限定邮箱时由用户填写；限定邮箱的邀请忽略该值（服务端以邀请为准）。 */
export function acceptInvite(
  token: string,
  password: string,
  opts?: { email?: string; displayName?: string },
): Promise<void> {
  const body: Record<string, unknown> = { token, password };
  if (opts?.email && opts.email.trim()) body.email = opts.email.trim();
  if (opts?.displayName && opts.displayName.trim()) body.display_name = opts.displayName.trim();
  return authPost('/auth/accept-invite', body);
}

export async function logout(): Promise<void> {
  try {
    await fetch('/auth/logout', {
      method: 'POST',
      headers: { 'X-CSRF-Token': getCsrf() },
      credentials: 'same-origin',
      redirect: 'manual',
    });
  } catch {
    /* ignore — cookie is cleared server-side */
  }
  location.href = loginPath() + '?next=' + encodeURIComponent('/');
}

/** 部署：用 XMLHttpRequest 以便拿到上传进度。 */
export function deploySite(
  slug: string,
  files: CollectedFile[],
  title: string | undefined,
  onProgress: (percent: number) => void,
): Promise<SiteOut> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    for (const { relPath, file } of files) {
      fd.append('files', file, encodeURIComponent(relPath));
      fd.append('paths', relPath);
    }
    if (title && title.trim()) fd.append('title', title.trim());

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/sites/${encodeURIComponent(slug)}/deploy`);
    xhr.setRequestHeader('X-CSRF-Token', getCsrf());
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status === 401) {
        redirectToLogin();
        reject(new ApiError(401, '登录已过期'));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as SiteOut);
        } catch {
          reject(new ApiError(xhr.status, '响应解析失败'));
        }
        return;
      }
      let msg =
        xhr.status === 413
          ? '内容超出大小限制'
          : xhr.status === 422
            ? '路径或参数非法'
            : `部署失败（HTTP ${xhr.status}）`;
      try {
        const detail = extractDetail(JSON.parse(xhr.responseText));
        if (detail) msg = detail;
      } catch {
        /* not json */
      }
      reject(new ApiError(xhr.status, msg));
    };
    xhr.onerror = () => reject(new ApiError(0, '网络错误，上传失败'));
    xhr.send(fd);
  });
}
