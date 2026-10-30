import type { Channel } from '~shared/domain';

export const IMPORTANCE_LEVELS = ['high', 'normal', 'low'] as const;
export type Importance = (typeof IMPORTANCE_LEVELS)[number];
export const QUIET_MODES = ['full', 'line', 'hide'] as const;
/** Чаты без событий в саммари: полностью, одной строкой, скрывать. */
export type QuietMode = (typeof QUIET_MODES)[number];

export interface Directorate {
  id: number;
  name: string;
  quietChats: QuietMode;
  createdAt: string;
}

export type ChatAccess = 'owner' | 'reader';

export interface ChatDirectorate {
  chatId: number;
  directorateId: number;
  access: ChatAccess;
  importance: Importance;
}

/** Настройки саммари получателя, сведённые по его дирекциям. */
export interface SummaryPrefs {
  importance: Map<number, Importance>;
  quiet: QuietMode;
}

export interface ChatClaimCode {
  codeHash: string;
  directorateId: number;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  chatId: number | null;
  channel: Channel;
}

/**
 * Права запроса. Суперадмин — без ограничений (фильтры не применяются).
 * Руководитель — только чаты своих дирекций (владелец или чтение) и получатели своих дирекций.
 */
export type Scope =
  | { kind: 'super'; login: string }
  | {
      kind: 'manager';
      login: string;
      adminId: number;
      directorateIds: number[];
      chatIds: Set<number>;
      ownedChatIds: Set<number>;
      recipientIds: Set<number>;
    };
