/** 邮箱验证 —— 无状态签名 token(HS256,同会话密钥)+ 发信。edge-safe。
 *
 * token 载荷 { purpose:'verify-email', uid, eml }:eml = 签发时的 canonicalEmail,
 * 验证时与库内当前 canonicalEmail 比对 —— 邮箱一旦改变,旧链接即失效(防过期地址被验证)。
 * 不落库:一次性语义靠「验证后 emailVerified 已为 true,再点链接也只是幂等」实现。 */

import { sign, verify as jwtVerify } from 'hono/jwt';

import { consoleBase } from '../config.js';
import type { UserRow } from '../db/index.js';
import type { AppDeps } from '../types.js';

const VERIFY_TTL = 86_400; // 验证链接有效期 24h

/** 给 user 发一封验证邮件。返回是否真的发了(无 mailer / 无 canonicalEmail → false)。 */
export async function sendVerificationEmail(deps: AppDeps, user: UserRow): Promise<boolean> {
  const { config: cfg, mailer } = deps;
  if (!mailer || !user.canonicalEmail) return false;
  const now = Math.floor(Date.now() / 1000);
  const token = await sign(
    {
      purpose: 'verify-email',
      uid: user.id,
      eml: user.canonicalEmail,
      iat: now,
      exp: now + VERIFY_TTL,
    },
    cfg.secret,
    'HS256',
  );
  const link = `${consoleBase(cfg)}/auth/verify-email?token=${encodeURIComponent(token)}`;
  await mailer.send({
    to: user.email ?? user.canonicalEmail,
    subject: 'Verify your pagepin email',
    text: `Confirm your email for pagepin:\n\n${link}\n\nThis link expires in 24 hours. If you didn't create a pagepin account, you can ignore this email.`,
    html: verifyHtml(link),
  });
  return true;
}

/** 校验 token,返回 { uid, eml };非法/过期/用途不符 → null。 */
export async function readVerifyToken(
  secret: string,
  token: string,
): Promise<{ uid: string; eml: string } | null> {
  try {
    const p = (await jwtVerify(token, secret, 'HS256')) as Record<string, unknown>;
    if (p.purpose !== 'verify-email' || typeof p.uid !== 'string' || typeof p.eml !== 'string') {
      return null;
    }
    return { uid: p.uid, eml: p.eml };
  } catch {
    return null;
  }
}

function verifyHtml(link: string): string {
  return `<!doctype html><html><body style="margin:0;background:#ECEEEF;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#fff;border:1px solid #e7e9eb;border-radius:16px;padding:32px">
<tr><td>
<div style="font-family:ui-monospace,monospace;font-size:18px;font-weight:700;color:#0f7c72;margin-bottom:20px">page<span style="color:#11161b">pin</span></div>
<h1 style="margin:0 0 8px;font-size:19px;color:#11161b">Verify your email</h1>
<p style="margin:0 0 22px;font-size:14px;line-height:1.6;color:#6b7480">Confirm this address to secure your pagepin account. This link expires in 24 hours.</p>
<a href="${link}" style="display:inline-block;background:#0f7c72;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 22px;border-radius:9px">Verify email</a>
<p style="margin:22px 0 0;font-size:12px;line-height:1.6;color:#9aa1a9;word-break:break-all">Or paste this link:<br>${link}</p>
<p style="margin:18px 0 0;font-size:12px;color:#9aa1a9">If you didn't create a pagepin account, ignore this email.</p>
</td></tr></table></td></tr></table></body></html>`;
}
