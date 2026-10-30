import type { DeliveryRepository } from '~server/repositories/delivery-repository';
import type { OnDemandRepository } from '~server/repositories/on-demand-repository';
import type { Channel } from '~shared/domain';
import type { BotKeyboard } from '~server/domain/keyboard';
import { periodContaining } from '~server/domain/periods';
import type { AuditService } from './audit-service';
import type { BotCallback, FeedbackHandler } from './bot-callback';
import type { ChannelBots } from './channel-bots';
import type { ChatService } from './chat-service';
import type { RecipientService } from './recipient-service';
import type { RuntimeState } from './runtime-state';
import type { SettingsService } from './settings-service';
import type { SubscriptionService } from './subscription-service';
import { NotFoundError, ValidationError } from './errors';
import { TECH } from './settings-defaults';
import { SETTINGS_OPEN } from './incident-settings-service';

export const MENU_NOW = 'menu:now';

/** Текст и кнопки закрепляемого меню бота — нейтрально, конкретный провод клавиатуры собирает клиент канала. */
export function menuMessage(): { text: string; keyboard: BotKeyboard } {
  return {
    text: [
      '📌 <b>Меню мониторинга поддержки</b>',
      '',
      '📍 <b>Что сейчас происходит</b> — сводка по вашим чатам с последнего саммари (08:00 или 22:00) до текущего момента.',
      '⚙️ <b>Настройки инцидентов</b> — какие категории алертов присылать и с какой серьёзности.',
      '',
      '<i>Если сообщение не закрепилось — нажмите на него и выберите «Закрепить».</i>',
    ].join('\n'),
    keyboard: [[{ text: '📍 Что сейчас происходит', data: MENU_NOW }], [{ text: '⚙️ Настройки инцидентов', data: SETTINGS_OPEN }]],
  };
}

/**
 * Меню бота и дайджест «Что сейчас происходит» по запросу получателя — отдельно по каждому каналу.
 * Права проверяются при нажатии и ещё раз при отправке (DeliveryService).
 */
export class OnDemandService implements FeedbackHandler {
  constructor(
    private readonly repo: OnDemandRepository,
    private readonly deliveries: DeliveryRepository,
    private readonly recipients: RecipientService,
    private readonly subscriptions: SubscriptionService,
    private readonly chats: ChatService,
    private readonly settings: SettingsService,
    private readonly bots: ChannelBots,
    private readonly audit: AuditService,
    private readonly runtime: RuntimeState,
  ) {}

  /** Чаты дайджеста в заданном канале — разрешённые получателю: подписки на саммари и на алерты, своего канала. */
  async allowedChatIds(recipientId: number, channel: Channel): Promise<number[]> {
    const [summary, alert] = await Promise.all([
      this.subscriptions.chatIds('summary', recipientId),
      this.subscriptions.chatIds('alert', recipientId),
    ]);
    const ids = [...new Set([...summary, ...alert])];
    if (!ids.length) return [];
    const chats = await this.chats.getMany(ids);
    return chats.filter((c) => c.channel === channel).map((c) => c.id);
  }

  /** Интервал «с последней границы саммари до сейчас» в часовом поясе расписания. */
  async currentInterval(now = new Date()): Promise<{ from: string; to: string }> {
    const g = await this.settings.global();
    const p = periodContaining(now, { timezone: g.timezone, dayStart: g.dayStart, nightStart: g.nightStart });
    return { from: p.start.toISOString(), to: now.toISOString() };
  }

  async sendMenu(recipientId: number, actor: string | null, channel: Channel): Promise<void> {
    const r = await this.recipients.getRaw(recipientId);
    if (!r) throw new NotFoundError('Получатель не найден');
    const active = channel === 'telegram' ? r.status === 'active' && r.telegramUserId : r.maxStatus === 'active' && r.maxUserId;
    if (!active) throw new ValidationError('Получатель не активировал бота в этом канале');
    await this.deliveries.enqueue({ dedupKey: `menu:${recipientId}:${channel}:${Date.now()}`, recipientId, channel, kind: 'menu', manualRetry: actor !== null });
    if (actor) await this.audit.record(actor, 'recipient.menu.send', 'recipient', String(recipientId), null, { channel });
    this.runtime.wake('delivery');
  }

  async sendMenuToAll(actor: string, channel: Channel): Promise<number> {
    const all = await this.recipients.list();
    const active = all.filter((r) => (channel === 'telegram' ? r.status === 'active' && r.telegramUserId : r.maxStatus === 'active' && r.maxUserId));
    for (const r of active) {
      await this.deliveries.enqueue({ dedupKey: `menu:${r.id}:${channel}:${Date.now()}`, recipientId: r.id, channel, kind: 'menu', manualRetry: true });
    }
    await this.audit.record(actor, 'recipient.menu.send_all', 'recipient', null, null, { channel, queued: active.length });
    if (active.length) this.runtime.wake('delivery');
    return active.length;
  }

  async handleCallback(cb: BotCallback): Promise<void> {
    const reply = this.bots.replyFor(cb.channel);
    const answer = async (text: string, alert = false) => {
      try {
        await reply.answerCallback(cb.id, text, alert);
      } catch (err) {
        console.error('[on-demand] answerCallback failed:', (err as Error).message);
      }
    };
    if (cb.data !== MENU_NOW) return answer('Неизвестное действие');

    const r = await this.recipients.findByChannelId(cb.channel, cb.fromId);
    const active = r && (cb.channel === 'telegram' ? r.status === 'active' : r.maxStatus === 'active');
    if (!r || !active) return answer('Нет доступа. Обратитесь к администратору.', true);

    const last = await this.repo.lastAcceptedAt(r.id, cb.channel);
    const waitMs = last ? new Date(last).getTime() + TECH.onDemandMinIntervalMs - Date.now() : 0;
    if (waitMs > 0) {
      await this.repo.insert({ recipientId: r.id, channel: cb.channel, status: 'throttled', chatIds: [], from: null, to: null });
      return answer(`Сводка уже готовится или только что отправлена. Повторите через ${Math.ceil(waitMs / 1000)} с.`, true);
    }

    const chatIds = await this.allowedChatIds(r.id, cb.channel);
    if (!chatIds.length) {
      await this.repo.insert({ recipientId: r.id, channel: cb.channel, status: 'no_chats', chatIds: [], from: null, to: null });
      return answer('Вам пока не назначены чаты. Обратитесь к администратору.', true);
    }

    const { from, to } = await this.currentInterval();
    await this.repo.insert({ recipientId: r.id, channel: cb.channel, status: 'accepted', chatIds, from, to });
    await this.deliveries.enqueue({
      dedupKey: `on_demand:${r.id}:${cb.channel}:${to}`,
      recipientId: r.id,
      channel: cb.channel,
      kind: 'on_demand',
      payload: { from, to },
      triggerAt: to,
    });
    this.runtime.wake('delivery');
    return answer('Собираю сводку…');
  }
}
