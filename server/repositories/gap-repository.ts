import type { Db } from '~server/platform';
import type { CollectionGap } from '~server/models/chat';
import { nowIso } from './sql-utils';

interface GapRow {
  id: number;
  chat_id: number | null;
  started_at: string;
  ended_at: string | null;
  reason: string;
  details: string | null;
  recovered: number;
}

const rowToGap = (r: GapRow): CollectionGap => ({
  id: r.id,
  chatId: r.chat_id,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  reason: r.reason,
  details: r.details,
  recovered: r.recovered === 1,
});

export class GapRepository {
  constructor(private readonly db: Db) {}

  async open(chatId: number | null, reason: string, startedAt: string, details: string | null): Promise<void> {
    const existing = await this.findOpen(chatId, reason);
    if (existing) return;
    await this.db.exec('INSERT INTO collection_gaps (chat_id, started_at, reason, details) VALUES (?, ?, ?, ?)', [
      chatId,
      startedAt,
      reason,
      details,
    ]);
  }

  async insertClosed(chatId: number | null, reason: string, startedAt: string, endedAt: string, details: string | null): Promise<void> {
    await this.db.exec('INSERT INTO collection_gaps (chat_id, started_at, ended_at, reason, details) VALUES (?, ?, ?, ?, ?)', [
      chatId,
      startedAt,
      endedAt,
      reason,
      details,
    ]);
  }

  async findOpen(chatId: number | null, reason: string): Promise<CollectionGap | null> {
    const r = await this.db.first<GapRow>(
      'SELECT * FROM collection_gaps WHERE chat_id IS ? AND reason = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1',
      [chatId, reason],
    );
    return r ? rowToGap(r) : null;
  }

  async close(chatId: number | null, reason: string, endedAt: string = nowIso()): Promise<void> {
    await this.db.exec('UPDATE collection_gaps SET ended_at = ? WHERE chat_id IS ? AND reason = ? AND ended_at IS NULL', [
      endedAt,
      chatId,
      reason,
    ]);
  }

  /** Telegram дослал апдейты за время простоя — пробел помечаем восстановленным. */
  async markRecoveredCovering(sentAt: string): Promise<void> {
    await this.db.exec(
      `UPDATE collection_gaps SET recovered = 1
       WHERE reason = 'service_down' AND recovered = 0 AND started_at <= ? AND ended_at > ?`,
      [sentAt, sentAt],
    );
  }

  /** Пробелы чата (и глобальные), пересекающие [from, to). */
  async overlapping(chatId: number | null, from: string, to: string): Promise<CollectionGap[]> {
    const rows = await this.db.query<GapRow>(
      `SELECT * FROM collection_gaps
       WHERE (chat_id IS NULL OR chat_id = ?) AND recovered = 0
         AND started_at < ? AND (ended_at IS NULL OR ended_at > ?)
       ORDER BY started_at LIMIT 100`,
      [chatId, to, from],
    );
    return rows.map(rowToGap);
  }

  async listRecent(limit: number): Promise<CollectionGap[]> {
    const rows = await this.db.query<GapRow>('SELECT * FROM collection_gaps ORDER BY id DESC LIMIT ?', [Math.min(limit, 100)]);
    return rows.map(rowToGap);
  }

  async deleteOlderThan(iso: string): Promise<number> {
    const r = await this.db.exec(
      'DELETE FROM collection_gaps WHERE id IN (SELECT id FROM collection_gaps WHERE ended_at IS NOT NULL AND ended_at < ? LIMIT 500)',
      [iso],
    );
    return r.changes;
  }
}
