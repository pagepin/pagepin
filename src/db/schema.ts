/** Drizzle SQLite schema —— 内嵌列表落 JSON 文本列。
 *
 * 发布原子性:事务里 push 新 version + 切 current_version_id,
 * 重发布不露半成品、回滚 = current_version_id 指回旧 version(与 Mongo 单文档更新同语义)。
 * ★ 改表结构后跑 `pnpm drizzle-kit generate` 生成迁移;libSQL 启动自动应用(见 db/libsql.ts),
 *   D1 用 `wrangler d1 migrations apply pagepin --remote`(见 package.json 的 cf:deploy)。
 */

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

/** 分批上传草稿里累计的文件清单项(rel→size,按 rel 去重;commit 时据此算 file_count/total_bytes)。 */
export interface PendingFile {
  rel: string;
  size: number;
}

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email'), // 展示用(可重复;不再是账号键)。真正的键是 canonicalEmail。
    // 账号键:canonicalEmail(NFKC+trim+lowercase 归一)唯一。大小写/Unicode 变体不再绕过唯一约束。
    canonicalEmail: text('canonical_email'),
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
    passwordHash: text('password_hash'),
    // 旧的单一社交身份列 —— 仍写入作影子(二进制回滚兼容),真正的多身份在 identities 表。一版后删。
    oidcSub: text('oidc_sub'),
    // 解绑身份/禁用账号时自增 → 内嵌进 JWT,每请求比对,使无状态会话可被主动失效(Phase 2 用)。
    sessionEpoch: integer('session_epoch').notNull().default(0),
    handle: text('handle'), // 路径用户名(首登确认;唯一、URL 安全)
    displayName: text('display_name'),
    isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
    disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false), // 禁用后所有认证路径即拒(控制面/数据面/登录入口);管理员可恢复
    createdAt: text('created_at').notNull(),
    lastLoginAt: text('last_login_at'),
  },
  (t) => [
    // 账号唯一性收口到归一后的 canonicalEmail(email 列改为可重复的展示字段)。
    // 普通唯一索引(非部分索引):SQLite/PG/MySQL 三家的唯一索引都允许多个 NULL,
    // 故「可空但唯一」语义无需 WHERE ... IS NOT NULL —— 行为一致、跨方言通用。
    uniqueIndex('users_canonical_email_uq').on(t.canonicalEmail),
    uniqueIndex('users_oidc_sub_uq').on(t.oidcSub),
    uniqueIndex('users_handle_uq').on(t.handle),
  ],
);

/** 登录身份(凭证)—— 一个 users.id 可挂多行:password + google + github 同属一人一账号。
 *
 * 取代「users 一行只装一个 oidc_sub」的旧模型:
 * - 登录恒按 (provider, sub) 查这张表 → 解析出 userId。这是唯一的登录键。
 * - social/oidc 的 sub 沿用历史命名空间值(与旧 oidc_sub 一致,如 'google:123'/'github:456');
 *   password 的 sub = canonicalEmail。
 * - email 仅展示/「连接提示」用,**永不**作跨账号自动并号键(IdP 验证过的邮箱只证明掌握邮箱、
 *   不证明拥有账号)。唯一的跨账号挂载路径是「登录进目标账号后在设置里连接」(Phase 2)。 */
