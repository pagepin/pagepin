/** /api/device/* —— OAuth2 设备授权流程(RFC 8628)。
 *
 * 目的:让 AI/CLI 经浏览器登录拿 PAT,而不是让用户把明文 token 贴进对话。
 *   1. 发起方 POST /code → 拿 device_code(密钥)+ user_code(短码)+ verification_uri。
 *   2. 人在浏览器打开 verification_uri,登录后在 /activate 里确认 user_code → POST /approve。
 *   3. 发起方按 interval 轮询 POST /token,批准后取走一次明文 token,随即删行。
 *
 * /code、/token 匿名(发起方还没有凭证);/approve、/deny 必须控制台 Cookie 会话(浏览器侧人来确认)。
 * 明文 token 只经「发起方轮询」交付 —— 浏览器侧永远拿不到,故对话/截屏都不会泄漏。
 */

import { eq, lt } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';

import { consoleBase } from '../config.js';
import { deviceAuths } from '../db/index.js';
import type { AppDeps, AppEnv } from '../types.js';
import { nowIso, uuid } from '../util.js';
import type { AuthMiddleware } from './deps.js';
import { mintToken } from './tokens.js';

/** 设备码有效期(秒);足够人去浏览器点确认。 */
const DEVICE_TTL_S = 600;
/** 建议轮询间隔(秒)。 */
const POLL_INTERVAL_S = 5;

function randBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/** 发起方密钥:32 hex(16 随机字节),只发给发起方、轮询用。 */
function newDeviceCode(): string {
  return [...randBytes(16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 去掉易混字符(I/O/0/1),人读人输更稳
const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 展示给人确认的短码:XXXX-XXXX。 */
function newUserCode(): string {
  const b = randBytes(8);
  const ch = [...b].map((x) => USER_CODE_ALPHABET[x % USER_CODE_ALPHABET.length]!);
  return ch.slice(0, 4).join('') + '-' + ch.slice(4, 8).join('');
}

async function readJson<T>(c: Context<AppEnv>): Promise<T | null> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return null;
  }
}

export function makeDeviceRoutes(deps: AppDeps, mw: AuthMiddleware): Hono<AppEnv> {
  const { db, config: cfg } = deps;
  const app = new Hono<AppEnv>();

  // 发起授权:匿名。返回展示给人的短码与浏览器确认地址。
  app.post('/api/device/code', async (c) => {
    await db.delete(deviceAuths).where(lt(deviceAuths.expiresAt, nowIso())); // 顺手清过期,避免无界增长

    const deviceCode = newDeviceCode();
    let userCode = newUserCode();
    for (let i = 0; i < 5; i++) {
      const dup = (await db
        .select({ id: deviceAuths.id })
        .from(deviceAuths)
        .where(eq(deviceAuths.userCode, userCode))
        )[0];
      if (!dup) break;
      userCode = newUserCode();
    }

    const expiresAt = new Date(Date.now() + DEVICE_TTL_S * 1000).toISOString();
    await db
      .insert(deviceAuths)
      .values({
        id: uuid(),
        deviceCode,
        userCode,
        status: 'pending',
        userId: null,
        token: null,
        tokenName: null,
        createdAt: nowIso(),
        expiresAt,
        approvedAt: null,
      });

    const base = consoleBase(cfg);
    const verificationUri = `${base}/activate`;
    return c.json({
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: verificationUri,
      verification_uri_complete: `${verificationUri}?user_code=${encodeURIComponent(userCode)}`,
      expires_in: DEVICE_TTL_S,
      interval: POLL_INTERVAL_S,
    });
  });

  // 轮询:匿名,凭 device_code。pending/denied/expired 或一次性交付 approved+token。
  app.post('/api/device/token', async (c) => {
    const body = await readJson<{ device_code?: unknown }>(c);
    const deviceCode = typeof body?.device_code === 'string' ? body.device_code : '';
    if (!deviceCode) return c.json({ detail: '缺少 device_code' }, 422);

    const rec = (await db.select().from(deviceAuths).where(eq(deviceAuths.deviceCode, deviceCode)))[0];
    if (!rec) return c.json({ status: 'expired' }); // 未知/已清理:按过期处理,发起方停止轮询
    if (Date.parse(rec.expiresAt) <= Date.now()) {
      await db.delete(deviceAuths).where(eq(deviceAuths.id, rec.id));
      return c.json({ status: 'expired' });
    }
    if (rec.status === 'denied') {
      await db.delete(deviceAuths).where(eq(deviceAuths.id, rec.id));
      return c.json({ status: 'denied' });
    }
    if (rec.status === 'approved' && rec.token) {
      const token = rec.token;
      await db.delete(deviceAuths).where(eq(deviceAuths.id, rec.id)); // 一次性交付:取走即删
      return c.json({ status: 'approved', token });
    }
    return c.json({ status: 'pending' });
  });

  // 批准:必须控制台 Cookie 会话(浏览器里登录的人)。铸 PAT 并暂存到行上,供发起方取走。
  app.post('/api/device/approve', mw.cookieMutatingUser, async (c) => {
    const user = c.get('user');
    const body = await readJson<{ user_code?: unknown }>(c);
    const userCode = typeof body?.user_code === 'string' ? body.user_code.trim().toUpperCase() : '';
    if (!userCode) return c.json({ detail: '缺少 user_code' }, 422);

    const rec = (await db.select().from(deviceAuths).where(eq(deviceAuths.userCode, userCode)))[0];
    if (!rec || Date.parse(rec.expiresAt) <= Date.now()) {
      if (rec) await db.delete(deviceAuths).where(eq(deviceAuths.id, rec.id));
      return c.json({ detail: '设备码不存在或已过期，请在工具里重新发起登录' }, 404);
    }
    if (rec.status !== 'pending') return c.json({ detail: '该设备码已被处理' }, 409);

    const name = `Device login ${nowIso().slice(0, 10)}`;
    // 设备登录铸的 token 默认带过期(PAGEPIN_DEVICE_TOKEN_TTL_DAYS,默认 90 天;0 = 不过期),
    // 给落盘的长期凭证一个兜底失效期;普通 PAT 仍不过期。
    const ttlDays = cfg.deviceTokenTtlDays;
    const expiresAt = ttlDays > 0 ? new Date(Date.now() + ttlDays * 86_400_000).toISOString() : null;
    const minted = await mintToken(db, user.id, name, expiresAt);
    await db
      .update(deviceAuths)
      .set({ status: 'approved', userId: user.id, token: minted.token, tokenName: name, approvedAt: nowIso() })
      .where(eq(deviceAuths.id, rec.id));
    console.log(`device approved handle=${user.handle} user_code=${userCode} prefix=${minted.prefix}`);
    return c.json({ ok: true, token_name: name });
  });

  // 拒绝:必须控制台 Cookie 会话。让发起方立即停止轮询。
  app.post('/api/device/deny', mw.cookieMutatingUser, async (c) => {
    const body = await readJson<{ user_code?: unknown }>(c);
    const userCode = typeof body?.user_code === 'string' ? body.user_code.trim().toUpperCase() : '';
    if (!userCode) return c.json({ detail: '缺少 user_code' }, 422);
    const rec = (await db.select().from(deviceAuths).where(eq(deviceAuths.userCode, userCode)))[0];
    if (rec && rec.status === 'pending') {
      await db.update(deviceAuths).set({ status: 'denied' }).where(eq(deviceAuths.id, rec.id));
    }
    return c.json({ ok: true });
  });

  return app;
}
