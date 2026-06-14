import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { AlertTriangle } from 'lucide-react';

interface ConfirmRequest {
  title: string;
  body?: string;
  confirmText: string;
  resolve: (ok: boolean) => void;
}

interface ConfirmState {
  req: ConfirmRequest | null;
  open: (r: ConfirmRequest) => void;
  settle: (ok: boolean) => void;
}

const useConfirmStore = create<ConfirmState>((set, get) => ({
  req: null,
  open: (req) => set({ req }),
  settle: (ok) => {
    get().req?.resolve(ok);
    set({ req: null });
  },
}));

/** 命令式危险操作确认（替代原生 confirm()），与 toast 同款用法：
 *  if (!(await confirmDanger({ title: '…', body: '…' }))) return; */
export function confirmDanger(opts: {
  title: string;
  body?: string;
  confirmText?: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.getState().open({
      title: opts.title,
      body: opts.body,
      confirmText: opts.confirmText ?? 'Confirm',
      resolve,
    });
  });
}

/** 挂在 App 根部；★ createPortal 到 body（同 TokenDialog：避免 backdrop-blur 改变包含块） */
export function Confirmer() {
  const req = useConfirmStore((s) => s.req);
  const settle = useConfirmStore((s) => s.settle);

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && settle(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [req, settle]);

  if (!req) return null;
  return createPortal(
    // z-[60]：要压住 TokenDialog（z-50）—— 轮换/吊销的确认从它里面弹出
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-900/55 px-4"
      onClick={() => settle(false)}
    >
      <div
        className="w-full max-w-sm rounded-card border border-ink-200 bg-white p-5 shadow-modal animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="shrink-0 rounded-full bg-red-50 p-2">
            <AlertTriangle className="h-4 w-4 text-red-600" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-bold text-ink-800">{req.title}</div>
            {req.body && <p className="mt-1 text-xs leading-relaxed text-ink-500">{req.body}</p>}
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="btn-ghost !px-3.5 !py-1.5 !text-xs"
            onClick={() => settle(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            className="rounded-field bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
            onClick={() => settle(true)}
          >
            {req.confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
