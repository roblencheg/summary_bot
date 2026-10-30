import type { MessageRepository } from '~server/repositories/message-repository';
import type { Chat } from '~server/models/chat';
import type { SpikeData } from '~server/models/incident';
import { evaluateSpike } from '~server/domain/spikes';
import type { IncidentService } from './incident-service';
import type { SettingsService } from './settings-service';

const DAY = 86_400_000;

/**
 * Всплеск: скользящее окно W, абсолютный минимум и кратность к уровню того же времени суток
 * за прошлые N дней (±30 мин, включая пустые окна; текущее окно в базу не входит).
 * Пока истории < N дней — только абсолютный порог и пометка «ограниченная база».
 */
export class SpikeService {
  constructor(
    private readonly messages: MessageRepository,
    private readonly incidents: IncidentService,
    private readonly settings: SettingsService,
  ) {}

  async check(chat: Chat, now = new Date()): Promise<void> {
    const rules = await this.settings.rulesFor(chat.id);
    const windowMs = rules.spikeWindowMin * 60_000;
    const from = new Date(now.getTime() - windowMs).toISOString();
    const to = now.toISOString();
    const w = await this.messages.windowStats(chat.id, from, to);
    if (w.count < rules.spikeMinMessages) return;

    const started = chat.collectionStartedAt ? new Date(chat.collectionStartedAt).getTime() : now.getTime();
    const historyLimited = now.getTime() - started < rules.historyDays * DAY;
    const ranges = Array.from({ length: rules.historyDays }, (_, i) => {
      const center = now.getTime() - (i + 1) * DAY;
      return { from: new Date(center - 30 * 60_000).toISOString(), to: new Date(center + 30 * 60_000).toISOString() };
    });
    const baselineMessages = historyLimited ? 0 : await this.messages.countInRanges(chat.id, ranges);
    const verdict = evaluateSpike(
      {
        windowCount: w.count,
        windowAuthors: w.authors,
        baselineMessages,
        baselineWindows: rules.historyDays * (60 / rules.spikeWindowMin),
        historyLimited,
      },
      rules,
    );
    if (!verdict.isSpike) return;

    const { topics, tones } = await this.messages.windowTopicsAndTones(chat.id, from, to);
    const spike: SpikeData = {
      windowStart: from,
      windowEnd: to,
      windowMin: rules.spikeWindowMin,
      count: w.count,
      authors: w.authors,
      baselinePerWindow: verdict.baselinePerWindow,
      ratio: verdict.ratio,
      historyLimited,
      topics,
      tones,
      unanalyzed: w.unanalyzed,
    };

    // продолжение текущего всплеска — обновляем тот же инцидент
    const existing = await this.incidents.recentSpike(chat.id, new Date(now.getTime() - 30 * 60_000).toISOString());
    const trigger = { sentAt: null, receivedAt: to, analyzedAt: null };
    if (existing) {
      const grew = spike.count >= (existing.spikeData?.count ?? 0) * 2;
      const updated = await this.incidents.updateSpike(existing, spike);
      await this.incidents.evaluateAndDispatch(updated, rules, grew, trigger);
      return;
    }
    const incident = await this.incidents.createSpike({
      chatId: chat.id,
      kind: 'spike',
      title: `Всплеск: ${w.count} сообщений за ${rules.spikeWindowMin} мин`,
      summary: `${w.count} сообщений от ${w.authors} участников за ${rules.spikeWindowMin} мин`,
      topic: topics[0]?.topic ?? null,
      categories: ['spike'],
      severity: 'attention',
      severityReason: historyLimited ? 'Превышен абсолютный порог (база сравнения ограничена)' : 'Превышены абсолютный порог и кратность к обычному уровню',
      confidence: 1,
      entities: [],
      authorKey: null,
      authorName: null,
      firstMessageAt: from,
      lastMessageAt: to,
      relatedIncidentId: null,
      analysisVersion: null,
      spikeData: spike,
    });
    await this.incidents.evaluateAndDispatch(incident, rules, false, trigger);
  }
}
