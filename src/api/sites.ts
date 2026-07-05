/** 站点管理 API(控制平面)—— 上传发布 / 列表 / 可见性 / 删除 / 回滚。
 *
 * 发布流程(原子,无半成品暴露):
 *   1. 文件全量流式写到新 version 的存储前缀(限额边写边校验)
 *   2. 乐观并发:重读站点行 → versions push + current_version_id 切换,守 current_version_id 未变的一条 update 写回
 * 失败则 current 不动,旧版本继续服务。
 */

import { and, asc, count, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';

import { galleryIndexHtml, redirectIndexHtml } from '../autoindex.js';
import { siteUrl } from '../config.js';
import type { Config } from '../config.js';
import {
  commentThreads,
  currentVersion,
  deploySessions,
  sites,
  type Db,
  type DeploySessionRow,
  type PendingFile,
  type SiteRow,
  type SiteVersion,
  type ThreadComment,
  type UserRow,
} from '../db/index.js';
import { writtenCount } from '../db/ops.js';
import { errorBody, t, type Locale } from '../i18n/index.js';
import { jsonError, localeOf } from '../i18n/locale.js';
import { mintShareKey } from '../share.js';
import { purgeSiteStorage, type Storage } from '../storage/index.js';
import { guessContentType } from '../storage/mime.js';
import type { AppDeps, AppEnv } from '../types.js';
import { normalizeSitePath, nowIso, tombstoneSlug, uuid, validSlug } from '../util.js';
import type { AuthMiddleware } from './deps.js';

/** 409 handle 未设置:错误体附机器可读 hint(英文,面向 agent 非人)。
 *  agent 靠错误体自愈比靠文档可靠 —— 它手里的 skill.md 可能是旧缓存。 */
function handleRequiredError(c: Context<AppEnv>) {
  return c.json(
    {
      ...errorBody(localeOf(c), 'site.handle.required'),
      hint:
        'The account has no handle (the user segment of page URLs). Fix with the same Bearer token: ' +
        'POST /api/me/handle/suggest for a free suggestion, then POST /api/me/handle {"handle":"..."} ' +
        '(permanent — confirm with the user first), then retry this request.',
    },
    409,
  );
}

function siteOut(deps: AppDeps, site: SiteRow, unresolved: number) {
  const cur = currentVersion(site);
  return {
    slug: site.slug,
    title: site.title,
    url: siteUrl(deps.config, site.ownerHandle, site.slug),
    visibility: site.visibility,
    public_expires_at: site.publicExpiresAt,
    spa_fallback: site.spaFallback,
    comments_enabled: site.commentsEnabled,
    guest_comments: site.guestComments,
    expires_at: site.expiresAt, // 非空 = 试用站硬 TTL
    unresolved_comments: unresolved,
    // 管理员下架状态(站长在控制台看到「Suspended」徽标 + 原因,理解为何 451)
    suspended: site.suspendedAt !== null,
    suspended_reason: site.suspendedReason,
    file_count: cur ? cur.file_count : 0,
    total_bytes: cur ? cur.total_bytes : 0,
    version_count: site.versions.length,
    created_at: site.createdAt,
    updated_at: site.updatedAt,
  };
}

/** 客户端 IP(审计用):Cloudflare 必带 cf-connecting-ip;自托管经反代取 x-forwarded-for 首跳;
 * 裸 Node 无反代则取不到(记 '-')。纯 header 读取,edge-safe。 */
function clientIp(c: Context<AppEnv>): string {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    '-'
  );
}

async function unresolvedCount(db: Db, siteId: string): Promise<number> {
  const row = (
    await db
      .select({ n: count() })
      .from(commentThreads)
      .where(
        and(
          eq(commentThreads.siteId, siteId),
          eq(commentThreads.resolved, false),
          isNull(commentThreads.deletedAt),
        ),
      )
  )[0];
  return row?.n ?? 0;
}

/** 本人名下未删站点;不存在返回 null(调用方回 404 '站点不存在')。 */
async function ownedSite(db: Db, userId: string, slug: string): Promise<SiteRow | null> {
  return (
    (
      await db
        .select()
        .from(sites)
        .where(and(eq(sites.ownerId, userId), eq(sites.slug, slug), isNull(sites.deletedAt)))
    )[0] ?? null
  );
}

async function readJson<T>(c: Context<AppEnv>): Promise<T | null> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return null;
  }
}

// ───────────────────────── 部署公共逻辑(单请求 /deploy 与分批 /deploys 共用) ─────────────────────────

