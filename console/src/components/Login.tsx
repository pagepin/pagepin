import { useEffect, useState } from 'react';
import { Loader2, LogIn } from 'lucide-react';
import { fetchAuthConfig, login, signup } from '../api';
import { useT } from '../i18n';
import type { AuthConfig } from '../types';
import { BrandMark } from './BrandMark';
import { OrDivider, SocialButtons } from './SocialButtons';
import { Turnstile } from './Turnstile';

/** 登录 / 注册页（password 模式）。oidc/none 模式只展示一个 SSO 登录入口。
 *  password 模式 + 配了社交 provider 时,密码表单上方加社交登录按钮。
 *  `?mode=signup` 直落注册态(官网 CTA 用),注册未开放时回落登录态。
 *  本页不调 /api/me，避免 401 跳转死循环。 */
export function Login() {
  const t = useT();
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [mode, setMode] = useState<'login' | 'signup'>(() =>
    new URLSearchParams(location.search).get('mode') === 'signup' ? 'signup' : 'login',
  );
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
  // URL 请求的 signup 态只在注册开放时生效(否则回落登录,避免提交必 403 的表单)
  const wantSignup = mode === 'signup' && !!config?.allow_signup;

  async function submit() {
    if (submitting) return;
    if (!email.trim() || !password) {
      setError(t('auth.enterEmailPassword'));
      return;
    }
    if (wantSignup && password.length < 8) {
      setError(t('auth.passwordTooShort'));
      return;
    }
    if (config?.turnstile_site_key && !turnstileToken) {
      setError(t('auth.completeVerification'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (wantSignup) {
        await signup(email.trim(), password, displayName, turnstileToken);
      } else {
        await login(email.trim(), password, turnstileToken);
      }
      location.href = next;
    } catch (e) {
      setError(e instanceof Error ? e.message : t('auth.requestFailed'));
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
          <span className="text-sm">{t('app.loading')}</span>
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
          <BrandMark size={44} />
          <h1 className="mt-4 text-[19px] font-bold tracking-tight text-ink-900">
            {t('auth.signInTitle')}
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{t('auth.ssoDesc')}</p>
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
            {t('auth.continueWithSso')}
          </button>
          <div className="mt-4 border-t border-ink-100 pt-3.5 text-center text-[11px] text-ink-400">
            {t('auth.configuredVia')}{' '}
            <span className="font-mono text-ink-500">AUTH_MODE={config.mode}</span>
          </div>
        </div>
      </div>
    );
  }

  const isSignup = wantSignup;

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md animate-fade-up rounded-card border border-ink-200 bg-white p-7 shadow-login">
        <BrandMark size={44} />
        <h1 className="mt-4 text-[19px] font-bold tracking-tight text-ink-900">
          {isSignup ? t('auth.createAccountTitle') : t('auth.signInTitle')}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
          {isSignup ? t('auth.signupSubtitle') : t('auth.loginSubtitle')}
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
            placeholder={t('auth.emailPlaceholder')}
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
            placeholder={
              isSignup ? t('auth.passwordMinPlaceholder') : t('auth.passwordPlaceholder')
            }
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
              placeholder={t('auth.displayNamePlaceholder')}
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
          {isSignup ? t('auth.signUp') : t('auth.signIn')}
        </button>

        {config.allow_signup && (
          <p className="mt-4 text-center text-xs text-ink-400">
            {isSignup ? t('auth.alreadyHaveAccount') : t('auth.noAccountYet')}
            <button
              type="button"
              className="ml-1 font-semibold text-tide-600 underline underline-offset-2 hover:text-tide-700"
              onClick={() => {
                setMode(isSignup ? 'login' : 'signup');
                setError(null);
              }}
            >
              {isSignup ? t('auth.signIn') : t('auth.signUp')}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
