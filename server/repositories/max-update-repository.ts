import type { Db } from '~server/platform';
import { isoPlus, newLeaseToken, nowIso } from './sql-utils';

export interface StoredMaxUpdate {
  id: number;
  kind: string;
  payload: unknown;
  attempts: number;
  receivedAt: string;
}

/** Сырые апдейты MAX — сохраняются ДО обработки; аналог update-repository.ts для Telegram. */
export class MaxUpdateRepository {
  constructor(private readonly db: Db) {}

  async insert(marker: number | null, kind: string, payload: unknown): Promise<void> {
    await this.db.exec('INSERT INTO max_updates (marker, received_at, kind, payload) VALUES (?, ?, ?, ?)', [
      marker,
      nowIso(),
      kind,
      JSON.stringify(payload),
    ]);
  }

  async claim(limit: number, leaseMs: number): Promise<StoredMaxUpdate[]> {
    const token = newLeaseToken();
    const now = nowIso();
    await this.db.exec(
      `UPDATE max_updates SET lease_token = ?, lease_until = ?
       WHERE id IN (
         SELECT id FROM max_updates
         WHERE status = 'pending' AND (lease_until IS NULL OR lease_until < ?)
         ORDER BY id LIMIT ?
       )`,
      [token, isoPlus(leaseMs), now, limit],
    );
    const rows = await this.db.query<{ id: number; kind: string; payload: string; attempts: number; received_at: string }>(
      'SELECT id, kind, payload, attempts, received_at FROM max_updates WHERE lease_token = ? ORDER BY id',
      [token],
    );
    return rows.map((r) => ({ id: r.id, kind: r.kind, payload: JSON.parse(r.payload), attempts: r.attempts, receivedAt: r.received_at }));
  }

  async markDone(id: number, status: 'done' | 'ignored'): Promise<void> {
    await this.db.exec('UPDATE max_updates SET status = ?, processed_at = ?, lease_token = NULL, lease_until = NULL WHERE id = ?', [
      status,
      nowIso(),
      id,
    ]);
  }

  async markError(id: number, error: string, final: boolean, retryInMs: number): Promise<void> {
    await this.db.exec(
      `UPDATE max_updates SET attempts = attempts + 1, error = ?, status = ?, lease_token = NULL, lease_until = ? WHERE id = ?`,
      [error.slice(0, 1000), final ? 'failed' : 'pending', final ? null : isoPlus(retryInMs), id],
    );
  }

  async stats(): Promise<{ pending: number; failed: number; oldestPendingAt: string | null }> {
    const r = await this.db.first<{ pending: number; failed: number; oldest: string | null }>(
      `SELECT SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
              MIN(CASE WHEN status = 'pending' THEN received_at END) AS oldest
       FROM max_updates`,
    );
    return { pending: r?.pending ?? 0, failed: r?.failed ?? 0, oldestPendingAt: r?.oldest ?? null };
  }

  async deleteProcessedOlderThan(iso: string): Promise<number> {
    const r = await this.db.exec(
      `DELETE FROM max_updates WHERE id IN (
         SELECT id FROM max_updates WHERE status IN ('done', 'ignored', 'failed') AND received_at < ? LIMIT 500)`,
      [iso],
    );
    return r.changes;
  }
}
