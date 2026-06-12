import { useState } from 'react';
import { KeyRound, LogOut } from 'lucide-react';
import { logout } from '../api';
import { useStore } from '../store';
import { TokenDialog } from './TokenDialog';

export function TopBar() {
  const me = useStore((s) => s.me);
  const [showTokens, setShowTokens] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-stone-200/70 bg-stone-50/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-lg font-bold tracking-tight text-tide-700">
            page<span className="text-stone-800">pin</span>
            <span className="ml-0.5 inline-block h-2 w-2 rounded-full bg-tide-500 align-baseline" />
          </span>
          <span className="hidden text-xs text-stone-400 sm:inline">拖进来，链接拿走</span>
        </div>
        {me && (
          <div className="flex items-center gap-3">
            <div className="text-right leading-tight">
              <div className="text-sm font-medium text-stone-700">{me.display_name}</div>
              {me.handle && <div className="font-mono text-xs text-stone-400">@{me.handle}</div>}
            </div>
            {!me.needs_handle && (
              <button
                type="button"
                onClick={() => setShowTokens(true)}
                title="API Token（给 AI/脚本部署用）"
                className="rounded-lg p-2 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600"
              >
                <KeyRound className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => void logout()}
              title="登出"
              className="rounded-lg p-2 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      {showTokens && <TokenDialog onClose={() => setShowTokens(false)} />}
    </header>
  );
}
