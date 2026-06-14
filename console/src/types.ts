export type RegistrationMode = 'open' | 'invite' | 'closed';

export interface AuthConfig {
  mode: 'password' | 'oidc' | 'none';
  allow_signup: boolean;
  registration_mode: RegistrationMode;
}

export interface Limits {
  max_file_mb: number;
  max_site_mb: number;
  max_files: number;
  public_max_hours: number;
}

export interface Me {
  sub: string;
  handle: string | null;
  display_name: string;
  email: string;
  is_admin: boolean;
  auth_mode: 'password' | 'oidc' | 'none';
  needs_handle: boolean;
  content_base: string;
  limits: Limits;
}

export interface PerSiteUsage {
  slug: string;
  total_bytes: number;
  file_count: number;
}

export interface Usage {
  sites: number;
  storage_bytes: number;
  files: number;
  versions: number;
  tokens: number;
  unresolved_comments: number;
  limits: Limits;
  per_site: PerSiteUsage[];
}

export type Visibility = 'private' | 'public';

export interface SiteOut {
  slug: string;
  title: string | null;
  url: string;
  visibility: Visibility;
  public_expires_at: string | null;
  spa_fallback: boolean;
  comments_enabled: boolean;
  /** 当前未解决的评论线程数 */
  unresolved_comments: number;
  file_count: number;
  total_bytes: number;
  version_count: number;
  created_at: string;
  updated_at: string;
}

export interface VersionItem {
  id: string;
  file_count: number;
  total_bytes: number;
  created_at: string;
}

export interface VersionsOut {
  current: string | null;
  versions: VersionItem[];
}

export interface TokenItem {
  id: string;
  name: string;
  /** 明文；存明文方案之前创建的旧 token 为 null（只能吊销重建） */
  token: string | null;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
}

export interface AdminUser {
  id: string;
  handle: string | null;
  email: string | null;
  display_name: string | null;
  is_admin: boolean;
  disabled: boolean;
  created_at: string;
  last_login_at: string | null;
  site_count: number;
  storage_bytes: number;
}

export interface AdminOverview {
  sites: number;
  users: number;
  admins: number;
  storage_bytes: number;
  versions: number;
}

export interface AdminSettings {
  auth_mode: 'password' | 'oidc' | 'none';
  registration_mode: RegistrationMode;
  registration_locked: boolean;
  limits: Limits;
}

export interface Invite {
  id: string;
  email: string | null;
  is_admin: boolean;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  expired: boolean;
}

/** POST /api/admin/invites 的返回（含一次性明文 token + 链接） */
export interface InviteCreated {
  id: string;
  token: string;
  url: string;
  email: string | null;
  is_admin: boolean;
  expires_at: string;
}

export interface CollectedFile {
  relPath: string;
  file: File;
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const HANDLE_RE = /^[a-z][a-z0-9-]{1,31}$/;
/** 邮箱粗校验：要求 @ 两侧非空、域名带点（拦下 a@b 这类）。与服务端 validEmail 同义。 */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
