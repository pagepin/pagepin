import { useState } from 'react';
import { AlertTriangle, Check, KeyRound, Loader2 } from 'lucide-react';
import { api } from '../api';
import { useStore } from '../store';

/** 设备授权确认屏(/activate?user_code=XXXX-XXXX)。
 * 由 App.tsx 在登录态确立后渲染 —— 未登录会先被 api 层重定向到 /login?next=/activate…,登录后回到这里。
 * 批准只调 /api/device/approve;明文 token 经发起方轮询交付,本页永远不展示 token。 */
export function Activate() {
  const me = useStore((s) => s.me);
  const userCode = (new URLSearchParams(location.search).get('user_code') ?? '').trim().toUpperCase();
  const [phase, setPhase] = useState<'idle' | 'working' | 'approved' | 'denied' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const who = me?.handle ?? me?.email ?? 'your account';

  const card = (children: React.ReactNode) => (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md animate-fade-up rounded-card border border-ink-200 bg-white p-7 text-center shadow-login">
        {children}
      </div>
    </div>
  );

  if (!userCode) {
    return card(
      <>
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-panel bg-red-50 text-red-500">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <h1 className="mt-4 text-[19px] font-bold tracking-tight text-ink-900">Missing device code</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
          Open the link your tool printed, or start the login again from your terminal.
        </p>
      </>,
    );
  }

  if (phase === 'approved') {
    return card(
      <>
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-panel bg-tide-50 text-tide-600">
          <Check className="h-5 w-5" />
        </div>
        <h1 className="mt-4 text-[19px] font-bold tracking-tight text-ink-900">Approved</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
          Return to your terminal — the token has been delivered to the tool that started this. You can close this tab.
        </p>
      </>,
    );
  }

  if (phase === 'denied') {
    return card(
      <>
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-panel bg-ink-50 text-ink-500">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <h1 className="mt-4 text-[19px] font-bold tracking-tight text-ink-900">Request denied</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
          No token was issued. If this was you, start the login again from your tool.
        </p>
      </>,
    );
  }

  const approve = () => {
    setPhase('working');
    setError(null);
    api
      .approveDevice(userCode)
      .then(() => setPhase('approved'))
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Approval failed');
        setPhase('error');
      });
  };

  const deny = () => {
    setPhase('working');
    setError(null);
    api
      .denyDevice(userCode)
      .then(() => setPhase('denied'))
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Could not deny');
        setPhase('error');
      });
  };

  const working = phase === 'working';

  return card(
    <>
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-panel bg-tide-50 text-tide-600">
        <KeyRound className="h-5 w-5" />
      </div>
      <div className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-tide-600">
        Device authorization
      </div>
      <h1 className="mt-1 text-[19px] font-bold tracking-tight text-ink-900">Approve this sign-in?</h1>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
        A tool is requesting an API token for <span className="font-semibold text-ink-700">{who}</span>. Only
        approve if the code below matches what your tool is showing.
      </p>

      <div className="mt-4 rounded-field border border-ink-200 bg-ink-50 px-3 py-2.5 text-center font-mono text-lg font-semibold tracking-[0.3em] text-ink-800">
        {userCode}
      </div>

      <div className="mt-2 min-h-[18px] text-xs">
        {error && <span className="text-red-600">{error}</span>}
      </div>

      <div className="mt-2 flex gap-2">
        <button type="button" className="btn-primary flex-1 !py-2.5" disabled={working} onClick={approve}>
          {working && <Loader2 className="h-4 w-4 animate-spin" />}
          Approve
        </button>
        <button
          type="button"
          className="flex-1 rounded-field border border-ink-200 bg-white px-3 py-2.5 text-sm font-medium text-ink-600 hover:bg-ink-50 disabled:opacity-50"
          disabled={working}
          onClick={deny}
        >
          Deny
        </button>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-ink-400">
        The token is delivered straight to the tool that started this — it is never shown here or pasted into a chat.
      </p>
    </>,
  );
}
