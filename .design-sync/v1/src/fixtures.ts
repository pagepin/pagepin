/**
 * Realistic in-memory fixtures for the design-sync v1 bundle.
 *
 * These back the mock store + mock api so every real console screen renders
 * populated and stays interactive in claude.ai/design. Timestamps are computed
 * relative to load time so cards always read "fresh" (formatRelative shows
 * "3h ago" rather than a stale date). Browser-only module — Date.now() is fine.
 */
import type {
  AdminOverview,
  AdminSettings,
  AdminUser,
  AuthConfig,
  Invite,
  Me,
  SiteOut,
  TokenItem,
  Usage,
  VersionsOut,
} from '../../../console/src/types';

const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const ahead = (ms: number) => new Date(NOW + ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const LIMITS = {
  max_file_mb: 25,
  max_site_mb: 200,
  max_files: 2000,
  public_max_hours: 168,
};

/** Default signed-in user: onboarded admin on a password instance (so Settings
 *  shows the password section and Admin renders). */
export const ME: Me = {
  sub: 'google:108422137755098',
  handle: 'wenqi',
  display_name: 'Wenqi Zhang',
  email: 'wenqi@example.com',
  is_admin: true,
  auth_mode: 'password',
  needs_handle: false,
  content_base: 'https://pagepin.page',
  limits: LIMITS,
};

/** Auth config that lights up the richest Login/Signup variant (email+password,
 *  social buttons, signup toggle). */
export const AUTH_CONFIG: AuthConfig = {
  mode: 'password',
  allow_signup: true,
  registration_mode: 'open',
  social_providers: ['google', 'github'],
};

export const SITES: SiteOut[] = [
  {
    slug: 'q3-launch',
    title: 'Q3 Launch Microsite',
    url: 'https://pagepin.page/wenqi/q3-launch/',
    visibility: 'public',
    public_expires_at: ahead(2 * DAY + 3 * HOUR),
    spa_fallback: false,
    comments_enabled: true,
    unresolved_comments: 3,
    file_count: 18,
    total_bytes: 4_410_000,
    version_count: 5,
    created_at: ago(9 * DAY),
    updated_at: ago(3 * HOUR),
  },
  {
    slug: 'checkout-review',
    title: 'Design Review — Checkout',
    url: 'https://pagepin.page/wenqi/checkout-review/',
    visibility: 'private',
    public_expires_at: null,
    spa_fallback: false,
    comments_enabled: true,
    unresolved_comments: 1,
    file_count: 6,
    total_bytes: 842_000,
    version_count: 12,
    created_at: ago(21 * DAY),
    updated_at: ago(40 * MIN),
  },
  {
    slug: 'api-docs',
    title: 'API Docs',
    url: 'https://pagepin.page/wenqi/api-docs/',
    visibility: 'private',
    public_expires_at: null,
    spa_fallback: true,
    comments_enabled: false,
    unresolved_comments: 0,
    file_count: 42,
    total_bytes: 11_300_000,
    version_count: 3,
    created_at: ago(2 * DAY),
    updated_at: ago(2 * DAY),
  },
  {
    slug: 'portfolio',
    title: null,
    url: 'https://pagepin.page/wenqi/portfolio/',
    visibility: 'private',
    public_expires_at: null,
    spa_fallback: false,
    comments_enabled: true,
    unresolved_comments: 0,
    file_count: 4,
    total_bytes: 263_000,
    version_count: 1,
    created_at: ago(75 * MIN),
    updated_at: ago(75 * MIN),
  },
];

export const USAGE: Usage = {
  sites: 4,
  storage_bytes: 16_815_000,
  files: 70,
  versions: 21,
  tokens: 2,
  unresolved_comments: 4,
  limits: LIMITS,
  per_site: SITES.map((s) => ({
    slug: s.slug,
    total_bytes: s.total_bytes,
    file_count: s.file_count,
  })),
};

export const TOKENS: TokenItem[] = [
  {
    id: 'tok_ci',
    name: 'CI · GitHub Actions',
    token: 'pp_7f3a9c2b1e8d4f60a5b2c1d0e9f8a7b6',
    prefix: 'pp_7f3a9c2b1e8',
    created_at: ago(34 * DAY),
    last_used_at: ago(5 * HOUR),
    expires_at: null,
  },
  {
    id: 'tok_cli',
    name: 'laptop · claude-code',
    token: null,
    prefix: 'pp_b1d0e9f8a7b',
    created_at: ago(6 * DAY),
    last_used_at: ago(2 * DAY),
    expires_at: ahead(84 * DAY),
  },
];

export const VERSIONS: VersionsOut = {
  current: 'v5',
  versions: [
    { id: 'v5', file_count: 18, total_bytes: 4_410_000, created_at: ago(3 * HOUR) },
    { id: 'v4', file_count: 18, total_bytes: 4_388_000, created_at: ago(2 * DAY) },
    { id: 'v3', file_count: 17, total_bytes: 4_120_000, created_at: ago(6 * DAY) },
    { id: 'v2', file_count: 15, total_bytes: 3_960_000, created_at: ago(8 * DAY) },
    { id: 'v1', file_count: 12, total_bytes: 3_540_000, created_at: ago(9 * DAY) },
  ],
};

// ---- admin ----
export const ADMIN_OVERVIEW: AdminOverview = {
  sites: 37,
  users: 12,
  admins: 2,
  storage_bytes: 537_000_000,
  versions: 184,
};

export const ADMIN_SETTINGS: AdminSettings = {
  auth_mode: 'password',
  registration_mode: 'invite',
  registration_locked: false,
  limits: LIMITS,
};

export const ADMIN_USERS: AdminUser[] = [
  {
    id: 'u_wenqi',
    handle: 'wenqi',
    email: 'wenqi@example.com',
    display_name: 'Wenqi Zhang',
    is_admin: true,
    disabled: false,
    created_at: ago(120 * DAY),
    last_login_at: ago(20 * MIN),
    site_count: 4,
    storage_bytes: 16_815_000,
  },
  {
    id: 'u_ops',
    handle: 'ops',
    email: 'ops@example.com',
    display_name: 'Ops Bot',
    is_admin: true,
    disabled: false,
    created_at: ago(110 * DAY),
    last_login_at: ago(3 * DAY),
    site_count: 9,
    storage_bytes: 210_400_000,
  },
  {
    id: 'u_mia',
    handle: 'mia',
    email: 'mia@example.com',
    display_name: 'Mia Chen',
    is_admin: false,
    disabled: false,
    created_at: ago(48 * DAY),
    last_login_at: ago(6 * HOUR),
    site_count: 7,
    storage_bytes: 88_900_000,
  },
  {
    id: 'u_left',
    handle: null,
    email: 'former@example.com',
    display_name: null,
    is_admin: false,
    disabled: true,
    created_at: ago(70 * DAY),
    last_login_at: ago(52 * DAY),
    site_count: 0,
    storage_bytes: 0,
  },
];

export const INVITES: Invite[] = [
  {
    id: 'inv_pending',
    email: 'newhire@example.com',
    is_admin: false,
    created_at: ago(2 * DAY),
    expires_at: ahead(5 * DAY),
    accepted_at: null,
    expired: false,
  },
  {
    id: 'inv_expired',
    email: null,
    is_admin: false,
    created_at: ago(20 * DAY),
    expires_at: ago(6 * DAY),
    accepted_at: null,
    expired: true,
  },
];

/** Demo device-authorization code surfaced on the Activate screen. */
export const DEVICE_USER_CODE = 'K7QP-2F9X';
