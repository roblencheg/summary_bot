import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { cn } from '~/lib/utils';

export function Spinner({ className }: { className?: string }) {
  return <span className={cn('inline-block size-5 animate-spin rounded-full border-2 border-signal border-r-transparent', className)} />;
}

export function Loading({ label = 'Загрузка…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 px-5 py-10 text-sm text-ink-soft">
      <Spinner /> {label}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
      {error instanceof Error ? error.message : String(error)}
    </div>
  );
}

export function Empty({ title, hint, children }: { title: string; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <div className="mx-auto mb-3 grid size-11 place-items-center rounded-full border border-dashed border-line-strong text-ink-mute">∅</div>
      <p className="font-semibold">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-md text-sm text-ink-soft">{hint}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function Notice({ tone = 'signal', title, children }: { tone?: 'signal' | 'danger' | 'info' | 'ok'; title?: ReactNode; children: ReactNode }) {
  const map = {
    signal: 'border-signal/40 bg-signal-soft/70 text-[#7a4510]',
    danger: 'border-danger/30 bg-danger-soft text-danger',
    info: 'border-info/25 bg-info-soft text-info',
    ok: 'border-ok/25 bg-ok-soft text-ok',
  };
  return (
    <div className={cn('rounded-xl border px-4 py-3 text-sm leading-relaxed', map[tone])}>
      {title && <p className="mb-0.5 font-bold">{title}</p>}
      <div>{children}</div>
    </div>
  );
}

// --- toast ---

type ToastItem = { id: number; text: string; tone: 'ok' | 'danger' };
const ToastCtx = createContext<(text: string, tone?: 'ok' | 'danger') => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, tone: 'ok' | 'danger' = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(92vw,380px)] flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto animate-rise rounded-xl border px-4 py-3 text-sm font-medium shadow-lg',
              t.tone === 'ok' ? 'border-ok/30 bg-surface text-ok' : 'border-danger/30 bg-surface text-danger',
            )}
          >
            {t.tone === 'ok' ? '✓ ' : '⚠ '}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

// --- модальное окно ---

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-night/45 p-0 backdrop-blur-[2px] animate-fade sm:items-center sm:p-6" onClick={onClose}>
      <div
        className={cn('max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-surface shadow-2xl animate-rise sm:rounded-2xl', wide ? 'max-w-4xl' : 'max-w-xl')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface px-5 py-4">
          <h3 className="text-base font-bold">{title}</h3>
          <button className="grid size-8 cursor-pointer place-items-center rounded-lg text-ink-soft hover:bg-sunken" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function Pager({ total, offset, limit, onChange }: { total: number; offset: number; limit: number; onChange: (o: number) => void }) {
  if (total <= limit) return null;
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-ink-soft">
      <span className="num">
        {offset + 1}–{Math.min(offset + limit, total)} из {total}
      </span>
      <div className="flex gap-2">
        <button className="cursor-pointer rounded-lg border border-line px-3 py-1 hover:bg-sunken disabled:opacity-40" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
          ←
        </button>
        <button className="cursor-pointer rounded-lg border border-line px-3 py-1 hover:bg-sunken disabled:opacity-40" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>
          →
        </button>
      </div>
    </div>
  );
}
