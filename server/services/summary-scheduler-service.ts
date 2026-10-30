import type { ReportRepository } from '~server/repositories/report-repository';
import type { MessageRepository } from '~server/repositories/message-repository';
import { periodsEndingBetween } from '~server/domain/periods';
import type { DigestService } from './digest-service';
import type { ReportService } from './report-service';
import type { RuntimeState } from './runtime-state';
import type { SettingsService } from './settings-service';
import type { SubscriptionService } from './subscription-service';
import { TECH } from './settings-defaults';

const LAST_BOUNDARY_KEY = 'scheduler.last_boundary';

/**
 * Расписание саммари. Периоды фиксируются в БД (UNIQUE по типу и началу) — после рестарта
 * пропущенные границы досоздаются, параллельные тики не создадут дублей.
 */
export class SummarySchedulerService {
  constructor(
    private readonly repo: ReportRepository,
    private readonly messages: MessageRepository,
    private readonly digests: DigestService,
    private readonly reports: ReportService,
    private readonly subscriptions: SubscriptionService,
    private readonly settings: SettingsService,
    private readonly runtime: RuntimeState,
  ) {}

  /** Создаёт периоды, границы которых прошли с прошлого тика. */
  async tick(now = new Date()): Promise<number> {
    const g = await this.settings.global();
    const last = await this.settings.getValue<string>(LAST_BOUNDARY_KEY);
    if (!last) {
      // первый запуск: историю не догоняем, начинаем с текущего момента
      await this.settings.setValue(LAST_BOUNDARY_KEY, now.toISOString());
      return 0;
    }
    const floor = Math.max(new Date(last).getTime(), now.getTime() - TECH.maxCatchupDays * 86_400_000);
    const due = periodsEndingBetween(new Date(floor), now, { timezone: g.timezone, dayStart: g.dayStart, nightStart: g.nightStart });
    for (const p of due) await this.repo.ensurePeriod(p.type, p.start.toISOString(), p.end.toISOString());
    await this.settings.setValue(LAST_BOUNDARY_KEY, now.toISOString());
    if (due.length) this.runtime.wake('reports');
    return due.length;
  }

  /** Обработка одного закрытого периода: дождаться анализа, собрать дайджесты, создать отчёты. */
  async processNext(now = new Date()): Promise<boolean> {
    const period = await this.repo.claimCollectingPeriod(10 * 60_000);
    if (!period) return false;
    try {
      const chatIds = [...new Set((await this.subscriptions.all('summary')).map((s) => s.chatId))];
      const waitUntil = new Date(period.endsAt).getTime() + TECH.digestWaitAnalysisMs;
      if (now.getTime() < waitUntil && !this.runtime.ai.failingSince) {
        let pending = 0;
        for (const c of chatIds) pending += await this.messages.pendingInRange(c, period.startsAt, period.endsAt);
        if (pending > 0) {
          await this.repo.postponePeriod(period.id, 10_000, `ожидание анализа: ${pending} сообщ.`);
          return true;
        }
      }
      for (const c of chatIds) await this.digests.ensure(c, period);
      const g = await this.settings.global();
      const newer = await this.repo.countPeriodsEndingBetween(period.endsAt, now.toISOString());
      await this.reports.createForPeriod(period, newer < g.catchupMaxReports);
      await this.repo.setPeriodStatus(period.id, 'ready', null);
    } catch (err) {
      console.error('[scheduler] period failed:', (err as Error).message);
      await this.repo.postponePeriod(period.id, 60_000, (err as Error).message.slice(0, 300));
    }
    return true;
  }
}