/** 解析部署表单:取 files/paths/title,做 multipart/数量/类型校验。成功 → 数据;失败 → Response。 */
async function collectDeployForm(
  c: Context<AppEnv>,
): Promise<{ files: File[]; paths: string[]; title: string | null } | Response> {
  let fd: FormData;
  try {
    fd = await c.req.formData();
  } catch {
    return jsonError(c, 422, 'site.deploy.form.notMultipart');
  }
  const fileEntries = fd.getAll('files');
  const pathEntries = fd.getAll('paths');
  if (pathEntries.some((p) => typeof p !== 'string')) {
    return jsonError(c, 422, 'site.deploy.paths.notString');
  }
  const paths = pathEntries as string[];
  if (fileEntries.length !== paths.length) {
    return jsonError(c, 422, 'site.deploy.countMismatch');
  }
  if (fileEntries.length === 0) return jsonError(c, 422, 'site.deploy.noFiles');
  if (fileEntries.some((f) => !(f instanceof File))) {
    return jsonError(c, 422, 'site.deploy.files.notFile');
  }
  const titleEntry = fd.get('title');
  return {
    files: fileEntries as File[],
    paths,
    title: typeof titleEntry === 'string' ? titleEntry : null,
  };
}

interface BatchFile {
  rel: string;
  size: number;
  file: File;
}

/** 校验一批待上传文件:逐个规范化路径、查单文件大小、批内去重。成功 → BatchFile[];失败 → Response。 */
function validateBatch(
  c: Context<AppEnv>,
  cfg: Config,
  files: File[],
  paths: string[],
): BatchFile[] | Response {
  const perFileLimit = cfg.maxFileMb * 1024 * 1024;
  const out: BatchFile[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < files.length; i++) {
    const f = files[i]!;
    const rel = normalizeSitePath(paths[i]!);
    if (rel === null)
      return jsonError(c, 422, 'site.deploy.pathInvalid', { path: String(paths[i]) });
    if (seen.has(rel)) return jsonError(c, 422, 'site.deploy.pathDuplicate', { path: rel });
    seen.add(rel);
    if (f.size > perFileLimit) {
      return jsonError(c, 413, 'site.file.tooLarge', { mb: cfg.maxFileMb, path: rel });
    }
    out.push({ rel, size: f.size, file: f });
  }
  return out;
}

/** 合并清单:按 rel 去重,新条目覆盖旧(重传同路径不重复计数)。 */
function mergeManifest(prev: PendingFile[], add: BatchFile[]): PendingFile[] {
  const m = new Map<string, number>();
  for (const e of prev) m.set(e.rel, e.size);
  for (const e of add) m.set(e.rel, e.size);
  return [...m].map(([rel, size]) => ({ rel, size }));
}

/** 每用户总存储配额检查。返回错误 Response 或 null(通过/管理员豁免/未启用)。
 * versionBytes=本次版本字节;计入 GC 投影(裁到 keepVersions),避免满额用户重发被误拒。 */
async function quotaCheck(
  c: Context<AppEnv>,
  db: Db,
  cfg: Config,
  user: UserRow,
  slug: string,
  versionBytes: number,
): Promise<Response | null> {
  if (user.isAdmin || cfg.freeUserMb <= 0) return null;
  const quotaBytes = cfg.freeUserMb * 1024 * 1024;
  const mySites = await db
    .select({ slug: sites.slug, versions: sites.versions })
    .from(sites)
    .where(and(eq(sites.ownerId, user.id), isNull(sites.deletedAt)));
  let otherBytes = 0;
  let thisBytes: number[] = [];
  for (const s of mySites) {
    if (s.slug === slug) thisBytes = s.versions.map((v) => v.total_bytes);
    else otherBytes += s.versions.reduce((a, v) => a + v.total_bytes, 0);
  }
  const projected = [...thisBytes, versionBytes];
  const keptBytes = (cfg.keepVersions > 0 ? projected.slice(-cfg.keepVersions) : projected).reduce(
    (a, b) => a + b,
    0,
  );
  if (otherBytes + keptBytes > quotaBytes) {
    const usedMb = ((otherBytes + thisBytes.reduce((a, b) => a + b, 0)) / 1048576).toFixed(1);
    return jsonError(c, 413, 'site.quota.exceeded', { quota: cfg.freeUserMb, used: usedMb });
  }
  return null;
}

/** 取本人站点;不存在则建(private、无 current)。 */
async function getOrCreateSite(
  db: Db,
  user: UserRow,
  handle: string,
  slug: string,
  title: string | null,
): Promise<SiteRow> {
  const existing = await ownedSite(db, user.id, slug);
  if (existing) return existing;
  const created = nowIso();
  const site: SiteRow = {
    id: uuid(),
    ownerId: user.id,
    ownerHandle: handle,
    slug,
    title,
    visibility: 'private',
    publicExpiresAt: null,
    shareKeyVersion: 1,
    guestComments: true,
    expiresAt: null,
    spaFallback: false,
    commentsEnabled: true,
    currentVersionId: null,
    versions: [],
    createdAt: created,
    updatedAt: created,
    deletedAt: null,
    suspendedAt: null,
    suspendedReason: null,
  };
  await db.insert(sites).values(site);
  return site;
}

