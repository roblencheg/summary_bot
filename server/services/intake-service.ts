import { ALLOWED_UPDATES, TelegramError } from '~server/integrations/telegram-client';
import type { BotService } from './bot-service';
import type { GapService } from './gap-service';
import type { IngestionService } from './ingestion-service';
import type { RuntimeState } from './runtime-state';
import type { SettingsService } from './settings-service';
import { TECH } from './settings-defaults';

const OFFSET_KEY = 'telegram.offset';

/**
 * Управление приёмом: регистрация webhook (prod) или long polling (тестовый бот).
 * AICODE-NOTE: при TELEGRAM_MODE=off (по умолчанию в dev) здесь НЕ вызываются setWebhook,
 * deleteWebhook и getUpdates — dev-контейнер видит prod-токен и иначе сломал бы приём в prod.
 * В режиме polling при старте снимается webhook (иначе getUpdates отвечает 409);
 * накопленные у Telegram апдейты при этом сохраняются и приходят через getUpdates.
 */
export class IntakeService {
  constructor(
    private readonly bot: BotService,
    private readonly ingestion: IngestionService,
    private readonly gaps: GapService,
    private readonly settings: SettingsService,
    private readonly state: RuntimeState,
    private readonly webhookUrl: string,
  ) {}

  get active(): boolean {
    return this.bot.configured && this.bot.mode !== 'off';
  }

  /** Подготовка приёма при старте процесса. */
  async prepare(): Promise<void> {
    if (this.bot.mode === 'webhook') return this.registerWebhook();
    if (this.bot.mode !== 'polling' || !this.bot.client) return;
    try {
      const info = await this.bot.client.getWebhookInfo();
      if (info.url) {
        await this.bot.client.deleteWebhook();
        console.log(`[intake] webhook ${info.url} снят, приём через long polling (в очереди Telegram: ${info.pending_update_count})`);
      }
    } catch (err) {
      this.markFailing(`deleteWebhook: ${(err as Error).message}`);
    }
  }

  private async registerWebhook(): Promise<void> {
    if (!this.bot.client || !this.bot.webhookSecret) return;
    try {
      await this.bot.client.setWebhook(this.webhookUrl, this.bot.webhookSecret);
      this.state.intake.webhookUrl = this.webhookUrl;
      this.state.intake.webhookRegisteredAt = new Date().toISOString();
      console.log(`[intake] webhook registered: ${this.webhookUrl}`);
    } catch (err) {
      this.markFailing(`setWebhook: ${(err as Error).message}`);
    }
    await this.refreshWebhookInfo();
  }

  /** Состояние webhook по getWebhookInfo: ошибки доставки и очередь у Telegram. */
  async refreshWebhookInfo(): Promise<void> {
    if (this.bot.mode !== 'webhook' || !this.bot.client) return;
    try {
      const info = await this.bot.client.getWebhookInfo();
      this.state.intake.pendingUpdateCount = info.pending_update_count;
      this.state.intake.webhookUrl = info.url || null;
      const lastErr = info.last_error_date ? info.last_error_date * 1000 : 0;
      if (info.last_error_message) {
        this.state.intake.lastErrorAt = new Date(lastErr).toISOString();
        this.state.intake.lastErrorMessage = info.last_error_message;
      }
      const recentError = lastErr && Date.now() - lastErr < TECH.intakeErrorGapMs;
      if (info.url !== this.webhookUrl) this.markFailing(`webhook указывает на другой адрес: ${info.url || 'не установлен'}`);
      else if (recentError) this.markFailing(`Telegram не может доставить webhook: ${info.last_error_message}`);
      else this.markOk();
    } catch (err) {
      this.markFailing(`getWebhookInfo: ${(err as Error).message}`);
    }
  }

  /** Один цикл long polling (только TELEGRAM_MODE=polling). */
  async pollOnce(): Promise<void> {
    if (this.bot.mode !== 'polling' || !this.bot.client) return;
    const offset = await this.settings.getValue<number>(OFFSET_KEY);
    try {
      const updates = await this.bot.client.getUpdates(offset, 25);
      for (const u of updates) await this.ingestion.store(u);
      if (updates.length) await this.settings.setValue(OFFSET_KEY, updates[updates.length - 1].update_id + 1);
      this.markOk();
    } catch (err) {
      const e = err as Error;
      this.markFailing(`getUpdates: ${e.message}`);
      if (e instanceof TelegramError && e.httpStatus === 409) console.error('[intake] 409: у токена установлен webhook или другой потребитель getUpdates');
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }

  private markFailing(msg: string): void {
    this.state.intake.failingSince ??= new Date().toISOString();
    this.state.intake.lastErrorMessage = msg.slice(0, 300);
    this.state.intake.lastErrorAt = new Date().toISOString();
  }

  private markOk(): void {
    this.state.intake.failingSince = null;
    this.state.intake.lastOkAt = new Date().toISOString();
  }

  /** Долгая ошибка приёма → пробел сбора. */
  async syncGap(): Promise<void> {
    const since = this.state.intake.failingSince;
    if (since && Date.now() - new Date(since).getTime() > TECH.intakeErrorGapMs) {
      await this.gaps.openIntakeError(since, this.state.intake.lastErrorMessage ?? 'ошибка приёма');
    } else if (!since) {
      await this.gaps.closeIntakeError();
    }
  }

  allowedUpdates(): string[] {
    return ALLOWED_UPDATES;
  }
}
