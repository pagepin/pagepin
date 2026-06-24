/** Cloudflare Turnstile 服务端校验 —— edge-safe（仅用 fetch / URLSearchParams）。
 * 仅当 config.turnstile 配置齐全时由 /auth/signup、/auth/password 调用；默认关。 */

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** 向 Cloudflare 校验前端回传的 Turnstile token。失败（含空 token、非 2xx、网络异常）一律 false。 */
export async function verifyTurnstile(
  secret: string,
  token: string,
  remoteIp?: string,
): Promise<boolean> {
  if (!token) return false;
  const form = new URLSearchParams();
  form.set('secret', secret);
  form.set('response', token);
  if (remoteIp && remoteIp !== 'unknown') form.set('remoteip', remoteIp);
  try {
    const res = await fetch(SITEVERIFY, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
