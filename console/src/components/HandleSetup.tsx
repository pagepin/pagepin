import { useEffect, useRef, useState } from 'react';
import { AtSign, Check, Loader2, AlertTriangle, Mail, X } from 'lucide-react';
import { api, ApiError } from '../api';
import { useT } from '../i18n';
import { useStore } from '../store';
import { toast, toastError } from './Toast';
import { HANDLE_RE } from '../types';

/** 未验证邮箱(can_publish=false)时挡在 handle 之前:claim handle / 建站 / 发 token 都要求先验证。 */
function VerifyEmailGate({ email }: { email: string }) {
  const t = useT();
  const [sending, setSending] = useState(false);
  const resend = () => {
    setSending(true);
    api
      .resendVerifyEmail()
      .then((r) => toast(r.sent ? t('auth.verifyEmailSent') : t('auth.emailSendingNotConfigured')))
      .catch((e) => toastError(e, t('auth.couldNotSend')))
      .finally(() => setSending(false));
  };
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="w-full max-w-md animate-fade-up rounded-card border border-ink-200 bg-white p-7 shadow-login">
        <div className="flex h-11 w-11 items-center justify-center rounded-panel bg-amber-50 text-amber-600">
          <Mail className="h-5 w-5" />
        </div>
        <h1 className="mt-4 text-[19px] font-bold tracking-tight text-ink-900">
          {t('auth.verifyEmailTitle')}
        </h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-500">
          {t('auth.verifyEmailBodyBefore')}
          <span className="font-mono text-ink-700">{email}</span>
          {t('auth.verifyEmailBodyAfter')}
        </p>
        <button
          type="button"
          className="btn-primary mt-5 w-full !py-2.5"
          disabled={sending}
          onClick={resend}
        >
          {sending && <Loader2 className="h-4 w-4 animate-spin" />}
          {t('auth.resendVerifyEmail')}
        </button>
        <p className="mt-3 text-center text-[11px] text-ink-400">
          {t('auth.alreadyClickedReload')}
        </p>
      </div>
    </div>
  );
}

type CheckState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'ok' }
  | { kind: 'bad'; reason: string };

export function HandleSetup() {
  const t = useT();
  const me = useStore((s) => s.me);
  const setMe = useStore((s) => s.setMe);
  const refreshSites = useStore((s) => s.refreshSites);

  const [handle, setHandle] = useState('');
  const [check, setCheck] = useState<CheckState>({ kind: 'idle' });
  const [submitting, setSubmitting] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const seq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void api
      .suggestHandle()
      .then(({ suggestion }) => {
        if (!cancelled && suggestion) {
          setHandle(suggestion);
          runCheck(suggestion);
        }
      })
      .catch(() => {
        /* 建议失败不阻塞 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function runCheck(value: string) {
    window.clearTimeout(timer.current);
    if (!value) {
      setCheck({ kind: 'idle' });
      return;
    }
    if (!HANDLE_RE.test(value)) {
      setCheck({ kind: 'bad', reason: t('auth.handleHint') });
      return;
    }
    setCheck({ kind: 'checking' });
    const mySeq = ++seq.current;
    timer.current = window.setTimeout(() => {
      void api
        .checkHandle(value)
        .then((r) => {
          if (seq.current !== mySeq) return;
          if (r.ok) setCheck({ kind: 'ok' });
          else {
            // 服务端 reason 是稳定 code(taken / invalid),按 locale 翻译
            const reason =
              r.reason === 'taken'
                ? t('auth.handleTaken')
                : r.reason === 'invalid'
                  ? t('auth.handleInvalidFormat')
                  : t('auth.handleNotAvailable');
            setCheck({ kind: 'bad', reason });
          }
        })
        .catch(() => {
          if (seq.current === mySeq) setCheck({ kind: 'idle' });
        });
    }, 300);
  }

  async function submit() {
    if (!HANDLE_RE.test(handle) || submitting) return;
    setSubmitting(true);
    try {
      const { handle: confirmed } = await api.setHandle(handle);
      if (me) setMe({ ...me, handle: confirmed, needs_handle: false });
      toast(t('auth.handleSet', { handle: confirmed }));
      void refreshSites();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setCheck({ kind: 'bad', reason: t('auth.handleTaken') });
      } else if (e instanceof ApiError && e.status === 422) {
        setCheck({ kind: 'bad', reason: t('auth.handleInvalidFormat') });
      } else {
        toastError(e);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = check.kind === 'ok' && !submitting;

  // 未验证邮箱 → 先验证,再来 claim handle(后端 /api/me/handle 也会 403 兜底)
  if (me && !me.can_publish) {
    return <VerifyEmailGate email={me.email} />;
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="w-full max-w-md animate-fade-up rounded-card border border-ink-200 bg-white p-7 shadow-login">
        <div className="flex h-11 w-11 items-center justify-center rounded-panel bg-tide-50 text-tide-600">
          <AtSign className="h-5 w-5" />
        </div>
        <h1 className="mt-4 text-[19px] font-bold tracking-tight text-ink-900">
          {t('auth.pickHandleTitle')}
        </h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-500">
          {t('auth.handleAppearsIn')}
          <br />
          <span className="font-mono text-xs text-ink-600">
            {me?.content_base ?? ''}/
            <span className="rounded bg-tide-50 px-1 py-0.5 font-semibold text-tide-700">
              {handle || t('auth.yourHandlePlaceholder')}
            </span>
            /&lt;slug&gt;/
          </span>
        </p>

        <div className="relative mt-5">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-mono text-sm text-ink-400">
            @
          </span>
          <input
            className="input pl-8 font-mono"
            value={handle}
            placeholder={t('auth.yourHandlePlaceholder')}
            autoFocus
            maxLength={32}
            onChange={(e) => {
              const v = e.target.value.toLowerCase();
              setHandle(v);
              runCheck(v);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
          />
          <span className="absolute inset-y-0 right-3 flex items-center">
            {check.kind === 'checking' && <Loader2 className="h-4 w-4 animate-spin text-ink-400" />}
            {check.kind === 'ok' && <Check className="h-4 w-4 text-tide-600" />}
            {check.kind === 'bad' && <X className="h-4 w-4 text-red-500" />}
          </span>
        </div>

        <div className="mt-2 min-h-[18px] text-xs">
          {check.kind === 'bad' && <span className="text-red-600">{check.reason}</span>}
          {check.kind === 'ok' && (
            <span className="text-tide-700">{t('auth.handleAvailable')}</span>
          )}
          {check.kind !== 'bad' && check.kind !== 'ok' && (
            <span className="text-ink-400">{t('auth.handleHint')}</span>
          )}
        </div>

        <button
          type="button"
          className="btn-primary mt-4 w-full !py-2.5"
          disabled={!canSubmit}
          onClick={() => void submit()}
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {t('auth.claimHandle', { handle: handle || '…' })}
        </button>
        <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[11px] text-amber-700">
          <AlertTriangle className="h-3 w-3" />
          {t('auth.handleImmutable')}
        </p>
      </div>
    </div>
  );
}
