import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useStore } from './store';
import { Confirmer } from './components/ConfirmDialog';
import { DropZone } from './components/DropZone';
import { HandleSetup } from './components/HandleSetup';
import { Login } from './components/Login';
import { SiteList } from './components/SiteList';
import { Toaster } from './components/Toast';
import { TopBar } from './components/TopBar';

export default function App() {
  const me = useStore((s) => s.me);
  const booting = useStore((s) => s.booting);
  const bootError = useStore((s) => s.bootError);
  const init = useStore((s) => s.init);

  // /login 是 SPA 内登录页：不调 /api/me（避免 401 跳转死循环）
  const onLoginPage = location.pathname === '/login';

  useEffect(() => {
    if (!onLoginPage) void init();
  }, [init, onLoginPage]);

  if (onLoginPage) {
    return <Login />;
  }

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-2 text-stone-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">正在进入 pagepin…</span>
        </div>
      </div>
    );
  }

  if (bootError || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-sm rounded-2xl border border-red-200 bg-white p-8 text-center shadow-card">
          <div className="text-2xl">🫥</div>
          <p className="mt-3 text-sm font-medium text-stone-700">加载失败</p>
          <p className="mt-1 text-xs text-stone-400">{bootError ?? '未知错误'}</p>
          <button type="button" className="btn-primary mt-5" onClick={() => location.reload()}>
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <TopBar />
      {me.needs_handle ? (
        <HandleSetup />
      ) : (
        <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
          <DropZone />
          <SiteList />
        </main>
      )}
      <Toaster />
      <Confirmer />
      <footer className="pb-8 pt-4 text-center text-xs text-stone-300">
        pagepin · 静态页面托管与评审
      </footer>
    </div>
  );
}
