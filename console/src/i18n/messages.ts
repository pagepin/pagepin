/** console 文案目录聚合器 —— 合并 messages/<域>.ts 为单一 { en, zh } 平铺表。
 * 新增组件域:在 messages/ 下建文件并在此 import + 加进 PARTS。
 * 不变量(见 test 或人工核对):每域 en/zh key 一致;跨域不重复。
 */

import type { Locale } from './index';
import { admin } from './messages/admin';
import { auth } from './messages/auth';
import { common } from './messages/common';
import { core } from './messages/core';
import { deploy } from './messages/deploy';
import { settings } from './messages/settings';
import { sites } from './messages/sites';
import { tokens } from './messages/tokens';

const PARTS: ReadonlyArray<Record<Locale, Record<string, string>>> = [
  common,
  sites,
  deploy,
  settings,
  admin,
  auth,
  tokens,
  core,
];

function build(): Record<Locale, Record<string, string>> {
  const out: Record<Locale, Record<string, string>> = { en: {}, zh: {} };
  for (const part of PARTS) {
    Object.assign(out.en, part.en);
    Object.assign(out.zh, part.zh);
  }
  return out;
}

export const messages: Record<Locale, Record<string, string>> = build();
export const MESSAGE_PARTS = PARTS;
