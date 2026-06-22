/**
 * Mock of console/src/api.ts — same export surface, backed by in-memory fixtures.
 * esbuild aliases `../api` / `./api` in the real components to this module.
 *
 * Every method resolves immediately (so screenshots capture populated state) and
 * mutates module-level copies where a flow should feel live (tokens, invites,
 * users, sites). NOTHING navigates for real: login/signup/logout drive the
 * prototype's in-app routing via the `location` shim (rewritten to __ppLoc) and
 * the mock store. CSRF/cookies are irrelevant here.
 */
import type {
  AdminSettings,
  AdminUser,
  CollectedFile,
  Invite,
  InviteCreated,
  RegistrationMode,
  SiteOut,
  TokenItem,
  Visibility,
} from '../../../console/src/types';
import { HANDLE_RE } from '../../../console/src/types';
import { useStore } from './mock-store';
import {
  ADMIN_OVERVIEW,
  ADMIN_SETTINGS,
  ADMIN_USERS,
  AUTH_CONFIG,
  INVITES,
  ME,
  TOKENS,
  USAGE,
  VERSIONS,
} from './fixtures';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ---- mutable working copies (so create/revoke/rotate feel live within a session) ----
let tokens: TokenItem[] = TOKENS.map((t) => ({ ...t }));
let invites: Invite[] = INVITES.map((i) => ({ ...i }));
let users: AdminUser[] = ADMIN_USERS.map((u) => ({ ...u }));
const settings: AdminSettings = { ...ADMIN_SETTINGS };

let seq = 100;
const rndHex = (n: number) =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
const nowIso = () => new Date().toISOString();
const TAKEN_HANDLES = new Set(['wenqi', 'admin', 'ops', 'mia', 'pagepin', 'api', 'www']);

export async function fetchAuthConfig() {
  return AUTH_CONFIG;
}

/** Pre-auth submit: seed the signed-in user so the prototype lands authenticated;
 *  the real Login/Signup component does the navigation itself afterward. */
export async function login(_email: string, _password: string): Promise<void> {
  useStore.getState().setMe(ME);
}
export async function signup(
  _email: string,
  _password: string,
  _displayName?: string,
): Promise<void> {
  useStore.getState().setMe(ME);
}

export function redirectToLogin(): void {
  location.href = '/login';
}

export async function fetchInviteInfo(_token: string) {
  return { ok: true, email: 'newhire@example.com', is_admin: false };
}

export async function acceptInvite(
  _token: string,
  _password: string,
  _opts?: { email?: string; displayName?: string },
): Promise<void> {
  useStore.getState().setMe(ME);
}

export async function logout(): Promise<void> {
  useStore.setState({ me: null });
  location.href = '/login';
}

/** Simulated multipart deploy with progress; resolves an updated/created SiteOut. */
export function deploySite(
  slug: string,
  files: CollectedFile[],
  title: string | undefined,
  onProgress: (percent: number) => void,
): Promise<SiteOut> {
  return new Promise((resolve) => {
    [20, 55, 85, 100].forEach((p, i) => setTimeout(() => onProgress(p), i * 120));
    setTimeout(() => {
      const existing = useStore.getState().sites.find((s) => s.slug === slug);
      const totalBytes = files.reduce((n, f) => n + (f.file?.size ?? 0), 0) || 512_000;
      const site: SiteOut = existing
        ? {
            ...existing,
            title: title?.trim() || existing.title,
            file_count: files.length || existing.file_count,
            total_bytes: totalBytes,
            version_count: existing.version_count + 1,
            updated_at: nowIso(),
          }
        : {
            slug,
            title: title?.trim() || null,
            url: `https://pagepin.page/wenqi/${slug}/`,
            visibility: 'private',
            public_expires_at: null,
            spa_fallback: false,
            comments_enabled: true,
            unresolved_comments: 0,
            file_count: files.length || 1,
            total_bytes: totalBytes,
            version_count: 1,
            created_at: nowIso(),
            updated_at: nowIso(),
          };
      resolve(site);
    }, 560);
  });
}

function patchStoreSite(slug: string, patch: Partial<SiteOut>): SiteOut {
  const cur = useStore.getState().sites.find((s) => s.slug === slug);
  const next: SiteOut = { ...(cur as SiteOut), ...patch, updated_at: nowIso() };
  return next;
}

