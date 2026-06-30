import { useState } from 'react';
import { KeyRound, LogOut, Settings as SettingsIcon, Shield } from 'lucide-react';
import { logout } from '../api';
import { useT } from '../i18n';
import { useStore } from '../store';
import { BrandMark } from './BrandMark';
import { LanguageSwitcher } from './LanguageSwitcher';
import { TokenDialog } from './TokenDialog';

const iconBtn =
  'flex h-[34px] w-[34px] items-center justify-center rounded-field border border-ink-200 bg-white text-ink-600 transition-colors hover:border-tide-300 hover:text-tide-700';

export function TopBar() {
  const t = useT();
  const me = useStore((s) => s.me);
  const [showTokens, setShowTokens] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-ink-200 bg-ink-50/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2">
            <BrandMark size={26} className="shrink-0" />
            <span className="font-mono text-lg font-bold tracking-tight text-tide-600">
              page<span className="text-ink-800">pin</span>
              <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse-dot rounded-full bg-tide-500 align-baseline" />
            </span>
          </span>
          <span className="hidden text-xs text-ink-400 sm:inline">{t('topbar.tagline')}</span>
        </div>
        <div className="flex items-center gap-3">
          {me && (
            <div className="text-right leading-tight">
              <div className="text-sm font-semibold text-ink-700">{me.display_name}</div>
              {me.handle && <div className="font-mono text-xs text-ink-400">@{me.handle}</div>}
            </div>
          )}
          {me && !me.needs_handle && (
            <>
              <button
                type="button"
                onClick={() => setShowTokens(true)}
                title={t('topbar.apiTokens')}
                className={iconBtn}
              >
                <KeyRound className="h-4 w-4" />
              </button>
              {me.is_admin && (
                <button
                  type="button"
                  onClick={() => {
                    location.href = '/admin';
                  }}
                  title={t('topbar.instanceAdmin')}
                  className={iconBtn}
                >
                  <Shield className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  location.href = '/settings';
                }}
                title={t('topbar.accountSettings')}
                className={iconBtn}
              >
                <SettingsIcon className="h-4 w-4" />
              </button>
            </>
          )}
          <LanguageSwitcher />
          {me && (
            <button
              type="button"
              onClick={() => void logout()}
              title={t('topbar.signOut')}
              className={iconBtn}
            >
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      {showTokens && <TokenDialog onClose={() => setShowTokens(false)} />}
    </header>
  );
}
