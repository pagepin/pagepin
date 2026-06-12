/** 启动建表 SQL —— schema.ts 的镜像,改一处必须同步另一处。
 * v1 不引迁移链(全新产品无存量库);将来加列走 ALTER + 版本号。 */

export const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT,
  password_hash TEXT,
  oidc_sub TEXT,
  handle TEXT,
  display_name TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_oidc_sub_uq ON users(oidc_sub) WHERE oidc_sub IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_handle_uq ON users(handle) WHERE handle IS NOT NULL;

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  owner_handle TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT,
  visibility TEXT NOT NULL DEFAULT 'private',
  public_expires_at TEXT,
  spa_fallback INTEGER NOT NULL DEFAULT 0,
  comments_enabled INTEGER NOT NULL DEFAULT 1,
  current_version_id TEXT,
  versions TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS sites_handle_slug_uq ON sites(owner_handle, slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sites_owner_idx ON sites(owner_id);

CREATE TABLE IF NOT EXISTS comment_threads (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  owner_handle TEXT NOT NULL,
  slug TEXT NOT NULL,
  page_path TEXT NOT NULL,
  version_id TEXT NOT NULL,
  selector TEXT NOT NULL,
  rx REAL NOT NULL,
  ry REAL NOT NULL,
  kind TEXT,
  anchor_text TEXT,
  resolved INTEGER NOT NULL DEFAULT 0,
  comments TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS threads_page_idx ON comment_threads(owner_handle, slug, page_path);
CREATE INDEX IF NOT EXISTS threads_site_idx ON comment_threads(site_id);

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token TEXT,
  token_hash TEXT NOT NULL,
  prefix TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS tokens_hash_uq ON api_tokens(token_hash);
CREATE INDEX IF NOT EXISTS tokens_user_idx ON api_tokens(user_id);
`;
