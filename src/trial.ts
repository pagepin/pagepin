/** 匿名试用 —— 无账号 drop 单个 HTML → 限时(默认 1h)可分享链接,到期连存储硬删。
 *
 * 设计要点:
 *   - 默认关闭(PAGEPIN_TRIAL):开着 = 公开互联网可匿名上传,只有官方服务这类
 *     配好 Turnstile + 边缘限速 + 滥用处置的实例才该开。
 *   - 试用站是普通 sites 行:ownerId='trial' 哨兵、ownerHandle='try'(保留 handle,
 *     见 util.RESERVED_HANDLES)、visibility=private、expiresAt=now+TTL。
 *     访问一律走签名分享链接(share.ts):部署响应直接返回带 ?key= 的 URL。
 *   - 三个无状态令牌复用同一 HS256 秘钥:share key(看+guest 评)、claim token
 *     (注册后认领,pln='claim')。全部到期即失效,不落库。
 *   - 防滥用:Turnstile(配置了才强制)+ per-IP 限频 + 单文件 ≤2MB 仅 .html/.md +
 *     serving 全局 noindex + 页面右下角试用缎带(serving.ts 注入)。
 *   - 清理:sweepExpiredTrialSites 由 Node setInterval / Workers cron 调用;
 *     serving 侧另有请求时到期判定,正确性不依赖清理节奏。
 */

import { and, eq, isNotNull, isNull, lt } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { sign, verify as jwtVerify } from 'hono/jwt';

import { consoleBase, siteUrl } from './config.js';
import type { Config } from './config.js';
import { verifyTurnstile } from './auth/turnstile.js';
import { commentThreads, sites } from './db/index.js';
import type { Db, SiteRow } from './db/index.js';
import { writtenCount } from './db/ops.js';
import { jsonError, localeOf } from './i18n/locale.js';
import { mintShareKey, verifyShareKey } from './share.js';
import type { Storage } from './storage/index.js';
import type { AppDeps, AppEnv } from './types.js';
import type { AuthMiddleware } from './api/deps.js';
import { nowIso, shortId, uuid, validSlug } from './util.js';

export const TRIAL_HANDLE = 'try';
export const TRIAL_OWNER = 'trial';

const MAX_TRIAL_BYTES = 2 * 1024 * 1024;

interface ClaimClaims {
  pln: 'claim';
  sid: string;
  iat: number;
  exp: number;
  [k: string]: unknown;
}

async function mintClaimToken(cfg: Config, siteId: string, exp: number): Promise<string> {
  const claims: ClaimClaims = {
    pln: 'claim',
    sid: siteId,
    iat: Math.floor(Date.now() / 1000),
    exp,
  };
  return sign(claims, cfg.secret, 'HS256');
}

async function verifyClaimToken(cfg: Config, token: string): Promise<ClaimClaims | null> {
  try {
    const claims = (await jwtVerify(token, cfg.secret, 'HS256')) as ClaimClaims;
    if (claims.pln !== 'claim' || typeof claims.sid !== 'string') return null;
    return claims;
  } catch {
    return null;
  }
}

function clientIp(c: Context<AppEnv>): string {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    '-'
  );
}

/** 官网(跨 origin 的静态落地页)直接调 POST /api/try:纯匿名接口、不带凭证,ACAO * 安全。 */
function cors(c: Context<AppEnv>): void {
  c.header('Access-Control-Allow-Origin', '*');
}

