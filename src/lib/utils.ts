import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Мёрж Tailwind-классов: conditionals через clsx + dedupe конфликтующих через tailwind-merge. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
