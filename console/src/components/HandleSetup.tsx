import { useEffect, useRef, useState } from 'react';
import { AtSign, Check, Loader2, AlertTriangle, Mail, X } from 'lucide-react';
import { api, ApiError } from '../api';
import { useStore } from '../store';
import { toast, toastError } from './Toast';
import { HANDLE_RE } from '../types';

const HANDLE_HINT = '2–32 chars: lowercase letters, digits, or hyphens, starting with a letter';

/** 未验证邮箱(can_publish=false)时挡在 handle 之前:claim handle / 建站 / 发 token 都要求先验证。 */
function VerifyEmailGate({ email }: { email: string }) {
  const [sending, setSending] = useState(false);
  const resend = () => {
    setSending(true);
    api
      .resendVerifyEmail()
      .then((r) => toast(r.sent ? 'Verification email sent' : 'Email sending is not configured'))
      .catch((e) => toastError(e, 'Could not send'))
      .finally(() => setSending(false));
  };
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="w-full max-w-md animate-fade-up rounded-card border border-ink-200 bg-white p-7 shadow-login">
        <div className="flex h-11 w-11 items-center justify-center rounded-panel bg-amber-50 text-amber-600">
          <Mail className="h-5 w-5" />
        </div>
        <h1 className="mt-4 text-[19px] font-bold tracking-tight text-ink-900">
          Verify your email first
        </h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-500">
          We sent a link to <span className="font-mono text-ink-700">{email}</span>. Click it to
          confirm your email — then you can pick a handle and publish sites.
        </p>
        <button
          type="button"
          className="btn-primary mt-5 w-full !py-2.5"
          disabled={sending}
          onClick={resend}
        >
          {sending && <Loader2 className="h-4 w-4 animate-spin" />}
          Resend verification email
        </button>
        <p className="mt-3 text-center text-[11px] text-ink-400">
          Already clicked it? Reload this page.
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
      setCheck({ kind: 'bad', reason: HANDLE_HINT });
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
          else setCheck({ kind: 'bad', reason: r.reason || 'Not available' });
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
      toast(`Handle set to @${confirmed}`);
      void refreshSites();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setCheck({ kind: 'bad', reason: 'Already taken — try another' });
      } else if (e instanceof ApiError && e.status === 422) {
        setCheck({ kind: 'bad', reason: 'Invalid format' });
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
        <h1 className="mt-4 text-[19px] font-bold tracking-tight text-ink-900">Pick a handle</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-500">
          It appears in every share link:
          <br />
          <span className="font-mono text-xs text-ink-600">
            {me?.content_base ?? ''}/
            <span className="rounded bg-tide-50 px-1 py-0.5 font-semibold text-tide-700">
              {handle || 'your-handle'}
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
            placeholder="your-handle"
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
          {check.kind === 'ok' && <span className="text-tide-700">That name is available.</span>}
          {check.kind !== 'bad' && check.kind !== 'ok' && (
            <span className="text-ink-400">{HANDLE_HINT}</span>
          )}
        </div>

        <button
          type="button"
          className="btn-primary mt-4 w-full !py-2.5"
          disabled={!canSubmit}
          onClick={() => void submit()}
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Claim @{handle || '…'}
        </button>
        <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[11px] text-amber-700">
          <AlertTriangle className="h-3 w-3" />
          Can&rsquo;t be changed once set.
        </p>
      </div>
    </div>
  );
}
