import type { SettingsRepository } from '~server/repositories/settings-repository';
import type { DeliveryRepository } from '~server/repositories/delivery-repository';
import type { RecipientRepository } from '~server/repositories/recipient-repository';
import { escapeHtml } from '~server/domain/html';
import type { RuntimeState } from './runtime-state';
import { TECH } from './settings-defaults';

/** Технические уведомления назначенным администраторам: не чаще раза в 30 минут на тип сбоя. */
export class TechAlertService {
  constructor(
    private readonly state: SettingsRepository,
    private readonly deliveries: DeliveryRepository,
    private readonly recipients: RecipientRepository,
    private readonly runtime: RuntimeState,
  ) {}

  async raise(kind: string, text: string): Promise<void> {
    const st = await this.state.getTechAlertState(kind);
    const now = Date.now();
    if (st?.active && st.lastSentAt && now - new Date(st.lastSentAt).getTime() < TECH.techAlertRepeatMs) return;
    await this.send(kind, `⚠️ <b>Технический сбой</b>\n${escapeHtml(text)}`);
    await this.state.setTechAlertState(kind, true, new Date(now).toISOString(), text);
  }

  async resolve(kind: string, text: string): Promise<void> {
    const st = await this.state.getTechAlertState(kind);
    if (!st?.active) return;
    await this.state.setTechAlertState(kind, false, null, null);
    await this.send(`${kind}:ok`, `✅ <b>Восстановлено</b>\n${escapeHtml(text)}`);
  }

  /** Техническое не завязано на чат — по заданию на каждый канал, где админ сейчас активен. */
  private async send(kind: string, text: string): Promise<void> {
    const admins = await this.recipients.listTechAdmins();
    const stamp = new Date().toISOString();
    let queued = 0;
    for (const r of admins) {
      if (r.status === 'active' && r.telegramUserId) {
        await this.deliveries.enqueue({ dedupKey: `tech:${kind}:${r.id}:telegram:${stamp}`, recipientId: r.id, channel: 'telegram', kind: 'tech', payload: { text } });
        queued++;
      }
      if (r.maxStatus === 'active' && r.maxUserId) {
        await this.deliveries.enqueue({ dedupKey: `tech:${kind}:${r.id}:max:${stamp}`, recipientId: r.id, channel: 'max', kind: 'tech', payload: { text } });
        queued++;
      }
    }
    if (queued) this.runtime.wake('delivery');
  }
}
