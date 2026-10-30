import type { ButtonHTMLAttributes } from 'react';
import { cn } from '~/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'signal';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const variants: Record<Variant, string> = {
  primary: 'bg-ink text-surface hover:bg-night-2 shadow-[0_1px_0_rgb(255_255_255/0.08)_inset]',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-sunken',
  ghost: 'bg-transparent text-ink-soft hover:bg-sunken hover:text-ink',
  danger: 'bg-surface text-danger border border-danger/40 hover:bg-danger-soft',
  signal: 'bg-signal text-white hover:brightness-95',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
};

export function Button({ variant = 'primary', size = 'md', loading, className, disabled, children, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-semibold tracking-tight transition-[background,filter,color] whitespace-nowrap',
        'disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />}
      {children}
    </button>
  );
}
