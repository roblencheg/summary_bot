import type { DeliveryRepository, DeliveryFilter } from '~server/repositories/delivery-repository';
import type { DeliveryJob, DeliveryAttempt } from '~server/models/delivery';
import { TelegramError } from '~server/integrations/telegram-client';
import { MaxError } from '~server/integrations/max-client';
import type { BotKeyboard } from '~server/domain/keyboard';
import type { Channel } from '~shared/domain';
import type { AlertService } from './alert-service';
import type { AuditService } from './audit-service';
import type { BotService } from './bot-service';
import type { MaxBotService } from './max-bot-service';
import type { ChatService } from './chat-service';
import type { IncidentService } from './incident-service';
import type { RateLimiter } from './rate-limiter';
import type { RecipientService } from './recipient-service';
import type { ReportService } from './report-service';
import type { RuntimeState } from './runtime-state';
import type { SettingsService } from './settings-service';
import type { SubscriptionService } from './subscription-service';
import { NotFoundError, ValidationError } from './errors';
import { menuMessage, type OnDemandService } from './on-demand-service';
import { TECH } from './settings-defaults';

interface Content {
  parts: string[];
  /** Rich message (саммари, «Что сейчас происходит») — только для Telegram; parts — текстовый формат. */
  rich?: string | null;
  keyboard?: BotKeyboard;
}

/** Общие поля ошибок обоих каналов — классификация (kind) у TelegramError и MaxError совпадает по значениям. */
type ChannelError = TelegramError | MaxError;
function asChannelError(method: string, err: unknown): ChannelError {
  if (err instanceof TelegramError || err instanceof MaxError) return err;
  return new TelegramError(method, 'uncertain', null, (err as Error).message);
}

const backoffMs = (attempt: number) => Math.min(5_000 * 2 ** attempt, 10 * 60_000) * (0.5 + Math.random() * 0.5);

/**
 * Доставка уведомлений. Перед КАЖДОЙ отправкой: статус получателя и права на чаты.
 * Канал задания (job.channel) выбирается при постановке в очередь (см. методы enqueue*) —
 * здесь он только определяет, через какого бота и какой идентификатор получателя отправлять.
 * Политика повторов — at-least-once: при неопределённом результате возможен дубль,
 * повтор помечается в тексте. Успех = «принято API канала», а не «прочитано».
 */
export class DeliveryService {
  constructor(
    private readonly repo: DeliveryRepository,
    private readonly recipients: RecipientService,
    private readonly subscriptions: SubscriptionService,
    private readonly incidents: IncidentService,
    private readonly alerts: AlertService,
    private readonly reports: ReportService,
    private readonly chats: ChatService,
    private readonly settings: SettingsService,
    private readonly bot: BotService,
    private readonly maxBot: MaxBotService,
    private readonly limiter: RateLimiter,
    private readonly maxLimiter: RateLimiter,
    private readonly audit: AuditService,
    private readonly runtime: RuntimeState,
    private readonly onDemand: OnDemandService,
  ) {}

  private clientFor(channel: Channel) {
    return channel === 'telegram' ? this.bot.client : this.maxBot.client;
  }

  private limiterFor(channel: Channel): RateLimiter {
    return channel === 'telegram' ? this.limiter : this.maxLimiter;
  }

  claim(limit: number): Promise<DeliveryJob[]> {
    return this.repo.claim(limit, 120_000);
  }

