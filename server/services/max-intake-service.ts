import { MaxError } from '~server/integrations/max-client';
import type { MaxBotService } from './max-bot-service';
import type { GapService } from './gap-service';
import type { MaxIngestionService } from './max-ingestion-service';
import type { RuntimeState } from './runtime-state';
import type { SettingsService } from './settings-service';
import { TECH } from './settings-defaults';

const MARKER_KEY = 'max.marker';

/**
 * Управление приёмом MAX — аналог intake-service.ts для Telegram. По умолчанию везде `polling`
 * (см. config.ts, maxMode): webhook поддержан в клиенте, но не включается — подпись запроса
 * webhook MAX не задокументирована однозначно (design.md, «Риски»).
 */
export class MaxIntakeService {
  constructor(
    private readonly bot: MaxBotService,
    private readonly ingestion: MaxIngestionService,
    private readonly gaps: GapService,
    private readonly settings: SettingsService,
    private readonly state: RuntimeState,
    private readonly webhookUrl: string,
  ) {}

  get active(): boolean {
    return this.bot.configured && this.bot.mode !== 'off';
  }

  async prepare(): Promise<void> {
    if (this.bot.mode === 'webhook') return this.registerWebhook();
    if (this.bot.mode !== 'polling' || !this.bot.client) return;
    try {
      await this.bot.client.unsubscribe(this.webhookUrl);
    } catch {
      // нет подписки — это ожидаемо, не ошибка
    }
  }

  private async registerWebhook(): Promise<void> {
    if (!this.bot.client) return;
    try {
      await this.bot.client.subscribe(this.webhookUrl);
      console.log(`[max-intake] webhook registered: ${this.webhookUrl}`);
      this.markOk();
    } catch (err) {
      this.markFailing(`subscribe: ${(err as Error).message}`);
    }
  }

  /** Один цикл long polling (только MAX_MODE=polling). */
  async pollOnce(): Promise<void> {
    if (this.bot.mode !== 'polling' || !this.bot.client) return;
    const marker = await this.settings.getValue<number>(MARKER_KEY);
    try {
      const res = await this.bot.client.getUpdates(marker ?? null, 25);
      for (const u of res.updates) await this.ingestion.store(u, res.marker);
      if (res.marker !== null && res.marker !== undefined) await this.settings.setValue(MARKER_KEY, res.marker);
      this.markOk();
    } catch (err) {
      const e = err as Error;
      this.markFailing(`getUpdates: ${e.message}`);
      if (e instanceof MaxError) console.error('[max-intake] getUpdates failed:', e.kind, e.description);
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }

  private markFailing(msg: string): void {
    this.state.maxIntake.failingSince ??= new Date().toISOString();
    this.state.maxIntake.lastErrorMessage = msg.slice(0, 300);
    this.state.maxIntake.lastErrorAt = new Date().toISOString();
  }

  private markOk(): void {
    this.state.maxIntake.failingSince = null;
    this.state.maxIntake.lastOkAt = new Date().toISOString();
  }

  /** Долгая ошибка приёма → пробел сбора (общий с Telegram — пробел по сбору вообще, не по каналу). */
  async syncGap(): Promise<void> {
    const since = this.state.maxIntake.failingSince;
    if (since && Date.now() - new Date(since).getTime() > TECH.intakeErrorGapMs) {
      await this.gaps.openIntakeErrorMax(since, this.state.maxIntake.lastErrorMessage ?? 'ошибка приёма MAX');
    } else if (!since) {
      await this.gaps.closeIntakeErrorMax();
    }
  }
}
