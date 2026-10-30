import type { PeriodType } from '~shared/domain';

export interface ReportPeriod {
  id: number;
  periodType: PeriodType;
  startsAt: string;
  endsAt: string;
  status: 'collecting' | 'ready' | 'failed';
  error: string | null;
  createdAt: string;
}

export interface Report {
  id: number;
  recipientId: number;
  periodId: number;
  periodType: PeriodType;
  startsAt: string;
  endsAt: string;
  version: number;
  manual: boolean;
  status: 'pending' | 'built' | 'sent' | 'skipped_catchup' | 'cancelled' | 'failed';
  chatIds: number[];
  parts: string[];
  fullText: string | null;
  /** Саммари в формате rich message Telegram; null — отправлен текстовый формат. */
  richHtml: string | null;
  delayed: boolean;
  createdAt: string;
  builtAt: string | null;
  sentAt: string | null;
  /** MAX не умеет rich message — по той же строке отчёта параллельный набор полей канала MAX. */
  maxStatus: 'pending' | 'built' | 'sent' | 'skipped_catchup' | 'cancelled' | 'failed';
  maxChatIds: number[];
  maxParts: string[];
  maxFullText: string | null;
  maxBuiltAt: string | null;
  maxSentAt: string | null;
}

/** Представление отчёта для одного канала — то, что реально строится и уходит получателю. */
export interface ReportChannelView {
  status: Report['status'];
  chatIds: number[];
  parts: string[];
  fullText: string | null;
  rich: string | null;
  builtAt: string | null;
  sentAt: string | null;
}

/** Счётчики раздела чата — считаются SQL-ом, модель их не пишет. */
export interface ChatPeriodStats {
  messages: number;
  authors: number;
  unidentified: number;
  attachmentsNoText: number;
  requests: number;
  repeatedRequests: number;
  riskSignals: number;
  classifiedRequests: number;
  unanalyzed: number;
  topics: Array<{ topic: string; count: number }>;
  tones: Array<{ tone: string; count: number }>;
}

export interface DigestRequest {
  requestKey: string;
  authorName: string;
  identityLimited: boolean;
  summary: string;
  topic: string;
  severity: string;
  messages: number;
  repeats: number;
  status: 'resolved' | 'answered' | 'no_reply' | 'unknown';
  firstMessageId: number;
  firstMessagePk: number;
  link: string | null;
  sentAt: string;
  score: number;
}

export interface DigestStatement {
  text: string;
  evidence: number[]; // message_id (Telegram) внутри чата
}

export interface DigestIncident {
  id: number;
  title: string;
  severity: string;
  categories: string[];
  messageCount: number;
  affectedAuthors: number;
  status: string;
  prolonged: boolean;
  // с digest-v3; в старых дайджестах отсутствуют
  authorName?: string | null;
  link?: string | null;
  firstMessageAt?: string;
  staffReplied?: boolean | null; // null — сотрудники чата не заданы
}

export interface DigestContent {
  /** Одна фраза об обстановке в чате (digest-v3); в старых дайджестах отсутствует. */
  headline?: DigestStatement | null;
  overview: DigestStatement[];
  toneReasons: DigestStatement[];
  attention: DigestStatement[];
  requests: DigestRequest[];
  spikes: Array<{ incidentId: number; at: string; count: number; baseline: number; authors: number; topics: string[]; historyLimited: boolean }>;
  incidents: DigestIncident[];
  gaps: Array<{ startedAt: string; endedAt: string | null; reason: string }>;
  staffConfigured: boolean;
  aiAvailable: boolean;
  keyLinks: Array<{ messageId: number; link: string | null }>;
}

export interface ChatPeriodDigest {
  id: number;
  chatId: number;
  periodId: number;
  version: number;
  stats: ChatPeriodStats;
  content: DigestContent;
  createdAt: string;
}
