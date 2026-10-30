import type { ReactNode } from 'react';
import { cn } from '~/lib/utils';

export type Tone = 'neutral' | 'ok' | 'signal' | 'danger' | 'info' | 'violet' | 'dark';

const tones: Record<Tone, string> = {
  neutral: 'bg-sunken text-ink-soft border-line',
  ok: 'bg-ok-soft text-ok border-ok/20',
  signal: 'bg-signal-soft text-[#9a5410] border-signal/25',
  danger: 'bg-danger-soft text-danger border-danger/25',
  info: 'bg-info-soft text-info border-info/20',
  violet: 'bg-violet-soft text-violet border-violet/20',
  dark: 'bg-ink text-surface border-ink',
};

export function Badge({ tone = 'neutral', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[12px] font-semibold leading-5 whitespace-nowrap', tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
