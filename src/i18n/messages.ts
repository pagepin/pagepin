/** 服务端文案目录聚合器 —— 把 messages/<域>.ts 各域合并成单一 { en, zh } 平铺表。
 *
 * 为何拆分:各 API/HTML/邮件面的文案各占一个域文件,新增/改文案时互不写冲突,也便于审阅。
 * 新增一个域:在 messages/ 下建文件(导出 Record<Locale, Record<string,string>>),在此 import 并加进 PARTS 即可。
 * 不变量(test/i18n.test.ts 守护):每个域文件 en/zh key 集合一致;跨域文件无重复 key。
 */

import type { Locale } from './index.js';
import { account } from './messages/account.js';
import { admin } from './messages/admin.js';
import { authflow } from './messages/authflow.js';
import { authHtml } from './messages/authHtml.js';
import { common } from './messages/common.js';
import { contentHtml } from './messages/contentHtml.js';
import { site } from './messages/site.js';

/** 所有域目录;合并顺序无关紧要(无碰撞由测试保证)。 */
const PARTS: ReadonlyArray<Record<Locale, Record<string, string>>> = [
  common,
  site,
  account,
  admin,
  authflow,
  contentHtml,
  authHtml,
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

/** 域目录数组,供测试做 parity / 无碰撞断言(不参与运行时)。 */
export const MESSAGE_PARTS = PARTS;
