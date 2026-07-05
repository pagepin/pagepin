import type { ReactNode } from 'react';
import { LogIn } from 'lucide-react';
import { useT } from '../i18n';

/** 品牌标(lucide 已去掉品牌图标,内联 SVG)。 */
function GoogleMark() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.55-5.17 3.55-8.87Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.95-2.91l-3.88-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.62H1.29a12 12 0 0 0 0 10.76l3.98-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75Z"
      />
    </svg>
  );
}
function GithubMark() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.95 0-1.31.47-2.39 1.24-3.23-.13-.31-.54-1.53.12-3.19 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.25 2.88.12 3.19.77.84 1.24 1.92 1.24 3.23 0 4.62-2.81 5.64-5.49 5.94.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12 12 0 0 0 12 .5Z" />
    </svg>
  );
}
const PROVIDER_META: Record<string, { labelKey: string; icon: ReactNode }> = {
  google: { labelKey: 'auth.continueWithGoogle', icon: <GoogleMark /> },
  github: { labelKey: 'auth.continueWithGithub', icon: <GithubMark /> },
};

/** 社交登录按钮区:每家一条,跳服务端 /auth/social/<id>。登录/注册两屏共用
 *  (社交首登即建号,同一按钮两个语义)。 */
export function SocialButtons({ providers, next }: { providers: string[]; next: string }) {
  const t = useT();
  if (!providers.length) return null;
  return (
    <div className="space-y-2.5">
      {providers.map((id) => {
        const meta = PROVIDER_META[id];
        const label = meta ? t(meta.labelKey) : t('auth.continueWith', { provider: id });
        const icon = meta ? meta.icon : <LogIn className="h-4 w-4" />;
        return (
          <button
            key={id}
            type="button"
            className="flex w-full items-center justify-center gap-2.5 rounded-panel border border-ink-200 bg-white px-3 py-2.5 text-sm font-semibold text-ink-700 transition hover:border-tide-400 hover:text-tide-700"
            onClick={() => {
              location.href =
                '/auth/social/' + encodeURIComponent(id) + '?next=' + encodeURIComponent(next);
            }}
          >
            {icon}
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** 居中"or"分隔线。 */
export function OrDivider() {
  const t = useT();
  return (
    <div className="my-4 flex items-center gap-3 text-[11px] uppercase tracking-wide text-ink-400">
      <span className="h-px flex-1 bg-ink-100" />
      {t('auth.or')}
      <span className="h-px flex-1 bg-ink-100" />
    </div>
  );
}
