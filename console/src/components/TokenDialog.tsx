import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { KeyRound, X } from 'lucide-react';
import { useT } from '../i18n';
import { TokenManager } from './TokenManager';

/** API Token 管理弹窗（TopBar 快捷入口）。内容复用 TokenManager；Settings 页内联同一组件。
 *  ★ 必须 createPortal 到 body：TopBar 的 backdrop-blur 会让 fixed 以 header 为包含块，弹窗被压进导航条。 */
export function TokenDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/55 px-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-card border border-ink-200 bg-white p-6 shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-ink-800">
            <KeyRound className="h-4 w-4 text-tide-600" />
            <span className="text-sm font-bold">{t('tokens.dialogTitle')}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-chip p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3">
          <TokenManager />
        </div>
      </div>
    </div>,
    document.body,
  );
}
