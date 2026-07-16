export type RegistrationMode = 'open' | 'invite' | 'closed';

export interface AuthConfig {
  mode: 'password' | 'oidc' | 'none';
  allow_signup: boolean;
  registration_mode: RegistrationMode;
  /** 已启用的社交登录 provider id(如 ['google','github']);缺省/空 = 无 */
  social_providers?: string[];
  /** Cloudflare Turnstile site key;配了才下发,前端据此在 login/signup 渲染人机校验。 */
  turnstile_site_key?: string | null;
}

export interface Limits {
  max_file_mb: number;
  max_site_mb: number;
  max_files: number;
  keep_versions: number;
  public_max_hours: number;
}

export interface Me {
  sub: string;
  handle: string | null;
  display_name: string;
  email: string;
  email_verified: boolean;
  has_password: boolean;
  /** 实例是否配置了邮件发送（决定是否显示「验证邮箱」入口） */
  mail_enabled?: boolean;
  /** 能否发布内容（claim handle / 建站 / 发 token）；false → 先去验证邮箱 */
  can_publish: boolean;
  is_admin: boolean;
  auth_mode: 'password' | 'oidc' | 'none';
  /** 已启用的社交登录 provider id（设置页据此渲染「连接账号」按钮） */
  social_providers?: string[];
  needs_handle: boolean;
  content_base: string;
  limits: Limits;
}

/** 一条已连接的登录身份（password / google / github / oidc）。 */
export interface Identity {
  id: string;
  provider: string;
  email: string | null;
  email_verified: boolean;
  created_at: string;
  last_login_at: string | null;
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
  /** 分享链接访客(凭 ?key= 链接进来的人)是否可评论 */
  guest_comments: boolean;
  /** 非空 = 试用站硬 TTL 到期时间 */
  expires_at: string | null;
  /** 当前未解决的评论线程数 */
  unresolved_comments: number;
  /** 被管理员下架(serving 返回 451);站长只能看不能自行解除 */
  suspended: boolean;
  suspended_reason: string | null;
  file_count: number;
  total_bytes: number;
  version_count: number;
  /** 本次部署因版本上限被永久删除的旧版本数(仅 deploy/commit 响应带;>0 → 前端提示) */
  pruned_versions?: number;
  created_at: string;
  updated_at: string;
}

/** POST /api/sites/{slug}/share-link 的返回。落库短码(/s/<code>),之后可在列表里随时找回/撤销。 */
export interface ShareLinkOut {
  url: string;
  code: string;
  label: string | null;
  expires_at: string | null; // null = 永不过期
  hours: number | null;
  guest_comments: boolean;
}

/** GET /api/sites/{slug}/share-links 列表项(只列未撤销的;过期的仍列出由前端标注)。 */
export interface ShareLinkItem {
  code: string;
  url: string;
  label: string | null;
  created_at: string;
  expires_at: string | null;
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
  /** 明文 —— 只在创建/轮换的响应里出现一次（show-once，库中只存 hash）；列表接口不返回 */
  token?: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  /** 非空 = 到期时间(设备登录铸的 token 有);null = 不过期 */
  expires_at: string | null;
}

export interface AdminUser {
  id: string;
  handle: string | null;
  email: string | null;
  display_name: string | null;
  is_admin: boolean;
  email_verified: boolean;
  disabled: boolean;
  created_at: string;
  last_login_at: string | null;
  site_count: number;
  storage_bytes: number;
}

export interface AdminSite {
  id: string;
  slug: string;
  title: string | null;
  owner_id: string;
  owner_handle: string;
  owner_email: string | null;
  url: string;
  visibility: Visibility;
  suspended: boolean;
  suspended_at: string | null;
  suspended_reason: string | null;
  file_count: number;
  total_bytes: number;
  version_count: number;
  created_at: string;
  updated_at: string;
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