export const identities = sqliteTable(
  'identities',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    provider: text('provider').notNull(), // 'password' | 'google' | 'github' | 'oidc'
    sub: text('sub').notNull(), // social/oidc:命名空间 sub;password:canonicalEmail
    email: text('email'), // 该身份断言的邮箱(canonical;展示/提示用)
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    lastLoginAt: text('last_login_at'),
  },
  (t) => [
    // 登录查找 + 挂载防并发的唯一键(取代 users_oidc_sub_uq 的登录职责)。
    uniqueIndex('identities_provider_sub_uq').on(t.provider, t.sub),
    index('identities_user_idx').on(t.userId),
    index('identities_email_idx').on(t.email), // 仅「连接提示」查找,非唯一(普通索引,跨方言通用)
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
    // 签名分享链接的撤销版本号:?key= 内嵌 skv,与此值不等即拒(撤销 = 自增,旧链接全部失效)
    shareKeyVersion: integer('share_key_version').notNull().default(1),
    // 允许持分享链接进来的访客(guest 会话)在本站点评论;访客只可能经站长签发的 key 链接进入
    guestComments: integer('guest_comments', { mode: 'boolean' }).notNull().default(true),
    // 站点硬 TTL(匿名试用站):非空 = 到期由清理任务连存储一起硬删;null = 常规站点
    expiresAt: text('expires_at'),
    spaFallback: integer('spa_fallback', { mode: 'boolean' }).notNull().default(false),
    commentsEnabled: integer('comments_enabled', { mode: 'boolean' }).notNull().default(true),
    currentVersionId: text('current_version_id'),
    versions: text('versions', { mode: 'json' }).$type<SiteVersion[]>().notNull().default([]),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'), // 软删时 slug 改名让出活命名空间(util.tombstoneSlug),故同名 slug 可复用
    // 管理员下架(可逆):非空 = serving 一律 451(对所有访问者,含站长/匿名公开),
    // 重新部署也不解除 —— 与软删互不影响(软删进墓碑,下架仍可恢复)。滥用处置开关。
    suspendedAt: text('suspended_at'),
    suspendedReason: text('suspended_reason'),
  },
  (t) => [
    // 普通唯一索引(非部分索引):软删时把 slug 改名(util.tombstoneSlug)让出活命名空间,
    // 墓碑行不再占用 (owner_handle, slug),故无需 WHERE deleted_at IS NULL → 跨 SQLite/PG/MySQL 通用。
    uniqueIndex('sites_handle_slug_uq').on(t.ownerHandle, t.slug),
    index('sites_owner_idx').on(t.ownerId),
    index('sites_expires_idx').on(t.expiresAt), // 试用站 TTL 清理扫描
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
    quote: text('quote'), // 文本选区锚点:选中的原文(≤200);非空 = 文本评论,前端在 selector 元素内检索并高亮
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
    tokenHash: text('token_hash').notNull(), // sha256(明文) hex,认证查询索引;明文只在创建/轮换响应里出现一次,不落库
    prefix: text('prefix').notNull(), // 明文前 15 位(pp_ + 12 hex),日志审计用
    createdAt: text('created_at').notNull(),
    lastUsedAt: text('last_used_at'),
    expiresAt: text('expires_at'), // 非空 = 到期即拒(设备授权铸的 token 用;普通 PAT 为 null = 不过期)
    revokedAt: text('revoked_at'), // 软吊销;命中即拒
  },
  (t) => [uniqueIndex('tokens_hash_uq').on(t.tokenHash), index('tokens_user_idx').on(t.userId)],
);

/** 注册邀请 —— 一次性链接,凭 token 建号。token 只存 sha256(明文),明文生成时展示一次。 */
export const invites = sqliteTable(
  'invites',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull(), // sha256(明文 inv_...) hex
    email: text('email'), // 限定被邀邮箱(可空 = 任意邮箱可用)
    isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false), // 接受后是否给 admin
    createdBy: text('created_by').notNull(), // = users.id(签发管理员)
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    acceptedAt: text('accepted_at'), // 非空 = 已用(一次性)
    acceptedUserId: text('accepted_user_id'),
  },
  (t) => [uniqueIndex('invites_hash_uq').on(t.tokenHash)],
);

