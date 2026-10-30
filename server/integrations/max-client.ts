import type { BotKeyboard } from '~server/domain/keyboard';

/**
 * Тонкая fetch-обёртка над MAX Bot API (https://dev.max.ru/docs-api/). Без БД и бизнес-правил.
 * AICODE-NOTE: собрано по официальной OpenAPI-схеме (github.com/max-messenger/api-schema) и
 * dev.max.ru/docs-api на 2026-10-30 — часть деталей (точный формат deep-link, подпись webhook,
 * полный список update_type) документация не раскрывает явно; см. design.md «Открытые вопросы».
 * Токен передаётся только в заголовке Authorization и никогда не попадает в логи и тексты ошибок.
 *
 * AICODE-NOTE: platform-api2.max.ru отдаёт сертификат, подписанный российским
 * национальным УЦ (Минцифры, «Russian Trusted Root/Sub CA») — его нет в дефолтном
 * доверенном наборе Node. Без явной настройки fetch падает с
 * UNABLE_TO_GET_ISSUER_CERT_LOCALLY. Доверенная цепочка подложена через
 * NODE_EXTRA_CA_CERTS (см. .platform/dev-start.sh и .platform/prod-start.sh,
 * файл server/certs/russian-trusted-ca-bundle.pem) — это глобальная для процесса,
 * но не ослабляющая проверку сертификатов настройка (добавляет доверие к одному
 * легитимному гос. УЦ, а не отключает верификацию TLS).
 */

const BASE_URL = 'https://platform-api2.max.ru';

export type MaxErrorKind =
  | 'blocked' // бот заблокирован получателем / диалог недоступен
  | 'not_found'
  | 'rate_limit'
  | 'bad_request'
  | 'unauthorized'
  | 'server'
  | 'network'
  | 'uncertain';

export class MaxError extends Error {
  constructor(
    public readonly method: string,
    public readonly kind: MaxErrorKind,
    public readonly httpStatus: number | null,
    public readonly description: string,
    public readonly retryAfterSec: number | null = null,
  ) {
    super(`MAX ${method}: ${kind}${httpStatus ? ` ${httpStatus}` : ''} — ${description}`);
    this.name = 'MaxError';
  }
}

export interface MaxUser {
  user_id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  is_bot?: boolean;
}

export interface MaxChat {
  chat_id: number;
  type: 'dialog' | 'chat' | 'channel';
  title?: string;
}

export interface MaxMessageBody {
  mid?: string;
  seq?: number;
  text?: string;
  attachments?: unknown[];
}

export interface MaxMessage {
  sender?: MaxUser;
  recipient: { chat_id?: number; chat_type?: string; user_id?: number };
  timestamp: number;
  body: MaxMessageBody;
}

export interface MaxCallback {
  callback_id: string;
  payload?: string;
  user: MaxUser;
  message?: { recipient: { chat_id?: number }; body?: MaxMessageBody };
}

export interface MaxBotStarted {
  chat_id: number;
  user: MaxUser;
  payload?: string;
}

export interface MaxBotAdded {
  chat_id: number;
  user: MaxUser;
}

export interface MaxUpdate {
  update_type: string;
  timestamp: number;
  message?: MaxMessage;
  callback?: MaxCallback;
  chat_id?: number;
  user?: MaxUser;
  payload?: string;
}

export interface MaxBotInfo {
  user_id: number;
  username?: string;
  first_name?: string;
}

const NETWORK_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT']);

function toKeyboardAttachment(keyboard: BotKeyboard | undefined): unknown[] | undefined {
  if (!keyboard) return undefined;
  // AICODE-NOTE: точная обёртка клавиатуры (имя типа attachment, вложенность payload) не
  // подтверждена документацией — собрана по аналогии с CallbackButton{type,text,payload} из
  // OpenAPI-схемы. Проверить на реальном токене при подключении.
  return [
    {
      type: 'inline_keyboard',
      payload: {
        buttons: keyboard.map((row) => row.map((b) => ({ type: 'callback', text: b.text, payload: b.data }))),
      },
    },
  ];
}

export class MaxClient {
  constructor(private readonly token: string) {}

