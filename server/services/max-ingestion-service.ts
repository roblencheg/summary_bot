import type { MessageRepository } from '~server/repositories/message-repository';
import type { MaxUpdateRepository, StoredMaxUpdate } from '~server/repositories/max-update-repository';
import type { IncomingMessage } from '~server/models/message';
import type { MaxCallback, MaxMessage, MaxUpdate } from '~server/integrations/max-client';
import type { BotCallback, FeedbackHandler } from './bot-callback';
import type { MaxCommandService } from './max-command-service';
import type { ChatService } from './chat-service';
import type { GapService } from './gap-service';
import type { RecipientService } from './recipient-service';
import type { RuntimeState } from './runtime-state';
import type { TechAlertService } from './tech-alert-service';
import { isSignificantEdit } from './ingestion-service';
import { TECH } from './settings-defaults';

/**
 * Приём MAX зеркалирует ingestion-service.ts для Telegram: сырой апдейт → чат/сообщение/
 * редакция/команда/callback. Отдельный файл, а не общий код с Telegram — транспорт и форма
 * апдейта разные, бизнес-правила (значимость правки, пробелы сбора) переиспользуются напрямую.
 */

/** Стабильный 31-битный числовой id из MAX mid (строка) — для UNIQUE(chat_id, message_id) и поиска правок.
 * AICODE-NOTE: MAX Bot API не документирует явно тип идентификатора сообщения в входящем апдейте —
 * предполагаем строковый `mid`; при подтверждении числового id на реальном токене хеш не нужен. */
