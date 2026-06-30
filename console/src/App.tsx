import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useT } from './i18n';
import { useStore } from './store';
import { AcceptInvite } from './components/AcceptInvite';
import { Activate } from './components/Activate';
import { Admin } from './components/Admin';
import { Confirmer } from './components/ConfirmDialog';
import { HandleSetup } from './components/HandleSetup';
import { CornerLang } from './components/LanguageSwitcher';
import { Login } from './components/Login';
import { Settings } from './components/Settings';
import { Signup } from './components/Signup';
import { SitesView } from './components/SitesView';
import { Toaster } from './components/Toast';
import { TopBar } from './components/TopBar';

export default function App() {
  const t = useT();
  const me = useStore((s) => s.me);
  const booting = useStore((s) => s.booting);
  const bootError = useStore((s) => s.bootError);
  const init = useStore((s) => s.init);

  // 登录前路由（/login、/signup[?invite]）：不调 /api/me（避免 401 跳转死循环）
  const path = location.pathname;
  const onPreAuth = path === '/login' || path === '/signup';

  useEffect(() => {
    if (!onPreAuth) void init();
  }, [init, onPreAuth]);

  if (path === '/login') {
    return (
      <>
        <CornerLang />
        <Login />
      </>
    );
  }
  if (path === '/signup') {
    const invite = new URLSearchParams(location.search).get('invite');
    return (
      <>
        <CornerLang />
        {invite ? <AcceptInvite token={invite} /> : <Signup />}
      </>
    );
  }

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-2 text-ink-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">{t('app.loading')}</span>
        </div>
      </div>
    );
  }

  if (bootError || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <CornerLang />
        <div className="max-w-sm rounded-card border border-red-200 bg-white p-8 text-center shadow-card">
          <div className="text-2xl">🫥</div>
          <p className="mt-3 text-sm font-semibold text-ink-700">{t('app.failedToLoad')}</p>
          <p className="mt-1 text-xs text-ink-400">{bootError ?? t('app.unknownError')}</p>
          <button type="button" className="btn-primary mt-5" onClick={() => location.reload()}>
            {t('common.retry')}
          </button>
        </div>
      </div>
    );
  }

  // 设备授权确认（/activate）：登录态已确立即可批准,不强制先设 handle（铸 token 不依赖 handle）。
  if (path === '/activate') {
    return (
      <>
        <CornerLang />
        <Activate />
        <Toaster />
      </>
    );
  }

  // 登录后子路由（handle 未设时一律先走首登）。Settings/Admin 自带页头（无全局 TopBar）。
  if (!me.needs_handle && path === '/settings') {
    return (
      <>
        <Settings />
        <Toaster />
        <Confirmer />
      </>
    );
  }
  if (!me.needs_handle && path === '/admin' && me.is_admin) {
    return (
      <>
        <Admin />
        <Toaster />
        <Confirmer />
      </>
    );
  }

  return (
    <div className="min-h-screen">
      <TopBar />
      {me.needs_handle ? <HandleSetup /> : <SitesView />}
      <Toaster />
      <Confirmer />
      <footer className="pb-8 pt-4 text-center text-xs text-ink-300">{t('app.footer')}</footer>
    </div>
  );
}
