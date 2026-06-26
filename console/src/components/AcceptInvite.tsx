import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, Lock, UserPlus } from 'lucide-react';
import { acceptInvite, fetchInviteInfo } from '../api';
import { EMAIL_RE } from '../types';

/** 接受邀请屏（/signup?invite=<token>）：校验邀请 → 设密码建号并登录。handle 仍走首登确认。 */
export function AcceptInvite({ token }: { token: string }) {
  const [info, setInfo] = useState<{
    ok: boolean;
    email?: string | null;
    is_admin?: boolean;
    reason?: string;
  } | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchInviteInfo(token).then((r) => {
      if (!cancelled) setInfo(r);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (info === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-ink-400" />
      </div>
    );
  }

  if (!info.ok) {
    const network = info.reason === 'network';
    const closed = info.reason === 'closed';
    const title = network
      ? "Couldn't load this invite"
      : closed
        ? 'Registration is closed'
        : "This invite can't be used";
    const body = network
      ? "We couldn't reach the server. Check your connection and try again."
      : closed
        ? 'This instance has stopped accepting new accounts. Ask an admin to re-open registration.'
        : 'Invite links are one-time and expire after a short window. This one has already been used or has passed its window.';
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md animate-fade-up rounded-card border border-ink-200 bg-white p-7 text-center shadow-login">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-panel bg-red-50 text-red-500">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <h1 className="mt-4 text-[19px] font-bold tracking-tight text-ink-900">{title}</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{body}</p>
          {network ? (
            <button
              type="button"
              className="btn-primary mt-5 w-full !py-2.5"
              onClick={() => location.reload()}
            >
              Try again
            </button>
          ) : (
            <a href="/login" className="btn-primary mt-5 w-full !py-2.5">
              Go to sign in
            </a>
          )}
        </div>
      </div>
    );
  }

  const lockedEmail = info.email ?? null;
  const touched = password.length > 0 || confirm.length > 0;
  const tooShort = touched && password.length < 8;
  const mismatch = touched && confirm.length > 0 && password !== confirm;
  const emailOk = lockedEmail !== null || EMAIL_RE.test(email.trim());
  const ready = emailOk && password.length >= 8 && password === confirm;

  const submit = () => {
    if (!ready || submitting) return;
    setSubmitting(true);
    setError(null);
    acceptInvite(token, password, { email: lockedEmail ? undefined : email.trim() })
      .then(() => {
        location.href = '/';
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Could not create account');
        setSubmitting(false);
      });
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md animate-fade-up rounded-card border border-ink-200 bg-white p-7 shadow-login">
        <div className="flex h-11 w-11 items-center justify-center rounded-panel bg-tide-50 text-tide-600">
          <UserPlus className="h-5 w-5" />
        </div>
        <div className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-tide-600">
          You&apos;re invited{info.is_admin ? ' · as admin' : ''}
        </div>
        <h1 className="mt-1 text-[19px] font-bold tracking-tight text-ink-900">
          Set a password to join
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
          {lockedEmail
            ? 'Your account will be created with the email your invite was sent to.'
            : 'Choose the email and password for your new account.'}
        </p>

        <div className="mt-5 space-y-2.5">
          {lockedEmail ? (
            <div className="flex items-center justify-between rounded-field border border-ink-200 bg-ink-50 px-3 py-2">
              <span className="truncate text-sm text-ink-600">{lockedEmail}</span>
              <span className="flex shrink-0 items-center gap-1 text-xs text-ink-400">
                <Lock className="h-3 w-3" /> From invite
              </span>
            </div>
          ) : (
            <input
              className="input"
              type="email"
              placeholder="you@email.com"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
          <input
            className={`input ${tooShort ? 'border-red-300 focus:border-red-400 focus:ring-red-500/10' : ''}`}
            type="password"
            placeholder="At least 8 characters"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <input
            className={`input ${mismatch ? 'border-red-300 focus:border-red-400 focus:ring-red-500/10' : ''}`}
            type="password"
            placeholder="Re-enter password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>

        <div className="mt-2 min-h-[18px] text-xs">
          {error ? (
            <span className="text-red-600">{error}</span>
          ) : tooShort ? (
            <span className="text-red-600">Password must be at least 8 characters.</span>
          ) : mismatch ? (
            <span className="text-red-600">Passwords don&apos;t match.</span>
          ) : ready ? (
            <span className="flex items-center gap-1 text-tide-700">
              <Check className="h-3.5 w-3.5" /> Looks good — ready to create your account.
            </span>
          ) : null}
        </div>

        <button
          type="button"
          className="btn-primary mt-2 w-full !py-2.5"
          disabled={!ready || submitting}
          onClick={submit}
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Create account &amp; sign in
        </button>
      </div>
    </div>
  );
}
