import { useEffect, useState } from 'react';
import { KeyRound, Loader2, LogIn, UserPlus } from 'lucide-react';
import { fetchAuthConfig, login, signup } from '../api';
import type { AuthConfig } from '../types';

/** 登录 / 注册页（password 模式）。oidc/none 模式只展示一个 SSO 登录入口。
 *  本页不调 /api/me，避免 401 跳转死循环。 */
export function Login() {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchAuthConfig().then((c) => {
      if (!cancelled) setConfig(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 只允许站内相对路径,防 open redirect / javascript: URI(与服务端 safeNext 同规则)
  const rawNext = new URLSearchParams(location.search).get('next') || '/';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';

  async function submit() {
    if (submitting) return;
    if (!email.trim() || !password) {
      setError('请输入邮箱和密码');
      return;
    }
    if (mode === 'signup' && password.length < 8) {
      setError('密码至少 8 位');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (mode === 'signup') {
        await signup(email.trim(), password, displayName);
      } else {
        await login(email.trim(), password);
      }
      location.href = next;
    } catch (e) {
      setError(e instanceof Error ? e.message : '请求失败');
      setSubmitting(false);
    }
  }

  if (!config) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-2 text-stone-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">正在进入 pagepin…</span>
        </div>
      </div>
    );
  }

  // oidc / none：整卡只有一个 SSO 登录入口
  if (config.mode !== 'password') {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md animate-fade-up rounded-2xl border border-stone-200 bg-white p-8 shadow-card">
          <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-xl bg-tide-50 text-tide-600">
            <LogIn className="h-5 w-5" />
          </div>
          <h1 className="mt-4 text-xl font-semibold text-stone-900">登录 pagepin</h1>
          <p className="mt-2 text-sm leading-relaxed text-stone-500">
            使用单点登录（SSO）继续。
          </p>
          <button
            type="button"
            className="btn-primary mt-6 w-full"
            onClick={() => {
              location.href = '/auth/login?next=' + encodeURIComponent(next);
            }}
          >
            <LogIn className="h-4 w-4" />
            使用 SSO 登录
          </button>
        </div>
      </div>
    );
  }

  const isSignup = mode === 'signup';

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md animate-fade-up rounded-2xl border border-stone-200 bg-white p-8 shadow-card">
        <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-xl bg-tide-50 text-tide-600">
          {isSignup ? <UserPlus className="h-5 w-5" /> : <KeyRound className="h-5 w-5" />}
        </div>
        <h1 className="mt-4 text-xl font-semibold text-stone-900">
          {isSignup ? '注册 pagepin' : '登录 pagepin'}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-stone-500">
          {isSignup ? '创建账号，开始托管你的静态页面。' : '使用邮箱和密码登录。'}
        </p>

        <div className="mt-6 space-y-3">
          <input
            className="input"
            type="email"
            placeholder="邮箱"
            autoFocus
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
          />
          <input
            className="input"
            type="password"
            placeholder={isSignup ? '密码（至少 8 位）' : '密码'}
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
          />
          {isSignup && (
            <input
              className="input"
              type="text"
              placeholder="显示名（可选）"
              maxLength={64}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
            />
          )}
        </div>

        <div className="mt-2 min-h-[20px] text-xs">
          {error && <span className="text-red-600">{error}</span>}
        </div>

        <button
          type="button"
          className="btn-primary mt-3 w-full"
          disabled={submitting}
          onClick={() => void submit()}
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {isSignup ? '注册并登录' : '登录'}
        </button>

        {config.allow_signup && (
          <p className="mt-4 text-center text-xs text-stone-400">
            {isSignup ? '已有账号？' : '还没有账号？'}
            <button
              type="button"
              className="ml-1 text-tide-600 underline hover:text-tide-700"
              onClick={() => {
                setMode(isSignup ? 'login' : 'signup');
                setError(null);
              }}
            >
              {isSignup ? '去登录' : '注册'}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
