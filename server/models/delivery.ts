import type { Channel, DeliveryKind, DeliveryStatus } from '~shared/domain';

export interface DeliveryJob {
  id: number;
  dedupKey: string;
  recipientId: number;
  kind: DeliveryKind;
  channel: Channel;
  incidentId: number | null;
  reportId: number | null;
  chatId: number | null;
  payload: DeliveryPayload | null;
  status: DeliveryStatus;
  statusReason: string | null;
  attempts: number;
  partsSent: number;
  uncertain: boolean;
  manualRetry: boolean;
  nextAttemptAt: string;
  lastError: string | null;
  triggerAt: string | null;
  sourceSentAt: string | null;
  sourceReceivedAt: string | null;
  analyzedAt: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface DeliveryPayload {
  text?: string;
  updateReason?: string;
  delayed?: boolean;
  /** Интервал дайджеста по запросу (ISO) */
  from?: string;
  to?: string;
}

export interface DeliveryAttempt {
  id: number;
  jobId: number;
  at: string;
  part: number;
  ok: boolean;
  uncertain: boolean;
  httpStatus: number | null;
  errorCode: string | null;
  error: string | null;
  telegramMessageId: number | null;
  durationMs: number | null;
}

export interface NewDeliveryJob {
  dedupKey: string;
  recipientId: number;
  kind: DeliveryKind;
  channel: Channel;
  incidentId?: number | null;
  reportId?: number | null;
  chatId?: number | null;
  payload?: DeliveryPayload | null;
  triggerAt?: string | null;
  sourceSentAt?: string | null;
  sourceReceivedAt?: string | null;
  analyzedAt?: string | null;
  manualRetry?: boolean;
  nextAttemptAt?: string;
}
