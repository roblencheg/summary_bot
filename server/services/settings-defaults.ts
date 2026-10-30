import { env } from '~server/config';
import { CATEGORIES, DEFAULT_TOPICS } from '~shared/domain';
import type { GlobalSettings } from '~server/models/settings';

/**
 * Значения пилота по умолчанию (ТЗ §2, §8, §11). Меняются в «Системных настройках»
 * и «Правилах чата»; описаны в docs/admin-guide.md.
 */
export const DEFAULT_SETTINGS: GlobalSettings = {
  timezone: env.DEFAULT_TIMEZONE,
  dayStart: '08:00',
  nightStart: '22:00',
  aiModel: env.OPENAI_MODEL,
  topics: DEFAULT_TOPICS,
  contextWindowHours: 24,
  catchupMaxReports: 2,
  delayedThresholdMin: 15,
  retentionMessagesDays: 90,
  retentionReportsDays: 180,
  retentionTechDays: 30,
  backupKeep: 14,
  rules: {
    categories: [...CATEGORIES],
    minSeverity: 'attention',
    minConfidence: 0.6,
    cooldownMin: 15,
    repeatCount: 3,
    repeatWindowMin: 30,
    authorRepeatHours: 24,
    spikeWindowMin: 5,
    spikeMinMessages: 20,
    spikeRatio: 3,
    massAuthors: 5,
    massWindowMin: 10,
    historyDays: 7,
    noReplyWindowMin: 30,
  },
};

/** Технические константы, не вынесенные в UI. */
export const TECH = {
  analysisBatchSize: 20,
  analysisDebounceMs: 3_000,
  analysisConcurrency: 3,
  analysisMaxAttempts: 3,
  contextMessages: 30,
  openIncidentsInPrompt: 15,
  openIncidentWindowHours: 72,
  revisionThreshold: 0.15,
  bindingCodeTtlHours: 24,
  sessionTtlHours: 12,
  loginMaxFailures: 5,
  loginLockMin: 15,
  deliveryMaxAttempts: 5,
  summaryPreviewRequests: 20,
  digestMaxRequests: 150,
  digestWaitAnalysisMs: 3 * 60_000,
  serviceDownGapMs: 5 * 60_000,
  intakeErrorGapMs: 2 * 60_000,
  aiDownTechAlertMs: 10 * 60_000,
  deliveryStuckTechAlertMs: 15 * 60_000,
  techAlertRepeatMs: 30 * 60_000,
  maxCatchupDays: 14,
  onDemandCacheMs: 2 * 60_000,
  onDemandMinIntervalMs: 2 * 60_000,
  /** Пробелы сбора короче — не показываются в Telegram-отчётах (ежедневный перезапуск ≈ 5 мин). */
  reportGapMinMs: 30 * 60_000,
} as const;