function maxMessageIdFrom(mid: string): number {
  let h = 2166136261;
  for (let i = 0; i < mid.length; i++) {
    h ^= mid.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 1; // положительное 31-битное число
}

function displayName(m: MaxMessage): string {
  const u = m.sender;
  if (!u) return 'Неизвестный автор';
  return [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || `id ${u.user_id}`;
}

function normalize(m: MaxMessage, chatId: number, receivedAt: string): IncomingMessage {
  const text = m.body.text ?? '';
  const mid = m.body.mid ?? String(m.body.seq ?? m.timestamp);
  // AICODE-NOTE: единицы timestamp не подтверждены документацией — секунды короче 10^12, миллисекунды длиннее.
  const sentMs = m.timestamp > 10_000_000_000 ? m.timestamp : m.timestamp * 1000;
  return {
    chatId,
    messageId: maxMessageIdFrom(mid),
    sentAt: new Date(sentMs).toISOString(),
    receivedAt,
    authorKey: m.sender ? `u:${m.sender.user_id}` : null,
    authorId: m.sender ? m.sender.user_id : null,
    authorName: displayName(m),
    authorUsername: m.sender?.username ?? null,
    senderChatId: null,
    identityLimited: !m.sender,
    text,
    contentType: text ? 'text' : m.body.attachments?.length ? 'other' : 'text',
    hasText: text.trim().length > 0,
    replyToMessageId: null,
    threadId: null,
    // AICODE-NOTE: подтверждено официальной схемой MAX — `link` в Message/NewMessageBody означает
    // ссылку на сообщение для reply/forward (NewMessageLink/LinkedMessage), не публичный URL вида
    // t.me/c/.../id. У Chat есть поле `link`, но это ссылка-приглашение в чат (только для публичных
    // чатов, у приватных групп — null), не на конкретное сообщение. Постоянного message permalink
    // для MAX не существует — поэтому в алертах/саммари для MAX всегда текстовый фоллбэк
    // ««название», сообщение #id», как и у Telegram для групп без ссылки.
    link: null,
  };
}

export class MaxIngestionService {
  constructor(
    private readonly updates: MaxUpdateRepository,
    private readonly messages: MessageRepository,
    private readonly chats: ChatService,
    private readonly gaps: GapService,
    private readonly commands: MaxCommandService,
    private readonly recipients: RecipientService,
    private readonly techAlerts: TechAlertService,
    private readonly feedback: FeedbackHandler,
    private readonly state: RuntimeState,
  ) {}

  async store(update: MaxUpdate, marker: number | null): Promise<void> {
    await this.updates.insert(marker, update.update_type, update);
    this.state.wake('max-intake');
  }

  claim(limit: number): Promise<StoredMaxUpdate[]> {
    return this.updates.claim(limit, 60_000);
  }

  async process(stored: StoredMaxUpdate): Promise<void> {
    const u = stored.payload as MaxUpdate;
    try {
      const handled = await this.dispatch(u, stored.receivedAt);
      await this.updates.markDone(stored.id, handled ? 'done' : 'ignored');
    } catch (err) {
      const final = stored.attempts + 1 >= 5;
      console.error(`[max-intake] update ${stored.id} failed:`, (err as Error).message);
      await this.updates.markError(stored.id, (err as Error).message, final, 2 ** stored.attempts * 2000);
    }
  }

  private async dispatch(u: MaxUpdate, receivedAt: string): Promise<boolean> {
    switch (u.update_type) {
      case 'message_created':
        return u.message ? this.onMessage(u.message, receivedAt) : false;
      case 'message_edited':
        return u.message ? this.onEdit(u.message, receivedAt) : false;
      case 'bot_added':
      case 'bot_removed':
        return this.onMembership(u, u.update_type === 'bot_removed');
      case 'bot_started':
        if (u.user) await this.commands.handleStarted(u.user, u.payload ?? null);
        return true;
      case 'message_callback':
        if (u.callback) await this.feedback.handleCallback(toBotCallback(u.callback));
        return true;
      default:
        return false;
    }
  }

  private async onMessage(m: MaxMessage, receivedAt: string): Promise<boolean> {
    const chatId = m.recipient.chat_id;
    if (m.recipient.chat_type === 'dialog' || !chatId) {
      // AICODE-NOTE: Recipient.user_id в схеме MAX — «если сообщение адресовано пользователю», что в
      // входящем от человека сообщении описывает получателя (бота), а не отправителя — на практике
      // наблюдался 0. Для ответа всегда берём sender.user_id — отправителя (человека), а не recipient.
      if (m.sender) await this.commands.handlePrivate(m.sender.user_id, m.sender, m.body.text ?? '');
      return true;
    }
    if (m.recipient.chat_type !== 'chat') return false;

    const chat = await this.chats.seen({ id: chatId, title: await this.knownTitle(chatId), type: 'chat', username: null, isForum: false, channel: 'max' });
    if (await this.commands.handleGroup(chatId, m.body.text ?? '', m.sender?.user_id ?? 0)) return true;
    if (chat.status !== 'active') return false;

    const incoming = normalize(m, chatId, receivedAt);
    const isStaff = await this.chats.isStaff(chat.id, incoming.authorId);
    const inserted = await this.messages.insert(incoming, isStaff);
    if (!inserted) return true;
    if (incoming.authorKey) {
      await this.messages.upsertParticipant({
        authorKey: incoming.authorKey,
        telegramUserId: incoming.authorId,
        senderChatId: null,
        displayName: incoming.authorName,
        username: incoming.authorUsername,
        seenAt: incoming.sentAt,
      });
    }
    await this.chats.touchMessage(chat.id, incoming.sentAt);
    await this.gaps.noteLateMessage(incoming.sentAt, receivedAt);
    if (incoming.hasText) this.state.wake('analysis');
    return true;
  }

  private async onEdit(m: MaxMessage, receivedAt: string): Promise<boolean> {
    const chatId = m.recipient.chat_id;
    if (m.recipient.chat_type !== 'chat' || !chatId) return false;
    const mid = m.body.mid ?? String(m.body.seq ?? m.timestamp);
    const existing = await this.messages.findByChatMessage(chatId, maxMessageIdFrom(mid));
    if (!existing) return this.onMessage(m, receivedAt);
    const newText = m.body.text ?? '';
    if (newText === existing.text) return true;
    const sentMs = m.timestamp > 10_000_000_000 ? m.timestamp : m.timestamp * 1000;
    const editedAt = new Date(sentMs).toISOString();
    const significant = isSignificantEdit(existing.text, newText);
    await this.messages.insertRevision(existing.id, editedAt, existing.text, newText, significant);
    await this.messages.applyEdit(existing.id, newText, editedAt, significant);
    if (significant) this.state.wake('analysis');
    return true;
  }

  private async onMembership(u: MaxUpdate, removedEvent: boolean): Promise<boolean> {
    const chatId = u.chat_id;
    if (!chatId) return false;
    await this.chats.seen({ id: chatId, title: await this.knownTitle(chatId), type: 'chat', username: null, isForum: false, channel: 'max' });
    const { removed, chat } = await this.chats.botMembershipChanged(chatId, 'max', removedEvent ? 'kicked' : 'member', true);
    if (removed && chat) {
      await this.techAlerts.raise(`bot_removed:${chat.id}`, `Бот MAX удалён из чата «${chat.title}». Сбор по чату остановлен.`);
    }
    // MAX не присылает права бота в самом событии bot_added (в отличие от Telegram my_chat_member,
    // там can_read_all_group_messages приходит сразу) — botMembershipChanged выше ставит readsAll=true
    // оптимистично, здесь проверяем реально и перезатираем, если прав на самом деле нет.
    if (!removedEvent) await this.chats.checkRightsMax(chatId);
    return true;
  }

  /**
   * MAX не передаёт название группы в message_created/bot_added — только GET /chats/{chatId}
   * (см. checkRightsMax). upsertSeen безусловно перезаписывает title при каждом вызове (для Telegram
   * это нужно — там title приходит в каждом апдейте и подхватывает переименования); для MAX это раньше
   * затирало уже известное правильное название плейсхолдером «Чат <id>» на первом же следующем сообщении.
   * Поэтому здесь всегда передаём уже известный title, а не генерируем плейсхолдер заново.
   */
  private async knownTitle(chatId: number): Promise<string> {
    const existing = await this.chats.get(chatId);
    return existing?.title ?? `Чат ${chatId}`;
  }
}

function toBotCallback(cb: MaxCallback): BotCallback {
  // AICODE-NOTE: здесь messageId — это НЕ внутренний хеш maxMessageIdFrom (тот только для
  // дедупликации входящих сообщений в БД), а числовое представление нативного MAX mid,
  // которое дальше уходит обратно в PUT /messages при перерисовке экрана настроек.
  const nativeId = cb.message?.body?.mid ? Number(cb.message.body.mid) : NaN;
  return {
    channel: 'max',
    id: cb.callback_id,
    fromId: cb.user.user_id,
    chatId: cb.message?.recipient.chat_id ?? cb.user.user_id,
    messageId: Number.isFinite(nativeId) ? nativeId : null,
    data: cb.payload ?? '',
  };
}
