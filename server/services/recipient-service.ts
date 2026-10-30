import { createHash, randomBytes } from 'node:crypto';
import type { RecipientRepository, RecipientPatch } from '~server/repositories/recipient-repository';
import type { DeliveryRepository } from '~server/repositories/delivery-repository';
import type { Recipient, RecipientWithSubscriptions } from '~server/models/recipient';
import type { DirectorateRepository } from '~server/repositories/directorate-repository';
import type { Scope } from '~server/models/directorate';
import { CATEGORIES, SEVERITIES, type Category, type Channel, type Severity } from '~shared/domain';
import type { AuditService } from './audit-service';
import type { BotService } from './bot-service';
import type { MaxBotService } from './max-bot-service';
import type { SubscriptionService } from './subscription-service';
import { NotFoundError, ValidationError } from './errors';
import { TECH } from './settings-defaults';

export const hashCode = (code: string) => createHash('sha256').update(code.trim().toUpperCase()).digest('hex');

// без похожих символов (0/O, 1/I/L)
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newCode(): string {
  const bytes = randomBytes(10);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export class RecipientService {
  constructor(
    private readonly repo: RecipientRepository,
    private readonly deliveries: DeliveryRepository,
    private readonly subscriptions: SubscriptionService,
    private readonly bot: BotService,
    private readonly maxBot: MaxBotService,
    private readonly audit: AuditService,
    private readonly memberships: DirectorateRepository,
  ) {}

  async list(): Promise<RecipientWithSubscriptions[]> {
    const all = await this.repo.list();
    const summary = await this.subscriptions.all('summary');
    const alert = await this.subscriptions.all('alert');
    const dirs = await this.memberships.allRecipientDirectorates();
    return all.map((r) => ({
      ...r,
      summaryChatIds: summary.filter((s) => s.recipientId === r.id).map((s) => s.chatId),
      alertChatIds: alert.filter((s) => s.recipientId === r.id).map((s) => s.chatId),
      directorateIds: dirs.filter((d) => d.recipientId === r.id).map((d) => d.directorateId),
    }));
  }

  async get(id: number): Promise<RecipientWithSubscriptions> {
    const r = await this.repo.get(id);
    if (!r) throw new NotFoundError('Получатель не найден');
    return {
      ...r,
      summaryChatIds: await this.subscriptions.chatIds('summary', id),
      alertChatIds: await this.subscriptions.chatIds('alert', id),
      directorateIds: await this.memberships.directoratesOfRecipient(id),
    };
  }

  findByTelegramId(id: number): Promise<Recipient | null> {
    return this.repo.findByTelegramId(id);
  }

  findByChannelId(channel: Channel, id: number): Promise<Recipient | null> {
    return this.repo.findByChannelId(channel, id);
  }

  async create(input: { name: string; isTechAdmin: boolean }, directorateId: number, actor: string): Promise<RecipientWithSubscriptions> {
    const name = input.name.trim();
    if (!name) throw new ValidationError('Укажите имя');
    const id = await this.repo.create({
      name,
      alertCategories: [...CATEGORIES],
      alertMinSeverity: 'attention',
      isTechAdmin: input.isTechAdmin,
    });
    await this.memberships.addRecipient(id, directorateId);
    await this.audit.record(actor, 'recipient.create', 'recipient', String(id), null, { name, isTechAdmin: input.isTechAdmin, directorateId });
    return this.get(id);
  }

  async update(id: number, p: RecipientPatch, actor: string): Promise<RecipientWithSubscriptions> {
    const prev = await this.repo.get(id);
    if (!prev) throw new NotFoundError('Получатель не найден');
    if (p.name !== undefined && !p.name.trim()) throw new ValidationError('Укажите имя');
    if (p.alertCategories) {
      if (!p.alertCategories.length) throw new ValidationError('Выберите хотя бы одну категорию алертов');
      if (p.alertCategories.some((c: Category) => !CATEGORIES.includes(c))) throw new ValidationError('Неизвестная категория');
    }
    if (p.alertMinSeverity && !SEVERITIES.includes(p.alertMinSeverity as Severity)) throw new ValidationError('Неизвестная серьёзность');
    await this.repo.update(id, { ...p, name: p.name?.trim() });
    const pick = (r: Recipient) => ({
      name: r.name,
      isTechAdmin: r.isTechAdmin,
      summaryDay: r.summaryDay,
      summaryNight: r.summaryNight,
      alertCategories: r.alertCategories,
      alertMinSeverity: r.alertMinSeverity,
    });
    const next = await this.repo.get(id);
    await this.audit.record(actor, 'recipient.update', 'recipient', String(id), pick(prev), pick(next!));
    return this.get(id);
  }

  async setEnabled(id: number, enabled: boolean, actor: string): Promise<RecipientWithSubscriptions> {
    const r = await this.repo.get(id);
    if (!r) throw new NotFoundError('Получатель не найден');
    // «отключён» — признак получателя целиком, одинаково выставляется на оба канала;
    // при включении каждый канал восстанавливается в своё состояние по факту привязки.
    const status = enabled ? (r.telegramUserId ? 'active' : 'pending') : 'disabled';
    const maxStatus = enabled ? (r.maxUserId ? 'active' : 'pending') : 'disabled';
    await this.repo.update(id, { status, maxStatus });
    if (!enabled) await this.deliveries.cancelPendingForRecipient(id, 'получатель отключён');
    await this.audit.record(actor, enabled ? 'recipient.enable' : 'recipient.disable', 'recipient', String(id), { status: r.status }, { status });
    return this.get(id);
  }

  /** Новый одноразовый код на канал (старые неиспользованные коды того же канала гасятся). Код показывается один раз. */
  async issueCode(id: number, channel: Channel, actor: string): Promise<{ code: string; link: string | null; expiresAt: string; channel: Channel }> {
    const r = await this.repo.get(id);
    if (!r) throw new NotFoundError('Получатель не найден');
    const code = newCode();
    const expiresAt = new Date(Date.now() + TECH.bindingCodeTtlHours * 3600_000).toISOString();
    await this.repo.createCode(id, channel, hashCode(code), expiresAt);
    await this.audit.record(actor, 'recipient.code.issue', 'recipient', String(id), null, { channel, expiresAt });
    if (channel === 'telegram') {
      const username = await this.bot.username();
      return { code, link: username ? `https://t.me/${username}?start=${code}` : null, expiresAt, channel };
    }
    // Формат подтверждён официальной OpenAPI-схемой MAX (github.com/max-messenger/api-schema,
    // README.mdx, раздел Deep linking): https://max.ru/<botName>?start=<payload> — открывает диалог
    // и присылает боту `bot_started.payload`. Код также можно ввести текстом `/start <код>» в
    // диалоге с ботом (см. MaxCommandService.handlePrivate) — ссылка не обязательна, но удобнее.
    const maxUsername = await this.maxBot.username();
    return { code, link: maxUsername ? `https://max.ru/${maxUsername}?start=${code}` : null, expiresAt, channel };
  }

  activeCodeExpiry(id: number, channel: Channel): Promise<string | null> {
    return this.repo.activeCodeExpiry(id, channel);
  }

  async resetBinding(id: number, channel: Channel, actor: string): Promise<RecipientWithSubscriptions> {
    const r = await this.repo.get(id);
    if (!r) throw new NotFoundError('Получатель не найден');
    if (channel === 'telegram') await this.repo.resetBinding(id);
    else await this.repo.resetBindingMax(id);
    await this.deliveries.cancelPendingForRecipient(id, 'привязка сброшена');
    const before = channel === 'telegram' ? r.telegramUserId : r.maxUserId;
    await this.audit.record(actor, 'recipient.binding.reset', 'recipient', String(id), { channel, userId: before }, { channel, userId: null });
    return this.get(id);
  }

  /**
   * Удаление. Руководитель удаляет получателя, состоящего и в других дирекциях, только из своих:
   * членство и подписки на ставшие невидимыми чаты снимаются, рассылки других дирекций продолжаются.
   */
  async remove(id: number, actor: string, scope: Scope): Promise<void> {
    const r = await this.repo.get(id);
    if (!r) throw new NotFoundError('Получатель не найден');
    const dirs = await this.memberships.directoratesOfRecipient(id);
    if (scope.kind === 'manager' && dirs.some((d) => !scope.directorateIds.includes(d))) {
      const mine = dirs.filter((d) => scope.directorateIds.includes(d));
      await this.memberships.removeRecipient(id, mine);
      await this.subscriptions.dropInvisibleForRecipient(id);
      await this.audit.record(actor, 'recipient.exclude', 'recipient', String(id), { directorateIds: dirs }, { directorateIds: dirs.filter((d) => !mine.includes(d)) });
      return;
    }
    await this.deliveries.cancelPendingForRecipient(id, 'получатель удалён');
    await this.repo.delete(id);
    await this.memberships.deleteRecipientMemberships(id);
    await this.audit.record(actor, 'recipient.delete', 'recipient', String(id), { name: r.name, telegramUserId: r.telegramUserId }, null);
  }

  /**
   * Привязка по коду из /start одного из каналов. Возвращает результат для ответа бота.
   * Числовой ID пользователя канала — устойчивый идентификатор; username только для отображения.
   * Код выдан на конкретный канал — попытка погасить его из другого канала отклоняется.
   */
  async bindByCode(
    code: string,
    channel: Channel,
    from: { id: number; username: string | null },
  ): Promise<{ ok: true; recipient: Recipient } | { ok: false; reason: 'invalid' | 'mismatch' | 'taken' }> {
    const hash = hashCode(code);
    const stored = await this.repo.findCode(hash);
    if (!stored || stored.channel !== channel || stored.usedAt || new Date(stored.expiresAt).getTime() < Date.now()) {
      return { ok: false, reason: 'invalid' };
    }
    const recipient = await this.repo.get(stored.recipientId);
    if (!recipient || recipient.status === 'disabled') return { ok: false, reason: 'invalid' };
    const boundId = channel === 'telegram' ? recipient.telegramUserId : recipient.maxUserId;
    if (boundId && boundId !== from.id) {
      await this.audit.record(`${channel}:${from.id}`, 'recipient.bind.mismatch', 'recipient', String(recipient.id), null, { channel, attemptedBy: from.id });
      return { ok: false, reason: 'mismatch' };
    }
    const other = await this.repo.findByChannelId(channel, from.id);
    if (other && other.id !== recipient.id) {
      // тот же человек уже получатель другой дирекции — объединяем записи (дирекции и подписки нового переходят к нему)
      if (other.status === 'disabled' || boundId) {
        await this.audit.record(`${channel}:${from.id}`, 'recipient.bind.taken', 'recipient', String(recipient.id), null, { channel, boundTo: other.id });
        return { ok: false, reason: 'taken' };
      }
      if (!(await this.repo.useCode(hash))) return { ok: false, reason: 'invalid' };
      await this.memberships.moveRecipient(recipient.id, other.id);
      await this.subscriptions.moveRecipient(recipient.id, other.id);
      await this.deliveries.cancelPendingForRecipient(recipient.id, 'объединён с существующим получателем');
      await this.repo.delete(recipient.id);
      await this.audit.record(
        `${channel}:${from.id}`,
        'recipient.bind.merged',
        'recipient',
        String(other.id),
        { mergedRecipientId: recipient.id, name: recipient.name },
        null,
      );
      return { ok: true, recipient: (await this.repo.get(other.id))! };
    }
    if (!(await this.repo.useCode(hash))) return { ok: false, reason: 'invalid' };
    const bound = channel === 'telegram' ? await this.repo.bind(recipient.id, from.id, from.username) : await this.repo.bindMax(recipient.id, from.id, from.username);
    if (!bound) return { ok: false, reason: 'taken' };
    await this.audit.record(`${channel}:${from.id}`, 'recipient.bind', 'recipient', String(recipient.id), { channel }, { channel, userId: from.id });
    return { ok: true, recipient: (await this.repo.get(recipient.id))! };
  }

  async markBlocked(channel: Channel, id: number): Promise<void> {
    if (channel === 'telegram') await this.repo.markBlocked(id);
    else await this.repo.markBlockedMax(id);
  }

  async userBlockedBot(channel: Channel, channelUserId: number): Promise<void> {
    const r = await this.repo.findByChannelId(channel, channelUserId);
    const active = channel === 'telegram' ? r?.status === 'active' : r?.maxStatus === 'active';
    if (r && active) {
      await this.markBlocked(channel, r.id);
      await this.audit.record(`${channel}:${channelUserId}`, 'recipient.blocked_bot', 'recipient', String(r.id), { channel }, { channel, status: 'blocked' });
    }
  }

  async userUnblockedBot(channel: Channel, channelUserId: number): Promise<void> {
    const r = await this.repo.findByChannelId(channel, channelUserId);
    if (!r) return;
    if (channel === 'telegram' && r.status === 'blocked') await this.repo.update(r.id, { status: 'active' });
    else if (channel === 'max' && r.maxStatus === 'blocked') await this.repo.update(r.id, { maxStatus: 'active' });
  }

  setMenuMessageId(channel: Channel, id: number, messageId: number): Promise<void> {
    return channel === 'telegram' ? this.repo.setMenuMessageId(id, messageId) : this.repo.setMaxMenuMessageId(id, messageId);
  }

  setLastDelivery(id: number, status: string): Promise<void> {
    return this.repo.setLastDelivery(id, status);
  }

  listTechAdmins(): Promise<Recipient[]> {
    return this.repo.listTechAdmins();
  }

  getRaw(id: number): Promise<Recipient | null> {
    return this.repo.get(id);
  }
}
