/** 页面评论 API —— 挂在数据平面,供注入的 comments.js 同源调用。
 *
 * 边界:
 *   - 只动 comment_threads 表,绝不触碰 sites/users/tokens 的写路径;
 *   - 全部端点要求 viewer 会话(匿名公开访客拿不到注入脚本,直连 API 也是 401);
 *   - 双域模式用 pp_view(无 CSRF claim:SameSite=Lax 下跨站 POST 不带 Cookie);
 *     单域模式 viewer 复用控制台 pp_session 会话。
 */

import { and, asc, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import type { Plane, SessionClaims } from './auth/sessions.js';
import { readSession } from './auth/sessions.js';
import { commentThreads, sites } from './db/index.js';
import type { CommentThreadRow, SiteRow, ThreadComment, UserRow } from './db/index.js';
import { users } from './db/index.js';
import { errorBody, t, type Locale, type TParams } from './i18n/index.js';
import { localeOf } from './i18n/locale.js';
import type { AppDeps, AppEnv } from './types.js';
import { normalizeSitePath, nowIso, shortId } from './util.js';

const MAX_TEXT = 4000;
const MAX_SELECTOR = 600;
/** 意图标签(null = 普通评论);"@page" 整页锚点由前端约定,后端不特判 */
const KINDS = new Set(['copy', 'style', 'question', 'bug']);
const KINDS_HINT = [...KINDS].sort().join('/'); // bug/copy/question/style,同 Python sorted()

/** 错误携带「文案 key + 占位参数」而非成品字面量;翻译延后到 wrap() 出口按请求 locale 进行。 */
class ApiError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public key: string,
    public params?: TParams,
  ) {
    super(key);
  }
}

/** 错误响应统一 { detail, code },detail 随请求 locale,code = 稳定 key(对齐 FastAPI HTTPException 形状并扩展 code)。 */
const wrap =
  (fn: (c: Context<AppEnv>) => Promise<Response>) =>
  async (c: Context<AppEnv>): Promise<Response> => {
    try {
      return await fn(c);
    } catch (e) {
      if (e instanceof ApiError) return c.json(errorBody(localeOf(c), e.key, e.params), e.status);
      throw e;
    }
  };

/** Python len() 数码点;JS .length 数 UTF-16 单元,用展开对齐 */
const cpLen = (s: string) => [...s].length;

const authorName = (u: UserRow, locale: Locale) =>
  u.displayName || u.handle || t(locale, 'comment.anonymousAuthor');

function commentOut(cm: ThreadComment) {
  return {
    id: cm.id,
    author_sub: cm.author_sub,
    author_name: cm.author_name,
    text: cm.text,
    created_at: cm.created_at,
  };
}

function threadOut(t: CommentThreadRow) {
  return {
    id: t.id,
    page_path: t.pagePath,
    version_id: t.versionId,
    selector: t.selector,
    rx: t.rx,
    ry: t.ry,
    rw: t.rw,
    rh: t.rh,
    kind: t.kind,
    anchor_text: t.anchorText,
    resolved: t.resolved,
    comments: t.comments.map(commentOut),
    created_at: t.createdAt,
  };
}

function cleanText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) throw new ApiError(422, 'comment.text.empty');
  if (cpLen(trimmed) > MAX_TEXT) throw new ApiError(422, 'comment.text.tooLong', { max: MAX_TEXT });
  return trimmed;
}

async function readJson(c: Context<AppEnv>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ApiError(422, 'request.body.invalidJson');
  }
}

interface ThreadCreateIn {
  path: string;
  selector: string;
  rx: number;
  ry: number;
  rw: number | null; // 框选区域相对宽高;null = 点评论
  rh: number | null;
  kind: string | null;
  anchor_text: string | null;
  text: string;
}

