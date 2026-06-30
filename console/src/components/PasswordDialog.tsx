import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Check, Loader2, Lock, X } from 'lucide-react';
import { api } from '../api';
import { useT } from '../i18n';
import { toast, toastError } from './Toast';

/** 改密码弹窗（仅 password 模式，从 Settings 触发）。只校验长度≥8 + 两次一致。 */
export function PasswordDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const touched = next.length > 0 || confirm.length > 0;
  const tooShort = touched && next.length < 8;
  const mismatch = touched && confirm.length > 0 && next !== confirm;
  const ready = current.length > 0 && next.length >= 8 && next === confirm;

  const submit = () => {
    if (!ready || submitting) return;
    setSubmitting(true);
    api
      .changePassword(current, next)
      .then(() => {
        toast(t('core.passwordUpdated'));
        onClose();
      })
      .catch((e) => {
        toastError(e, t('core.passwordUpdateFailed'));
        setSubmitting(false);
      });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/55 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-card border border-ink-200 bg-white p-6 shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-ink-800">
            <Lock className="h-4 w-4 text-tide-600" />
            <span className="text-sm font-bold">{t('core.changePassword')}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-chip p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-2.5">
          <input
            className="input"
            type="password"
            placeholder={t('core.currentPasswordPlaceholder')}
            autoFocus
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
          <input
            className={`input ${tooShort ? 'border-red-300 focus:border-red-400 focus:ring-red-500/10' : ''}`}
            type="password"
            placeholder={t('core.newPasswordPlaceholder')}
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          <input
            className={`input ${mismatch ? 'border-red-300 focus:border-red-400 focus:ring-red-500/10' : ''}`}
            type="password"
            placeholder={t('core.confirmPasswordPlaceholder')}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>

        <div className="mt-2 flex min-h-[18px] items-center gap-1 text-xs">
          {tooShort ? (
            <span className="flex items-center gap-1 text-red-600">
              <AlertCircle className="h-3.5 w-3.5" /> {t('core.passwordTooShort')}
            </span>
          ) : mismatch ? (
            <span className="flex items-center gap-1 text-red-600">
              <AlertCircle className="h-3.5 w-3.5" /> {t('core.passwordMismatch')}
            </span>
          ) : ready ? (
            <span className="flex items-center gap-1 text-tide-700">
              <Check className="h-3.5 w-3.5" /> {t('core.passwordsMatch')}
            </span>
          ) : null}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!ready || submitting}
            onClick={submit}
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('core.updatePassword')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
