import type { SubscriptionRepository } from '~server/repositories/subscription-repository';
import type { RecipientRepository } from '~server/repositories/recipient-repository';
import type { ChatRepository } from '~server/repositories/chat-repository';
import type { Recipient } from '~server/models/recipient';
import type { Incident } from '~server/models/incident';
import type { PeriodType } from '~shared/domain';
import { severityRank } from '~shared/domain';
import type { AuditService } from './audit-service';
import { NotFoundError, ValidationError } from './errors';

type Kind = 'summary' | 'alert';

/**
 * Независимые подписки на саммари и алерты. Права проверяются здесь же —
 * и при постановке задания, и повторно перед отправкой.
 */
export class SubscriptionService {
  constructor(
    private readonly repo: SubscriptionRepository,
    private readonly recipients: RecipientRepository,
    private readonly chats: ChatRepository,
    private readonly audit: AuditService,
  ) {}

  chatIds(kind: Kind, recipientId: number): Promise<number[]> {
    return this.repo.chatIdsOf(kind, recipientId);
  }

  all(kind: Kind): Promise<Array<{ recipientId: number; chatId: number }>> {
    return this.repo.all(kind);
  }

  /**
   * visible — чаты, доступные руководителю (undefined — суперадмин, без ограничений).
   * Руководитель назначает только видимые; подписки получателя на остальные чаты сохраняются как есть.
   */
  async replace(kind: Kind, recipientId: number, chatIds: number[], actor: string, visible?: number[]): Promise<number[]> {
    const recipient = await this.recipients.get(recipientId);
    if (!recipient) throw new NotFoundError('Получатель не найден');
    const unique = [...new Set(chatIds)];
    if (visible && unique.some((id) => !visible.includes(id))) throw new ValidationError('Чат недоступен');
    const chats = await this.chats.getMany(unique);
    const known = new Map(chats.map((c) => [c.id, c]));
    for (const id of unique) {
      const c = known.get(id);
      if (!c) throw new ValidationError(`Чат ${id} не найден`);
      if (c.status !== 'active' && c.status !== 'disabled') {
        throw new ValidationError(`Чат «${c.title}» не подключён — сначала активируйте сбор`);
      }
    }
    const prev = await this.repo.chatIdsOf(kind, recipientId);
    const hidden = visible ? prev.filter((id) => !visible.includes(id)) : [];
    await this.repo.replace(kind, recipientId, [...unique, ...hidden]);
    const next = await this.repo.chatIdsOf(kind, recipientId);
    await this.audit.record(actor, `subscription.${kind}.update`, 'recipient', String(recipientId), prev, next);
    return next;
  }

  /** Чат ушёл в архив (бот удалён): подписки — это назначения на будущее, снимаем у всех. История не трогается. */
  async purgeChat(chatId: number, actor: string): Promise<void> {
    const removed = await this.repo.removeChatEverywhere(chatId);
    if (removed.summary.length || removed.alert.length) {
      await this.audit.record(actor, 'subscription.chat_archived', 'chat', String(chatId), removed, null);
    }
  }

  /** Доступ дирекций к чату изменился — снять подписки получателей, которым чат больше не виден. */
  dropInvisibleForChat(chatId: number): Promise<void> {
    return this.repo.removeChatOutsiders(chatId);
  }

  /** Состав дирекций получателя изменился — снять подписки на чаты, которые ему больше не видны. */
  dropInvisibleForRecipient(recipientId: number): Promise<void> {
    return this.repo.removeInvisibleFor(recipientId);
  }

  /** Объединение получателей при привязке: подписки дубля переходят к основной записи. */
  moveRecipient(fromId: number, toId: number): Promise<void> {
    return this.repo.moveRecipient(fromId, toId);
  }

  /** Получатели алерта по инциденту: подписка на чат + категории + минимальная серьёзность. */
  async alertRecipients(incident: Incident): Promise<Recipient[]> {
    const ids = await this.repo.recipientIdsOf('alert', incident.chatId);
    const out: Recipient[] = [];
    for (const id of ids) {
      const r = await this.recipients.get(id);
      if (r && r.status !== 'disabled' && this.alertFilterPasses(r, incident)) out.push(r);
    }
    return out;
  }

  alertFilterPasses(r: Recipient, incident: Incident): boolean {
    return incident.categories.some((c) => r.alertCategories.includes(c)) && severityRank(incident.severity) >= severityRank(r.alertMinSeverity);
  }

  /** Повторная проверка перед отправкой алерта. */
  async allowsAlert(r: Recipient, incident: Incident): Promise<boolean> {
    const chats = await this.repo.chatIdsOf('alert', r.id);
    return chats.includes(incident.chatId) && this.alertFilterPasses(r, incident);
  }

  /** Получатели саммари периода данного типа с их текущими чатами. */
  async summaryRecipients(periodType: PeriodType): Promise<Array<{ recipient: Recipient; chatIds: number[] }>> {
    const pairs = await this.repo.all('summary');
    const byRecipient = new Map<number, number[]>();
    for (const p of pairs) {
      if (!byRecipient.has(p.recipientId)) byRecipient.set(p.recipientId, []);
      byRecipient.get(p.recipientId)!.push(p.chatId);
    }
    const out: Array<{ recipient: Recipient; chatIds: number[] }> = [];
    for (const [id, chatIds] of byRecipient) {
      const r = await this.recipients.get(id);
      if (!r || r.status === 'disabled') continue;
      if ((periodType === 'day' && !r.summaryDay) || (periodType === 'night' && !r.summaryNight)) continue;
      out.push({ recipient: r, chatIds });
    }
    return out;
  }
}
