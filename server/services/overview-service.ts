import type { MetricsRepository } from '~server/repositories/metrics-repository';
import type { AnalysisRepository } from '~server/repositories/analysis-repository';
import type { DeliveryRepository } from '~server/repositories/delivery-repository';
import type { IncidentRepository } from '~server/repositories/incident-repository';
import type { MessageRepository } from '~server/repositories/message-repository';
import type { UpdateRepository } from '~server/repositories/update-repository';
import type { GapService } from './gap-service';
import type { RuntimeState } from './runtime-state';
import type { BotService } from './bot-service';
import type { MaxBotService } from './max-bot-service';
import type { AiClient } from '~server/integrations/ai-client';

/** Сводка для раздела «Обзор»: всё — SQL-агрегаты и состояние процесса. */
export class OverviewService {
  constructor(
    private readonly metrics: MetricsRepository,
    private readonly analysis: AnalysisRepository,
    private readonly deliveries: DeliveryRepository,
    private readonly incidents: IncidentRepository,
    private readonly messages: MessageRepository,
    private readonly updates: UpdateRepository,
    private readonly gaps: GapService,
    private readonly state: RuntimeState,
    private readonly bot: BotService,
    private readonly maxBot: MaxBotService,
    private readonly ai: AiClient,
  ) {}

  /** scope — ограничение руководителя (чаты и получатели его дирекций); без него — вся система. */
  async overview(hours: number, scope?: { chatIds: number[]; recipientIds: number[] }) {
    const since = new Date(Date.now() - hours * 3600_000).toISOString();
    const chatIds = scope?.chatIds;
    const [msgs, chats, recipients, perChat, peak, aiUsage, backlog, intakeQueue, delivery, latency, summaryLatency, deliveryStatus, incidents, created, feedback, gaps, dbSize] =
      await Promise.all([
        this.metrics.messagesSince(since, chatIds),
        this.metrics.chatsByStatus(chatIds),
        this.metrics.recipientsByStatus(scope?.recipientIds),
        this.metrics.messagesPerChatSince(since, chatIds),
        this.metrics.peakPerMinuteSince(since, chatIds),
        this.analysis.usageSince(since),
        this.messages.backlog(),
        this.updates.stats(),
        this.deliveries.queueStats(),
        this.deliveries.latencySince(since),
        this.deliveries.summaryLatencySince(since),
        this.deliveries.countByStatusSince(since),
        this.incidents.countActive(chatIds),
        this.incidents.countCreatedSince(since, chatIds),
        this.incidents.feedbackStats(since),
        this.gaps.recent(10),
        this.metrics.dbSizeBytes(),
      ]);
    const fbTotal = feedback.useful + feedback.falsePositive;
    return {
      generatedAt: new Date().toISOString(),
      hours,
      service: {
        startedAt: this.state.startedAt,
        heartbeats: this.state.heartbeatAges(),
        staleWorkers: this.state.staleComponents(),
        telegramConfigured: this.bot.configured,
        intake: { ...this.state.intake },
        bot: { ...this.state.bot },
        maxConfigured: this.maxBot.configured,
        maxIntake: { ...this.state.maxIntake },
        maxBot: { ...this.state.maxBot },
        ai: { configured: this.ai.configured, ...this.state.ai },
        dbSizeBytes: dbSize,
      },
      messages: { ...msgs, peakPerMinute: peak, perChat },
      chats,
      recipients,
      analysis: { ...backlog, usage: aiUsage },
      intakeQueue,
      delivery: { ...delivery, latency, summaryLatency, byStatus: deliveryStatus },
      incidents: { ...incidents, ...created },
      feedback: { ...feedback, falseShare: fbTotal ? feedback.falsePositive / fbTotal : null },
      gaps: chatIds ? gaps.filter((g) => g.chatId === null || chatIds.includes(g.chatId)) : gaps,
    };
  }

  /** Readiness: БД отвечает, воркеры живы, Telegram доступен (если настроен). */
  async readiness(): Promise<{ ready: boolean; components: Record<string, { ok: boolean; detail?: string }> }> {
    const components: Record<string, { ok: boolean; detail?: string }> = {};
    try {
      await this.metrics.chatsByStatus();
      components.db = { ok: true };
    } catch (err) {
      components.db = { ok: false, detail: (err as Error).message.slice(0, 100) };
    }
    const stale = new Set(this.state.staleComponents());
    for (const [name, age] of Object.entries(this.state.heartbeatAges())) {
      components[`worker:${name}`] = stale.has(name) ? { ok: false, detail: `heartbeat ${age} с назад` } : { ok: true };
    }
    if (this.bot.configured) {
      const last = this.state.bot.lastGetMeOkAt;
      const ok = Boolean(last && Date.now() - new Date(last).getTime() < 5 * 60_000);
      components.telegram = ok ? { ok } : { ok, detail: this.state.bot.error ?? 'getMe не выполнялся' };
    }
    if (this.maxBot.configured) {
      const last = this.state.maxBot.lastGetMeOkAt;
      const ok = Boolean(last && Date.now() - new Date(last).getTime() < 5 * 60_000);
      components.max = ok ? { ok } : { ok, detail: this.state.maxBot.error ?? 'getMe не выполнялся' };
    }
    return { ready: Object.values(components).every((c) => c.ok), components };
  }
}
