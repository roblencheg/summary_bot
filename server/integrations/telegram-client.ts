import { createHmac } from 'node:crypto';
import type { BotKeyboard } from '~server/domain/keyboard';

/**
 * Тонкая fetch-обёртка над Telegram Bot API. Без БД и бизнес-правил.
 * Токен живёт только в URL запроса и никогда не попадает в логи и тексты ошибок.
 */

export type TelegramErrorKind =
  | 'blocked' // 403: бот заблокирован / диалог не начат / пользователь удалён
  | 'not_found' // 400: chat not found
  | 'rate_limit' // 429
  | 'bad_request' // прочие 400
  | 'unauthorized' // 401: неверный токен
  | 'server' // 5xx
  | 'network' // запрос не ушёл (DNS, отказ соединения)
  | 'uncertain'; // запрос мог уйти, ответ не получен

export class TelegramError extends Error {
  constructor(
    public readonly method: string,
    public readonly kind: TelegramErrorKind,
    public readonly httpStatus: number | null,
    public readonly description: string,
    public readonly retryAfterSec: number | null = null,
  ) {
    super(`Telegram ${method}: ${kind}${httpStatus ? ` ${httpStatus}` : ''} — ${description}`);
    this.name = 'TelegramError';
  }
}

export interface TgUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TgChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  is_forum?: boolean;
}

export interface TgMessage {
  message_id: number;
  message_thread_id?: number;
  from?: TgUser;
  sender_chat?: TgChat;
  date: number;
  edit_date?: number;
  chat: TgChat;
  reply_to_message?: TgMessage;
  is_topic_message?: boolean;
  is_automatic_forward?: boolean;
  text?: string;
  caption?: string;
  photo?: unknown;
  video?: unknown;
  document?: unknown;
  audio?: unknown;
  voice?: unknown;
  video_note?: unknown;
  sticker?: unknown;
  animation?: unknown;
  contact?: unknown;
  location?: unknown;
  poll?: unknown;
  new_chat_members?: TgUser[];
  left_chat_member?: TgUser;
  new_chat_title?: string;
  migrate_to_chat_id?: number;
  migrate_from_chat_id?: number;
  author_signature?: string;
}

export interface TgChatMemberUpdated {
  chat: TgChat;
  from: TgUser;
  date: number;
  old_chat_member: { status: string; user: TgUser };
  new_chat_member: { status: string; user: TgUser; can_read_all_group_messages?: boolean };
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  channel_post?: TgMessage;
  edited_channel_post?: TgMessage;
  my_chat_member?: TgChatMemberUpdated;
  callback_query?: TgCallbackQuery;
}

export interface TgBotInfo extends TgUser {
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
}

export interface TgWebhookInfo {
  url: string;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
  max_connections?: number;
  allowed_updates?: string[];
}

export interface TgChatMember {
  status: 'creator' | 'administrator' | 'member' | 'restricted' | 'left' | 'kicked';
  user: TgUser;
}

export const ALLOWED_UPDATES = ['message', 'edited_message', 'my_chat_member', 'callback_query'];

function toInlineKeyboard(keyboard: BotKeyboard | undefined): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } | undefined {
  if (!keyboard) return undefined;
  return { inline_keyboard: keyboard.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) };
}

/** Секрет webhook: из env или детерминированно из токена (меняется вместе с токеном). */
export function deriveWebhookSecret(token: string, explicit?: string): string {
  if (explicit) return explicit;
  return createHmac('sha256', 'telegram-webhook').update(token).digest('hex');
}

const NETWORK_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT']);

export class TelegramClient {
  constructor(private readonly token: string) {}

