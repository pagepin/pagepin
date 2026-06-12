/** 站点管理 API(控制平面)—— 上传发布 / 列表 / 可见性 / 删除 / 回滚。
 *
 * 发布流程(原子,无半成品暴露):
 *   1. 文件全量流式写到新 version 的存储前缀(限额边写边校验)
 *   2. 事务内重读站点行 → versions push + current_version_id 切换,一条 update 写回
 * 失败则 current 不动,旧版本继续服务。
 */

import { and, asc, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';

import { galleryIndexHtml, redirectIndexHtml } from '../autoindex.js';
import type { IndexEntry } from '../autoindex.js';
import { siteUrl } from '../config.js';
import {
  commentThreads,
  currentVersion,
  sites,
  type Db,
  type SiteRow,
  type SiteVersion,
  type ThreadComment,
  type UserRow,
} from '../db/index.js';
import { guessContentType } from '../storage/mime.js';
import type { AppDeps, AppEnv } from '../types.js';
import { normalizeSitePath, nowIso, uuid, validSlug } from '../util.js';
import type { AuthMiddleware } from './deps.js';

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
    unresolved_comments: unresolved,
    file_count: cur ? cur.file_count : 0,
    total_bytes: cur ? cur.total_bytes : 0,
    version_count: site.versions.length,
    created_at: site.createdAt,
    updated_at: site.updatedAt,
  };
}

function unresolvedCount(db: Db, siteId: string): number {
  const row = db
    .select({ n: count() })
    .from(commentThreads)
    .where(
      and(
        eq(commentThreads.siteId, siteId),
        eq(commentThreads.resolved, false),
        isNull(commentThreads.deletedAt),
      ),
    )
    .get();
  return row?.n ?? 0;
}

/** 本人名下未删站点;不存在返回 null(调用方回 404 '站点不存在')。 */
function ownedSite(db: Db, userId: string, slug: string): SiteRow | null {
  return (
    db
      .select()
      .from(sites)
      .where(and(eq(sites.ownerId, userId), eq(sites.slug, slug), isNull(sites.deletedAt)))
      .get() ?? null
  );
}

async function readJson<T>(c: Context<AppEnv>): Promise<T | null> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return null;
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
}