export function makeTrialRoutes(deps: AppDeps, mw: AuthMiddleware): Hono<AppEnv> {
  const { config: cfg, db, storage } = deps;
  const r = new Hono<AppEnv>().basePath('/api/try');

  r.options('/', (c) => {
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'content-type');
    return c.body(null, 204);
  });

  // ---- 匿名上传:单个 HTML → 私有试用站 + 带 ?key= 的限时链接 ----
  r.post('/', async (c) => {
    cors(c);
    if (!cfg.trialEnabled) return jsonError(c, 404, 'trial.disabled');
    const ip = clientIp(c);
    if (deps.rateLimiter && !(await deps.rateLimiter.check(`try:${ip}`, 5, 3600))) {
      return jsonError(c, 429, 'trial.rateLimited');
    }
    // Content-Length 早拒:multipart 有编码开销,给 2× 余量;不把超大 body 读进内存再判
    const clen = Number(c.req.header('content-length') ?? '0');
    if (Number.isFinite(clen) && clen > MAX_TRIAL_BYTES * 2) {
      return jsonError(c, 413, 'trial.file.tooLarge', { mb: MAX_TRIAL_BYTES / 1024 / 1024 });
    }
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return jsonError(c, 422, 'site.deploy.form.notMultipart');
    }
    if (cfg.turnstile) {
      const token = form.get('turnstile_token');
      const ok =
        typeof token === 'string' &&
        (await verifyTurnstile(cfg.turnstile.secretKey, token, ip === '-' ? undefined : ip));
      if (!ok) return jsonError(c, 400, 'auth.turnstile.failed');
    }
    const file = form.get('file');
    if (!(file instanceof File)) return jsonError(c, 422, 'trial.file.missing');
    const lower = (file.name || '').toLowerCase();
    // Markdown 存成 index.md,serving 的查看器壳渲染;目录 URL 缺 index.html 时也会回退到它
    const isMd = lower.endsWith('.md') || lower.endsWith('.markdown');
    if (!isMd && !lower.endsWith('.html') && !lower.endsWith('.htm')) {
      return jsonError(c, 422, 'trial.file.notHtml');
    }
    if (file.size > MAX_TRIAL_BYTES) {
      return jsonError(c, 413, 'trial.file.tooLarge', { mb: MAX_TRIAL_BYTES / 1024 / 1024 });
    }
    const indexName = isMd ? 'index.md' : 'index.html';

    const created = nowIso();
    const expiresAt = new Date(Date.now() + cfg.trialTtlMinutes * 60 * 1000).toISOString();
    const vid = uuid();
    // slug 随机不可猜(小写 base62 → [0-9a-z]),撞唯一索引重试一次
    let site: SiteRow | null = null;
    for (let attempt = 0; attempt < 2 && !site; attempt++) {
      const slug = shortId(12).toLowerCase();
      const row: SiteRow = {
        id: uuid(),
        ownerId: TRIAL_OWNER,
        ownerHandle: TRIAL_HANDLE,
        slug,
        title: file.name || null,
        visibility: 'private',
        publicExpiresAt: null,
        shareKeyVersion: 1,
        guestComments: true,
        expiresAt,
        spaFallback: false,
        commentsEnabled: true,
        currentVersionId: vid,
        versions: [
          {
            id: vid,
            storage_prefix: `sites/${TRIAL_OWNER}/${slug}/${vid}/`,
            file_count: 1,
            total_bytes: file.size,
            uploaded_by: TRIAL_OWNER,
            created_at: created,
            files: [indexName],
          },
        ],
        createdAt: created,
        updatedAt: created,
        deletedAt: null,
        suspendedAt: null,
        suspendedReason: null,
      };
      try {
        await db.insert(sites).values(row);
        site = row;
      } catch {
        /* slug 撞车(概率極低):换一个重试 */
      }
    }
    if (!site) return jsonError(c, 500, 'server.internalError');

    await storage.put(
      site.versions[0]!.storage_prefix + indexName,
      file.stream(),
      isMd ? 'text/markdown; charset=utf-8' : 'text/html; charset=utf-8',
    );

    const { token } = await mintShareKey(cfg, site.id, 1, cfg.trialTtlMinutes / 60);
    const exp = Math.floor(new Date(expiresAt).getTime() / 1000);
    const claimToken = await mintClaimToken(cfg, site.id, exp);
    console.log(`trial deploy slug=${site.slug} bytes=${file.size} ip=${ip}`);
    return c.json({
      site_id: site.id,
      // md 直指文件路径(目录 URL 另有 index.md 回退,但链接不吃这跳 302)
      url: `${siteUrl(cfg, TRIAL_HANDLE, site.slug)}${isMd ? 'index.md' : ''}?key=${token}`,
      expires_at: expiresAt,
      claim_token: claimToken,
      comments_api: `${consoleBase(cfg)}/api/try/${site.id}/comments?key=${token}`,
    });
  });

  // ---- 试用站评论导出(闭环演示):凭 share key 即可拉,无需账号/PAT ----
  r.get('/:id/comments', async (c) => {
    cors(c);
    const id = c.req.param('id');
    const key = c.req.query('key');
    const site = (
      await db
        .select()
        .from(sites)
        .where(and(eq(sites.id, id), isNull(sites.deletedAt)))
    )[0];
    if (!site || site.expiresAt === null || site.expiresAt <= nowIso()) {
      return jsonError(c, 404, 'trial.notFound');
    }
    const k = key === undefined ? null : await verifyShareKey(cfg, key);
    if (!k || k.sid !== site.id || k.skv !== site.shareKeyVersion) {
      return jsonError(c, 401, 'auth.unauthenticated');
    }
    const threads = await db
      .select()
      .from(commentThreads)
      .where(and(eq(commentThreads.siteId, site.id), isNull(commentThreads.deletedAt)));
    const base = siteUrl(cfg, site.ownerHandle, site.slug);
    return c.json({
      slug: site.slug,
      expires_at: site.expiresAt,
      threads: threads.map((t) => ({
        id: t.id,
        page_path: t.pagePath,
        url: base + (t.pagePath === 'index.html' ? '' : t.pagePath) + `#pp-comment-${t.id}`,
        selector: t.selector,
        kind: t.kind,
        anchor_text: t.anchorText,
        resolved: t.resolved,
        comments: t.comments.map((cm) => ({
          author: cm.author_name,
          text: cm.text,
          created_at: cm.created_at,
        })),
        created_at: t.createdAt,
      })),
    });
  });

  // ---- 认领:注册/登录后把试用站移入自己账号(TTL 清零,试用链接全部作废) ----
  r.post('/:id/claim', mw.mutatingUser, mw.requireVerified, async (c) => {
    const user = c.get('user');
    if (user.handle == null) return jsonError(c, 409, 'site.handle.required');
    const body = (await c.req.json().catch(() => null)) as {
      claim_token?: unknown;
      slug?: unknown;
    } | null;
    if (!body || typeof body.claim_token !== 'string') {
      return jsonError(c, 422, 'trial.claim.invalid');
    }
    const claims = await verifyClaimToken(cfg, body.claim_token);
    const id = c.req.param('id');
    if (!claims || claims.sid !== id) return jsonError(c, 422, 'trial.claim.invalid');
    const site = (
      await db
        .select()
        .from(sites)
        .where(and(eq(sites.id, id), isNull(sites.deletedAt)))
    )[0];
    if (
      !site ||
      site.ownerHandle !== TRIAL_HANDLE ||
      site.expiresAt === null ||
      site.expiresAt <= nowIso()
    ) {
      return jsonError(c, 404, 'trial.notFound');
    }
    const slug = body.slug === undefined || body.slug === null ? site.slug : body.slug;
    if (typeof slug !== 'string' || !validSlug(slug)) {
      return jsonError(c, 422, 'site.slug.invalid');
    }
    const conflict = (
      await db
        .select({ id: sites.id })
        .from(sites)
        .where(
          and(eq(sites.ownerHandle, user.handle), eq(sites.slug, slug), isNull(sites.deletedAt)),
        )
    )[0];
    if (conflict) return jsonError(c, 409, 'site.slug.taken');
    const now = nowIso();
    // 注:存储对象留在原 sites/trial/<旧slug>/ 前缀下(version.storage_prefix 是真相源,
    // serving 不受影响);删除路径会按 version 前缀逐个回收(见 sites.ts)。
    // 条件 UPDATE:守 (ownerId='trial' + expiresAt 非空) —— 与清理任务竞态时,若行已被
    // sweep 删除或已被认领,0 命中 → 返回 404 而非谎报成功。
    const wrote = await writtenCount(
      db
        .update(sites)
        .set({
          ownerId: user.id,
          ownerHandle: user.handle,
          slug,
          expiresAt: null,
          shareKeyVersion: site.shareKeyVersion + 1, // 试用期的分享链接/访客会话全部作废
          updatedAt: now,
        })
        .where(
          and(eq(sites.id, site.id), eq(sites.ownerId, TRIAL_OWNER), isNotNull(sites.expiresAt)),
        ),
    );
    if (wrote === 0) return jsonError(c, 404, 'trial.notFound');
    // 线程行的反范式 (ownerHandle, slug) 同步跟走
    await db
      .update(commentThreads)
      .set({ ownerHandle: user.handle, slug, updatedAt: now })
      .where(eq(commentThreads.siteId, site.id));
    console.log(`trial claim site=${site.id} slug=${site.slug}→${slug} user=${user.id}`);
    return c.json({ slug, url: siteUrl(cfg, user.handle, slug) });
  });

  return r;
}

