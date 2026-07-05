import { useState } from 'react';
import { AlertTriangle, Check, KeyRound, Loader2 } from 'lucide-react';
import { api } from '../api';
import { useT } from '../i18n';
import { useStore } from '../store';
import { HandleSetup } from './HandleSetup';

/** 设备授权确认屏(/activate?user_code=XXXX-XXXX)。
 * 由 App.tsx 在登录态确立后渲染 —— 未登录会先被 api 层重定向到 /login?next=/activate…,登录后回到这里。
 * 批准只调 /api/device/approve;明文 token 经发起方轮询交付,本页永远不展示 token。
 * 批准成功后若账号还没 handle,就地内嵌 HandleSetup —— 这是 device flow 里用户唯一必经的
 * 浏览器界面,不拦在这里,用户关掉窗口后 agent 部署就会 409。 */
export function Activate() {
  const t = useT();
  const me = useStore((s) => s.me);
  const userCode = (new URLSearchParams(location.search).get('user_code') ?? '')
    .trim()
    .toUpperCase();
  const [phase, setPhase] = useState<'idle' | 'working' | 'approved' | 'denied' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const who = me?.handle ?? me?.email ?? t('auth.yourAccount');

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
        <h1 className="mt-4 text-[19px] font-bold tracking-tight text-ink-900">
          {t('auth.deviceMissingTitle')}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{t('auth.deviceMissingBody')}</p>
      </>,
    );
  }

  if (phase === 'approved') {
    // 还没 handle:token 已交付,但 deploy 会 409 —— 别让用户带着半成品账号关窗口
    if (me?.needs_handle) {
      return (
        <div className="pb-10">
          <div className="mx-auto mt-10 flex w-full max-w-md items-start gap-2.5 rounded-card border border-tide-200 bg-tide-50 px-4 py-3 text-left">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-tide-600" />
            <div>
              <div className="text-sm font-semibold text-tide-800">
                {t('auth.deviceHandleGateTitle')}
              </div>
              <div className="mt-0.5 text-xs leading-relaxed text-tide-700">
                {t('auth.deviceHandleGateBody')}
              </div>
            </div>
          </div>
          <HandleSetup />
        </div>
      );
    }
    return card(
      <>
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-panel bg-tide-50 text-tide-600">
          <Check className="h-5 w-5" />
        </div>
        <h1 className="mt-4 text-[19px] font-bold tracking-tight text-ink-900">
          {t('auth.deviceApprovedTitle')}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
          {t('auth.deviceApprovedBody')}
        </p>
        <div className="mt-5 rounded-panel border border-ink-200 bg-ink-50 px-4 py-3 text-left">
          <p className="text-xs leading-relaxed text-ink-500">{t('auth.deviceAgentTip')}</p>
          <code className="mt-1.5 block break-all font-mono text-[11px] text-ink-700">
            {`${location.origin}/skill.md`}
          </code>
        </div>
      </>,
    );
  }

  if (phase === 'denied') {
    return card(
      <>
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-panel bg-ink-50 text-ink-500">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <h1 className="mt-4 text-[19px] font-bold tracking-tight text-ink-900">
          {t('auth.deviceDeniedTitle')}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{t('auth.deviceDeniedBody')}</p>
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
        setError(e instanceof Error ? e.message : t('auth.approvalFailed'));
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
        setError(e instanceof Error ? e.message : t('auth.couldNotDeny'));
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
        {t('auth.deviceAuthLabel')}
      </div>
      <h1 className="mt-1 text-[19px] font-bold tracking-tight text-ink-900">
        {t('auth.deviceApproveTitle')}
      </h1>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
        {t('auth.deviceRequestBefore')}
        <span className="font-semibold text-ink-700">{who}</span>
        {t('auth.deviceRequestAfter')}
      </p>

      <div className="mt-4 rounded-field border border-ink-200 bg-ink-50 px-3 py-2.5 text-center font-mono text-lg font-semibold tracking-[0.3em] text-ink-800">
        {userCode}
      </div>

      <div className="mt-2 min-h-[18px] text-xs">
        {error && <span className="text-red-600">{error}</span>}
      </div>

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className="btn-primary flex-1 !py-2.5"
          disabled={working}
          onClick={approve}
        >
          {working && <Loader2 className="h-4 w-4 animate-spin" />}
          {t('auth.approve')}
        </button>
        <button
          type="button"
          className="flex-1 rounded-field border border-ink-200 bg-white px-3 py-2.5 text-sm font-medium text-ink-600 hover:bg-ink-50 disabled:opacity-50"
          disabled={working}
          onClick={deny}
        >
          {t('auth.deny')}
        </button>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-ink-400">{t('auth.deviceTokenNote')}</p>
    </>,
  );
}
