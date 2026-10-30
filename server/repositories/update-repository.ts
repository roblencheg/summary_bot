import type { Db } from '~server/platform';
import { isoPlus, newLeaseToken, nowIso } from './sql-utils';

export interface StoredUpdate {
  updateId: number;
  kind: string;
  payload: unknown;
  attempts: number;
  receivedAt: string;
}

/** Сырые апдейты Telegram — сохраняются ДО обработки; это и есть очередь приёма. */
export class UpdateRepository {
  constructor(private readonly db: Db) {}

  /** true — апдейт новый; false — повторная доставка того же update_id. */
  async insert(updateId: number, kind: string, payload: unknown): Promise<boolean> {
    const r = await this.db.exec(
      `INSERT INTO telegram_updates (update_id, received_at, kind, payload) VALUES (?, ?, ?, ?)
       ON CONFLICT(update_id) DO NOTHING`,
      [updateId, nowIso(), kind, JSON.stringify(payload)],
    );
    return r.changes > 0;
  }

  async claim(limit: number, leaseMs: number): Promise<StoredUpdate[]> {
    const token = newLeaseToken();
    const now = nowIso();
    await this.db.exec(
      `UPDATE telegram_updates SET lease_token = ?, lease_until = ?
       WHERE update_id IN (
         SELECT update_id FROM telegram_updates
         WHERE status = 'pending' AND (lease_until IS NULL OR lease_until < ?)
         ORDER BY update_id LIMIT ?
       )`,
      [token, isoPlus(leaseMs), now, limit],
    );
    const rows = await this.db.query<{ update_id: number; kind: string; payload: string; attempts: number; received_at: string }>(
      'SELECT update_id, kind, payload, attempts, received_at FROM telegram_updates WHERE lease_token = ? ORDER BY update_id',
      [token],
    );
    return rows.map((r) => ({
      updateId: r.update_id,
      kind: r.kind,
      payload: JSON.parse(r.payload),
      attempts: r.attempts,
      receivedAt: r.received_at,
    }));
  }

  async markDone(updateId: number, status: 'done' | 'ignored'): Promise<void> {
    await this.db.exec(
      'UPDATE telegram_updates SET status = ?, processed_at = ?, lease_token = NULL, lease_until = NULL WHERE update_id = ?',
      [status, nowIso(), updateId],
    );
  }

  async markError(updateId: number, error: string, final: boolean, retryInMs: number): Promise<void> {
    await this.db.exec(
      `UPDATE telegram_updates SET attempts = attempts + 1, error = ?, status = ?, lease_token = NULL, lease_until = ?
       WHERE update_id = ?`,
      [error.slice(0, 1000), final ? 'failed' : 'pending', final ? null : isoPlus(retryInMs), updateId],
    );
  }

  async stats(): Promise<{ pending: number; failed: number; oldestPendingAt: string | null }> {
    const r = await this.db.first<{ pending: number; failed: number; oldest: string | null }>(
      `SELECT SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
              MIN(CASE WHEN status = 'pending' THEN received_at END) AS oldest
       FROM telegram_updates`,
    );
    return { pending: r?.pending ?? 0, failed: r?.failed ?? 0, oldestPendingAt: r?.oldest ?? null };
  }

  async deleteProcessedOlderThan(iso: string): Promise<number> {
    const r = await this.db.exec(
      `DELETE FROM telegram_updates WHERE update_id IN (
         SELECT update_id FROM telegram_updates WHERE status IN ('done', 'ignored', 'failed') AND received_at < ? LIMIT 500)`,
      [iso],
    );
    return r.changes;
  }
}
