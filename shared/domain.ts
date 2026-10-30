/**
 * Перечисления предметной области — общие для сервера и клиента (значения и подписи).
 */

export const CATEGORIES = [
  'complaint',
  'conflict',
  'prolonged',
  'churn_risk',
  'repeat',
  'spike',
  'malfunction',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  complaint: 'Жалоба/недовольство',
  conflict: 'Конфликт',
  prolonged: 'Затянувшаяся проблема',
  churn_risk: 'Риск потери клиента/репутации',
  repeat: 'Повторяющаяся ситуация',
  spike: 'Всплеск активности',
  malfunction: 'Функциональный сбой',
};

export const SEVERITIES = ['info', 'attention', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_LABELS: Record<Severity, string> = {
  info: 'Информационный',
  attention: 'Требует внимания',
  high: 'Высокий',
  critical: 'Критический',
};

export function severityRank(s: Severity | 'none' | null | undefined): number {
  if (!s || s === 'none') return -1;
  return SEVERITIES.indexOf(s);
}

export const TONES = ['neutral', 'positive', 'negative', 'mixed'] as const;
export type Tone = (typeof TONES)[number];
export const TONE_LABELS: Record<Tone, string> = {
  neutral: 'нейтральный',
  positive: 'позитивный',
  negative: 'негативный',
  mixed: 'смешанный',
};

export const OTHER_TOPIC = 'прочее/не определено';

export const INCIDENT_STATUSES = ['new', 'seen', 'closed', 'false_positive'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  new: 'Новый',
  seen: 'Просмотрен',
  closed: 'Закрыт',
  false_positive: 'Ложный сигнал',
};

export const REPEAT_TYPE_LABELS: Record<string, string> = {
  single: 'одиночное',
  author_repeat: 'повтор автора',
  multi: 'несколько участников',
  mass: 'массовая',
};

export const CHANNELS = ['telegram', 'max'] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABELS: Record<Channel, string> = {
  telegram: 'Telegram',
  max: 'MAX',
};

export const CHAT_STATUSES = ['pending', 'active', 'disabled', 'removed', 'migrated'] as const;
export type ChatStatus = (typeof CHAT_STATUSES)[number];
export const CHAT_STATUS_LABELS: Record<ChatStatus, string> = {
  pending: 'Ожидает подключения',
  active: 'Сбор включён',
  disabled: 'Сбор выключен',
  removed: 'Бот удалён / нет прав',
  migrated: 'Перенесён в супергруппу',
};

export const RECIPIENT_STATUSES = ['pending', 'active', 'blocked', 'disabled'] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];
export const RECIPIENT_STATUS_LABELS: Record<RecipientStatus, string> = {
  pending: 'Не активировал бота',
  active: 'Активен',
  blocked: 'Заблокировал бота',
  disabled: 'Отключён',
};

export const DELIVERY_KINDS = ['alert', 'incident_update', 'summary', 'test', 'tech', 'menu', 'on_demand'] as const;
export type DeliveryKind = (typeof DELIVERY_KINDS)[number];
export const DELIVERY_KIND_LABELS: Record<DeliveryKind, string> = {
  alert: 'Алерт',
  incident_update: 'Обновление инцидента',
  summary: 'Саммари',
  test: 'Тестовое',
  tech: 'Техническое',
  menu: 'Меню бота',
  on_demand: 'Дайджест по запросу',
};

export const DELIVERY_STATUSES = [
  'pending',
  'retry',
  'sending',
  'sent',
  'failed',
  'blocked',
  'not_activated',
  'cancelled',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  pending: 'В очереди',
  retry: 'Повтор запланирован',
  sending: 'Отправляется',
  sent: 'Принято Telegram',
  failed: 'Ошибка',
  blocked: 'Заблокировано получателем',
  not_activated: 'Получатель не активировал бота',
  cancelled: 'Отменено',
};

export const PERIOD_TYPES = ['day', 'night'] as const;
export type PeriodType = (typeof PERIOD_TYPES)[number];
export const PERIOD_TYPE_LABELS: Record<PeriodType, string> = {
  day: 'Дневной',
  night: 'Ночной',
};

export const DEFAULT_TOPICS = [
  'доставка',
  'оплата',
  'промокод/акция',
  'приложение/сайт',
  'оформление заказа',
  'возврат/отмена',
  'качество товара',
  'наличие/ассортимент',
  'консультация',
];
