export interface AuthConfig {
  mode: 'password' | 'oidc' | 'none';
  allow_signup: boolean;
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
  needs_handle: boolean;
  content_base: string;
  limits: Limits;
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

export interface CollectedFile {
  relPath: string;
  file: File;
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const HANDLE_RE = /^[a-z][a-z0-9-]{1,31}$/;