/** 实例级运行时设置(KV)—— 管理员可改、重启保留;env 显式设置时由 env 覆盖(见 instance-settings.ts)。 */
export const instanceSettings = sqliteTable('instance_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/** 设备授权(OAuth2 Device Authorization Grant, RFC 8628)—— AI/CLI 经浏览器登录换 token,免在对话里贴明文。
 *
 * deviceCode:高熵密钥,只 /api/device/code 返给发起方,/api/device/token 凭它轮询。
 * userCode:短码,展示给人在 /activate 里确认(浏览器复用控制台会话授权)。
 * token:批准时铸的明文 PAT(同时落 api_tokens 真凭证),仅经 /api/device/token 取走一次后即删行。
 * 浏览器侧永远拿不到明文 token —— 它只走「发起方轮询」这条路。 */
export const deviceAuths = sqliteTable(
  'device_auths',
  {
    id: text('id').primaryKey(),
    deviceCode: text('device_code').notNull(), // 发起方密钥(轮询用)
    userCode: text('user_code').notNull(), // 展示给人确认的短码
    status: text('status').notNull().default('pending'), // pending | approved | denied
    userId: text('user_id'), // 批准后绑定的用户
    token: text('token'), // 批准时铸的明文 PAT;取走一次后置空/删行
    tokenName: text('token_name'), // 铸出 token 的名字(便于在 token 列表里识别)
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(), // ISO;过期即作废
    approvedAt: text('approved_at'),
  },
  (t) => [
    uniqueIndex('device_code_uq').on(t.deviceCode),
    index('device_user_code_idx').on(t.userCode),
  ],
);

/** 跨域登录接力(dual 模式)—— console 会话换内容域 pp_view 的一次性短时凭证。
 *
 * 流程:内容域登录墙「Sign in」→ console /auth/handoff(有 pp_session 即铸 code,无则先登录)
 *   → 302 内容域 /auth/accept?code= → 兑换(取走即删,60s TTL)→ 种 pp_view 落回原页。
 * 效果:GitHub/OIDC 只在 console 登录一次,内容域不再二次 OAuth。
 * code 走 URL 但一次性 + 短时,重放必失败;过期行在铸新 code 时顺手清理。 */
export const handoffCodes = sqliteTable(
  'handoff_codes',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull(), // 高熵一次性凭证(32 hex)
    userId: text('user_id').notNull(),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(), // ISO;过期即拒
  },
  (t) => [uniqueIndex('handoff_code_uq').on(t.code)],
);

/** 分批上传草稿会话 —— 大站点拆成多请求时,文件先按版本 id 落到唯一前缀,commit 才 flip current。
 *
 * 半成品永不外露:草稿版本在 commit 前不被 current_version_id 指向(原子性与单请求部署一致)。
 * manifest 跨批累计(按 rel 去重,重传同 rel 覆盖不重复计数),commit 据此算 file_count/total_bytes。
 * 与存储驱动无关(不依赖 list 能力,故 S3 BYO 桶也支持);未 commit 的草稿到 expires_at 由后续
 * begin 顺手清理(删存储前缀 + 行),不长期占用 R2。 */
export const deploySessions = sqliteTable(
  'deploy_sessions',
  {
    id: text('id').primaryKey(), // = 未来的 version id(也是存储前缀里的 vid 段)
    siteId: text('site_id').notNull(),
    ownerId: text('owner_id').notNull(),
    slug: text('slug').notNull(),
    storagePrefix: text('storage_prefix').notNull(), // sites/<ownerId>/<slug>/<vid>/
    title: text('title'),
    manifest: text('manifest', { mode: 'json' }).$type<PendingFile[]>().notNull().default([]),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    expiresAt: text('expires_at').notNull(), // ISO;过期未 commit 即可回收
  },
  (t) => [
    index('deploy_sessions_owner_idx').on(t.ownerId),
    index('deploy_sessions_expires_idx').on(t.expiresAt),
  ],
);

/** 账号合并日志 + 冲突标记(reconcile 用)。loserId 唯一 = 一个账号只会被吸收一次的闩锁;
 *  status: moving(进行中,可恢复)| done | conflict(两边都有内容,需人工)。 */
export const accountMerges = sqliteTable(
  'account_merges',
  {
    id: text('id').primaryKey(),
    loserId: text('loser_id').notNull(),
    survivorId: text('survivor_id').notNull(),
    emailKey: text('email_key').notNull(),
    status: text('status').notNull().default('moving'),
    createdAt: text('created_at').notNull(),
    finishedAt: text('finished_at'),
  },
  (t) => [uniqueIndex('account_merges_loser_uq').on(t.loserId)],
);

export type UserRow = typeof users.$inferSelect;
export type IdentityRow = typeof identities.$inferSelect;
export type AccountMergeRow = typeof accountMerges.$inferSelect;
export type SiteRow = typeof sites.$inferSelect;
export type CommentThreadRow = typeof commentThreads.$inferSelect;
export type ApiTokenRow = typeof apiTokens.$inferSelect;
export type InviteRow = typeof invites.$inferSelect;
export type DeviceAuthRow = typeof deviceAuths.$inferSelect;
export type HandoffCodeRow = typeof handoffCodes.$inferSelect;
export type DeploySessionRow = typeof deploySessions.$inferSelect;

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
