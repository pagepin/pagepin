import { create } from 'zustand';
import { CheckCircle2, XCircle } from 'lucide-react';

type Kind = 'ok' | 'err';

interface ToastItem {
  id: number;
  kind: Kind;
  message: string;
}

interface ToastState {
  toasts: ToastItem[];
  push: (kind: Kind, message: string) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (kind, message) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 3200);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export function toast(message: string, kind: Kind = 'ok'): void {
  useToastStore.getState().push(kind, message);
}

export function toastError(e: unknown, fallback = '操作失败'): void {
  toast(e instanceof Error ? e.message : fallback, 'err');
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto flex max-w-md items-center gap-2 rounded-xl border px-4 py-2.5 text-sm shadow-lift animate-toast-in ${
            t.kind === 'ok'
              ? 'border-tide-200 bg-white text-tide-800'
              : 'border-red-200 bg-white text-red-700'
          }`}
        >
          {t.kind === 'ok' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-tide-500" />
          ) : (
            <XCircle className="h-4 w-4 shrink-0 text-red-500" />
          )}
          <span className="text-left">{t.message}</span>
        </button>
      ))}
    </div>
  );
}
