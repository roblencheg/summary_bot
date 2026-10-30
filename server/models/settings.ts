import type { Category, Severity } from '~shared/domain';

/** Правила анализа и алертов. Глобальные значения по умолчанию + переопределения по чату. */
export interface ChatRules {
  categories: Category[];
  minSeverity: Severity;
  minConfidence: number;
  cooldownMin: number;
  repeatCount: number;
  repeatWindowMin: number;
  authorRepeatHours: number;
  spikeWindowMin: number;
  spikeMinMessages: number;
  spikeRatio: number;
  massAuthors: number;
  massWindowMin: number;
  historyDays: number;
  noReplyWindowMin: number;
}

export interface GlobalSettings {
  timezone: string;
  dayStart: string;
  nightStart: string;
  aiModel: string;
  topics: string[];
  contextWindowHours: number;
  catchupMaxReports: number;
  delayedThresholdMin: number;
  retentionMessagesDays: number;
  retentionReportsDays: number;
  retentionTechDays: number;
  backupKeep: number;
  rules: ChatRules;
}
