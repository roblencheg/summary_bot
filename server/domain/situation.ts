import type { ChatPeriodDigest, DigestRequest } from '~server/models/report';
import { CATEGORY_LABELS, severityRank, type Category, type Severity } from '~shared/domain';

/**
 * Оценка обстановки для руководителя — детерминированно по данным дайджеста, без AI.
 * 🔴 — активный инцидент «Высокий»/«Критический» или всплеск;
 * 🟡 — инцидент «Требует внимания», обращения «возможно, без ответа» или негатив ≥ 1/3 тона;
 * 🟢 — иначе; ⚪ — сообщений не было.
 */

export type SituationLevel = 'red' | 'yellow' | 'green' | 'none';

export const LEVEL_ICON: Record<SituationLevel, string> = { red: '🔴', yellow: '🟡', green: '🟢', none: '⚪' };
export const LEVEL_LABEL: Record<SituationLevel, string> = { red: 'тревожно', yellow: 'есть вопросы', green: 'спокойно', none: 'сообщений не было' };
const LEVEL_RANK: Record<SituationLevel, number> = { none: 0, green: 1, yellow: 2, red: 3 };

export const SEVERITY_ICON: Record<Severity, string> = { info: 'ℹ️', attention: '🟡', high: '🟠', critical: '🔴' };

export const REQUEST_STATUS_ICON: Record<DigestRequest['status'], string> = { resolved: '✅', answered: '💬', no_reply: '⏳', unknown: '❔' };

const ACTIVE_STATUSES = new Set(['new', 'seen']);

export function isActiveIncident(i: { status: string }): boolean {
  return ACTIVE_STATUSES.has(i.status);
}

export interface ChatSituation {
  level: SituationLevel;
  reasons: string[];
}

export const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};

export function chatSituation(d: ChatPeriodDigest): ChatSituation {
  if (d.stats.messages === 0) return { level: 'none', reasons: [] };
  const active = d.content.incidents.filter(isActiveIncident);
  const severe = active.filter((i) => i.severity === 'high' || i.severity === 'critical');
  const attention = active.filter((i) => i.severity === 'attention');
  const noReply = d.content.requests.filter((r) => r.status === 'no_reply').length;
  const toneTotal = d.stats.tones.reduce((a, t) => a + t.count, 0);
  const negative = d.stats.tones.find((t) => t.tone === 'negative')?.count ?? 0;
  const negativeShare = toneTotal ? negative / toneTotal : 0;

  const reasons: string[] = [];
  const critical = severe.filter((i) => i.severity === 'critical').length;
  const high = severe.length - critical;
  if (critical) reasons.push(`${critical} ${plural(critical, 'критический инцидент', 'критических инцидента', 'критических инцидентов')}`);
  if (high) reasons.push(`${high} ${plural(high, 'инцидент', 'инцидента', 'инцидентов')} «Высокий»`);
  if (d.content.spikes.length) reasons.push(d.content.spikes.length > 1 ? `всплески активности: ${d.content.spikes.length}` : 'всплеск активности');
  if (attention.length) reasons.push(`${attention.length} ${plural(attention.length, 'инцидент', 'инцидента', 'инцидентов')} «Требует внимания»`);
  if (noReply) reasons.push(`${noReply} без ответа`);
  if (negativeShare >= 1 / 3) reasons.push(`негативный тон ${Math.round(negativeShare * 100)}%`);

  const level: SituationLevel =
    severe.length || d.content.spikes.length ? 'red' : attention.length || noReply || negativeShare >= 1 / 3 ? 'yellow' : 'green';
  return { level, reasons };
}

export function worstLevel(levels: SituationLevel[]): SituationLevel {
  return levels.reduce<SituationLevel>((w, l) => (LEVEL_RANK[l] > LEVEL_RANK[w] ? l : w), 'none');
}

export function levelRank(l: SituationLevel): number {
  return LEVEL_RANK[l];
}

/** Главная категория для первой строки алерта — по значимости для руководителя. */
const CATEGORY_PRIORITY: Category[] = ['churn_risk', 'conflict', 'malfunction', 'prolonged', 'repeat', 'complaint', 'spike'];

export function primaryCategoryLabel(categories: readonly string[]): string | null {
  const c = CATEGORY_PRIORITY.find((x) => categories.includes(x));
  return c ? CATEGORY_LABELS[c] : null;
}

export function severityOrder(s: string): number {
  return severityRank(s as Severity);
}