/** 对齐 Python ThreadCreateIn 的 pydantic 校验(请求体形状错误一律 422)。 */
function parseThreadCreate(raw: unknown): ThreadCreateIn {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ApiError(422, 'request.body.malformed');
  }
  const b = raw as Record<string, unknown>;
  if (typeof b.path !== 'string') throw new ApiError(422, 'comment.path.notString');
  if (typeof b.selector !== 'string' || cpLen(b.selector) < 1 || cpLen(b.selector) > MAX_SELECTOR) {
    throw new ApiError(422, 'comment.selector.length', { max: MAX_SELECTOR });
  }
  for (const k of ['rx', 'ry'] as const) {
    const v = b[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
      throw new ApiError(422, 'comment.coord.range', { field: k });
    }
  }
  // 框选区域:rw/rh 成对出现,(0,1] 区间
  const hasRw = b.rw !== undefined && b.rw !== null;
  const hasRh = b.rh !== undefined && b.rh !== null;
  if (hasRw !== hasRh) throw new ApiError(422, 'comment.rect.pairRequired');
  if (hasRw) {
    for (const k of ['rw', 'rh'] as const) {
      const v = b[k];
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 1) {
        throw new ApiError(422, 'comment.coord.range', { field: k });
      }
    }
  }
  const kind = b.kind === undefined || b.kind === null ? null : b.kind;
  if (kind !== null && typeof kind !== 'string') throw new ApiError(422, 'comment.kind.notString');
  const anchor = b.anchor_text === undefined || b.anchor_text === null ? null : b.anchor_text;
  if (anchor !== null && typeof anchor !== 'string') {
    throw new ApiError(422, 'comment.anchorText.notString');
  }
  if (anchor !== null && cpLen(anchor) > 200)
    throw new ApiError(422, 'comment.anchorText.tooLong', { max: 200 });
  if (typeof b.text !== 'string') throw new ApiError(422, 'comment.text.notString');
  return {
    path: b.path,
    selector: b.selector,
    rx: b.rx as number,
    ry: b.ry as number,
    rw: hasRw ? (b.rw as number) : null,
    rh: hasRw ? (b.rh as number) : null,
    kind,
    anchor_text: anchor,
    text: b.text,
  };
}

