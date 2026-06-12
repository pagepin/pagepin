import { useEffect, useRef, useState } from 'react';
import { AtSign, Check, Loader2, X } from 'lucide-react';
import { api, ApiError } from '../api';
import { useStore } from '../store';
import { toast, toastError } from './Toast';
import { HANDLE_RE } from '../types';

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function runCheck(value: string) {
    window.clearTimeout(timer.current);
    if (!value) {
      setCheck({ kind: 'idle' });
      return;
    }
    if (!HANDLE_RE.test(value)) {
      setCheck({ kind: 'bad', reason: '2-32 位小写字母 / 数字 / 中划线，且以字母开头' });
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
          else setCheck({ kind: 'bad', reason: r.reason || '不可用' });
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
      toast(`你的 handle 已设为 @${confirmed}`);
      void refreshSites();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setCheck({ kind: 'bad', reason: '已被占用，换一个试试' });
      } else if (e instanceof ApiError && e.status === 422) {
        setCheck({ kind: 'bad', reason: '格式不正确' });
      } else {
        toastError(e);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = check.kind === 'ok' && !submitting;

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="w-full max-w-md animate-fade-up rounded-2xl border border-stone-200 bg-white p-8 shadow-card">
        <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-xl bg-tide-50 text-tide-600">
          <AtSign className="h-5 w-5" />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-stone-900">先取一个 handle</h1>
        <p className="mt-2 text-sm leading-relaxed text-stone-500">
          它会出现在你所有页面的分享链接里：
          <br />
          <span className="font-mono text-xs text-stone-600">
            {me?.content_base ?? ''}/
            <span className="rounded bg-tide-50 px-1 py-0.5 font-semibold text-tide-700">
              {handle || 'your-handle'}
            </span>
            /&lt;slug&gt;/
          </span>
        </p>

        <div className="relative mt-6">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-mono text-sm text-stone-400">
            @
          </span>
          <input
            className="input pl-8 font-mono"
            value={handle}
            placeholder="例如 zhang-san"
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
            {check.kind === 'checking' && (
              <Loader2 className="h-4 w-4 animate-spin text-stone-400" />
            )}
            {check.kind === 'ok' && <Check className="h-4 w-4 text-tide-600" />}
            {check.kind === 'bad' && <X className="h-4 w-4 text-red-500" />}
          </span>
        </div>

        <div className="mt-2 min-h-[20px] text-xs">
          {check.kind === 'bad' && <span className="text-red-600">{check.reason}</span>}
          {check.kind === 'ok' && <span className="text-tide-700">这个名字可以用</span>}
          {check.kind !== 'bad' && check.kind !== 'ok' && (
            <span className="text-stone-400">
              2-32 位小写字母 / 数字 / 中划线，以字母开头
            </span>
          )}
        </div>

        <button
          type="button"
          className="btn-primary mt-5 w-full"
          disabled={!canSubmit}
          onClick={() => void submit()}
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          确认使用 @{handle || '…'}
        </button>
        <p className="mt-3 text-center text-xs text-amber-700/80">
          确认后不可修改，请谨慎选择
        </p>
      </div>
    </div>
  );
}
