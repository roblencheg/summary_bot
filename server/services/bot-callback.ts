import type { Channel } from '~shared/domain';
import type { BotKeyboard } from '~server/domain/keyboard';

/**
 * Нажатие инлайн-кнопки, нормализованное к каналу: callback_query Telegram и message_callback
 * MAX сводятся к этой форме на границе приёма (ingestion-service / max-ingestion-service),
 * дальше бизнес-логика (on-demand, настройки инцидентов, оценки алертов) не знает про канал
 * API и просто вызывает reply этого канала.
 */
export interface BotCallback {
  channel: Channel;
  id: string;
  fromId: number;
  chatId: number;
  messageId: number | null;
  data: string;
}

export interface ChannelReply {
  sendMessage(chatId: number, text: string, opts?: { keyboard?: BotKeyboard }): Promise<void>;
  editMessageText(chatId: number, messageId: number, text: string, opts?: { keyboard?: BotKeyboard }): Promise<void>;
  answerCallback(id: string, text: string, showAlert?: boolean): Promise<void>;
}

export interface FeedbackHandler {
  handleCallback(cb: BotCallback): Promise<void>;
}