  async call<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = 15_000): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: ctrl.signal,
      });
    } catch (err) {
      const code = (err as { cause?: { code?: string } }).cause?.code ?? '';
      const kind: TelegramErrorKind = NETWORK_CODES.has(code) ? 'network' : 'uncertain';
      throw new TelegramError(method, kind, null, ctrl.signal.aborted ? 'timeout' : code || 'fetch failed');
    } finally {
      clearTimeout(timer);
    }
    let body: { ok: boolean; result?: T; description?: string; error_code?: number; parameters?: { retry_after?: number } };
    try {
      body = await res.json();
    } catch {
      throw new TelegramError(method, res.status >= 500 ? 'server' : 'uncertain', res.status, 'invalid JSON response');
    }
    if (body.ok) return body.result as T;
    const status = body.error_code ?? res.status;
    const description = body.description ?? 'unknown error';
    let kind: TelegramErrorKind = 'bad_request';
    if (status === 403) kind = 'blocked';
    else if (status === 429) kind = 'rate_limit';
    else if (status === 401) kind = 'unauthorized';
    else if (status >= 500) kind = 'server';
    else if (status === 400 && /chat not found|user not found|PEER_ID_INVALID/i.test(description)) kind = 'not_found';
    throw new TelegramError(method, kind, status, description, body.parameters?.retry_after ?? null);
  }

  getMe(): Promise<TgBotInfo> {
    return this.call('getMe');
  }

  getUpdates(offset: number | null, timeoutSec: number): Promise<TgUpdate[]> {
    return this.call(
      'getUpdates',
      { offset: offset ?? undefined, timeout: timeoutSec, allowed_updates: ALLOWED_UPDATES },
      (timeoutSec + 10) * 1000,
    );
  }

  setWebhook(url: string, secretToken: string): Promise<boolean> {
    return this.call('setWebhook', {
      url,
      secret_token: secretToken,
      allowed_updates: ALLOWED_UPDATES,
      drop_pending_updates: false,
      max_connections: 10,
    });
  }

  /** Снять webhook, сохранив недоставленные апдейты (их заберёт getUpdates). */
  deleteWebhook(): Promise<boolean> {
    return this.call('deleteWebhook', { drop_pending_updates: false });
  }

  getWebhookInfo(): Promise<TgWebhookInfo> {
    return this.call('getWebhookInfo');
  }

  getChat(chatId: number): Promise<TgChat> {
    return this.call('getChat', { chat_id: chatId });
  }

  getChatMember(chatId: number, userId: number): Promise<TgChatMember> {
    return this.call('getChatMember', { chat_id: chatId, user_id: userId });
  }

  sendMessage(
    chatId: number,
    text: string,
    opts: { keyboard?: BotKeyboard } = {},
  ): Promise<{ message_id: number }> {
    return this.call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: toInlineKeyboard(opts.keyboard),
    });
  }

  /**
   * Rich message (Bot API 10.1): заголовки, таблицы, списки, сворачиваемые блоки — до 32 768 символов.
   * Содержимое — HTML в поле rich_message.html.
   */
  sendRichMessage(chatId: number, html: string, opts: { keyboard?: BotKeyboard } = {}): Promise<{ message_id: number }> {
    return this.call('sendRichMessage', {
      chat_id: chatId,
      rich_message: { html, skip_entity_detection: true },
      link_preview_options: { is_disabled: true },
      reply_markup: toInlineKeyboard(opts.keyboard),
    });
  }

  /** Перерисовать сообщение на месте (экран настроек). «message is not modified» — не ошибка. */
  async editMessageText(chatId: number, messageId: number, text: string, opts: { keyboard?: BotKeyboard } = {}): Promise<void> {
    try {
      await this.call('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: toInlineKeyboard(opts.keyboard),
      });
    } catch (err) {
      if (err instanceof TelegramError && /message is not modified/i.test(err.description)) return;
      throw err;
    }
  }

  answerCallbackQuery(id: string, text: string, showAlert = false): Promise<boolean> {
    return this.call('answerCallbackQuery', { callback_query_id: id, text, show_alert: showAlert });
  }

  /** Закрепление в личном диалоге доступно боту без прав администратора. */
  pinChatMessage(chatId: number, messageId: number): Promise<boolean> {
    return this.call('pinChatMessage', { chat_id: chatId, message_id: messageId, disable_notification: true });
  }
}
