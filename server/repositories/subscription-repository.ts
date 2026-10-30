import type { Db } from '~server/platform';

type Kind = 'summary' | 'alert';
const table = (k: Kind) => (k === 'summary' ? 'summary_subscriptions' : 'alert_subscriptions');

export class SubscriptionRepository {
  constructor(private readonly db: Db) {}

  async chatIdsOf(kind: Kind, recipientId: number): Promise<number[]> {
    const rows = await this.db.query<{ chat_id: number }>(
      `SELECT chat_id FROM ${table(kind)} WHERE recipient_id = ? ORDER BY chat_id LIMIT 100`,
      [recipientId],
    );
    return rows.map((r) => r.chat_id);
  }

  async recipientIdsOf(kind: Kind, chatId: number): Promise<number[]> {
    const rows = await this.db.query<{ recipient_id: number }>(
      `SELECT recipient_id FROM ${table(kind)} WHERE chat_id = ? ORDER BY recipient_id LIMIT 100`,
      [chatId],
    );
    return rows.map((r) => r.recipient_id);
  }

  async all(kind: Kind): Promise<Array<{ recipientId: number; chatId: number }>> {
    const out: Array<{ recipientId: number; chatId: number }> = [];
    for (let offset = 0; ; offset += 100) {
      const rows = await this.db.query<{ recipient_id: number; chat_id: number }>(
        `SELECT recipient_id, chat_id FROM ${table(kind)} ORDER BY recipient_id, chat_id LIMIT 100 OFFSET ?`,
        [offset],
      );
      out.push(...rows.map((r) => ({ recipientId: r.recipient_id, chatId: r.chat_id })));
      if (rows.length < 100) return out;
    }
  }

  /** Снять чат со всех подписок обоих видов; возвращает затронутых получателей (для аудита). */
  async removeChatEverywhere(chatId: number): Promise<{ summary: number[]; alert: number[] }> {
    const summary = await this.recipientIdsOf('summary', chatId);
    const alert = await this.recipientIdsOf('alert', chatId);
    await this.db.exec('DELETE FROM summary_subscriptions WHERE chat_id = ?', [chatId]);
    await this.db.exec('DELETE FROM alert_subscriptions WHERE chat_id = ?', [chatId]);
    return { summary, alert };
  }

  /** Снять подписки на чат у получателей, ни одна дирекция которых не имеет доступа к чату. */
  async removeChatOutsiders(chatId: number): Promise<void> {
    for (const t of ['summary_subscriptions', 'alert_subscriptions']) {
      await this.db.exec(
        `DELETE FROM ${t} WHERE chat_id = ? AND recipient_id NOT IN (
           SELECT rd.recipient_id FROM recipient_directorates rd JOIN chat_directorates cd ON cd.directorate_id = rd.directorate_id WHERE cd.chat_id = ?)`,
        [chatId, chatId],
      );
    }
  }

  /** Снять подписки получателя на чаты, не видимые ни одной из его дирекций. */
  async removeInvisibleFor(recipientId: number): Promise<void> {
    for (const t of ['summary_subscriptions', 'alert_subscriptions']) {
      await this.db.exec(
        `DELETE FROM ${t} WHERE recipient_id = ? AND chat_id NOT IN (
           SELECT cd.chat_id FROM chat_directorates cd JOIN recipient_directorates rd ON rd.directorate_id = cd.directorate_id WHERE rd.recipient_id = ?)`,
        [recipientId, recipientId],
      );
    }
  }

  /** Объединение получателей: подписки from переносятся на to. */
  async moveRecipient(fromId: number, toId: number): Promise<void> {
    for (const t of ['summary_subscriptions', 'alert_subscriptions']) {
      await this.db.exec(`INSERT INTO ${t} (recipient_id, chat_id) SELECT ?, chat_id FROM ${t} WHERE recipient_id = ? ON CONFLICT DO NOTHING`, [toId, fromId]);
      await this.db.exec(`DELETE FROM ${t} WHERE recipient_id = ?`, [fromId]);
    }
  }

  // AICODE-NOTE: транзакций нет — сначала добавляем новые, потом удаляем лишние,
  // чтобы падение посередине не оставило получателя без подписок.
  async replace(kind: Kind, recipientId: number, chatIds: number[]): Promise<void> {
    for (let i = 0; i < chatIds.length; i += 50) {
      const chunk = chatIds.slice(i, i + 50);
      await this.db.exec(
        `INSERT INTO ${table(kind)} (recipient_id, chat_id) VALUES ${chunk.map(() => '(?, ?)').join(', ')} ON CONFLICT DO NOTHING`,
        chunk.flatMap((c) => [recipientId, c]),
      );
    }
    if (!chatIds.length) {
      await this.db.exec(`DELETE FROM ${table(kind)} WHERE recipient_id = ?`, [recipientId]);
    } else {
      await this.db.exec(
        `DELETE FROM ${table(kind)} WHERE recipient_id = ? AND chat_id NOT IN (${chatIds.map(() => '?').join(', ')})`,
        [recipientId, ...chatIds],
      );
    }
  }
}
