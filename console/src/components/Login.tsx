import { useEffect, useState, type ReactNode } from 'react';
import { KeyRound, Loader2, LogIn, UserPlus } from 'lucide-react';
import { fetchAuthConfig, login, signup } from '../api';
import type { AuthConfig } from '../types';
import { Turnstile } from './Turnstile';

/** 品牌标(lucide 已去掉品牌图标,内联 SVG)。 */
function GoogleMark() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.55-5.17 3.55-8.87Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.08 7.95-2.91l-3.88-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.62H1.29a12 12 0 0 0 0 10.76l3.98-3.09Z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75Z" />
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
const PROVIDER_META: Record<string, { label: string; icon: ReactNode }> = {
  google: { label: 'Continue with Google', icon: <GoogleMark /> },
  github: { label: 'Continue with GitHub', icon: <GithubMark /> },
};

/** 社交登录按钮区:每家一条,跳服务端 /auth/social/<id>。 */
function SocialButtons({ providers, next }: { providers: string[]; next: string }) {
  if (!providers.length) return null;
  return (
    <div className="space-y-2.5">
      {providers.map((id) => {
        const meta = PROVIDER_META[id] ?? { label: `Continue with ${id}`, icon: <LogIn className="h-4 w-4" /> };
        return (
          <button
            key={id}
            type="button"
            className="flex w-full items-center justify-center gap-2.5 rounded-panel border border-ink-200 bg-white px-3 py-2.5 text-sm font-semibold text-ink-700 transition hover:border-tide-400 hover:text-tide-700"
            onClick={() => {
              location.href = '/auth/social/' + encodeURIComponent(id) + '?next=' + encodeURIComponent(next);
            }}
          >
            {meta.icon}
            {meta.label}
          </button>
        );
      })}
    </div>
  );
}

/** 居中"or"分隔线。 */
function OrDivider() {
  return (
    <div className="my-4 flex items-center gap-3 text-[11px] uppercase tracking-wide text-ink-400">
      <span className="h-px flex-1 bg-ink-100" />
      or
      <span className="h-px flex-1 bg-ink-100" />
    </div>
  );
}

/** 登录 / 注册页（password 模式）。oidc/none 模式只展示一个 SSO 登录入口。
 *  password 模式 + 配了社交 provider 时,密码表单上方加社交登录按钮。
 *  本页不调 /api/me，避免 401 跳转死循环。 */
export function Login() {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileKey, setTurnstileKey] = useState(0);

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
    if (config?.turnstile_site_key && !turnstileToken) {
      setError('Please complete the verification below');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (mode === 'signup') {
        await signup(email.trim(), password, displayName, turnstileToken);
      } else {
        await login(email.trim(), password, turnstileToken);
      }
      location.href = next;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
      setSubmitting(false);
      // token 一次性，失败后重置以重新挑战
      setTurnstileToken('');
      setTurnstileKey((k) => k + 1);
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

  const social = config.social_providers ?? [];

  // oidc / none：单 SSO 登录入口(配了社交 provider 时一并列出)
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
          {social.length > 0 && (
            <div className="mt-5">
              <SocialButtons providers={social} next={next} />
              <OrDivider />
            </div>
          )}
          <button
            type="button"
            className={`btn-primary w-full !py-2.5${social.length ? '' : ' mt-5'}`}
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

        {social.length > 0 && (
          <div className="mt-5">
            <SocialButtons providers={social} next={next} />
            <OrDivider />
          </div>
        )}

        <div className={`space-y-2.5${social.length ? '' : ' mt-5'}`}>
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

        {config.turnstile_site_key && (
          <Turnstile
            key={turnstileKey}
            siteKey={config.turnstile_site_key}
            onToken={setTurnstileToken}
          />
        )}

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