  async process(job: DeliveryJob): Promise<void> {
    const client = this.clientFor(job.channel);
    if (!client) {
      await this.repo.scheduleRetry(job.id, new Date(Date.now() + 60_000).toISOString(), `бот ${job.channel} не настроен`, false);
      return;
    }
    const recipient = await this.recipients.getRaw(job.recipientId);
    if (!recipient || recipient.status === 'disabled') return this.close(job, 'cancelled', 'получатель отключён или удалён');
    const status = job.channel === 'telegram' ? recipient.status : recipient.maxStatus;
    const channelUserId = job.channel === 'telegram' ? recipient.telegramUserId : recipient.maxUserId;
    if (status === 'blocked') return this.close(job, 'blocked', 'получатель заблокировал бота');
    if (!channelUserId || status !== 'active') return this.close(job, 'not_activated', 'получатель не активировал бота в этом канале');

    let content: Content | null;
    try {
      content = await this.build(job, recipient.id);
    } catch (err) {
      await this.repo.fail(job.id, 'failed', `Сборка содержимого: ${(err as Error).message}`);
      return;
    }
    if (!content) return; // задание закрыто при сборке (отозван доступ и т.п.)

    const prefix = job.uncertain && job.kind !== 'alert' && job.kind !== 'incident_update' ? '♻️ <i>Повторная отправка: возможен дубль</i>\n' : '';
    const limiter = this.limiterFor(job.channel);

    // Саммари и «Что сейчас происходит» — одним rich message (заголовки, таблицы, сворачиваемые разделы).
    // Только для Telegram — у MAX такого формата нет (design.md). AICODE-NOTE: если Telegram отклонил
    // rich message (bad_request: формат/лимиты/клиент), отправляем прежний текстовый формат частями —
    // получатель не должен остаться без отчёта.
    if (job.channel === 'telegram' && content.rich && job.partsSent === 0) {
      await limiter.wait(channelUserId);
      const started = Date.now();
      try {
        const html = (prefix ? `<p>${prefix.trim()}</p>` : '') + content.rich;
        const res = await this.bot.requireClient().sendRichMessage(channelUserId, html, { keyboard: content.keyboard });
        await this.logAttempt(job.id, 0, true, false, null, res.message_id, Date.now() - started);
        await this.repo.partSent(job.id, content.parts.length);
        await this.repo.finish(job.id, 'sent', job.uncertain ? 'отправлено после неопределённого результата: возможен дубль' : null);
        await this.recipients.setLastDelivery(recipient.id, 'sent');
        if (job.kind === 'summary' && job.reportId) await this.reports.setStatus(job.reportId, job.channel, 'sent');
        return;
      } catch (err) {
        const e = asChannelError('sendRichMessage', err);
        if (e.kind !== 'bad_request') {
          await this.logAttempt(job.id, 0, false, e.kind === 'uncertain', e, null, Date.now() - started);
          return this.onError(job, e, recipient.id);
        }
        await this.repo.logAttempt({
          jobId: job.id,
          part: 0,
          ok: false,
          uncertain: false,
          httpStatus: e.httpStatus,
          errorCode: 'rich_rejected',
          error: `Rich message отклонён, отправлен текстовый формат: ${e.description}`,
          telegramMessageId: null,
          durationMs: Date.now() - started,
        });
        if (job.kind === 'summary' && job.reportId) await this.reports.clearRich(job.reportId);
      }
    }

    for (let i = job.partsSent; i < content.parts.length; i++) {
      await limiter.wait(channelUserId);
      const started = Date.now();
      const isLast = i === content.parts.length - 1;
      try {
        const res = await client.sendMessage(channelUserId, (i === job.partsSent ? prefix : '') + content.parts[i], {
          keyboard: isLast ? content.keyboard : undefined,
        });
        await this.logAttempt(job.id, i, true, false, null, res.message_id, Date.now() - started);
        await this.repo.partSent(job.id, i + 1);
        if (job.kind === 'menu') await this.pinMenu(job, recipient.id, channelUserId, res.message_id);
      } catch (err) {
        const e = asChannelError('sendMessage', err);
        await this.logAttempt(job.id, i, false, e.kind === 'uncertain', e, null, Date.now() - started);
        return this.onError(job, e, recipient.id);
      }
    }
    await this.repo.finish(job.id, 'sent', job.uncertain ? 'отправлено после неопределённого результата: возможен дубль' : null);
    await this.recipients.setLastDelivery(recipient.id, 'sent');
    if (job.kind === 'summary' && job.reportId) await this.reports.setStatus(job.reportId, job.channel, 'sent');
  }

  /** Закрепление меню — только Telegram (pinChatMessage у MAX не подтверждён документацией). Неудача не делает отправку неуспешной. */
  private async pinMenu(job: DeliveryJob, recipientId: number, chatId: number, messageId: number): Promise<void> {
    await this.recipients.setMenuMessageId(job.channel, recipientId, messageId);
    if (job.channel !== 'telegram') return;
    const started = Date.now();
    try {
      await this.bot.requireClient().pinChatMessage(chatId, messageId);
    } catch (err) {
      const e = asChannelError('pinChatMessage', err);
      await this.repo.logAttempt({
        jobId: job.id,
        part: 0,
        ok: false,
        uncertain: false,
        httpStatus: e.httpStatus,
        errorCode: 'pin_failed',
        error: `Закрепить не удалось: ${e.description}`,
        telegramMessageId: messageId,
        durationMs: Date.now() - started,
      });
    }
  }

