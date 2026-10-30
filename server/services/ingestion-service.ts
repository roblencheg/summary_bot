import type { MessageRepository } from '~server/repositories/message-repository';
import type { UpdateRepository, StoredUpdate } from '~server/repositories/update-repository';
import type { IncomingMessage } from '~server/models/message';
import type { TgCallbackQuery, TgChatMemberUpdated, TgMessage, TgUpdate } from '~server/integrations/telegram-client';
import type { BotCallback, FeedbackHandler } from './bot-callback';
import type { BotCommandService } from './bot-command-service';
import type { ChatService } from './chat-service';
import type { GapService } from './gap-service';
import type { RecipientService } from './recipient-service';
import type { RuntimeState } from './runtime-state';
import type { TechAlertService } from './tech-alert-service';
import { TECH } from './settings-defaults';

// служебные аккаунты Telegram: анонимный админ группы и пересылки из связанного канала
const ANONYMOUS_IDS = new Set([1087968824, 136817688, 777000]);

export function toBotCallback(cb: TgCallbackQuery): BotCallback {
  return {
    channel: 'telegram',
    id: cb.id,
    fromId: cb.from.id,
    chatId: cb.message?.chat.id ?? cb.from.id,
    messageId: cb.message?.message_id ?? null,
    data: cb.data ?? '',
  };
}

export function updateKind(u: TgUpdate): string {
  return (
    (['message', 'edited_message', 'channel_post', 'edited_channel_post', 'my_chat_member', 'callback_query'] as const).find(
      (k) => u[k] !== undefined,
    ) ?? 'other'
  );
}

function displayName(m: TgMessage): string {
  if (m.sender_chat) return m.sender_chat.title ?? m.author_signature ?? 'Скрытый автор';
  if (m.from) return [m.from.first_name, m.from.last_name].filter(Boolean).join(' ') || m.from.username || `id ${m.from.id}`;
  return 'Неизвестный автор';
}

function contentType(m: TgMessage): string {
  if (m.text !== undefined) return 'text';
  for (const k of ['photo', 'video', 'document', 'voice', 'audio', 'video_note', 'sticker', 'animation', 'contact', 'location', 'poll'] as const) {
    if (m[k] !== undefined) return k;
  }
  return 'other';
}

function isServiceMessage(m: TgMessage): boolean {
  return Boolean(m.new_chat_members || m.left_chat_member || m.new_chat_title || m.migrate_to_chat_id || m.migrate_from_chat_id);
}

/** Ссылка на сообщение: публичный чат — t.me/<username>, приватная супергруппа — t.me/c/…, обычная группа — нет. */
export function messageLink(m: TgMessage): string | null {
  const chat = m.chat;
  if (chat.type !== 'supergroup') return null;
  const thread = chat.is_forum && m.message_thread_id && m.is_topic_message ? `${m.message_thread_id}/` : '';
  if (chat.username) return `https://t.me/${chat.username}/${thread}${m.message_id}`;
  const internal = String(chat.id).replace(/^-100/, '');
  return `https://t.me/c/${internal}/${thread}${m.message_id}`;
}

export function normalize(m: TgMessage, receivedAt: string): IncomingMessage {
  const text = m.text ?? m.caption ?? '';
  const anonymous = Boolean(m.sender_chat) || (m.from ? ANONYMOUS_IDS.has(m.from.id) : true);
  const authorKey = m.sender_chat ? `c:${m.sender_chat.id}` : m.from ? `u:${m.from.id}` : null;
  return {
    chatId: m.chat.id,
    messageId: m.message_id,
    sentAt: new Date(m.date * 1000).toISOString(),
    receivedAt,
    authorKey,
    authorId: m.from && !anonymous ? m.from.id : null,
    authorName: displayName(m),
    authorUsername: m.sender_chat ? (m.sender_chat.username ?? null) : (m.from?.username ?? null),
    senderChatId: m.sender_chat?.id ?? null,
    identityLimited: anonymous,
    text,
    contentType: contentType(m),
    hasText: text.trim().length > 0,
    replyToMessageId: m.reply_to_message && m.reply_to_message.message_id !== m.message_thread_id ? m.reply_to_message.message_id : null,
    threadId: m.chat.is_forum ? (m.message_thread_id ?? null) : null,
    link: messageLink(m),
  };
}

/** Доля изменения текста (Левенштейн / длина) или изменение чисел. */
export function isSignificantEdit(oldText: string, newText: string): boolean {
  const digits = (s: string) => (s.match(/\d+/g) ?? []).join(',');
  if (digits(oldText) !== digits(newText)) return true;
  const a = oldText.slice(0, 2000);
  const b = newText.slice(0, 2000);
  if (a === b) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length] / Math.max(a.length, b.length, 1) > TECH.revisionThreshold;
}

/** Приём: сырой апдейт → чат/сообщение/редакция/команда/оценка. */
export class IngestionService {
  constructor(
    private readonly updates: UpdateRepository,
    private readonly messages: MessageRepository,
    private readonly chats: ChatService,
    private readonly gaps: GapService,
    private readonly commands: BotCommandService,
    private readonly recipients: RecipientService,
    private readonly techAlerts: TechAlertService,
    private readonly feedback: FeedbackHandler,
    private readonly state: RuntimeState,
  ) {}

