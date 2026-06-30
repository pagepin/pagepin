/** console SPA 的 i18n 核心。
 *
 * console 是独立 Vite 工程,不能 import 服务端的 src/i18n(跨构建根),故此处自带一份精简实现。
 * locale 存 zustand,useT() 订阅它 → 切换语言时所有用到文案的组件实时重渲染。
 * 语言同时写入 pp_lang cookie(非 httpOnly),让随后的 API fetch / 服务端渲染页拿到同一语言。
 */

import { useMemo } from 'react';
import { create } from 'zustand';

import { messages } from './messages';

export type Locale = 'en' | 'zh';
export const SUPPORTED: readonly Locale[] = ['en', 'zh'];
export const DEFAULT_FALLBACK: Locale = 'en';
export const LANG_COOKIE = 'pp_lang';

export type TParams = Record<string, string | number>;

/** 把任意语言串规整到受支持 Locale;兼容 navigator.language 的 "zh-CN" / 带权重列表。 */
export function normalizeLocale(raw: string | undefined | null): Locale | undefined {
  if (!raw) return undefined;
  for (const part of raw.split(',')) {
    const tag = (part.split(';')[0] ?? '').trim().toLowerCase();
    if (!tag) continue;
    if (tag === 'zh' || tag.startsWith('zh-') || tag.startsWith('zh_')) return 'zh';
    if (tag === 'en' || tag.startsWith('en-') || tag.startsWith('en_')) return 'en';
  }
  return undefined;
}

/** 平铺查表 + {name} 占位替换;回落 目标 → en → key 本身。 */
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

function readCookie(name: string): string | undefined {
  const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]!) : undefined;
}

function writeLangCookie(locale: Locale): void {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${LANG_COOKIE}=${locale}; path=/; max-age=31536000; SameSite=Lax${secure}`;
}

/** 首选语言:pp_lang cookie → 浏览器语言 → 默认 en。 */
function detectInitialLocale(): Locale {
  const fromCookie = normalizeLocale(readCookie(LANG_COOKIE));
  if (fromCookie) return fromCookie;
  const nav =
    (navigator.languages && navigator.languages.join(',')) || navigator.language || undefined;
  return normalizeLocale(nav) ?? DEFAULT_FALLBACK;
}

interface LocaleStore {
  locale: Locale;
  setLocale: (l: Locale) => void;
}

export const useLocaleStore = create<LocaleStore>((set) => ({
  locale: detectInitialLocale(),
  setLocale: (locale) => {
    writeLangCookie(locale);
    set({ locale });
  },
}));

export type TFn = (key: string, params?: TParams) => string;

/** 取一个绑定当前 locale 的 t();locale 变化时返回新函数并触发组件重渲染。 */
export function useT(): TFn {
  const locale = useLocaleStore((s) => s.locale);
  return useMemo<TFn>(() => (key, params) => t(locale, key, params), [locale]);
}

export function useLocale(): Locale {
  return useLocaleStore((s) => s.locale);
}

export function useSetLocale(): (l: Locale) => void {
  return useLocaleStore((s) => s.setLocale);
}

/** 非组件代码(api.ts / store.ts 等无 hooks 处)用:按当前 store locale 即时翻译,不订阅重渲染。 */
export function translate(key: string, params?: TParams): string {
  return t(useLocaleStore.getState().locale, key, params);
}
