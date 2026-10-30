import { randomUUID } from 'node:crypto';

/** Хелперы маппинга строк SQLite. */

export const nowIso = (): string => new Date().toISOString();
export const isoPlus = (ms: number, from: Date = new Date()): string => new Date(from.getTime() + ms).toISOString();
export const newLeaseToken = (): string => randomUUID();

export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw === '') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export const bool = (v: unknown): boolean => v === 1 || v === true || v === '1';
export const boolOrNull = (v: unknown): boolean | null => (v === null || v === undefined ? null : bool(v));
export const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));
export const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
export const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** "?, ?, ?" для IN (...) */
export const placeholders = (n: number): string => Array.from({ length: n }, () => '?').join(', ');

// Общий размер страницы для последовательного чтения списков.
export const PAGE = 100;
