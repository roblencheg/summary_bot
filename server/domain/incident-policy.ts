import { severityRank, type Category, type Severity } from '~shared/domain';

/**
 * Решение «что делать с уведомлением по инциденту» — чистая функция от состояния
 * инцидента и правил. Не знает про получателей: фильтры получателя применяются при рассылке.
 */

export interface IncidentSnapshot {
  status: string;
  severity: Severity;
  confidence: number;
  categories: Category[];
  affectedAuthors: number;
  messageCount: number;
  lastAlertAt: string | null;
  lastAlertSeverity: Severity | null;
  lastAlertCategories: Category[];
  lastAlertAuthors: number | null;
  lastAlertMessageCount: number | null;
}

export interface PolicyRules {
  categories: Category[];
  minSeverity: Severity;
  minConfidence: number;
  cooldownMin: number;
}

export type Decision =
  | { action: 'none'; borderline: boolean; reason: string }
  | { action: 'alert'; reason: string }
  | { action: 'urgent_update'; reason: string }
  | { action: 'summary_update'; reason: string }
  | { action: 'defer'; reason: string };

export function passesChatThreshold(s: IncidentSnapshot, r: PolicyRules): boolean {
  return (
    s.categories.some((c) => r.categories.includes(c)) &&
    severityRank(s.severity) >= severityRank(r.minSeverity) &&
    s.confidence >= r.minConfidence
  );
}

export function decide(s: IncidentSnapshot, r: PolicyRules, now: Date, materialUpdate: boolean): Decision {
  if (s.status === 'closed' || s.status === 'false_positive') {
    return { action: 'none', borderline: false, reason: 'инцидент закрыт администратором' };
  }
  if (!passesChatThreshold(s, r)) {
    const borderline = s.confidence < r.minConfidence && severityRank(s.severity) >= severityRank('attention');
    return { action: 'none', borderline, reason: borderline ? 'уверенность ниже порога' : 'ниже порогов чата' };
  }
  if (!s.lastAlertAt) return { action: 'alert', reason: 'первое значимое событие' };

  const reasons: string[] = [];
  if (s.lastAlertSeverity && severityRank(s.severity) > severityRank(s.lastAlertSeverity)) reasons.push('выросла серьёзность');
  const newCats = s.categories.filter((c) => !s.lastAlertCategories.includes(c));
  if (newCats.length) reasons.push('новая категория');
  const prevAuthors = s.lastAlertAuthors ?? 1;
  if (s.affectedAuthors >= prevAuthors * 2 && s.affectedAuthors - prevAuthors >= 2) reasons.push('резко выросло число затронутых');
  if (materialUpdate) reasons.push('новый существенный факт');
  if (reasons.length) return { action: 'urgent_update', reason: reasons.join(', ') };

  if ((s.lastAlertMessageCount ?? 0) >= s.messageCount) return { action: 'none', borderline: false, reason: 'нет новых данных' };
  const cooldownEnds = new Date(s.lastAlertAt).getTime() + r.cooldownMin * 60_000;
  if (now.getTime() >= cooldownEnds) return { action: 'summary_update', reason: 'новые сообщения после паузы между уведомлениями' };
  return { action: 'defer', reason: 'пауза между уведомлениями' };
}