/** 没有 index.html 时生成根 URL 兜底(别名/秒跳/画廊;生成物不计入 file_count/total_bytes)。 */
async function generateIndexFallback(
  storage: Storage,
  storagePrefix: string,
  manifest: PendingFile[],
  label: string,
  locale: Locale,
): Promise<void> {
  const rels = new Set(manifest.map((e) => e.rel));
  if (rels.has('index.html')) return;
  const rootHtmls = [...rels].filter(
    (p) =>
      !p.includes('/') && (p.toLowerCase().endsWith('.html') || p.toLowerCase().endsWith('.htm')),
  );
  if (rootHtmls.length === 1) {
    await storage.copy(storagePrefix + rootHtmls[0]!, storagePrefix + 'index.html');
  } else {
    const html =
      manifest.length === 1
        ? redirectIndexHtml(manifest[0]!.rel, locale)
        : galleryIndexHtml(label, manifest, locale);
    await storage.put(
      storagePrefix + 'index.html',
      new TextEncoder().encode(html),
      'text/html; charset=utf-8',
    );
  }
}

/** 落版本:构建 SiteVersion → 乐观并发追加 + flip current → 版本 GC 回收被裁旧版本的存储。 */
async function publishVersion(
  db: Db,
  storage: Storage,
  cfg: Config,
  p: {
    siteId: string;
    vid: string;
    storagePrefix: string;
    fileCount: number;
    totalBytes: number;
    manifestRels: string[];
    uploadedBy: string;
    title: string | null;
  },
): Promise<number> {
  const version: SiteVersion = {
    id: p.vid,
    storage_prefix: p.storagePrefix,
    file_count: p.fileCount,
    total_bytes: p.totalBytes,
    uploaded_by: p.uploadedBy,
    created_at: nowIso(),
  };
  // 文件清单进版本记录(图片查看器壳同版本导航用);超大站点不存,免得 versions JSON 列膨胀
  if (p.manifestRels.length <= 2000) version.files = p.manifestRels;
  // 乐观并发 + 版本 GC:新版始终是末元素 → slice(-N) 必含它(current 绝不指向被裁版本)
  let removed: SiteVersion[] = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    const fresh = (await db.select().from(sites).where(eq(sites.id, p.siteId)))[0];
    if (!fresh) break;
    const allVersions = [...fresh.versions, version];
    const kept = cfg.keepVersions > 0 ? allVersions.slice(-cfg.keepVersions) : allVersions;
    const trimmed = allVersions.slice(0, allVersions.length - kept.length);
    const set: {
      versions: SiteVersion[];
      currentVersionId: string;
      updatedAt: string;
      title?: string;
    } = {
      versions: kept,
      currentVersionId: p.vid,
      updatedAt: nowIso(),
    };
    if (p.title) set.title = p.title;
    const guard =
      fresh.currentVersionId === null
        ? isNull(sites.currentVersionId)
        : eq(sites.currentVersionId, fresh.currentVersionId);
    const wrote = await writtenCount(
      db
        .update(sites)
        .set(set)
        .where(and(eq(sites.id, p.siteId), guard)),
    );
    if (wrote) {
      removed = trimmed;
      break;
    }
  }
  // 先落库再删存储,删失败只 warn(留孤儿对象不阻断部署;与 purgeSiteStorage 同「尽力而为」)。
  for (const v of removed) {
    if (!storage.deletePrefix) break;
    try {
      await storage.deletePrefix(v.storage_prefix);
    } catch (e) {
      console.warn(`版本回收失败 ${v.storage_prefix}:`, e);
    }
  }
  return removed.length; // 被裁掉的旧版本数(>0 → 前端可提示「已达版本上限」)
}

/** 本人名下的草稿会话;不属于本人/不匹配 slug → null。 */
async function ownedSession(
  db: Db,
  userId: string,
  slug: string,
  deployId: string,
): Promise<DeploySessionRow | null> {
  const s = (await db.select().from(deploySessions).where(eq(deploySessions.id, deployId)))[0];
  if (!s || s.ownerId !== userId || s.slug !== slug) return null;
  return s;
}

/** 回收本人过期未提交的草稿会话(删存储前缀 + 行)。尽力而为。 */
async function sweepExpiredSessions(db: Db, storage: Storage, ownerId: string): Promise<void> {
  const stale = await db
    .select()
    .from(deploySessions)
    .where(and(eq(deploySessions.ownerId, ownerId), lt(deploySessions.expiresAt, nowIso())));
  for (const s of stale) {
    if (storage.deletePrefix) {
      try {
        await storage.deletePrefix(s.storagePrefix);
      } catch (e) {
        console.warn(`草稿回收失败 ${s.storagePrefix}:`, e);
      }
    }
    await db.delete(deploySessions).where(eq(deploySessions.id, s.id));
  }
}

