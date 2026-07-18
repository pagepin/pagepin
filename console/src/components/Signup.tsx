import { useEffect, useState } from 'react';
import { Loader2, Lock, UserPlus } from 'lucide-react';
import { fetchAuthConfig, signup } from '../api';
import { useT } from '../i18n';
import { EMAIL_RE, type AuthConfig } from '../types';
import { OrDivider, SocialButtons } from './SocialButtons';
import { Turnstile } from './Turnstile';

/** Open 模式自助注册屏（/signup，无 invite 参数）。仅 registration_mode==='open' 放行;
 *  否则显示「注册未开放」。handle 走首登确认。 */
export function Signup() {
  const t = useT();
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [probing, setProbing] = useState(true);
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

  // 已登录探测(裸 fetch,避开 api 层 401 重定向):有会话直接进控制台
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/me', { credentials: 'same-origin' })
      .then((r) => {
        if (cancelled) return;
        if (r.ok) location.replace('/');
        else setProbing(false);
      })
      .catch(() => {
        if (!cancelled) setProbing(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!config || probing) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-ink-400" />
      </div>
    );
  }

  const open = config.mode === 'password' && config.registration_mode === 'open';
  const social = config.social_providers ?? [];

  if (!open) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md animate-fade-up rounded-card border border-ink-200 bg-white p-7 text-center shadow-login">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-panel bg-ink-100 text-ink-500">
            <Lock className="h-5 w-5" />
          </div>
          <h1 className="mt-4 text-[19px] font-bold tracking-tight text-ink-900">
            {t('auth.registrationClosed')}
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
            {config.registration_mode === 'invite'
              ? t('auth.inviteOnly')
              : t('auth.signupsDisabled')}
          </p>
          <a href="/login" className="btn-primary mt-5 w-full !py-2.5">
            {t('auth.goToSignIn')}
          </a>
        </div>
      </div>
    );
  }

  const tooShort = password.length > 0 && password.length < 8;
  const needsTurnstile = !!config.turnstile_site_key;
  const ready =
    EMAIL_RE.test(email.trim()) && password.length >= 8 && (!needsTurnstile || !!turnstileToken);
  const submit = () => {
    if (!ready || submitting) return;
    setSubmitting(true);
    setError(null);
    signup(email.trim(), password, displayName, turnstileToken)
      .then(() => {
        location.href = '/';
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : t('auth.couldNotSignUp'));
        setSubmitting(false);
        // token 一次性，失败后重置以重新挑战
        setTurnstileToken('');
        setTurnstileKey((k) => k + 1);
      });
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md animate-fade-up rounded-card border border-ink-200 bg-white p-7 shadow-login">
        <div className="flex h-11 w-11 items-center justify-center rounded-panel bg-tide-50 text-tide-600">
          <UserPlus className="h-5 w-5" />
        </div>
        <h1 className="mt-4 text-[19px] font-bold tracking-tight text-ink-900">
          {t('auth.createAccountTitle')}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{t('auth.signupSubtitle')}</p>

        {social.length > 0 && (
          <div className="mt-5">
            <SocialButtons providers={social} next="/" />
            <OrDivider />
          </div>
        )}

        <div className={social.length ? 'space-y-2.5' : 'mt-5 space-y-2.5'}>
          <input
            className="input"
            type="email"
            placeholder={t('auth.emailExamplePlaceholder')}
            autoFocus
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className={`input ${tooShort ? 'border-red-300 focus:border-red-400 focus:ring-red-500/10' : ''}`}
            type="password"
            placeholder={t('auth.passwordMinPlaceholder')}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <input
            className="input"
            type="text"
            placeholder={t('auth.displayNamePlaceholder')}
            maxLength={64}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>

        {config.turnstile_site_key && (
          <Turnstile
            key={turnstileKey}
            siteKey={config.turnstile_site_key}
            onToken={setTurnstileToken}
          />
        )}

        <div className="mt-2 min-h-[18px] text-xs">
          {error ? (
            <span className="text-red-600">{error}</span>
          ) : tooShort ? (
            <span className="text-red-600">{t('auth.passwordMin8Period')}</span>
          ) : null}
        </div>

        <button
          type="button"
          className="btn-primary mt-2 w-full !py-2.5"
          disabled={!ready || submitting}
          onClick={submit}
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {t('auth.signUp')}
        </button>

        <p className="mt-4 text-center text-xs text-ink-400">
          {t('auth.alreadyHaveAccount')}
          <a
            href="/login"
            className="ml-1 font-semibold text-tide-600 underline underline-offset-2 hover:text-tide-700"
          >
            {t('auth.signIn')}
          </a>
        </p>
      </div>
    </div>
  );
}
