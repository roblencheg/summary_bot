import type { Category, Severity, Tone } from '~shared/domain';

export interface Message {
  id: number;
  chatId: number;
  messageId: number;
  sentAt: string;
  receivedAt: string;
  authorKey: string | null;
  authorId: number | null;
  authorName: string;
  authorUsername: string | null;
  senderChatId: number | null;
  identityLimited: boolean;
  isStaff: boolean;
  text: string;
  contentType: string;
  hasText: boolean;
  replyToMessageId: number | null;
  threadId: number | null;
  editedAt: string | null;
  revisionCount: number;
  link: string | null;
  analysisStatus: string;
  analysisAttempts: number;
  analysisError: string | null;
  analyzedAt: string | null;
  analysisId: number | null;
  isRequest: boolean | null;
  requestKey: string | null;
  topic: string | null;
  tone: Tone | null;
  categories: Category[];
  severity: Severity | 'none' | null;
  confidence: number | null;
  summary: string | null;
  resolutionConfirmed: boolean;
}

/** Нормализованное сообщение из апдейта Telegram — до записи в БД. */
export interface IncomingMessage {
  chatId: number;
  messageId: number;
  sentAt: string;
  receivedAt: string;
  authorKey: string | null;
  authorId: number | null;
  authorName: string;
  authorUsername: string | null;
  senderChatId: number | null;
  identityLimited: boolean;
  text: string;
  contentType: string;
  hasText: boolean;
  replyToMessageId: number | null;
  threadId: number | null;
  link: string | null;
}

export interface MessageAnalysisUpdate {
  analysisId: number;
  isRequest: boolean;
  requestKey: string | null;
  topic: string;
  tone: Tone;
  categories: Category[];
  severity: Severity | 'none';
  confidence: number;
  summary: string;
  resolutionConfirmed: boolean;
  answersMessageIds: number[];
}