/** 到期试用站清理:站点行「条件硬删」→ 命中才删线程 + 回收存储。返回清理数。
 *  先删行、且删除条件与筛选条件同口径(ownerId='trial' + expiresAt 过期):
 *  与 claim 存在 TOCTOU —— claim 会把 expiresAt 清空并改 ownerId,那一刻起本删除不再命中,
 *  绝不会误删刚认领的真实站点(宁可漏清一轮,不可删真数据)。
 *  存储回收放在行删之后、尽力而为:失败仅 warn(残留对象≤2MB,成本可接受),不因此保留行。 */
export async function sweepExpiredTrialSites(db: Db, storage: Storage): Promise<number> {
  const now = nowIso();
  const expired = await db
    .select({ id: sites.id, versions: sites.versions })
    .from(sites)
    .where(
      and(isNotNull(sites.expiresAt), lt(sites.expiresAt, now), eq(sites.ownerId, TRIAL_OWNER)),
    )
    .limit(50);
  let removed = 0;
  for (const site of expired) {
    try {
      // 条件删除:与 claim 竞态时,claim 已改行 → 0 命中 → 本轮跳过,不动线程/存储
      const wrote = await writtenCount(
        db
          .delete(sites)
          .where(
            and(
              eq(sites.id, site.id),
              eq(sites.ownerId, TRIAL_OWNER),
              isNotNull(sites.expiresAt),
              lt(sites.expiresAt, now),
            ),
          ),
      );
      if (wrote === 0) continue; // 竞态:期间被 claim/改动,保留数据
      removed++;
      await db.delete(commentThreads).where(eq(commentThreads.siteId, site.id));
      if (storage.deletePrefix) {
        for (const v of site.versions) {
          try {
            await storage.deletePrefix(v.storage_prefix);
          } catch (e) {
            console.warn(`试用站存储回收失败 ${v.storage_prefix}:`, e);
          }
        }
      }
    } catch (e) {
      console.warn(`试用站清理失败 ${site.id}:`, e);
    }
  }
  if (removed > 0) console.log(`trial sweep: removed ${removed} expired site(s)`);
  return removed;
}
