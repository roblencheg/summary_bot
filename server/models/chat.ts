import type { Channel, ChatStatus } from '~shared/domain';
import type { ChatRules } from './settings';

export interface Chat {
  id: number;
  title: string;
  type: string;
  username: string | null;
  isForum: boolean;
  status: ChatStatus;
  channel: Channel;
  collectionStartedAt: string | null;
  lastMessageAt: string | null;
  lastEventAt: string | null;
  botMemberStatus: string | null;
  botIsAdmin: boolean | null;
  botReadsAll: boolean | null;
  rightsCheckedAt: string | null;
  rightsError: string | null;
  migratedTo: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatStaff {
  chatId: number;
  telegramUserId: number;
  label: string | null;
}

export interface ChatWithRules extends Chat {
  rulesOverride: Partial<ChatRules>;
  staff: ChatStaff[];
}

export interface CollectionGap {
  id: number;
  chatId: number | null;
  startedAt: string;
  endedAt: string | null;
  reason: string;
  details: string | null;
  recovered: boolean;
}
