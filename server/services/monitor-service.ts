import type { DeliveryRepository } from '~server/repositories/delivery-repository';
import type { MessageRepository } from '~server/repositories/message-repository';
import type { IncidentService } from './incident-service';
import type { IntakeService } from './intake-service';
import type { MaxIntakeService } from './max-intake-service';
import type { RuntimeState } from './runtime-state';
import type { TechAlertService } from './tech-alert-service';
import { TECH } from './settings-defaults';

/** Периодические проверки: технические уведомления и отложенные обновления инцидентов. */
export class MonitorService {
  constructor(
    private readonly state: RuntimeState,
    private readonly techAlerts: TechAlertService,
    private readonly deliveries: DeliveryRepository,
    private readonly messages: MessageRepository,
    private readonly incidents: IncidentService,
    private readonly intake: IntakeService,
    private readonly maxIntake: MaxIntakeService,
  ) {}

  async check(): Promise<void> {
    const now = Date.now();
    const ai = this.state.ai.failingSince;
    if (ai && now - new Date(ai).getTime() > TECH.aiDownTechAlertMs) {
      const backlog = await this.messages.backlog();
      await this.techAlerts.raise(
        'ai_down',
        `AI-анализ недоступен с ${ai}. Сообщения сохраняются, в очереди ${backlog.pending}. Ошибка: ${this.state.ai.lastError ?? '—'}`,
      );
    } else if (!ai) {
      await this.techAlerts.resolve('ai_down', 'AI-анализ снова доступен, очередь доанализируется.');
    }

    await this.intake.refreshWebhookInfo();
    await this.intake.syncGap();
    const intake = this.state.intake.failingSince;
    if (intake && now - new Date(intake).getTime() > TECH.intakeErrorGapMs) {
      await this.techAlerts.raise('intake', `Ошибки приёма событий Telegram с ${intake}: ${this.state.intake.lastErrorMessage ?? '—'}`);
    } else if (!intake) {
      await this.techAlerts.resolve('intake', 'Приём событий Telegram восстановлен.');
    }

    await this.maxIntake.syncGap();
    const maxIntake = this.state.maxIntake.failingSince;
    if (maxIntake && now - new Date(maxIntake).getTime() > TECH.intakeErrorGapMs) {
      await this.techAlerts.raise('intake_max', `Ошибки приёма событий MAX с ${maxIntake}: ${this.state.maxIntake.lastErrorMessage ?? '—'}`);
    } else if (!maxIntake) {
      await this.techAlerts.resolve('intake_max', 'Приём событий MAX восстановлен.');
    }

    const q = await this.deliveries.queueStats();
    if (q.oldestPendingAt && now - new Date(q.oldestPendingAt).getTime() > TECH.deliveryStuckTechAlertMs) {
      await this.techAlerts.raise('delivery_stuck', `Очередь отправок задерживается: ${q.pending} заданий, самое старое с ${q.oldestPendingAt}.`);
    } else {
      await this.techAlerts.resolve('delivery_stuck', 'Очередь отправок в норме.');
    }

    await this.incidents.flushPending();
  }
}
