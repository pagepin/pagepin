import { Languages } from 'lucide-react';

import { useLocale, useSetLocale, useT, type Locale } from '../i18n';

/** 语言切换:en ↔ zh 互切。写 pp_lang cookie 并即时重渲染(见 i18n/index.ts)。
 *  样式与 TopBar 的图标按钮一致;按钮上以 EN/中 标出「当前」语言。 */
export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const t = useT();
  const locale = useLocale();
  const setLocale = useSetLocale();
  const next: Locale = locale === 'zh' ? 'en' : 'zh';
  return (
    <button
      type="button"
      onClick={() => setLocale(next)}
      title={t('language.label')}
      aria-label={t('language.label')}
      className={
        'flex h-[34px] items-center justify-center gap-1 rounded-field border border-ink-200 bg-white px-2 text-ink-600 transition-colors hover:border-tide-300 hover:text-tide-700 ' +
        className
      }
    >
      <Languages className="h-4 w-4" />
      <span className="text-xs font-semibold">{locale === 'zh' ? '中' : 'EN'}</span>
    </button>
  );
}

/** 固定在右上角的语言切换器,给无全局 TopBar 的独立页(登录/注册/激活/错误页)用。 */
export function CornerLang() {
  return (
    <div className="fixed right-3 top-3 z-50">
      <LanguageSwitcher />
    </div>
  );
}