/** FastAPI 风格的 bool query 解析(?all=true / 1 / yes / on)。 */
function boolQuery(v: string | undefined): boolean {
  if (v === undefined) return false;
  return ['1', 'true', 't', 'yes', 'y', 'on'].includes(v.toLowerCase());
}

/** pydantic 宽松 bool:布尔/0/1/常见字符串可转,其余 null(调用方回 422)。 */
function parseLaxBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (v === 0 || v === 1) return v === 1;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['true', 't', 'yes', 'y', 'on', '1'].includes(s)) return true;
    if (['false', 'f', 'no', 'n', 'off', '0'].includes(s)) return false;
  }
  return null;
}

interface SitePatchBody {
  visibility?: string | null;
  public_hours?: number | null;
  title?: string | null;
  spa_fallback?: boolean | null;
  comments_enabled?: boolean | null;
  guest_comments?: boolean | null;
}

export function makeSiteRoutes(deps: AppDeps, mw: AuthMiddleware): Hono<AppEnv> {
  const { db, config: cfg, storage } = deps;
  const r = new Hono<AppEnv>().basePath('/api/sites');

  // ---- 列表(未解决评论数:一条 group by,避免 N 站点 N 次 count) ----
  r.get('/', mw.currentUser, async (c) => {
    const user = c.get('user');
    const rows = await db
      .select()
      .from(sites)
      .where(and(eq(sites.ownerId, user.id), isNull(sites.deletedAt)))
      .orderBy(desc(sites.updatedAt));
    const counts = new Map<string, number>();
    if (rows.length > 0) {
      const grouped = await db
        .select({ siteId: commentThreads.siteId, n: count() })
        .from(commentThreads)
        .where(
          and(
            inArray(
              commentThreads.siteId,
              rows.map((x) => x.id),
            ),
            eq(commentThreads.resolved, false),
            isNull(commentThreads.deletedAt),
          ),
        )
        .groupBy(commentThreads.siteId);
      for (const g of grouped) counts.set(g.siteId, g.n);
    }
    return c.json({ sites: rows.map((x) => siteOut(deps, x, counts.get(x.id) ?? 0)) });
  });

  // ---- 部署(单请求 multipart;小站点一行 curl 即可。>~90MB 的大站点走分批 /deploys) ----
  // 注:单请求整站塞进一个 body,受 Cloudflare 100MB 请求体上限约束(Free/Pro);超过请用分批端点。
  r.post('/:slug/deploy', mw.mutatingUser, mw.requireVerified, async (c) => {
    const user = c.get('user');
    const slug = c.req.param('slug');
    if (user.handle == null) return handleRequiredError(c);
    const handle = user.handle;
    if (!validSlug(slug)) {
      return jsonError(c, 422, 'site.slug.invalid');
    }

    const form = await collectDeployForm(c);
    if (form instanceof Response) return form;
    const { files, paths, title } = form;
    if (files.length > cfg.maxFiles) {
      return jsonError(c, 413, 'site.fileCount.exceeded', { max: cfg.maxFiles });
    }
    const batch = validateBatch(c, cfg, files, paths);
    if (batch instanceof Response) return batch;
    const totalBytes = batch.reduce((a, e) => a + e.size, 0);
    if (totalBytes > cfg.maxSiteMb * 1024 * 1024) {
      return jsonError(c, 413, 'site.size.exceeded', { mb: cfg.maxSiteMb });
    }
    const quotaErr = await quotaCheck(c, db, cfg, user, slug, totalBytes);
    if (quotaErr) return quotaErr;

    const site = await getOrCreateSite(db, user, handle, slug, title);
    const vid = uuid();
    const storagePrefix = `sites/${site.ownerId}/${slug}/${vid}/`;
    for (const e of batch) {
      await storage.put(storagePrefix + e.rel, e.file.stream(), guessContentType(e.rel));
    }
    const manifest: PendingFile[] = batch.map((e) => ({ rel: e.rel, size: e.size }));
    await generateIndexFallback(storage, storagePrefix, manifest, title || slug, localeOf(c));
    const pruned = await publishVersion(db, storage, cfg, {
      siteId: site.id,
      vid,
      storagePrefix,
      fileCount: manifest.length,
      totalBytes,
      manifestRels: manifest.map((e) => e.rel),
      uploadedBy: user.id,
      title,
    });
    // 部署审计线(→ stdout / Workers Logs):谁、从哪、用什么凭证上传了什么。
    console.log(
      `deploy handle=${handle} slug=${slug} vid=${vid} files=${manifest.length} bytes=${totalBytes} ` +
        `user=${user.id} via=${c.get('authVia')} ip=${clientIp(c)} ua=${JSON.stringify(c.req.header('user-agent') ?? '-')}`,
    );
    const updated = await ownedSite(db, user.id, slug);
    if (!updated) return jsonError(c, 404, 'site.notFound');
    // pruned_versions:本次发布因版本上限被回收的旧版本数(>0 → 前端提示)
    return c.json({
      ...siteOut(deps, updated, await unresolvedCount(db, updated.id)),
      pruned_versions: pruned,
    });
  });

  // ---- 分批部署 begin:开一个草稿版本,文件后续分多请求推上来,commit 才发布 ----
  // 解除单请求 100MB 上限:大站点把文件分批(每批 <~90MB)推到同一版本前缀,最后 commit 原子切换。
  r.post('/:slug/deploys', mw.mutatingUser, mw.requireVerified, async (c) => {
    const user = c.get('user');
    const slug = c.req.param('slug');
    if (user.handle == null) return handleRequiredError(c);
    const handle = user.handle;
    if (!validSlug(slug)) {
      return jsonError(c, 422, 'site.slug.invalid');
    }
    const body = await readJson<{ title?: unknown }>(c);
    const title = body && typeof body.title === 'string' ? body.title : null;

    await sweepExpiredSessions(db, storage, user.id); // 顺手回收本人过期草稿

    const site = await getOrCreateSite(db, user, handle, slug, title);
    const vid = uuid();
    const now = nowIso();
    const session: DeploySessionRow = {
      id: vid,
      siteId: site.id,
      ownerId: user.id,
      slug,
      storagePrefix: `sites/${site.ownerId}/${slug}/${vid}/`,
      title,
      manifest: [],
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + cfg.deployTtlH * 3600 * 1000).toISOString(),
    };
    await db.insert(deploySessions).values(session);
    return c.json({
      deploy_id: vid,
      storage_prefix: session.storagePrefix,
      expires_at: session.expiresAt,
      max_file_mb: cfg.maxFileMb,
      max_site_mb: cfg.maxSiteMb,
      max_files: cfg.maxFiles,
    });
  });

  // ---- 分批部署:上传一批文件(可多次调用;每批控制在 ~90MB 内) ----
  r.post('/:slug/deploys/:deployId/files', mw.mutatingUser, async (c) => {
    const user = c.get('user');
    const session = await ownedSession(db, user.id, c.req.param('slug'), c.req.param('deployId'));
    if (!session) return jsonError(c, 404, 'site.deploy.session.notFound');

    const form = await collectDeployForm(c);
    if (form instanceof Response) return form;
    const batch = validateBatch(c, cfg, form.files, form.paths);
    if (batch instanceof Response) return batch;

    // 用「合并后」的清单查限额:重传同 rel 不重复计数,避免重试误判超限
    const merged = mergeManifest(session.manifest, batch);
    if (merged.length > cfg.maxFiles) {
      return jsonError(c, 413, 'site.fileCount.exceeded', { max: cfg.maxFiles });
    }
    const mergedBytes = merged.reduce((a, e) => a + e.size, 0);
    if (mergedBytes > cfg.maxSiteMb * 1024 * 1024) {
      return jsonError(c, 413, 'site.size.exceeded', { mb: cfg.maxSiteMb });
    }
    const quotaErr = await quotaCheck(c, db, cfg, user, session.slug, mergedBytes);
    if (quotaErr) return quotaErr;

    for (const e of batch) {
      await storage.put(session.storagePrefix + e.rel, e.file.stream(), guessContentType(e.rel));
    }
    await db
      .update(deploySessions)
      .set({ manifest: merged, updatedAt: nowIso() })
      .where(eq(deploySessions.id, session.id));
    return c.json({ file_count: merged.length, total_bytes: mergedBytes });
  });

  // ---- 分批部署 commit:据累计清单生成 index 兜底 → 原子发布 + 版本 GC → 删草稿 ----
  r.post('/:slug/deploys/:deployId/commit', mw.mutatingUser, async (c) => {
    const user = c.get('user');
    const session = await ownedSession(db, user.id, c.req.param('slug'), c.req.param('deployId'));
    if (!session) return jsonError(c, 404, 'site.deploy.session.notFound');
    if (session.manifest.length === 0) return jsonError(c, 422, 'site.deploy.noFiles');

    const body = await readJson<{ title?: unknown }>(c);
    const title = body && typeof body.title === 'string' ? body.title : session.title;
    const totalBytes = session.manifest.reduce((a, e) => a + e.size, 0);
    if (session.manifest.length > cfg.maxFiles) {
      return jsonError(c, 413, 'site.fileCount.exceeded', { max: cfg.maxFiles });
    }
    if (totalBytes > cfg.maxSiteMb * 1024 * 1024) {
      return jsonError(c, 413, 'site.size.exceeded', { mb: cfg.maxSiteMb });
    }
    const quotaErr = await quotaCheck(c, db, cfg, user, session.slug, totalBytes);
    if (quotaErr) return quotaErr;

    await generateIndexFallback(
      storage,
      session.storagePrefix,
      session.manifest,
      title || session.slug,
      localeOf(c),
    );
    const pruned = await publishVersion(db, storage, cfg, {
      siteId: session.siteId,
      vid: session.id,
      storagePrefix: session.storagePrefix,
      fileCount: session.manifest.length,
      totalBytes,
      manifestRels: session.manifest.map((e) => e.rel),
      uploadedBy: user.id,
      title,
    });
    await db.delete(deploySessions).where(eq(deploySessions.id, session.id));
    console.log(
      `deploy(chunked) handle=${user.handle} slug=${session.slug} vid=${session.id} ` +
        `files=${session.manifest.length} bytes=${totalBytes} user=${user.id} via=${c.get('authVia')} ` +
        `ip=${clientIp(c)} ua=${JSON.stringify(c.req.header('user-agent') ?? '-')}`,
    );
    const updated = await ownedSite(db, user.id, session.slug);
    if (!updated) return jsonError(c, 404, 'site.notFound');
    return c.json({
      ...siteOut(deps, updated, await unresolvedCount(db, updated.id)),
      pruned_versions: pruned,
    });
  });

  // ---- 分批部署 abort:丢弃草稿并回收已上传的存储 ----
  r.delete('/:slug/deploys/:deployId', mw.mutatingUser, async (c) => {
    const user = c.get('user');
    const session = await ownedSession(db, user.id, c.req.param('slug'), c.req.param('deployId'));
    if (!session) return jsonError(c, 404, 'site.deploy.session.notFound');
    if (storage.deletePrefix) {
      try {
        await storage.deletePrefix(session.storagePrefix);
      } catch (e) {
        console.warn(`草稿回收失败 ${session.storagePrefix}:`, e);
      }
    }
    await db.delete(deploySessions).where(eq(deploySessions.id, session.id));
    return c.json({ ok: true });
  });

  // ---- 可见性 / 标题 / SPA / 评论开关 ----
  r.patch('/:slug', mw.mutatingUser, async (c) => {
    const user = c.get('user');
    const slug = c.req.param('slug');
    const body = await readJson<SitePatchBody>(c);
    if (body === null) return jsonError(c, 422, 'request.body.malformed');

    const site = await ownedSite(db, user.id, slug);
    if (!site) return jsonError(c, 404, 'site.notFound');

    const set: Partial<typeof sites.$inferInsert> = {};
    if (body.visibility != null) {
      if (body.visibility !== 'private' && body.visibility !== 'public') {
        return jsonError(c, 422, 'site.visibility.invalid');
      }
      if (body.visibility === 'public') {
        // 对齐 pydantic int|None:非整数(含 bool/字符串/小数)一律 422,而非 NaN 落库或 500
        const raw = body.public_hours;
        if (raw != null && (typeof raw !== 'number' || !Number.isInteger(raw))) {
          return jsonError(c, 422, 'site.publicHours.notInteger');
        }
        const hours0 = raw || 24;
        if (hours0 < 1) return jsonError(c, 422, 'site.publicHours.tooSmall');
        const hours = Math.min(hours0, cfg.publicMaxHours); // 硬上限(默认 7 天)
        set.publicExpiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();
      } else {
        set.publicExpiresAt = null;
      }
      set.visibility = body.visibility;
    }
    if (body.title != null) {
      if (typeof body.title !== 'string') return jsonError(c, 422, 'site.title.notString');
      set.title = body.title;
    }
    if (body.spa_fallback != null) {
      const b = parseLaxBool(body.spa_fallback);
      if (b === null) return jsonError(c, 422, 'site.spaFallback.notBool');
      set.spaFallback = b;
    }
    if (body.comments_enabled != null) {
      const b = parseLaxBool(body.comments_enabled);
      if (b === null) return jsonError(c, 422, 'site.commentsEnabled.notBool');
      set.commentsEnabled = b;
    }
    if (body.guest_comments != null) {
      const b = parseLaxBool(body.guest_comments);
      if (b === null) return jsonError(c, 422, 'site.guestComments.notBool');
      set.guestComments = b;
    }
    set.updatedAt = nowIso();
    await db.update(sites).set(set).where(eq(sites.id, site.id));

    const updated = await ownedSite(db, user.id, slug);
    if (!updated) return jsonError(c, 404, 'site.notFound');
    return c.json(siteOut(deps, updated, await unresolvedCount(db, updated.id)));
  });

  // ---- 签名分享链接:无账号者凭链接可看(guest_comments 开着还可评论) ----
  // 无状态 HS256 key,绑定 (site_id, share_key_version);默认 72h,上限 cfg.shareMaxHours。
  r.post('/:slug/share-link', mw.mutatingUser, async (c) => {
    const user = c.get('user');
    const body = (await readJson<{ hours?: unknown }>(c)) ?? {};
    const raw = body.hours;
    if (raw != null && (typeof raw !== 'number' || !Number.isInteger(raw))) {
      return jsonError(c, 422, 'site.shareHours.notInteger');
    }
    // ?? 而非 ||:hours=0 应 422 tooSmall,不能静默落到默认值
    const hours0 = (raw as number | null | undefined) ?? 72;
    if (hours0 < 1) return jsonError(c, 422, 'site.shareHours.tooSmall');
    const hours = Math.min(hours0, cfg.shareMaxHours);
    const site = await ownedSite(db, user.id, c.req.param('slug'));
    if (!site) return jsonError(c, 404, 'site.notFound');
    const { token, expiresAt } = await mintShareKey(cfg, site.id, site.shareKeyVersion, hours);
    return c.json({
      url: `${siteUrl(cfg, site.ownerHandle, site.slug)}?key=${token}`,
      expires_at: expiresAt,
      hours,
      guest_comments: site.guestComments,
    });
  });

  // ---- 撤销全部分享链接(share_key_version 自增,旧 key 与旧访客会话同时失效) ----
  r.delete('/:slug/share-link', mw.mutatingUser, async (c) => {
    const user = c.get('user');
    const site = await ownedSite(db, user.id, c.req.param('slug'));
    if (!site) return jsonError(c, 404, 'site.notFound');
    await db
      .update(sites)
      .set({ shareKeyVersion: site.shareKeyVersion + 1, updatedAt: nowIso() })
      .where(eq(sites.id, site.id));
    return c.json({ ok: true });
  });

  // ---- 软删(同名 slug 可复用) ----
  r.delete('/:slug', mw.mutatingUser, async (c) => {
    const user = c.get('user');
    const site = await ownedSite(db, user.id, c.req.param('slug'));
    if (!site) return jsonError(c, 404, 'site.notFound');
    const now = nowIso();
    // 软删:同时把 slug 改成墓碑名,让出活命名空间 → 普通唯一索引下同名 slug 可复用(跨方言通用)。
    await db
      .update(sites)
      .set({ deletedAt: now, updatedAt: now, slug: tombstoneSlug(site.slug, site.id) })
      .where(eq(sites.id, site.id));
    // 软删后回收存储(尽力而为;同名 slug 复用是新建,不与已删行的 storage 冲突)。
    // 版本前缀是真相源,逐个回收 —— 从试用站 claim 来的站点,对象仍留在原 sites/trial/ 前缀下,
    // 只按 (ownerId, slug) 推算会漏删;canonical 前缀再兜一次底(pruned 版本残留等)。
    if (storage.deletePrefix) {
      for (const v of site.versions) {
        try {
          await storage.deletePrefix(v.storage_prefix);
        } catch (e) {
          console.warn(`存储回收失败 ${v.storage_prefix}:`, e);
        }
      }
    }
    await purgeSiteStorage(storage, site.ownerId, site.slug);
    return c.json({ ok: true });
  });

  // ---- 评论导出(AI 闭环入口,PAT 可访问):改页面前先拉未解决意见 ----
  r.get('/:slug/comments', mw.currentUser, async (c) => {
    const user = c.get('user');
    const site = await ownedSite(db, user.id, c.req.param('slug'));
    if (!site) return jsonError(c, 404, 'site.notFound');
    const all = boolQuery(c.req.query('all'));

    const conds = [eq(commentThreads.siteId, site.id), isNull(commentThreads.deletedAt)];
    if (!all) conds.push(eq(commentThreads.resolved, false));
    const threads = await db
      .select()
      .from(commentThreads)
      .where(and(...conds))
      .orderBy(asc(commentThreads.createdAt));

    const base = siteUrl(cfg, site.ownerHandle, site.slug);
    return c.json({
      slug: site.slug,
      current_version_id: site.currentVersionId,
      threads: threads.map((t) => ({
        id: t.id,
        page_path: t.pagePath,
        url: base + (t.pagePath === 'index.html' ? '' : t.pagePath) + `#pp-comment-${t.id}`,
        selector: t.selector,
        rx: t.rx,
        ry: t.ry,
        rw: t.rw,
        rh: t.rh,
        kind: t.kind,
        anchor_text: t.anchorText,
        resolved: t.resolved,
        stale: t.versionId !== site.currentVersionId,
        comments: t.comments.map((cm) => ({
          author: cm.author_name,
          text: cm.text,
          created_at: cm.created_at,
        })),
        created_at: t.createdAt,
      })),
    });
  });

  /** 定位本人站点下的某条评论(跨站 / 已删 / 不属于该站 → null,调用方回 404)。 */
  async function ownedThread(userId: string, slug: string, threadId: string) {
    const site = await ownedSite(db, userId, slug);
    if (!site) return { site: null, thread: null };
    const thread =
      (await db.select().from(commentThreads).where(eq(commentThreads.id, threadId)))[0] ?? null;
    if (!thread || thread.deletedAt !== null || thread.siteId !== site.id) {
      return { site, thread: null };
    }
    return { site, thread };
  }

  // ---- 标记已解决 / 重开(PAT 可调,AI 处理完意见后闭环) ----
  r.patch('/:slug/comments/:tid', mw.mutatingUser, async (c) => {
    const user = c.get('user');
    const body = await readJson<{ resolved?: unknown }>(c);
    if (body === null || typeof body.resolved !== 'boolean') {
      return jsonError(c, 422, 'comment.resolved.notBool');
    }
    const { site, thread } = await ownedThread(user.id, c.req.param('slug'), c.req.param('tid'));
    if (!site) return jsonError(c, 404, 'site.notFound');
    if (!thread) return jsonError(c, 404, 'comment.notFound');
    await db
      .update(commentThreads)
      .set({ resolved: body.resolved, updatedAt: nowIso() })
      .where(eq(commentThreads.id, thread.id));
    return c.json({ id: thread.id, resolved: body.resolved });
  });

  // ---- 给评论留言(PAT 可调,AI 说明「已按 X 修改」) ----
  r.post('/:slug/comments/:tid/replies', mw.mutatingUser, async (c) => {
    const user = c.get('user');
    const body = await readJson<{ text?: unknown }>(c);
    if (body === null) return jsonError(c, 422, 'request.body.malformed');
    const { site, thread } = await ownedThread(user.id, c.req.param('slug'), c.req.param('tid'));
    if (!site) return jsonError(c, 404, 'site.notFound');
    if (!thread) return jsonError(c, 404, 'comment.notFound');

    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) return jsonError(c, 422, 'site.reply.empty');
    if (text.length > 4000) return jsonError(c, 422, 'site.reply.tooLong', { max: 4000 });

    const reply: ThreadComment = {
      id: uuid(),
      author_sub: user.id,
      author_name: replyAuthorName(user, localeOf(c)),
      text,
      created_at: nowIso(),
    };
    // 乐观并发(D1 无交互事务):重读 → 追加 → 条件 UPDATE 守 updated_at 未变 → RETURNING 检测命中,
    // 未命中说明有并发回复抢先,重读重试,原子追加防覆盖。
    for (let attempt = 0; attempt < 5; attempt++) {
      const fresh = (
        await db.select().from(commentThreads).where(eq(commentThreads.id, thread.id))
      )[0];
      if (!fresh) break;
      const wrote = await writtenCount(
        db
          .update(commentThreads)
          .set({ comments: [...fresh.comments, reply], updatedAt: nowIso() })
          .where(
            and(eq(commentThreads.id, thread.id), eq(commentThreads.updatedAt, fresh.updatedAt)),
          ),
      );
      if (wrote) break;
    }
    return c.json({
      id: reply.id,
      author: reply.author_name,
      text: reply.text,
      created_at: reply.created_at,
    });
  });

  // ---- 版本列表(created_at 倒序) ----
  r.get('/:slug/versions', mw.currentUser, async (c) => {
    const user = c.get('user');
    const site = await ownedSite(db, user.id, c.req.param('slug'));
    if (!site) return jsonError(c, 404, 'site.notFound');
    const versions = [...site.versions].sort((a, b) => b.created_at.localeCompare(a.created_at));
    return c.json({
      current: site.currentVersionId,
      versions: versions.map((v) => ({
        id: v.id,
        file_count: v.file_count,
        total_bytes: v.total_bytes,
        created_at: v.created_at,
      })),
    });
  });

  // ---- 回滚(current_version_id 指回旧 version) ----
  r.post('/:slug/rollback', mw.mutatingUser, async (c) => {
    const user = c.get('user');
    const body = await readJson<{ version_id?: unknown }>(c);
    if (body === null || typeof body.version_id !== 'string') {
      return jsonError(c, 422, 'site.version.missingId');
    }
    const versionId = body.version_id;
    const site = await ownedSite(db, user.id, c.req.param('slug'));
    if (!site) return jsonError(c, 404, 'site.notFound');
    if (!site.versions.some((v) => v.id === versionId)) {
      return jsonError(c, 404, 'site.version.notFound');
    }
    await db
      .update(sites)
      .set({ currentVersionId: versionId, updatedAt: nowIso() })
      .where(eq(sites.id, site.id));
    const updated = await ownedSite(db, user.id, c.req.param('slug'));
    if (!updated) return jsonError(c, 404, 'site.notFound');
    return c.json(siteOut(deps, updated, await unresolvedCount(db, updated.id)));
  });

  return r;
}

function replyAuthorName(user: UserRow, locale: Locale): string {
  return user.displayName || user.handle || t(locale, 'comment.anonymousAuthor');
}