export function makeCommentRoutes(deps: AppDeps): Hono<AppEnv> {
  const { config: cfg, db } = deps;
  // viewer 会话:双域走内容域 pp_view;单域 viewer 复用控制台 pp_session
  const plane: Plane = cfg.mode === 'dual' ? 'view' : 'session';
  const app = new Hono<AppEnv>();

  // 查库判活:被禁用用户即时失效(数据面不经控制台中间件,disabled 须在此自行兜住)
  async function activeViewer(
    c: Context<AppEnv>,
  ): Promise<{ claims: SessionClaims; user: UserRow }> {
    const claims = await readSession(c, cfg, plane);
    if (claims === null) throw new ApiError(401, 'auth.unauthenticated');
    const user = (await db.select().from(users).where(eq(users.id, claims.sub)))[0];
    if (!user) throw new ApiError(401, 'auth.userNotFound');
    if (user.disabled) throw new ApiError(403, 'auth.account.disabled');
    return { claims, user };
  }

  async function viewer(c: Context<AppEnv>): Promise<SessionClaims> {
    return (await activeViewer(c)).claims;
  }

  async function viewerUser(c: Context<AppEnv>): Promise<UserRow> {
    return (await activeViewer(c)).user;
  }

  async function commentableSite(handle: string, slug: string): Promise<SiteRow> {
    const site = (
      await db
        .select()
        .from(sites)
        .where(and(eq(sites.ownerHandle, handle), eq(sites.slug, slug), isNull(sites.deletedAt)))
    )[0];
    if (!site) throw new ApiError(404, 'site.notFound');
    if (!site.commentsEnabled) throw new ApiError(403, 'comment.site.disabled');
    return site;
  }

  async function getThread(threadId: string): Promise<CommentThreadRow> {
    const thread = (
      await db.select().from(commentThreads).where(eq(commentThreads.id, threadId))
    )[0];
    if (!thread || thread.deletedAt !== null) throw new ApiError(404, 'comment.notFound');
    return thread;
  }

  /** 当前访问者身份(注入脚本启动时调用;401 = 匿名,脚本静默退出)。 */
  app.get(
    '/api/viewer',
    wrap(async (c) => {
      const user = await viewerUser(c);
      return c.json({
        sub: user.id,
        name: authorName(user, localeOf(c)),
        handle: user.handle,
      });
    }),
  );

  app.get(
    '/api/comments/:handle/:slug',
    wrap(async (c) => {
      // path 是必填查询参数:缺失时先于鉴权 422(对齐 FastAPI 参数校验时序)
      const rawPath = c.req.query('path');
      if (rawPath === undefined) throw new ApiError(422, 'comment.path.missing');
      await viewer(c);
      const handle = c.req.param('handle') ?? '';
      const slug = c.req.param('slug') ?? '';
      await commentableSite(handle, slug);
      const rel = normalizeSitePath(rawPath);
      if (rel === null) throw new ApiError(422, 'site.path.invalid');
      const threads = await db
        .select()
        .from(commentThreads)
        .where(
          and(
            eq(commentThreads.ownerHandle, handle),
            eq(commentThreads.slug, slug),
            eq(commentThreads.pagePath, rel),
            isNull(commentThreads.deletedAt),
          ),
        )
        .orderBy(asc(commentThreads.createdAt));
      return c.json({ threads: threads.map(threadOut) });
    }),
  );

  app.post(
    '/api/comments/:handle/:slug',
    wrap(async (c) => {
      // 对齐 FastAPI:请求体校验先于鉴权(pydantic 在 handler 前跑)
      const body = parseThreadCreate(await readJson(c));
      const user = await viewerUser(c);
      const handle = c.req.param('handle') ?? '';
      const slug = c.req.param('slug') ?? '';
      const site = await commentableSite(handle, slug);
      const rel = normalizeSitePath(body.path);
      if (rel === null) throw new ApiError(422, 'site.path.invalid');
      if (body.kind !== null && !KINDS.has(body.kind)) {
        throw new ApiError(422, 'comment.kind.invalid', { kinds: KINDS_HINT });
      }
      const now = nowIso();
      const first: ThreadComment = {
        id: shortId(),
        author_sub: user.id,
        author_name: authorName(user, localeOf(c)),
        text: cleanText(body.text),
        created_at: now,
      };
      const row: CommentThreadRow = {
        id: shortId(),
        siteId: site.id,
        ownerHandle: handle,
        slug,
        pagePath: rel,
        versionId: site.currentVersionId ?? '',
        selector: body.selector,
        rx: body.rx,
        ry: body.ry,
        rw: body.rw,
        rh: body.rh,
        kind: body.kind,
        anchorText: body.anchor_text ? body.anchor_text.trim() : null,
        resolved: false,
        comments: [first],
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      await db.insert(commentThreads).values(row);
      return c.json(threadOut(row));
    }),
  );

  app.post(
    '/api/comments/threads/:tid/replies',
    wrap(async (c) => {
      const raw = await readJson(c);
      if (
        typeof raw !== 'object' ||
        raw === null ||
        typeof (raw as Record<string, unknown>).text !== 'string'
      ) {
        throw new ApiError(422, 'comment.text.notString');
      }
      const user = await viewerUser(c);
      const thread = await getThread(c.req.param('tid') ?? '');
      const reply: ThreadComment = {
        id: shortId(),
        author_sub: user.id,
        author_name: authorName(user, localeOf(c)),
        text: cleanText((raw as { text: string }).text),
        created_at: nowIso(),
      };
      await db
        .update(commentThreads)
        .set({ comments: [...thread.comments, reply], updatedAt: nowIso() })
        .where(eq(commentThreads.id, thread.id));
      return c.json(commentOut(reply));
    }),
  );

  app.patch(
    '/api/comments/threads/:tid',
    wrap(async (c) => {
      const raw = await readJson(c);
      if (typeof raw !== 'object' || raw === null)
        throw new ApiError(422, 'request.body.malformed');
      const body = raw as Record<string, unknown>;
      const hasResolved = 'resolved' in body;
      const hasKind = 'kind' in body;
      if (!hasResolved && !hasKind) throw new ApiError(422, 'comment.patch.empty');
      const set: { resolved?: boolean; kind?: string | null; updatedAt: string } = {
        updatedAt: nowIso(),
      };
      if (hasResolved) {
        if (typeof body.resolved !== 'boolean') throw new ApiError(422, 'comment.resolved.notBool');
        set.resolved = body.resolved;
      }
      if (hasKind) {
        const k = body.kind;
        if (k !== null && (typeof k !== 'string' || !KINDS.has(k))) {
          throw new ApiError(422, 'comment.kind.invalidOrNull', { kinds: KINDS_HINT });
        }
        set.kind = k as string | null;
      }
      // 解决/重开/改 kind 放开给所有登录成员(协作场景,留痕在回复里)
      await viewer(c);
      const thread = await getThread(c.req.param('tid') ?? '');
      await db.update(commentThreads).set(set).where(eq(commentThreads.id, thread.id));
      const updated: CommentThreadRow = {
        ...thread,
        resolved: hasResolved ? set.resolved! : thread.resolved,
        kind: hasKind ? (set.kind ?? null) : thread.kind,
        updatedAt: set.updatedAt,
      };
      return c.json(threadOut(updated));
    }),
  );

  app.delete(
    '/api/comments/threads/:tid',
    wrap(async (c) => {
      const user = await viewerUser(c);
      const thread = await getThread(c.req.param('tid') ?? '');
      const site = (await db.select().from(sites).where(eq(sites.id, thread.siteId)))[0];
      const isAuthor = thread.comments[0]?.author_sub === user.id;
      const isSiteOwner = site !== undefined && site.ownerId === user.id;
      if (!isAuthor && !isSiteOwner) {
        throw new ApiError(403, 'comment.delete.forbidden');
      }
      const now = nowIso();
      await db
        .update(commentThreads)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(commentThreads.id, thread.id));
      return c.json({ ok: true });
    }),
  );

  return app;
}
