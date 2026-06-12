/** 密码哈希:scrypt(@noble/hashes,纯 JS,edge-safe)。
 * 格式:scrypt$N$r$p$<salt b64>$<hash b64> —— 参数随存,将来调强度旧哈希仍可验。
 */

import { scryptAsync } from '@noble/hashes/scrypt';
import { randomBytes } from '@noble/hashes/utils';

const N = 2 ** 15; // ~100ms 量级,自托管与 Workers paid 档均可承受
const R = 8;
const P = 1;
const DKLEN = 32;

function b64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password.normalize('NFKC'), salt, { N, r: R, p: P, dkLen: DKLEN });
  return `scrypt$${N}$${R}$${P}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nS, rS, pS, saltB64, hashB64] = parts;
  const want = unb64(hashB64!);
  const got = await scryptAsync(password.normalize('NFKC'), unb64(saltB64!), {
    N: Number(nS), r: Number(rS), p: Number(pS), dkLen: want.length,
  });
  // 常数时间比较
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i]! ^ want[i]!;
  return diff === 0;
}
