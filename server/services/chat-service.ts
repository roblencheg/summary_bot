import type { ChatRepository } from '~server/repositories/chat-repository';
import type { Chat, ChatStaff, ChatWithRules } from '~server/models/chat';
import type { ChatRules } from '~server/models/settings';
import { TelegramError } from '~server/integrations/telegram-client';
import { MaxError } from '~server/integrations/max-client';
import type { Channel } from '~shared/domain';
import type { AuditService } from './audit-service';
import type { BotService } from './bot-service';
import type { MaxBotService } from './max-bot-service';
import type { GapService } from './gap-service';
import type { SettingsService } from './settings-service';
import type { SubscriptionService } from './subscription-service';
import { NotFoundError, ValidationError } from './errors';

export class ChatService {
  private staffCache: Map<number, Set<number>> | null = null;

  constructor(
    private readonly repo: ChatRepository,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly bot: BotService,
    private readonly maxBot: MaxBotService,
    private readonly gaps: GapService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  list(): Promise<Chat[]> {
    return this.repo.list();
  }

  get(id: number): Promise<Chat | null> {
    return this.repo.get(id);
  }

  getMany(ids: number[]): Promise<Chat[]> {
    return this.repo.getMany(ids);
  }

  async details(id: number): Promise<ChatWithRules> {
    const chat = await this.repo.get(id);
    if (!chat) throw new NotFoundError('Чат не найден');
    return { ...chat, rulesOverride: await this.settings.chatOverride(id), staff: await this.repo.listStaff(id) };
  }

  /** Событие в группе: регистрируем чат (статус «ожидает подключения» для новых). Канал фиксируется один раз. */
  async seen(c: { id: number; title: string; type: string; username: string | null; isForum: boolean; channel: Channel }): Promise<Chat> {
    await this.repo.upsertSeen(c);
    const chat = await this.repo.get(c.id);
    if (!chat) throw new Error('chat upsert failed');
    return chat;
  }

  touchMessage(id: number, sentAt: string): Promise<void> {
    return this.repo.touchMessage(id, sentAt);
  }

  async botMembershipChanged(chatId: number, channel: Channel, status: string, readsAll: boolean | undefined): Promise<{ removed: boolean; chat: Chat | null }> {
    const isAdmin = status === 'administrator' || status === 'creator';
    await this.repo.setBotMember(chatId, status, isAdmin);
    const chat = await this.repo.get(chatId);
    if (!chat) return { removed: false, chat: null };
    if (status === 'left' || status === 'kicked') {
      if (chat.status !== 'removed' && chat.status !== 'migrated') {
        const wasActive = chat.status === 'active';
        await this.repo.setStatus(chatId, 'removed');
        if (wasActive) await this.gaps.openBotRemoved(chatId, `Статус бота: ${status}`);
        // архив: подписки снимаются сразу; при возврате бота не восстанавливаются — назначает администратор
        await this.subscriptions.purgeChat(chatId, channel);
        await this.audit.record(channel, 'chat.bot_removed', 'chat', String(chatId), { status: chat.status }, { status: 'removed' });
        return { removed: wasActive, chat };
      }
      return { removed: false, chat };
    }
    if (chat.status === 'removed') {
      const restored = chat.collectionStartedAt ? 'active' : 'pending';
      await this.repo.setStatus(chatId, restored);
      await this.gaps.closeBotRemoved(chatId);
      await this.audit.record(channel, 'chat.bot_returned', 'chat', String(chatId), { status: 'removed' }, { status: restored });
    }
    await this.repo.setRights(chatId, {
      memberStatus: status,
      isAdmin,
      readsAll: isAdmin || readsAll === true ? true : readsAll === false ? false : null,
      error: null,
    });
    return { removed: false, chat: await this.repo.get(chatId) };
  }

  async migrate(oldId: number, newId: number): Promise<void> {
    await this.repo.migrate(oldId, newId);
    this.staffCache = null;
    await this.audit.record('telegram', 'chat.migrate', 'chat', String(oldId), null, { migratedTo: newId });
  }

  /** Проверка прав бота и privacy mode (getMe + getChatMember + getChat). Только для Telegram — см. checkRightsMax. */
  async checkRights(chatId: number): Promise<Chat> {
    const client = this.bot.client;
    if (!client) {
      await this.repo.setRights(chatId, { memberStatus: null, isAdmin: null, readsAll: null, error: 'TELEGRAM_BOT_TOKEN не задан' });
      return (await this.repo.get(chatId))!;
    }
    try {
      const me = await this.bot.getMe(true);
      if (!me) throw new Error('getMe недоступен');
      const member = await client.getChatMember(chatId, me.id);
      const info = await client.getChat(chatId);
      const isAdmin = member.status === 'administrator' || member.status === 'creator';
      const readsAll = isAdmin || me.can_read_all_group_messages === true;
      const present = !['left', 'kicked'].includes(member.status);
      let error: string | null = null;
      if (!present) error = 'Бота нет в чате';
      else if (!readsAll)
        error =
          'Бот видит только команды и ответы на свои сообщения: privacy mode включён и бот не администратор. ' +
          'Отключите privacy mode в @BotFather (/setprivacy → Disable) и добавьте бота в чат заново, либо назначьте бота администратором.';
      await this.repo.setRights(chatId, {
        memberStatus: member.status,
        isAdmin,
        readsAll,
        error,
        isForum: info.is_forum === true,
        username: info.username ?? null,
        title: info.title,
      });
    } catch (err) {
      const msg = err instanceof TelegramError ? `${err.kind}: ${err.description}` : (err as Error).message;
      await this.repo.setRights(chatId, { memberStatus: null, isAdmin: null, readsAll: null, error: `Проверка не удалась — ${msg}` });
    }
    return (await this.repo.get(chatId))!;
  }

  /**
   * Проверка прав для MAX: GET /chats/{chatId}/members/me — подтверждено официальной схемой MAX,
   * message_created в группе бот получает только если он администратор с read_all_messages
   * (аналог privacy mode у Telegram, но без автоматического уведомления о сбое со стороны MAX).
   */
  async checkRightsMax(chatId: number): Promise<Chat> {
    const client = this.maxBot.client;
    if (!client) {
      await this.repo.setRights(chatId, { memberStatus: null, isAdmin: null, readsAll: null, error: 'MAX_BOT_TOKEN не задан' });
      return (await this.repo.get(chatId))!;
    }
    try {
      const member = await client.getMembership(chatId);
      const readsAll = member.is_admin && (member.permissions?.includes('read_all_messages') ?? false);
      const error = readsAll
        ? null
        : 'Бот не видит обычные сообщения: нужны права администратора чата MAX с разрешением «чтение всех сообщений» (read_all_messages). ' +
          'Назначьте бота администратором чата и выдайте это право.';
      // bot_added/bot_removed не передают название группы (в отличие от Telegram my_chat_member) —
      // подтягиваем реальный title здесь же, иначе чат остаётся с заглушкой «Чат <id>».
      const info = await client.getChat(chatId).catch(() => null);
      await this.repo.setRights(chatId, { memberStatus: 'member', isAdmin: member.is_admin, readsAll, error, title: info?.title ?? undefined });
    } catch (err) {
      const msg = err instanceof MaxError ? `${err.kind}: ${err.description}` : (err as Error).message;
      await this.repo.setRights(chatId, { memberStatus: null, isAdmin: null, readsAll: null, error: `Проверка не удалась — ${msg}` });
    }
    return (await this.repo.get(chatId))!;
  }

  /** Проверка прав по кнопке «Проверить права» — выбирает метод по каналу чата. */
  async checkRightsFor(chatId: number): Promise<Chat> {
    const chat = await this.repo.get(chatId);
    if (!chat) throw new NotFoundError('Чат не найден');
    return chat.channel === 'max' ? this.checkRightsMax(chatId) : this.checkRights(chatId);
  }

  async activate(chatId: number, actor: string): Promise<Chat> {
    const chat = await this.repo.get(chatId);
    if (!chat) throw new NotFoundError('Чат не найден');
    if (chat.status === 'removed' || chat.status === 'migrated') throw new ValidationError('Бота нет в этом чате — добавьте его снова');
    if (chat.status !== 'active') {
      await this.repo.setStatus(chatId, 'active', new Date().toISOString());
      await this.audit.record(actor, 'chat.activate', 'chat', String(chatId), { status: chat.status }, { status: 'active' });
    }
    return chat.channel === 'max' ? this.checkRightsMax(chatId) : this.checkRights(chatId);
  }

  async deactivate(chatId: number, actor: string): Promise<Chat> {
    const chat = await this.repo.get(chatId);
    if (!chat) throw new NotFoundError('Чат не найден');
    if (chat.status === 'active') {
      await this.repo.setStatus(chatId, 'disabled');
      await this.audit.record(actor, 'chat.deactivate', 'chat', String(chatId), { status: 'active' }, { status: 'disabled' });
    }
    return (await this.repo.get(chatId))!;
  }

  async setStaff(chatId: number, staff: Array<{ telegramUserId: number; label: string | null }>, actor: string): Promise<ChatStaff[]> {
    if (!(await this.repo.get(chatId))) throw new NotFoundError('Чат не найден');
    const ids = new Set<number>();
    for (const s of staff) {
      if (!Number.isSafeInteger(s.telegramUserId) || s.telegramUserId <= 0) throw new ValidationError('Telegram ID — положительное число');
      if (ids.has(s.telegramUserId)) throw new ValidationError(`Дубликат Telegram ID ${s.telegramUserId}`);
      ids.add(s.telegramUserId);
    }
    const prev = await this.repo.listStaff(chatId);
    await this.repo.replaceStaff(chatId, staff);
    this.staffCache = null;
    const next = await this.repo.listStaff(chatId);
    await this.audit.record(actor, 'chat.staff.update', 'chat', String(chatId), prev, next);
    return next;
  }

  async setRules(chatId: number, override: Partial<ChatRules>, actor: string): Promise<void> {
    if (!(await this.repo.get(chatId))) throw new NotFoundError('Чат не найден');
    await this.settings.setChatOverride(chatId, override, actor);
  }

  async isStaff(chatId: number, userId: number | null): Promise<boolean> {
    if (userId === null) return false;
    if (!this.staffCache) {
      const all = await this.repo.listAllStaff();
      this.staffCache = new Map();
      for (const s of all) {
        if (!this.staffCache.has(s.chatId)) this.staffCache.set(s.chatId, new Set());
        this.staffCache.get(s.chatId)!.add(s.telegramUserId);
      }
    }
    return this.staffCache.get(chatId)?.has(userId) ?? false;
  }

  async staffConfigured(chatId: number): Promise<boolean> {
    await this.isStaff(chatId, -1);
    return (this.staffCache?.get(chatId)?.size ?? 0) > 0;
  }

  listActive(): Promise<Chat[]> {
    return this.repo.listActive();
  }
}
