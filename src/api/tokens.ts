/** /api/tokens —— PAT 管理,仅浏览器 Cookie 会话可操作。
 *
 * 明文只在创建/轮换的响应里出现一次,库中只存 sha256(show-once):DB 泄露/备份/管理员
 * 都拿不到可用凭证,console 会话沦陷也只能"新建 token"(列表可见、可吊销)而非静默捞走存量。
 * 吊销 = 软删(revoked_at),认证路径命中即拒,立即生效。
 * token 管理接口必须 Cookie 会话(token 不能造/吊销/查看 token,限制泄露半径)。
 */

import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';

import { apiTokens, type ApiTokenRow, type Db, type UserRow } from '../db/index.js';
import { jsonError } from '../i18n/locale.js';
import type { AppDeps, AppEnv } from '../types.js';
import { nowIso, uuid } from '../util.js';

/** makeAuthMiddleware(deps) 的产出形状(结构匹配 api/deps.ts,集成时对齐)。 */
export interface AuthMw {
  currentUser: MiddlewareHandler<AppEnv>;
  mutatingUser: MiddlewareHandler<AppEnv>;
  cookieUser: MiddlewareHandler<AppEnv>;
  cookieMutatingUser: MiddlewareHandler<AppEnv>;
  requireVerified: MiddlewareHandler<AppEnv>;
}

export const MAX_TOKENS_PER_USER = 10;

/** 新明文 token:pp_ + 40 个 hex(20 随机字节)。 */
function newRawToken(): string {
  const buf = new Uint8Array(20);
  crypto.getRandomValues(buf);
  return 'pp_' + [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** mintToken 的产出:行(库中只有 hash)+ 明文。明文只在铸造这一刻存在,
 * 调用方负责一次性交付(HTTP 响应 / 设备流暂存行),之后无从找回。 */
export interface MintedToken {
  row: ApiTokenRow;
  plaintext: string;
}

/** 铸一个新 PAT 并落库(只存 hash),明文随返回值一次性交付。
 * POST /api/tokens 与设备授权(api/device.ts)共用,保证认证路径完全一致。
 * expiresAt:ISO 字符串则到期即拒;null(默认)= 不过期(普通 PAT)。 */
export async function mintToken(
  db: Db,
  userId: string,
  name: string,
  expiresAt: string | null = null,
): Promise<MintedToken> {
  const raw = newRawToken();
  const row: ApiTokenRow = {
    id: uuid(),
    userId,
    name,
    tokenHash: await sha256Hex(raw),
    prefix: raw.slice(0, 15),
    createdAt: nowIso(),
    lastUsedAt: null,
    expiresAt,
    revokedAt: null,
  };
  await db.insert(apiTokens).values(row);
  return { row, plaintext: raw };
}

function out(t: ApiTokenRow) {
  return {
    id: t.id,
    name: t.name,
    prefix: t.prefix,
    created_at: t.createdAt,
    last_used_at: t.lastUsedAt,
    expires_at: t.expiresAt, // null = 不过期;设备授权铸的 token 有到期时间
  };
}

/** 读 JSON body 里的 name 字段;缺失/非法一律折叠成 ''(后续 1-64 校验自然拦下)。 */
async function readNameField(c: Context<AppEnv>): Promise<string> {
  try {
    const body = (await c.req.json()) as unknown;
    if (typeof body === 'object' && body !== null) {
      const n = (body as Record<string, unknown>).name;
      if (typeof n === 'string') return n;
    }
    return '';
  } catch {
    return '';
  }
}

export function makeTokenRoutes(deps: AppDeps, mw: AuthMw): Hono<AppEnv> {
  const { db } = deps;
  const app = new Hono<AppEnv>();

  const activeOf = (userId: string) =>
    and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt));

  /** 按 id 取本人未吊销的 token;不存在/他人/已吊销一律视为不存在。 */
  const ownedToken = async (tokenId: string, user: UserRow): Promise<ApiTokenRow | null> => {
    const rec = (await db.select().from(apiTokens).where(eq(apiTokens.id, tokenId)))[0];
    if (!rec || rec.userId !== user.id || rec.revokedAt !== null) return null;
    return rec;
  };

  app.get('/api/tokens', mw.cookieUser, async (c) => {
    const user = c.get('user');
    const toks = await db
      .select()
      .from(apiTokens)
      .where(activeOf(user.id))
      .orderBy(desc(apiTokens.createdAt));
    return c.json({ tokens: toks.map(out) });
  });

  app.post('/api/tokens', mw.cookieMutatingUser, mw.requireVerified, async (c) => {
    const user = c.get('user');
    const name = (await readNameField(c)).trim();
    if (name.length < 1 || name.length > 64) return jsonError(c, 422, 'token.name.length');
    const row = (await db.select({ n: count() }).from(apiTokens).where(activeOf(user.id)))[0];
    if ((row?.n ?? 0) >= MAX_TOKENS_PER_USER) {
      return jsonError(c, 409, 'token.limit.reached', { max: MAX_TOKENS_PER_USER });
    }

    const minted = await mintToken(db, user.id, name);
    console.log(`token created handle=${user.handle} name=${name} prefix=${minted.row.prefix}`);
    // 明文仅此一次:列表接口(out)不含 token 字段,之后只能轮换拿新值。
    return c.json({ ...out(minted.row), token: minted.plaintext });
  });

  /** 原地换新值(名字/记录不变):旧明文立即失效,正在用它的 AI/脚本需换新 token。 */
  app.post('/api/tokens/:tokenId/rotate', mw.cookieMutatingUser, mw.requireVerified, async (c) => {
    const user = c.get('user');
    const rec = await ownedToken(c.req.param('tokenId'), user);
    if (!rec) return jsonError(c, 404, 'token.notFound');
    const raw = newRawToken();
    const tokenHash = await sha256Hex(raw);
    const prefix = raw.slice(0, 15);
    await db.update(apiTokens).set({ tokenHash, prefix }).where(eq(apiTokens.id, rec.id));
    console.log(`token rotated handle=${user.handle} ${rec.prefix} -> ${prefix}`);
    // 同创建:新明文只在本响应出现一次。
    return c.json({ ...out({ ...rec, tokenHash, prefix }), token: raw });
  });

  app.delete('/api/tokens/:tokenId', mw.cookieMutatingUser, async (c) => {
    const user = c.get('user');
    const rec = await ownedToken(c.req.param('tokenId'), user);
    if (!rec) return jsonError(c, 404, 'token.notFound');
    await db.update(apiTokens).set({ revokedAt: nowIso() }).where(eq(apiTokens.id, rec.id));
    console.log(`token revoked handle=${user.handle} prefix=${rec.prefix}`);
    return c.json({ ok: true });
  });

  return app;
}
