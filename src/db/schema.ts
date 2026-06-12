/** Drizzle SQLite schema —— 内嵌列表落 JSON 文本列。
 *
 * 发布原子性:better-sqlite3 事务里 push 新 version + 切 current_version_id,
 * 重发布不露半成品、回滚 = current_version_id 指回旧 version(与 Mongo 单文档更新同语义)。
 * ★ 改表结构必须同步 ddl.ts(启动建表的唯一事实源)。
 */

import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export interface SiteVersion {
  id: string; // uuid
  storage_prefix: string; // sites/<ownerId>/<slug>/<vid>/
  file_count: number;
  total_bytes: number;
  uploaded_by: string;
  created_at: string;
  files?: string[]; // 上传文件 rel 清单(图片查看器壳「上一张/下一张」数据源;旧版本无此字段 → 不出导航)
}

export interface ThreadComment {
  id: string; // uuid
  author_sub: string; // = users.id(删除权限判定)
  author_name: string; // 姓名快照(展示用;改名不回溯)
  text: string; // 纯文本(前端一律 textContent 渲染,无 HTML 注入面)
  created_at: string;
}

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email'),
    passwordHash: text('password_hash'),
    oidcSub: text('oidc_sub'),
    handle: text('handle'), // 路径用户名(首登确认;唯一、URL 安全)
    displayName: text('display_name'),
    isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    lastLoginAt: text('last_login_at'),
  },
  (t) => [
    uniqueIndex('users_email_uq').on(t.email).where(sql`email IS NOT NULL`),
    uniqueIndex('users_oidc_sub_uq').on(t.oidcSub).where(sql`oidc_sub IS NOT NULL`),
    uniqueIndex('users_handle_uq').on(t.handle).where(sql`handle IS NOT NULL`),
  ],
);

export const sites = sqliteTable(
  'sites',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    ownerHandle: text('owner_handle').notNull(), // 反范式:serving 热路径 (handle, slug) 一次查到
    slug: text('slug').notNull(),
    title: text('title'),
    visibility: text('visibility').notNull().default('private'), // private | public
    publicExpiresAt: text('public_expires_at'), // 仅 public 有值;请求时判定过期
    spaFallback: integer('spa_fallback', { mode: 'boolean' }).notNull().default(false),
    commentsEnabled: integer('comments_enabled', { mode: 'boolean' }).notNull().default(true),
    currentVersionId: text('current_version_id'),
    versions: text('versions', { mode: 'json' }).$type<SiteVersion[]>().notNull().default([]),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'), // 软删后同名 slug 可复用(唯一索引只约束未删行)
  },
  (t) => [
    uniqueIndex('sites_handle_slug_uq').on(t.ownerHandle, t.slug).where(sql`deleted_at IS NULL`),
    index('sites_owner_idx').on(t.ownerId),
  ],
);

export const commentThreads = sqliteTable(
  'comment_threads',
  {
    id: text('id').primaryKey(),
    siteId: text('site_id').notNull(),
    ownerHandle: text('owner_handle').notNull(),
    slug: text('slug').notNull(),
    pagePath: text('page_path').notNull(), // 站点内页面路径("index.html" / "docs/a.html")
    versionId: text('version_id').notNull(), // 创建时的 current_version_id
    selector: text('selector').notNull(), // 被评论元素的 CSS path;"@page" = 整页评论
    rx: real('rx').notNull(), // 锚点在元素盒内的相对偏移(0~1);框选时为框左上角
    ry: real('ry').notNull(),
    rw: real('rw'), // 框选区域的相对宽高(0~1);null = 点评论
    rh: real('rh'),
    kind: text('kind'), // copy/style/question/bug;null = 普通评论
    anchorText: text('anchor_text'), // 创建时目标元素文本指纹(SPA 换数据降级判定)
    resolved: integer('resolved', { mode: 'boolean' }).notNull().default(false),
    comments: text('comments', { mode: 'json' }).$type<ThreadComment[]>().notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (t) => [
    index('threads_page_idx').on(t.ownerHandle, t.slug, t.pagePath),
    index('threads_site_idx').on(t.siteId),
  ],
);

export const apiTokens = sqliteTable(
  'api_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    token: text('token'), // 明文(仅 owner 的 Cookie 会话可读;自托管拍板同内部版取舍)
    tokenHash: text('token_hash').notNull(), // sha256(明文) hex,认证查询索引
    prefix: text('prefix').notNull(), // 明文前 15 位(pp_ + 12 hex),日志审计用
    createdAt: text('created_at').notNull(),
    lastUsedAt: text('last_used_at'),
    revokedAt: text('revoked_at'), // 软吊销;命中即拒
  },
  (t) => [
    uniqueIndex('tokens_hash_uq').on(t.tokenHash),
    index('tokens_user_idx').on(t.userId),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type SiteRow = typeof sites.$inferSelect;
export type CommentThreadRow = typeof commentThreads.$inferSelect;
export type ApiTokenRow = typeof apiTokens.$inferSelect;

/** site.versions 里找当前版本(对应 Site.current_version())。 */
export function currentVersion(site: SiteRow): SiteVersion | null {
  if (!site.currentVersionId) return null;
  return site.versions.find((v) => v.id === site.currentVersionId) ?? null;
}

/** 公开可见判定(对应 Site.is_publicly_visible)。 */
export function isPubliclyVisible(site: SiteRow, now: Date): boolean {
  if (site.visibility !== 'public' || !site.publicExpiresAt) return false;
  return now < new Date(site.publicExpiresAt);
}