  async call<T>(method: string, path: string, params: Record<string, unknown> = {}, body?: unknown, timeoutMs = 15_000): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const query = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&');
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}${path}${query ? `?${query}` : ''}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: this.token },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } catch (err) {
      const code = (err as { cause?: { code?: string } }).cause?.code ?? '';
      const kind: MaxErrorKind = NETWORK_CODES.has(code) ? 'network' : 'uncertain';
      throw new MaxError(path, kind, null, ctrl.signal.aborted ? 'timeout' : code || 'fetch failed');
    } finally {
      clearTimeout(timer);
    }
    let parsed: unknown;
    try {
      parsed = res.status === 204 ? null : await res.json();
    } catch {
      throw new MaxError(path, res.status >= 500 ? 'server' : 'uncertain', res.status, 'invalid JSON response');
    }
    if (res.ok) return parsed as T;
    const errBody = parsed as { code?: string; message?: string } | null;
    const description = errBody?.message ?? errBody?.code ?? 'unknown error';
    let kind: MaxErrorKind = 'bad_request';
    if (res.status === 403) kind = 'blocked';
    else if (res.status === 429) kind = 'rate_limit';
    else if (res.status === 401) kind = 'unauthorized';
    else if (res.status >= 500) kind = 'server';
    else if (res.status === 404) kind = 'not_found';
    throw new MaxError(path, kind, res.status, description);
  }

  getMe(): Promise<MaxBotInfo> {
    return this.call('GET', '/me');
  }

  /** Карточка чата (в т.ч. реальное название группы — bot_added/bot_removed его не передают). */
  getChat(chatId: number): Promise<{ chat_id: number; type: string; title: string | null }> {
    return this.call('GET', `/chats/${chatId}`);
  }

  /**
   * Права бота в группе: GET /chats/{chatId}/members/me. По официальной схеме MAX
   * (MessageCreatedUpdate) бот получает message_created в группе только если он администратор
   * с правом read_all_messages — иначе события о чужих сообщениях не приходят вообще, без ошибки.
   * Аналог Telegram privacy mode, но без автоматического уведомления о сбое — проверяется явно.
   */
  getMembership(chatId: number): Promise<{ is_admin: boolean; permissions: string[] | null }> {
    return this.call('GET', `/chats/${chatId}/members/me`);
  }

  getUpdates(marker: number | null, timeoutSec: number): Promise<{ updates: MaxUpdate[]; marker: number | null }> {
    return this.call('GET', '/updates', { marker: marker ?? undefined, timeout: timeoutSec, limit: 100 }, undefined, (timeoutSec + 10) * 1000);
  }

  subscribe(url: string): Promise<unknown> {
    return this.call('POST', '/subscriptions', {}, { url });
  }

  unsubscribe(url: string): Promise<unknown> {
    return this.call('DELETE', '/subscriptions', { url });
  }

  listSubscriptions(): Promise<{ subscriptions: Array<{ url: string }> }> {
    return this.call('GET', '/subscriptions');
  }

  /**
   * Личный диалог с пользователем (привязка, саммари, алерты, меню, тест) — по схеме POST /messages
   * параметр адресации `user_id`, а не `chat_id`. `chat_id` у MAX предназначен только для
   * чата/канала (см. sendToChat) — перепутать легко, т.к. у Telegram приватный чат и user_id
   * совпадают, а у MAX это разные id-пространства; подстановка user_id в chat_id даёт
   * `404 Chat not found`.
   */
  async sendMessage(userId: number, text: string, opts: { keyboard?: BotKeyboard } = {}): Promise<{ message_id: number }> {
    return this.send({ user_id: userId }, text, opts);
  }

  /** Сообщение в группу/канал MAX (например, подтверждение подключения чата к дирекции) — адресация `chat_id`. */
  async sendToChat(chatId: number, text: string, opts: { keyboard?: BotKeyboard } = {}): Promise<{ message_id: number }> {
    return this.send({ chat_id: chatId }, text, opts);
  }

  private async send(target: Record<string, number>, text: string, opts: { keyboard?: BotKeyboard }): Promise<{ message_id: number }> {
    const res = await this.call<{ message: { body: { mid: string } } }>(
      'POST',
      '/messages',
      target,
      { text, format: 'html', attachments: toKeyboardAttachment(opts.keyboard) },
    );
    return { message_id: Number(res.message.body.mid) || 0 };
  }

  /** «message is not modified» — MAX не документирует отдельный код; повторная правка тем же текстом просто не ошибка. */
  async editMessage(messageId: number, text: string, opts: { keyboard?: BotKeyboard } = {}): Promise<void> {
    await this.call('PUT', '/messages', { message_id: messageId }, { text, format: 'html', attachments: toKeyboardAttachment(opts.keyboard) });
  }

  async answerCallback(callbackId: string, text: string): Promise<void> {
    await this.call('POST', '/answers', { callback_id: callbackId }, { notification: text });
  }
}