  private async build(job: DeliveryJob, recipientId: number): Promise<Content | null> {
    const g = await this.settings.global();
    switch (job.kind) {
      case 'alert':
      case 'incident_update': {
        const incident = job.incidentId ? await this.incidents.get(job.incidentId) : null;
        if (!incident) {
          await this.close(job, 'cancelled', 'инцидент удалён');
          return null;
        }
        if (job.kind === 'incident_update' && (incident.status === 'closed' || incident.status === 'false_positive')) {
          await this.close(job, 'cancelled', 'инцидент закрыт администратором');
          return null;
        }
        const recipient = (await this.recipients.getRaw(recipientId))!;
        if (!(await this.subscriptions.allowsAlert(recipient, incident))) {
          await this.close(job, 'cancelled', 'доступ отозван или фильтр получателя изменён');
          return null;
        }
        const chat = await this.chats.get(incident.chatId);
        const r = await this.alerts.render(incident, chat, job, g.timezone);
        return { parts: [r.text], keyboard: r.keyboard };
      }
      case 'summary': {
        const report = job.reportId ? await this.reports.getReport(job.reportId) : null;
        if (!report) {
          await this.close(job, 'cancelled', 'отчёт удалён');
          return null;
        }
        const recipient = (await this.recipients.getRaw(recipientId))!;
        const prevParts = job.channel === 'telegram' ? report.parts : report.maxParts;
        if (job.partsSent > 0 && prevParts.length) {
          // продолжение: части уже отправлялись — тот же текст, но права проверяем заново
          const prevChatIds = job.channel === 'telegram' ? report.chatIds : report.maxChatIds;
          const allowed = await this.subscriptions.chatIds('summary', recipientId);
          if (prevChatIds.some((c) => !allowed.includes(c))) {
            await this.close(job, 'cancelled', 'доступ к части чатов отозван — оставшиеся части не отправлены');
            return null;
          }
          return { parts: prevParts };
        }
        const built = await this.reports.assemble(report, recipient, job.channel);
        if (job.channel === 'telegram') await this.reports.saveBuilt(report.id, built.chatIds, built.parts, built.fullText, built.rich, built.delayed, 'built');
        else await this.reports.saveBuiltMax(report.id, built.chatIds, built.parts, built.fullText, 'built');
        return { parts: built.parts, rich: built.rich };
      }
      case 'test':
        return { parts: ['🧪 <b>Тестовое уведомление</b>\nСвязь с ботом мониторинга работает. Данные чатов в этом сообщении не передаются.'] };
      case 'tech':
        return { parts: [job.payload?.text ?? 'Техническое уведомление'] };
      case 'menu': {
        const menu = menuMessage();
        return { parts: [menu.text], keyboard: menu.keyboard };
      }
      case 'on_demand': {
        const { from, to } = job.payload ?? {};
        if (!from || !to) {
          await this.close(job, 'cancelled', 'нет интервала дайджеста');
          return null;
        }
        // права — на момент отправки: отозванные после нажатия чаты не попадут в сводку
        const chatIds = await this.onDemand.allowedChatIds(recipientId, job.channel);
        if (!chatIds.length) {
          await this.close(job, 'cancelled', 'чаты больше не назначены');
          return null;
        }
        const built = await this.reports.assembleOnDemand(job.recipientId, chatIds, from, to);
        return { parts: built.parts, rich: job.channel === 'telegram' ? built.rich : null };
      }
    }
  }

  private async onError(job: DeliveryJob, e: ChannelError, recipientId: number): Promise<void> {
    if (e.kind === 'blocked' || e.kind === 'not_found') {
      await this.recipients.markBlocked(job.channel, recipientId);
      await this.repo.fail(job.id, 'blocked', e.description);
      await this.recipients.setLastDelivery(recipientId, 'blocked');
      return;
    }
    if (e.kind === 'bad_request') {
      await this.repo.fail(job.id, 'failed', e.description);
      await this.recipients.setLastDelivery(recipientId, 'failed');
      return;
    }
    if (job.attempts + 1 >= TECH.deliveryMaxAttempts) {
      await this.repo.fail(job.id, 'failed', e.message);
      await this.recipients.setLastDelivery(recipientId, 'failed');
      return;
    }
    const delay = e.kind === 'rate_limit' && e.retryAfterSec ? e.retryAfterSec * 1000 + 250 : backoffMs(job.attempts);
    await this.repo.scheduleRetry(job.id, new Date(Date.now() + delay).toISOString(), e.message, e.kind === 'uncertain');
  }

