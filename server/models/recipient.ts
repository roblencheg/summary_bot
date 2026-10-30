import type { Category, RecipientStatus, Severity } from '~shared/domain';

export interface Recipient {
  id: number;
  name: string;
  telegramUserId: number | null;
  telegramUsername: string | null;
  status: RecipientStatus;
  maxUserId: number | null;
  maxUsername: string | null;
  maxStatus: RecipientStatus;
  maxActivatedAt: string | null;
  maxBlockedAt: string | null;
  isTechAdmin: boolean;
  summaryDay: boolean;
  summaryNight: boolean;
  alertCategories: Category[];
  alertMinSeverity: Severity;
  activatedAt: string | null;
  blockedAt: string | null;
  lastDeliveryAt: string | null;
  lastDeliveryStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecipientWithSubscriptions extends Recipient {
  summaryChatIds: number[];
  alertChatIds: number[];
  directorateIds: number[];
}
