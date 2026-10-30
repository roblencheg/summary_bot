import type { ReactNode } from 'react';
import { cn } from '~/lib/utils';

export function Stat({ label, value, hint, tone = 'neutral' }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'neutral' | 'ok' | 'signal' | 'danger' }) {
  const bar = { neutral: 'bg-line-strong', ok: 'bg-ok', signal: 'bg-signal', danger: 'bg-danger' }[tone];
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-surface px-4 py-4">
      <span className={cn('absolute left-0 top-4 h-8 w-[3px] rounded-r', bar)} />
      <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">{label}</p>
      <p className="num mt-1.5 text-[28px] font-medium leading-none tracking-tight">{value}</p>
      {hint && <p className="mt-2 text-[12.5px] leading-snug text-ink-soft">{hint}</p>}
    </div>
  );
}

export function StatusLine({ ok, warn, label, detail }: { ok: boolean; warn?: boolean; label: string; detail: ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', ok ? 'bg-ok' : warn ? 'bg-signal' : 'bg-danger', !ok && 'animate-pulse')} />
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-[13px] leading-snug text-ink-soft break-words">{detail}</p>
      </div>
    </div>
  );
}
