import type { Db } from '~server/platform';
import type { Channel } from '~shared/domain';
import { nowIso } from './sql-utils';

export type OnDemandStatus = 'accepted' | 'throttled' | 'no_chats' | 'denied';

/** Журнал нажатий «Что сейчас происходит» — и источник ограничения частоты, по каналу. */
export class OnDemandRepository {
  constructor(private readonly db: Db) {}

  async insert(r: { recipientId: number; channel: Channel; status: OnDemandStatus; chatIds: number[]; from: string | null; to: string | null }): Promise<void> {
    await this.db.exec(
      'INSERT INTO on_demand_requests (recipient_id, channel, requested_at, status, chat_ids, from_at, to_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [r.recipientId, r.channel, nowIso(), r.status, JSON.stringify(r.chatIds), r.from, r.to],
    );
  }

  async lastAcceptedAt(recipientId: number, channel: Channel): Promise<string | null> {
    const row = await this.db.first<{ at: string | null }>(
      "SELECT MAX(requested_at) AS at FROM on_demand_requests WHERE recipient_id = ? AND channel = ? AND status = 'accepted'",
      [recipientId, channel],
    );
    return row?.at ?? null;
  }

  async deleteOlderThan(iso: string): Promise<number> {
    const r = await this.db.exec(
      'DELETE FROM on_demand_requests WHERE id IN (SELECT id FROM on_demand_requests WHERE requested_at < ? LIMIT 500)',
      [iso],
    );
    return r.changes;
  }
}
