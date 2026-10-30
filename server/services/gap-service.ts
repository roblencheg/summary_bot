import type { GapRepository } from '~server/repositories/gap-repository';
import type { CollectionGap } from '~server/models/chat';
import type { SettingsService } from './settings-service';
import { TECH } from './settings-defaults';

const HEARTBEAT_KEY = 'heartbeat_at';

export const GAP_REASON_LABELS: Record<string, string> = {
  service_down: 'сервис не работал',
  intake_error: 'ошибки приёма событий Telegram',
  intake_error_max: 'ошибки приёма событий MAX',
  bot_removed: 'бот удалён из чата или лишён прав',
};

/** Пробелы сбора: простой сервиса, ошибки приёма, удаление бота. */
export class GapService {
  constructor(
    private readonly repo: GapRepository,
    private readonly settings: SettingsService,
  ) {}

  /** При старте: если heartbeat старше порога — сервис простаивал. */
  async detectDowntimeOnStart(now = new Date()): Promise<void> {
    const last = await this.settings.getValue<string>(HEARTBEAT_KEY);
    if (last && now.getTime() - new Date(last).getTime() > TECH.serviceDownGapMs) {
      await this.repo.insertClosed(null, 'service_down', last, now.toISOString(), 'Обнаружено при старте по heartbeat');
    }
    await this.heartbeat(now);
  }

  async heartbeat(now = new Date()): Promise<void> {
    await this.settings.setValue(HEARTBEAT_KEY, now.toISOString());
  }

  /** Сообщение из окна простоя всё же пришло — Telegram дослал апдейты. */
  async noteLateMessage(sentAt: string, receivedAt: string): Promise<void> {
    if (new Date(receivedAt).getTime() - new Date(sentAt).getTime() > TECH.serviceDownGapMs) {
      await this.repo.markRecoveredCovering(sentAt);
    }
  }

  openIntakeError(since: string, details: string): Promise<void> {
    return this.repo.open(null, 'intake_error', since, details);
  }

  closeIntakeError(): Promise<void> {
    return this.repo.close(null, 'intake_error');
  }

  /** Пробел приёма MAX — отдельная причина (`intake_error_max`), чтобы не гаситься/открываться вместе с Telegram. */
  openIntakeErrorMax(since: string, details: string): Promise<void> {
    return this.repo.open(null, 'intake_error_max', since, details);
  }

  closeIntakeErrorMax(): Promise<void> {
    return this.repo.close(null, 'intake_error_max');
  }

  openBotRemoved(chatId: number, details: string): Promise<void> {
    return this.repo.open(chatId, 'bot_removed', new Date().toISOString(), details);
  }

  closeBotRemoved(chatId: number): Promise<void> {
    return this.repo.close(chatId, 'bot_removed');
  }

  overlapping(chatId: number, from: string, to: string): Promise<CollectionGap[]> {
    return this.repo.overlapping(chatId, from, to);
  }

  recent(limit: number): Promise<CollectionGap[]> {
    return this.repo.listRecent(limit);
  }
}