export function makeSiteRoutes(deps: AppDeps, mw: AuthMiddleware): Hono<AppEnv> {
  const { db, config: cfg, storage } = deps;
  const r = new Hono<AppEnv>().basePath('/api/sites');

  // ---- 列表(未解决评论数:一条 group by,避免 N 站点 N 次 count) ----
  r.get('/', mw.currentUser, (c) => {
    const user = c.get('user');
    const rows = db
      .select()
      .from(sites)
      .where(and(eq(sites.ownerId, user.id), isNull(sites.deletedAt)))
      .orderBy(desc(sites.updatedAt))
      .all();
    const counts = new Map<string, number>();
    if (rows.length > 0) {
      const grouped = db
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
        .groupBy(commentThreads.siteId)
        .all();
      for (const g of grouped) counts.set(g.siteId, g.n);
    }
    return c.json({ sites: rows.map((x) => siteOut(deps, x, counts.get(x.id) ?? 0)) });
  });

  // ---- 部署(multipart;校验顺序/状态码即对外契约) ----
  r.post('/:slug/deploy', mw.mutatingUser, async (c) => {
    const user = c.get('user');
    const slug = c.req.param('slug');

    let fd: FormData;
    try {
      fd = await c.req.formData();
    } catch {
      return c.json({ detail: '请求体格式错误(需 multipart 表单)' }, 422);
    }
    const fileEntries = fd.getAll('files');
    const pathEntries = fd.getAll('paths');
    // paths 里混入文件 part 必须 422;String() 化会把它吞成 "[object File]"
    if (pathEntries.some((p) => typeof p !== 'string')) {
      return c.json({ detail: 'paths 字段必须是字符串' }, 422);
    }
    const paths = pathEntries as string[];
    const titleEntry = fd.get('title');
    const title = typeof titleEntry === 'string' ? titleEntry : null;

    if (user.handle == null) return c.json({ detail: '请先设置 handle' }, 409);
    const handle = user.handle;
    if (!validSlug(slug)) {
      return c.json({ detail: '站点名需小写字母/数字/中划线，≤64 位' }, 422);
    }
    if (fileEntries.length !== paths.length) {
      return c.json({ detail: 'files 与 paths 数量不一致' }, 422);
    }
    if (fileEntries.length === 0) return c.json({ detail: '没有文件' }, 422);
    if (fileEntries.length > cfg.maxFiles) {
      return c.json({ detail: `文件数超限（≤${cfg.maxFiles}）` }, 413);
    }
    // files 字段混入非文件 part 直接 422
    if (fileEntries.some((f) => !(f instanceof File))) {
      return c.json({ detail: 'files 字段必须是文件' }, 422);
    }
    const files = fileEntries as File[];

    let site = ownedSite(db, user.id, slug);
    if (!site) {
      const created = nowIso();
      site = {
        id: uuid(),
        ownerId: user.id,
        ownerHandle: handle,
        slug,
        title,
        visibility: 'private',
        publicExpiresAt: null,
        spaFallback: false,
        commentsEnabled: true,
        currentVersionId: null,
        versions: [],
        createdAt: created,
        updatedAt: created,
        deletedAt: null,
      };
      db.insert(sites).values(site).run();
    }
    const siteId = site.id;

    const vid = uuid();
    const storagePrefix = `sites/${site.ownerId}/${slug}/${vid}/`;
    const perFileLimit = cfg.maxFileMb * 1024 * 1024;
    const siteLimit = cfg.maxSiteMb * 1024 * 1024;
    let total = 0;
    const seen = new Set<string>();
    const uploaded: IndexEntry[] = []; // 自动索引页用(rel + size)

    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      const rawPath = paths[i]!;
      const rel = normalizeSitePath(rawPath);
      if (rel === null) return c.json({ detail: `非法路径：${rawPath}` }, 422);
      if (seen.has(rel)) return c.json({ detail: `路径重复：${rel}` }, 422);
      seen.add(rel);
      uploaded.push({ rel, size: f.size });
      const contentType = guessContentType(rel);
      // File.size 预判(超限即 413,且完全不写存储)
      if (f.size > perFileLimit) {
        return c.json({ detail: `单文件超限（≤${cfg.maxFileMb}MB）：${rel}` }, 413);
      }
      await storage.put(storagePrefix + rel, f.stream(), contentType);
      total += f.size;
      if (total > siteLimit) {
        return c.json({ detail: `站点总大小超限（≤${cfg.maxSiteMb}MB）` }, 413);
      }
    }

    // 没有 index.html 时的根 URL 兜底(三层,任一命中即止;生成物不计入 file_count/total_bytes):
    //   1. 根目录唯一 .html/.htm → 别名 copy(「拖一个 html 就能用」)
    //   2. 全站只有一个文件(图片/md/任意)→ 生成秒跳页,落到查看器壳
    //   3. 多文件无 html(图片文件夹等)→ 生成画廊/文件索引页(评论层照常注入)
    if (!seen.has('index.html')) {
      const rootHtmls = [...seen].filter(
        (p) =>
          !p.includes('/') && (p.toLowerCase().endsWith('.html') || p.toLowerCase().endsWith('.htm')),
      );
      if (rootHtmls.length === 1) {
        await storage.copy(storagePrefix + rootHtmls[0]!, storagePrefix + 'index.html');
      } else {
        const html =
          uploaded.length === 1
            ? redirectIndexHtml(uploaded[0]!.rel)
            : galleryIndexHtml(title || slug, uploaded);
        await storage.put(
          storagePrefix + 'index.html',
          new TextEncoder().encode(html),
          'text/html; charset=utf-8',
        );
      }
    }

    const version: SiteVersion = {
      id: vid,
      storage_prefix: storagePrefix,
      file_count: files.length,
      total_bytes: total,
      uploaded_by: user.id,
      created_at: nowIso(),
    };
    // 事务内重读再写回:整列替换 versions JSON,避免覆盖并发 deploy 推入的版本
    db.transaction((tx) => {
      const fresh = tx.select().from(sites).where(eq(sites.id, siteId)).get();
      if (!fresh) return;
      const set: {
        versions: SiteVersion[];
        currentVersionId: string;
        updatedAt: string;
        title?: string;
      } = { versions: [...fresh.versions, version], currentVersionId: vid, updatedAt: nowIso() };
      if (title) set.title = title;
      tx.update(sites).set(set).where(eq(sites.id, siteId)).run();
    });
    console.log(
      `deploy handle=${handle} slug=${slug} vid=${vid} files=${files.length} bytes=${total}`,
    );
    const updated = ownedSite(db, user.id, slug);
    if (!updated) return c.json({ detail: '站点不存在' }, 404);
    return c.json(siteOut(deps, updated, unresolvedCount(db, updated.id)));
  });

  // ---- 可见性 / 标题 / SPA / 评论开关 ----
  r.patch('/:slug', mw.mutatingUser, async (c) => {
    const user = c.get('user');
    const slug = c.req.param('slug');
    const body = await readJson<SitePatchBody>(c);
    if (body === null) return c.json({ detail: '请求体格式错误' }, 422);

    const site = ownedSite(db, user.id, slug);
    if (!site) return c.json({ detail: '站点不存在' }, 404);

    const set: Partial<typeof sites.$inferInsert> = {};
    if (body.visibility != null) {
      if (body.visibility !== 'private' && body.visibility !== 'public') {
        return c.json({ detail: 'visibility 只能是 private/public' }, 422);
      }
      if (body.visibility === 'public') {
        // 对齐 pydantic int|None:非整数(含 bool/字符串/小数)一律 422,而非 NaN 落库或 500
        const raw = body.public_hours;
        if (raw != null && (typeof raw !== 'number' || !Number.isInteger(raw))) {
          return c.json({ detail: 'public_hours 必须是整数' }, 422);
        }
        const hours0 = raw || 24;
        if (hours0 < 1) return c.json({ detail: '公开时长至少 1 小时' }, 422);
        const hours = Math.min(hours0, cfg.publicMaxHours); // 硬上限(默认 7 天)
        set.publicExpiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();
      } else {
        set.publicExpiresAt = null;
      }
      set.visibility = body.visibility;
    }
    if (body.title != null) {
      if (typeof body.title !== 'string') return c.json({ detail: 'title 必须是字符串' }, 422);
      set.title = body.title;
    }
    if (body.spa_fallback != null) {
      const b = parseLaxBool(body.spa_fallback);
      if (b === null) return c.json({ detail: 'spa_fallback 必须是布尔值' }, 422);
      set.spaFallback = b;
    }
    if (body.comments_enabled != null) {
      const b = parseLaxBool(body.comments_enabled);
      if (b === null) return c.json({ detail: 'comments_enabled 必须是布尔值' }, 422);
      set.commentsEnabled = b;
    }
    set.updatedAt = nowIso();
    db.update(sites).set(set).where(eq(sites.id, site.id)).run();

    const updated = ownedSite(db, user.id, slug);
    if (!updated) return c.json({ detail: '站点不存在' }, 404);
    return c.json(siteOut(deps, updated, unresolvedCount(db, updated.id)));
  });

  // ---- 软删(同名 slug 可复用) ----
  r.delete('/:slug', mw.mutatingUser, (c) => {
    const user = c.get('user');
    const site = ownedSite(db, user.id, c.req.param('slug'));
    if (!site) return c.json({ detail: '站点不存在' }, 404);
    const now = nowIso();
    db.update(sites).set({ deletedAt: now, updatedAt: now }).where(eq(sites.id, site.id)).run();
    return c.json({ ok: true });
  });

  // ---- 评论导出(AI 闭环入口,PAT 可访问):改页面前先拉未解决意见 ----
  r.get('/:slug/comments', mw.currentUser, (c) => {
    const user = c.get('user');
    const site = ownedSite(db, user.id, c.req.param('slug'));
    if (!site) return c.json({ detail: '站点不存在' }, 404);
    const all = boolQuery(c.req.query('all'));

    const conds = [eq(commentThreads.siteId, site.id), isNull(commentThreads.deletedAt)];
    if (!all) conds.push(eq(commentThreads.resolved, false));
    const threads = db
      .select()
      .from(commentThreads)
      .where(and(...conds))
      .orderBy(asc(commentThreads.createdAt))
      .all();

    const base = siteUrl(cfg, site.ownerHandle, site.slug);
    return c.json({
      slug: site.slug,
      current_version_id: site.currentVersionId,
      threads: threads.map((t) => ({
        id: t.id,
        page_path: t.pagePath,
        url: base + (t.pagePath === 'index.html' ? '' : t.pagePath) + `#pp-comment-${t.id}`,
        selector: t.selector,
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
  function ownedThread(userId: string, slug: string, threadId: string) {
    const site = ownedSite(db, userId, slug);
    if (!site) return { site: null, thread: null };
    const thread =
      db.select().from(commentThreads).where(eq(commentThreads.id, threadId)).get() ?? null;
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
      return c.json({ detail: 'resolved 必须是布尔值' }, 422);
    }
    const { site, thread } = ownedThread(user.id, c.req.param('slug'), c.req.param('tid'));
    if (!site) return c.json({ detail: '站点不存在' }, 404);
    if (!thread) return c.json({ detail: '评论不存在' }, 404);
    db.update(commentThreads)
      .set({ resolved: body.resolved, updatedAt: nowIso() })
      .where(eq(commentThreads.id, thread.id))
      .run();
    return c.json({ id: thread.id, resolved: body.resolved });
  });

  // ---- 给评论留言(PAT 可调,AI 说明「已按 X 修改」) ----
  r.post('/:slug/comments/:tid/replies', mw.mutatingUser, async (c) => {
    const user = c.get('user');
    const body = await readJson<{ text?: unknown }>(c);
    if (body === null) return c.json({ detail: '请求体格式错误' }, 422);
    const { site, thread } = ownedThread(user.id, c.req.param('slug'), c.req.param('tid'));
    if (!site) return c.json({ detail: '站点不存在' }, 404);
    if (!thread) return c.json({ detail: '评论不存在' }, 404);

    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) return c.json({ detail: '回复内容不能为空' }, 422);
    if (text.length > 4000) return c.json({ detail: '回复过长（≤4000 字）' }, 422);

    const reply: ThreadComment = {
      id: uuid(),
      author_sub: user.id,
      author_name: replyAuthorName(user),
      text,
      created_at: nowIso(),
    };
    // 事务内重读再整列写回(原子追加,防覆盖并发写)
    db.transaction((tx) => {
      const fresh = tx.select().from(commentThreads).where(eq(commentThreads.id, thread.id)).get();
      if (!fresh) return;
      tx.update(commentThreads)
        .set({ comments: [...fresh.comments, reply], updatedAt: nowIso() })
        .where(eq(commentThreads.id, thread.id))
        .run();
    });
    return c.json({
      id: reply.id,
      author: reply.author_name,
      text: reply.text,
      created_at: reply.created_at,
    });
  });

  // ---- 版本列表(created_at 倒序) ----
  r.get('/:slug/versions', mw.currentUser, (c) => {
    const user = c.get('user');
    const site = ownedSite(db, user.id, c.req.param('slug'));
    if (!site) return c.json({ detail: '站点不存在' }, 404);
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
      return c.json({ detail: '缺少 version_id' }, 422);
    }
    const versionId = body.version_id;
    const site = ownedSite(db, user.id, c.req.param('slug'));
    if (!site) return c.json({ detail: '站点不存在' }, 404);
    if (!site.versions.some((v) => v.id === versionId)) {
      return c.json({ detail: '版本不存在' }, 404);
    }
    db.update(sites)
      .set({ currentVersionId: versionId, updatedAt: nowIso() })
      .where(eq(sites.id, site.id))
      .run();
    const updated = ownedSite(db, user.id, c.req.param('slug'));
    if (!updated) return c.json({ detail: '站点不存在' }, 404);
    return c.json(siteOut(deps, updated, unresolvedCount(db, updated.id)));
  });

  return r;
}

function replyAuthorName(user: UserRow): string {
  return user.displayName || user.handle || '成员';
}