  /** Сохранить сырой апдейт. false — повтор того же update_id. */
  async store(update: TgUpdate): Promise<boolean> {
    const inserted = await this.updates.insert(update.update_id, updateKind(update), update);
    if (inserted) this.state.wake('intake');
    return inserted;
  }

  claim(limit: number): Promise<StoredUpdate[]> {
    return this.updates.claim(limit, 60_000);
  }

  async process(stored: StoredUpdate): Promise<void> {
    const u = stored.payload as TgUpdate;
    try {
      const handled = await this.dispatch(u, stored.receivedAt);
      await this.updates.markDone(stored.updateId, handled ? 'done' : 'ignored');
    } catch (err) {
      const final = stored.attempts + 1 >= 5;
      console.error(`[intake] update ${stored.updateId} failed:`, (err as Error).message);
      await this.updates.markError(stored.updateId, (err as Error).message, final, 2 ** stored.attempts * 2000);
    }
  }

  private async dispatch(u: TgUpdate, receivedAt: string): Promise<boolean> {
    if (u.message) return this.onMessage(u.message, receivedAt);
    if (u.edited_message) return this.onEdit(u.edited_message, receivedAt);
    if (u.my_chat_member) return this.onMembership(u.my_chat_member);
    if (u.callback_query) {
      await this.feedback.handleCallback(toBotCallback(u.callback_query));
      return true;
    }
    return false; // каналы и прочее не собираем
  }

  private async onMessage(m: TgMessage, receivedAt: string): Promise<boolean> {
    if (m.chat.type === 'private') {
      await this.commands.handlePrivate(m);
      return true;
    }
    if (m.chat.type !== 'group' && m.chat.type !== 'supergroup') return false;

    if (m.migrate_to_chat_id) {
      await this.chats.migrate(m.chat.id, m.migrate_to_chat_id);
      return true;
    }
    const chat = await this.chats.seen({
      id: m.chat.id,
      title: m.chat.title ?? `Чат ${m.chat.id}`,
      type: m.chat.type,
      username: m.chat.username ?? null,
      isForum: m.chat.is_forum === true,
      channel: 'telegram',
    });
    // подключение группы к дирекции по коду руководителя — команда, а не сообщение поддержки
    if (await this.commands.handleGroup(m)) return true;
    if (chat.status !== 'active' || isServiceMessage(m) || m.is_automatic_forward) return false;

    const incoming = normalize(m, receivedAt);
    const isStaff = await this.chats.isStaff(chat.id, incoming.authorId);
    const inserted = await this.messages.insert(incoming, isStaff);
    if (!inserted) return true; // повторная доставка — дубля нет
    if (incoming.authorKey) {
      await this.messages.upsertParticipant({
        authorKey: incoming.authorKey,
        telegramUserId: incoming.authorId,
        senderChatId: incoming.senderChatId,
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

  private async onEdit(m: TgMessage, receivedAt: string): Promise<boolean> {
    if (m.chat.type !== 'group' && m.chat.type !== 'supergroup') return false;
    const existing = await this.messages.findByChatMessage(m.chat.id, m.message_id);
    if (!existing) {
      // правка сообщения, которого у нас нет (до подключения) — сохраняем как новое, если чат активен
      return this.onMessage(m, receivedAt);
    }
    const newText = m.text ?? m.caption ?? '';
    if (newText === existing.text) return true;
    const editedAt = new Date((m.edit_date ?? m.date) * 1000).toISOString();
    const significant = isSignificantEdit(existing.text, newText);
    await this.messages.insertRevision(existing.id, editedAt, existing.text, newText, significant);
    await this.messages.applyEdit(existing.id, newText, editedAt, significant);
    if (significant) this.state.wake('analysis');
    return true;
  }

  private async onMembership(u: TgChatMemberUpdated): Promise<boolean> {
    const status = u.new_chat_member.status;
    if (u.chat.type === 'private') {
      if (status === 'kicked') await this.recipients.userBlockedBot('telegram', u.from.id);
      else if (status === 'member') await this.recipients.userUnblockedBot('telegram', u.from.id);
      return true;
    }
    if (u.chat.type !== 'group' && u.chat.type !== 'supergroup') return false;
    await this.chats.seen({
      id: u.chat.id,
      title: u.chat.title ?? `Чат ${u.chat.id}`,
      type: u.chat.type,
      username: u.chat.username ?? null,
      isForum: u.chat.is_forum === true,
      channel: 'telegram',
    });
    const { removed, chat } = await this.chats.botMembershipChanged(u.chat.id, 'telegram', status, u.new_chat_member.can_read_all_group_messages);
    if (removed && chat) {
      await this.techAlerts.raise(
        `bot_removed:${chat.id}`,
        `Бот удалён из чата «${chat.title}» или лишён прав (статус: ${status}). Сбор по чату остановлен.`,
      );
    }
    return true;
  }
}
