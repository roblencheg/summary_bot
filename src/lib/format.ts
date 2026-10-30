const cache = new Map<string, Intl.DateTimeFormat>();

function fmt(tz: string, withDate: boolean, withSeconds = false): Intl.DateTimeFormat {
  const key = `${tz}|${withDate}|${withSeconds}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('ru-RU', {
      timeZone: tz,
      ...(withDate ? { day: '2-digit', month: '2-digit', year: '2-digit' } : {}),
      hour: '2-digit',
      minute: '2-digit',
      ...(withSeconds ? { second: '2-digit' } : {}),
    });
    cache.set(key, f);
  }
  return f;
}

/** Время в часовом поясе расписания (не браузера). */
export function dt(iso: string | null | undefined, tz: string, withSeconds = false): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : fmt(tz, true, withSeconds).format(d);
}

export function time(iso: string | null | undefined, tz: string): string {
  if (!iso) return '—';
  return fmt(tz, false).format(new Date(iso));
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return '—';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 0) return 'через ' + ago(new Date(Date.now() + -s * 2000).toISOString()).replace(' назад', '');
  if (s < 60) return `${s} с назад`;
  if (s < 3600) return `${Math.round(s / 60)} мин назад`;
  if (s < 86400) return `${Math.round(s / 3600)} ч назад`;
  return `${Math.round(s / 86400)} дн назад`;
}

export function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} КБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
}

export function num(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('ru-RU', { maximumFractionDigits: digits });
}

/** <input type="datetime-local"> оперирует локальным временем браузера. */
export function localInputToIso(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