export const api = {
  me: async () => ME,

  setHandle: async (handle: string) => {
    useStore.setState((s) => ({ me: s.me ? { ...s.me, handle, needs_handle: false } : s.me }));
    return { handle };
  },

  checkHandle: async (handle: string) => {
    if (!HANDLE_RE.test(handle)) return { ok: false, reason: 'invalid' as string | null };
    if (TAKEN_HANDLES.has(handle)) return { ok: false, reason: 'taken' as string | null };
    return { ok: true, reason: null as string | null };
  },

  suggestHandle: async () => ({ suggestion: 'wenqi-z' as string | null }),

  listSites: async () => ({ sites: useStore.getState().sites }),

  patchSite: async (
    slug: string,
    body: {
      visibility?: Visibility;
      public_hours?: number;
      title?: string;
      spa_fallback?: boolean;
      comments_enabled?: boolean;
    },
  ) => {
    const patch: Partial<SiteOut> = {};
    if (body.visibility) {
      patch.visibility = body.visibility;
      patch.public_expires_at =
        body.visibility === 'public'
          ? new Date(Date.now() + (body.public_hours ?? 168) * 3_600_000).toISOString()
          : null;
    }
    if (body.title !== undefined) patch.title = body.title || null;
    if (body.spa_fallback !== undefined) patch.spa_fallback = body.spa_fallback;
    if (body.comments_enabled !== undefined) patch.comments_enabled = body.comments_enabled;
    return patchStoreSite(slug, patch);
  },

  deleteSite: async (_slug: string) => ({ ok: true as const }),

  versions: async (_slug: string) => VERSIONS,

  rollback: async (slug: string, _versionId: string) => patchStoreSite(slug, {}),

  listTokens: async () => ({ tokens }),

  createToken: async (name: string) => {
    const t: TokenItem = {
      id: 'tok_' + seq++,
      name,
      token: 'pp_' + rndHex(32),
      prefix: 'pp_' + rndHex(11),
      created_at: nowIso(),
      last_used_at: null,
      expires_at: null,
    };
    tokens = [t, ...tokens];
    return t;
  },

  rotateToken: async (id: string) => {
    const idx = tokens.findIndex((t) => t.id === id);
    const base = tokens[idx] ?? tokens[0];
    const rotated: TokenItem = {
      ...base,
      token: 'pp_' + rndHex(32),
      prefix: 'pp_' + rndHex(11),
      last_used_at: null,
    };
    if (idx !== -1) tokens[idx] = rotated;
    return rotated;
  },

  revokeToken: async (id: string) => {
    tokens = tokens.filter((t) => t.id !== id);
    return { ok: true as const };
  },

  approveDevice: async (_userCode: string) => ({ ok: true, token_name: 'laptop · claude-code' }),
  denyDevice: async (_userCode: string) => ({ ok: true }),

  updateProfile: async (displayName: string | null) => {
    useStore.setState((s) => ({
      me: s.me ? { ...s.me, display_name: displayName ?? '' } : s.me,
    }));
    return { display_name: displayName };
  },

  changePassword: async (_currentPassword: string, _newPassword: string) => ({ ok: true as const }),

  usage: async () => USAGE,

  // ---- admin ----
  adminOverview: async () => ADMIN_OVERVIEW,

  adminUsers: async () => ({ users }),

  patchUser: async (id: string, body: { is_admin?: boolean; disabled?: boolean }) => {
    const idx = users.findIndex((u) => u.id === id);
    const updated: AdminUser = { ...(users[idx] ?? users[0]), ...body };
    if (idx !== -1) users[idx] = updated;
    return updated;
  },

  adminSettings: async () => settings,

  setRegistrationMode: async (mode: RegistrationMode) => {
    settings.registration_mode = mode;
    return { registration_mode: mode };
  },

  listInvites: async () => ({ invites }),

  createInvite: async (body: { email?: string; is_admin?: boolean }) => {
    const id = 'inv_' + seq++;
    const expires = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const created: InviteCreated = {
      id,
      token: 'inv_' + rndHex(24),
      url: `https://app.pagepin.ai/signup?invite=inv_${rndHex(24)}`,
      email: body.email ?? null,
      is_admin: !!body.is_admin,
      expires_at: expires,
    };
    invites = [
      {
        id,
        email: body.email ?? null,
        is_admin: !!body.is_admin,
        created_at: nowIso(),
        expires_at: expires,
        accepted_at: null,
        expired: false,
      },
      ...invites,
    ];
    return created;
  },

  revokeInvite: async (id: string) => {
    invites = invites.filter((i) => i.id !== id);
    return { ok: true as const };
  },
};
