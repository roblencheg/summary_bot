import type { PeriodType } from '~shared/domain';

/**
 * Границы периодов саммари. Всё считается через IANA-зону (Intl), а не через TZ процесса:
 * сервер может жить в UTC, расписание всё равно идёт по Новосибирску.
 * Интервалы полуоткрытые: [start, end).
 */

export interface PeriodConfig {
  timezone: string;
  dayStart: string; // "08:00" — начало дневного = конец ночного
  nightStart: string; // "22:00" — начало ночного = конец дневного
}

export interface Period {
  type: PeriodType;
  start: Date;
  end: Date;
}

interface LocalParts {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function localParts(date: Date, tz: string): LocalParts {
  const p: Record<string, number> = {};
  for (const part of fmt(tz).formatToParts(date)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return { y: p.year, m: p.month, d: p.day, h: p.hour === 24 ? 0 : p.hour, mi: p.minute, s: p.second };
}

function offsetMs(date: Date, tz: string): number {
  const p = localParts(date, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Локальное время в зоне tz → момент UTC. */
export function zonedToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string): Date {
  const naive = Date.UTC(y, m - 1, d, h, mi);
  let guess = naive - offsetMs(new Date(naive), tz);
  guess = naive - offsetMs(new Date(guess), tz);
  return new Date(guess);
}

function hm(s: string): [number, number] {
  const [h, m] = s.split(':').map(Number);
  return [h, m];
}

function addDays(y: number, m: number, d: number, k: number): [number, number, number] {
  const t = new Date(Date.UTC(y, m - 1, d + k));
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
}

/** Периоды, которые заканчиваются на локальную дату (ночной — утром, дневной — вечером). */
function periodsEndingOnLocalDate(y: number, m: number, d: number, cfg: PeriodConfig): Period[] {
  const [dh, dm] = hm(cfg.dayStart);
  const [nh, nm] = hm(cfg.nightStart);
  const [py, pm, pd] = addDays(y, m, d, -1);
  return [
    {
      type: 'night',
      start: zonedToUtc(py, pm, pd, nh, nm, cfg.timezone),
      end: zonedToUtc(y, m, d, dh, dm, cfg.timezone),
    },
    {
      type: 'day',
      start: zonedToUtc(y, m, d, dh, dm, cfg.timezone),
      end: zonedToUtc(y, m, d, nh, nm, cfg.timezone),
    },
  ];
}

/** Периоды с концом в (from, to], по возрастанию конца. */
export function periodsEndingBetween(from: Date, to: Date, cfg: PeriodConfig): Period[] {
  const a = localParts(from, cfg.timezone);
  const b = localParts(to, cfg.timezone);
  const out: Period[] = [];
  let [y, m, d] = addDays(a.y, a.m, a.d, -1);
  const stop = Date.UTC(b.y, b.m - 1, b.d + 1);
  while (Date.UTC(y, m - 1, d) <= stop) {
    for (const p of periodsEndingOnLocalDate(y, m, d, cfg)) {
      if (p.end.getTime() > from.getTime() && p.end.getTime() <= to.getTime()) out.push(p);
    }
    [y, m, d] = addDays(y, m, d, 1);
  }
  return out.sort((x, z) => x.end.getTime() - z.end.getTime());
}

/** Период, которому принадлежит момент t. */
export function periodContaining(t: Date, cfg: PeriodConfig): Period {
  const p = localParts(t, cfg.timezone);
  for (const k of [0, 1]) {
    const [y, m, d] = addDays(p.y, p.m, p.d, k);
    for (const per of periodsEndingOnLocalDate(y, m, d, cfg)) {
      if (t.getTime() >= per.start.getTime() && t.getTime() < per.end.getTime()) return per;
    }
  }
  throw new Error('periodContaining: период не найден');
}

/** Последний закрывшийся к моменту now период. */
export function lastClosedPeriod(now: Date, cfg: PeriodConfig): Period {
  const current = periodContaining(now, cfg);
  return periodContaining(new Date(current.start.getTime() - 1), cfg);
}

const pad = (n: number) => String(n).padStart(2, '0');

export function formatLocal(date: Date | string, tz: string, withDate = true): string {
  const p = localParts(typeof date === 'string' ? new Date(date) : date, tz);
  const time = `${pad(p.h)}:${pad(p.mi)}`;
  return withDate ? `${pad(p.d)}.${pad(p.m)}.${p.y} ${time}` : time;
}

export function formatLocalShort(date: Date | string, tz: string): string {
  const p = localParts(typeof date === 'string' ? new Date(date) : date, tz);
  return `${pad(p.d)}.${pad(p.m)} ${pad(p.h)}:${pad(p.mi)}`;
}
