/** 实例级运行时设置 —— instance_settings 表(KV)的读写 + 注册模式的有效值解析。
 *
 * 注册模式优先级:env 显式覆盖(锁定) > DB instance_settings > 兜底默认(沿用旧 allowSignup,默认 open)。
 * env 覆盖时管理员在 UI 改不动(registrationModeLocked 为 true)—— 与「env 启动时覆盖」语义一致。
 */

import { eq } from 'drizzle-orm';

import { instanceSettings } from './db/index.js';
import type { AppDeps } from './types.js';

export const REGISTRATION_MODES = ['open', 'invite', 'closed'] as const;
export type RegistrationMode = (typeof REGISTRATION_MODES)[number];

export function isRegistrationMode(v: unknown): v is RegistrationMode {
  return typeof v === 'string' && (REGISTRATION_MODES as readonly string[]).includes(v);
}

export async function getSetting(deps: AppDeps, key: string): Promise<string | null> {
  const row = await deps.db
    .select({ value: instanceSettings.value })
    .from(instanceSettings)
    .where(eq(instanceSettings.key, key))
    .get();
  return row?.value ?? null;
}

export async function setSetting(deps: AppDeps, key: string, value: string): Promise<void> {
  await deps.db
    .insert(instanceSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: instanceSettings.key, set: { value } })
    .run();
}

/** env 是否锁定了注册模式(锁定时 UI 不可改)。 */
export function registrationModeLocked(deps: AppDeps): boolean {
  return deps.config.registrationMode !== undefined;
}

/** 当前生效的注册模式。 */
export async function effectiveRegistrationMode(deps: AppDeps): Promise<RegistrationMode> {
  if (deps.config.registrationMode) return deps.config.registrationMode; // env 锁定
  const stored = await getSetting(deps, 'registration_mode');
  if (isRegistrationMode(stored)) return stored;
  return deps.config.allowSignup ? 'open' : 'closed'; // 兜底:沿用旧 allowSignup(默认 true → open)
}

export async function setRegistrationMode(deps: AppDeps, mode: RegistrationMode): Promise<void> {
  await setSetting(deps, 'registration_mode', mode);
}
