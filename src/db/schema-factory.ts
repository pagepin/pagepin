/** 跨方言 schema 工厂 —— 用一份表定义,按方言列工具箱(columns.ts)生成 pg / mysql(及 sqlite)的
 *  drizzle table。结构(表名/列名/索引名/约束)与手写的 sqlite schema.ts 完全一致,差异只在底层列类型。
 *
 *  与 schema.ts 的两点有意差异(均不影响语义,且经迁移/集成测试验证):
 *   1) JSON 列(versions/comments/manifest)不设 DB 默认 —— 所有插入都显式给值(见 api/sites.ts、
 *      comments.ts),且 MySQL 的 JSON 默认值限制多,故统一在应用层给默认,DDL 不带 DEFAULT。
 *   2) 字符串长度仅 MySQL 用到(VARCHAR(n) 才能进索引);索引用到的列长度都已控到 utf8mb4
 *      复合索引 ≤3072B(如 comment_threads.slug=64,只存真实 slug 快照,非墓碑名)。
 *
 *  运行时:sqlite/D1 仍直接用 schema.ts;本工厂只为自托管 Node 的 pg/mysql 驱动与其迁移生成服务。
 */
import type { ColumnKit } from './columns.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
// 注:JSON 列不在此处 .$type<T>() —— 工厂列类型放松成 any,精确行类型由 db/index.ts 统一从
// 规范 sqlite schema cast 得到(见该文件)。这里只关心运行时 DDL/取值映射正确。
export function buildSchema(kit: ColumnKit) {
  const { table, str, longStr, bool, int, real, json, unique, index } = kit;

  const users = table(
    'users',
    {
      id: str('id', 64).primaryKey(),
      email: str('email', 320),
      canonicalEmail: str('canonical_email', 320),
      emailVerified: bool('email_verified').notNull().default(false),
      passwordHash: longStr('password_hash'),
      oidcSub: str('oidc_sub', 255),
      sessionEpoch: int('session_epoch').notNull().default(0),
      handle: str('handle', 64),
      displayName: str('display_name', 255),
      isAdmin: bool('is_admin').notNull().default(false),
      disabled: bool('disabled').notNull().default(false),
      createdAt: str('created_at', 40).notNull(),
      lastLoginAt: str('last_login_at', 40),
    },
    (t: any) => [
      unique('users_canonical_email_uq').on(t.canonicalEmail),
      unique('users_oidc_sub_uq').on(t.oidcSub),
      unique('users_handle_uq').on(t.handle),
    ],
  );

  const identities = table(
    'identities',
    {
      id: str('id', 64).primaryKey(),
      userId: str('user_id', 64).notNull(),
      provider: str('provider', 32).notNull(),
      sub: str('sub', 255).notNull(),
      email: str('email', 320),
      emailVerified: bool('email_verified').notNull().default(false),
      createdAt: str('created_at', 40).notNull(),
      lastLoginAt: str('last_login_at', 40),
    },
    (t: any) => [
      unique('identities_provider_sub_uq').on(t.provider, t.sub),
      index('identities_user_idx').on(t.userId),
      index('identities_email_idx').on(t.email),
    ],
  );

  const sites = table(
    'sites',
    {
      id: str('id', 64).primaryKey(),
      ownerId: str('owner_id', 64).notNull(),
      ownerHandle: str('owner_handle', 64).notNull(),
      slug: str('slug', 255).notNull(),
      title: longStr('title'),
      visibility: str('visibility', 16).notNull().default('private'),
      publicExpiresAt: str('public_expires_at', 40),
      shareKeyVersion: int('share_key_version').notNull().default(1),
      guestComments: bool('guest_comments').notNull().default(true),
      expiresAt: str('expires_at', 40),
      spaFallback: bool('spa_fallback').notNull().default(false),
      commentsEnabled: bool('comments_enabled').notNull().default(true),
      currentVersionId: str('current_version_id', 64),
      versions: json('versions').notNull(),
      createdAt: str('created_at', 40).notNull(),
      updatedAt: str('updated_at', 40).notNull(),
      deletedAt: str('deleted_at', 40),
      suspendedAt: str('suspended_at', 40),
      suspendedReason: longStr('suspended_reason'),
    },
    (t: any) => [
      unique('sites_handle_slug_uq').on(t.ownerHandle, t.slug),
      index('sites_owner_idx').on(t.ownerId),
      index('sites_expires_idx').on(t.expiresAt),
    ],
  );

  const commentThreads = table(
    'comment_threads',
    {
      id: str('id', 64).primaryKey(),
      siteId: str('site_id', 64).notNull(),
      ownerHandle: str('owner_handle', 64).notNull(),
      slug: str('slug', 64).notNull(),
      pagePath: str('page_path', 512).notNull(),
      versionId: str('version_id', 64).notNull(),
      selector: longStr('selector').notNull(),
      rx: real('rx').notNull(),
      ry: real('ry').notNull(),
      rw: real('rw'),
      rh: real('rh'),
      kind: str('kind', 16),
      anchorText: longStr('anchor_text'),
      resolved: bool('resolved').notNull().default(false),
      comments: json('comments').notNull(),
      createdAt: str('created_at', 40).notNull(),
      updatedAt: str('updated_at', 40).notNull(),
      deletedAt: str('deleted_at', 40),
    },
    (t: any) => [
      index('threads_page_idx').on(t.ownerHandle, t.slug, t.pagePath),
      index('threads_site_idx').on(t.siteId),
    ],
  );

  const apiTokens = table(
    'api_tokens',
    {
      id: str('id', 64).primaryKey(),
      userId: str('user_id', 64).notNull(),
      name: str('name', 255).notNull(),
      token: longStr('token'),
      tokenHash: str('token_hash', 64).notNull(),
      prefix: str('prefix', 32).notNull(),
      createdAt: str('created_at', 40).notNull(),
      lastUsedAt: str('last_used_at', 40),
      expiresAt: str('expires_at', 40),
      revokedAt: str('revoked_at', 40),
    },
    (t: any) => [unique('tokens_hash_uq').on(t.tokenHash), index('tokens_user_idx').on(t.userId)],
  );

  const invites = table(
    'invites',
    {
      id: str('id', 64).primaryKey(),
      tokenHash: str('token_hash', 64).notNull(),
      email: str('email', 320),
      isAdmin: bool('is_admin').notNull().default(false),
      createdBy: str('created_by', 64).notNull(),
      createdAt: str('created_at', 40).notNull(),
      expiresAt: str('expires_at', 40).notNull(),
      acceptedAt: str('accepted_at', 40),
      acceptedUserId: str('accepted_user_id', 64),
    },
    (t: any) => [unique('invites_hash_uq').on(t.tokenHash)],
  );

  const instanceSettings = table('instance_settings', {
    key: str('key', 255).primaryKey(),
    value: longStr('value').notNull(),
  });

  const deviceAuths = table(
    'device_auths',
    {
      id: str('id', 64).primaryKey(),
      deviceCode: str('device_code', 255).notNull(),
      userCode: str('user_code', 64).notNull(),
      status: str('status', 16).notNull().default('pending'),
      userId: str('user_id', 64),
      token: longStr('token'),
      tokenName: str('token_name', 255),
      createdAt: str('created_at', 40).notNull(),
      expiresAt: str('expires_at', 40).notNull(),
      approvedAt: str('approved_at', 40),
    },
    (t: any) => [
      unique('device_code_uq').on(t.deviceCode),
      index('device_user_code_idx').on(t.userCode),
    ],
  );

  const handoffCodes = table(
    'handoff_codes',
    {
      id: str('id', 64).primaryKey(),
      code: str('code', 64).notNull(),
      userId: str('user_id', 64).notNull(),
      createdAt: str('created_at', 40).notNull(),
      expiresAt: str('expires_at', 40).notNull(),
    },
    (t: any) => [unique('handoff_code_uq').on(t.code)],
  );

  const deploySessions = table(
    'deploy_sessions',
    {
      id: str('id', 64).primaryKey(),
      siteId: str('site_id', 64).notNull(),
      ownerId: str('owner_id', 64).notNull(),
      slug: str('slug', 64).notNull(),
      storagePrefix: longStr('storage_prefix').notNull(),
      title: longStr('title'),
      manifest: json('manifest').notNull(),
      createdAt: str('created_at', 40).notNull(),
      updatedAt: str('updated_at', 40).notNull(),
      expiresAt: str('expires_at', 40).notNull(),
    },
    (t: any) => [
      index('deploy_sessions_owner_idx').on(t.ownerId),
      index('deploy_sessions_expires_idx').on(t.expiresAt),
    ],
  );

  const accountMerges = table(
    'account_merges',
    {
      id: str('id', 64).primaryKey(),
      loserId: str('loser_id', 64).notNull(),
      survivorId: str('survivor_id', 64).notNull(),
      emailKey: str('email_key', 320).notNull(),
      status: str('status', 16).notNull().default('moving'),
      createdAt: str('created_at', 40).notNull(),
      finishedAt: str('finished_at', 40),
    },
    (t: any) => [unique('account_merges_loser_uq').on(t.loserId)],
  );

  return {
    users,
    identities,
    sites,
    commentThreads,
    apiTokens,
    invites,
    instanceSettings,
    deviceAuths,
    handoffCodes,
    deploySessions,
    accountMerges,
  };
}
