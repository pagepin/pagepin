/** i18n 核心 —— 纯函数、零 I/O、edge-safe(Node/Workers 同构)。
 *
 * 设计要点:
 *   - catalog 是普通 TS 模块(messages.ts),import 进来即可,绝不 readFileSync
 *     (与 schema.ts / edge-assets.ts 同理:Workers 运行时无 fs,顶层读盘会在 import 时崩 isolate)。
 *   - t() 查不到 key 时「原样返回 key」,作为增量迁移的安全网:未迁移的旧字面量调用不会抛错。
 *   - 仅 en/zh 两语,无需 Intl/ICU;占位符用最简单的 {name} 平铺替换。
 */

import { messages } from './messages.js';

export type Locale = 'en' | 'zh';

/** 受支持的语言;新增语言时只动这里 + messages.ts。 */
export const SUPPORTED: readonly Locale[] = ['en', 'zh'];

/** 兜底语言:locale 缺失 / catalog 缺 key 时回落到它(与 PAGEPIN_DEFAULT_LOCALE 默认值保持一致)。 */
export const DEFAULT_FALLBACK: Locale = 'en';

export type TParams = Record<string, string | number>;

/** 把任意来源(?lang= / pp_lang cookie / Accept-Language 头)的语言串规整到受支持的 Locale。
 *  兼容 Accept-Language 的带权重列表(如 "zh-CN,zh;q=0.9,en;q=0.8"),按 q 降序取首个支持项;
 *  也兼容单值("zh" / "en-US" / "zh-Hans-CN")。无法匹配返回 undefined(交由上层决定回落)。 */
export function normalizeLocale(raw: string | undefined | null): Locale | undefined {
  if (!raw) return undefined;
  const ranked = raw
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      let q = 1;
      for (const p of params) {
        const m = /^\s*q=([0-9.]+)\s*$/.exec(p);
        if (m?.[1]) q = Number.parseFloat(m[1]);
      }
      return { tag: (tag ?? '').trim().toLowerCase(), q: Number.isFinite(q) ? q : 0 };
    })
    .filter((x) => x.tag.length > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of ranked) {
    if (tag === 'zh' || tag.startsWith('zh-') || tag.startsWith('zh_')) return 'zh';
    if (tag === 'en' || tag.startsWith('en-') || tag.startsWith('en_')) return 'en';
  }
  return undefined;
}

/** 平铺查表 + {name} 占位替换。
 *  回落链:目标 locale → DEFAULT_FALLBACK → key 本身(三重兜底,永不抛错、永不返回 undefined)。 */
export function t(locale: Locale, key: string, params?: TParams): string {
  const table = messages[locale] ?? messages[DEFAULT_FALLBACK];
  let template = table[key] ?? messages[DEFAULT_FALLBACK][key] ?? key;
  if (params) {
    template = template.replace(/\{(\w+)\}/g, (whole, name: string) =>
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
    );
  }
  return template;
}

/** 统一错误体:{ detail(已按 locale 翻译的人读文案), code(稳定的机器可读 key) }。
 *  detail 给人看、随语言变;code 给程序/AI 反馈闭环用、跨语言恒定(= i18n key)。 */
export function errorBody(
  locale: Locale,
  key: string,
  params?: TParams,
): { detail: string; code: string } {
  return { detail: t(locale, key, params), code: key };
}
