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
      setError('Please enter your email and password');
      return;
    }
    if (mode === 'signup' && password.length < 8) {
      setError('Password must be at least 8 characters');
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
      setError(e instanceof Error ? e.message : 'Request failed');
      setSubmitting(false);
    }
  }

  if (!config) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-2 text-ink-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading pagepin…</span>
        </div>
      </div>
    );
  }

  // oidc / none：整卡只有一个 SSO 登录入口
  if (config.mode !== 'password') {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md animate-fade-up rounded-card border border-ink-200 bg-white p-7 shadow-login">
          <div className="flex h-11 w-11 items-center justify-center rounded-panel bg-tide-50 text-tide-600">
            <LogIn className="h-5 w-5" />
          </div>
          <h1 className="mt-4 text-[19px] font-bold tracking-tight text-ink-900">
            Sign in to pagepin
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
            This instance uses single sign-on. Continue with your identity provider.
          </p>
          <button
            type="button"
            className="btn-primary mt-5 w-full !py-2.5"
            onClick={() => {
              location.href = '/auth/login?next=' + encodeURIComponent(next);
            }}
          >
            <LogIn className="h-4 w-4" />
            Continue with SSO
          </button>
          <div className="mt-4 border-t border-ink-100 pt-3.5 text-center text-[11px] text-ink-400">
            Configured via{' '}
            <span className="font-mono text-ink-500">AUTH_MODE={config.mode}</span>
          </div>
        </div>
      </div>
    );
  }

  const isSignup = mode === 'signup';

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md animate-fade-up rounded-card border border-ink-200 bg-white p-7 shadow-login">
        <div className="flex h-11 w-11 items-center justify-center rounded-panel bg-tide-50 text-tide-600">
          {isSignup ? <UserPlus className="h-5 w-5" /> : <KeyRound className="h-5 w-5" />}
        </div>
        <h1 className="mt-4 text-[19px] font-bold tracking-tight text-ink-900">
          {isSignup ? 'Create your account' : 'Sign in to pagepin'}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
          {isSignup
            ? 'Host static pages and collect pin-point review comments.'
            : 'Use your email and password.'}
        </p>

        <div className="mt-5 space-y-2.5">
          <input
            className="input"
            type="email"
            placeholder="Email"
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
            placeholder={isSignup ? 'At least 8 characters' : 'Password'}
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
              placeholder="Display name (optional)"
              maxLength={64}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
            />
          )}
        </div>

        <div className="mt-2 min-h-[18px] text-xs">
          {error && <span className="text-red-600">{error}</span>}
        </div>

        <button
          type="button"
          className="btn-primary mt-2 w-full !py-2.5"
          disabled={submitting}
          onClick={() => void submit()}
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {isSignup ? 'Sign up' : 'Sign in'}
        </button>

        {config.allow_signup && (
          <p className="mt-4 text-center text-xs text-ink-400">
            {isSignup ? 'Already have an account?' : 'No account yet?'}
            <button
              type="button"
              className="ml-1 font-semibold text-tide-600 underline underline-offset-2 hover:text-tide-700"
              onClick={() => {
                setMode(isSignup ? 'login' : 'signup');
                setError(null);
              }}
            >
              {isSignup ? 'Sign in' : 'Sign up'}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