  private async close(job: DeliveryJob, status: 'cancelled' | 'blocked' | 'not_activated', reason: string): Promise<void> {
    await this.repo.finish(job.id, status, reason);
    if (job.kind !== 'summary' || !job.reportId) return;
    // отчёт не доставлен, но остаётся доступным в интерфейсе — собираем по текущим правам
    const report = await this.reports.getReport(job.reportId);
    const recipient = await this.recipients.getRaw(job.recipientId);
    if (report && recipient) {
      const alreadyBuilt = job.channel === 'telegram' ? report.parts.length : report.maxParts.length;
      if (!alreadyBuilt) {
        try {
          const built = await this.reports.assemble(report, recipient, job.channel);
          if (job.channel === 'telegram') await this.reports.saveBuilt(report.id, built.chatIds, built.parts, built.fullText, built.rich, built.delayed, 'cancelled');
          else await this.reports.saveBuiltMax(report.id, built.chatIds, built.parts, built.fullText, 'cancelled');
          return;
        } catch (err) {
          console.error('[delivery] assemble undelivered report failed:', (err as Error).message);
        }
      }
    }
    await this.reports.setStatus(job.reportId, job.channel, 'cancelled');
  }

  private logAttempt(jobId: number, part: number, ok: boolean, uncertain: boolean, e: ChannelError | null, messageId: number | null, ms: number) {
    return this.repo.logAttempt({
      jobId,
      part,
      ok,
      uncertain,
      httpStatus: e?.httpStatus ?? null,
      errorCode: e?.kind ?? null,
      error: e?.description ?? null,
      telegramMessageId: messageId,
      durationMs: ms,
    });
  }

  // --- админка ---

  list(f: DeliveryFilter) {
    return this.repo.list(f);
  }

  async details(id: number): Promise<{ job: DeliveryJob; attempts: DeliveryAttempt[] }> {
    const job = await this.repo.get(id);
    if (!job) throw new NotFoundError('Задание не найдено');
    return { job, attempts: await this.repo.attempts(id) };
  }

  /** Ручной повтор: новое задание с пометкой, права проверятся при отправке. */
  async retry(id: number, actor: string): Promise<DeliveryJob> {
    const job = await this.repo.get(id);
    if (!job) throw new NotFoundError('Задание не найдено');
    if (!['failed', 'blocked', 'not_activated', 'cancelled'].includes(job.status)) throw new ValidationError('Повторить можно только завершившееся неуспешно задание');
    const dedupKey = `retry:${job.id}:${Date.now()}`;
    await this.repo.enqueue({
      dedupKey,
      recipientId: job.recipientId,
      kind: job.kind,
      channel: job.channel,
      incidentId: job.incidentId,
      reportId: job.reportId,
      chatId: job.chatId,
      payload: job.payload,
      manualRetry: true,
      triggerAt: job.triggerAt,
    });
    await this.audit.record(actor, 'delivery.retry', 'delivery', String(id), { status: job.status }, { retryOf: id });
    this.runtime.wake('delivery');
    const created = await this.repo.list({ recipientId: job.recipientId, limit: 1, offset: 0 });
    return created.items[0] ?? job;
  }

  async sendTest(recipientId: number, channel: Channel, actor: string): Promise<void> {
    const r = await this.recipients.getRaw(recipientId);
    if (!r) throw new NotFoundError('Получатель не найден');
    const active = channel === 'telegram' ? r.status === 'active' : r.maxStatus === 'active';
    if (!active) throw new ValidationError('Получатель не активировал бота в этом канале — тестовое уведомление не будет доставлено');
    await this.repo.enqueue({ dedupKey: `test:${recipientId}:${channel}:${Date.now()}`, recipientId, channel, kind: 'test', manualRetry: true });
    await this.audit.record(actor, 'delivery.test', 'recipient', String(recipientId), null, { channel });
    this.runtime.wake('delivery');
  }

  queueStats() {
    return this.repo.queueStats();
  }
}
