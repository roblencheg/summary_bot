import type { Db } from '~server/platform';
import { placeholders } from './sql-utils';

/** Условие ограничения по дирекциям руководителя: undefined — без ограничения, [] — пусто. */
function scoped(col: string, ids: number[] | undefined): { sql: string; params: number[] } {
  if (!ids) return { sql: '', params: [] };
  return ids.length ? { sql: ` AND ${col} IN (${placeholders(ids.length)})`, params: ids } : { sql: ' AND 0', params: [] };
}

/** Сводные счётчики для обзора — только агрегаты SQL. */
export class MetricsRepository {
  constructor(private readonly db: Db) {}

  async messagesSince(iso: string, chatIds?: number[]): Promise<{ messages: number; chats: number; authors: number }> {
    const f = scoped('chat_id', chatIds);
    const r = await this.db.first<{ n: number; c: number; a: number }>(
      `SELECT COUNT(*) AS n, COUNT(DISTINCT chat_id) AS c, COUNT(DISTINCT author_key) AS a FROM messages WHERE received_at >= ?${f.sql}`,
      [iso, ...f.params],
    );
    return { messages: r?.n ?? 0, chats: r?.c ?? 0, authors: r?.a ?? 0 };
  }

  async chatsByStatus(chatIds?: number[]): Promise<Array<{ status: string; n: number }>> {
    const f = scoped('id', chatIds);
    return this.db.query<{ status: string; n: number }>(`SELECT status, COUNT(*) AS n FROM chats WHERE 1 = 1${f.sql} GROUP BY status`, f.params);
  }

  async recipientsByStatus(recipientIds?: number[]): Promise<Array<{ status: string; n: number }>> {
    const f = scoped('id', recipientIds);
    return this.db.query<{ status: string; n: number }>(`SELECT status, COUNT(*) AS n FROM recipients WHERE 1 = 1${f.sql} GROUP BY status`, f.params);
  }

  async messagesPerChatSince(iso: string, chatIds?: number[]): Promise<Array<{ chatId: number; n: number }>> {
    const f = scoped('chat_id', chatIds);
    const rows = await this.db.query<{ chat_id: number; n: number }>(
      `SELECT chat_id, COUNT(*) AS n FROM messages WHERE received_at >= ?${f.sql} GROUP BY chat_id ORDER BY n DESC LIMIT 100`,
      [iso, ...f.params],
    );
    return rows.map((r) => ({ chatId: r.chat_id, n: r.n }));
  }

  /** Пик сообщений в минуту за окно — для профиля нагрузки. */
  async peakPerMinuteSince(iso: string, chatIds?: number[]): Promise<number> {
    const f = scoped('chat_id', chatIds);
    const r = await this.db.first<{ m: number | null }>(
      `SELECT MAX(n) AS m FROM (SELECT substr(received_at, 1, 16) AS minute, COUNT(*) AS n FROM messages
         WHERE received_at >= ?${f.sql} GROUP BY minute)`,
      [iso, ...f.params],
    );
    return r?.m ?? 0;
  }

  async dbSizeBytes(): Promise<number | null> {
    try {
      const r = await this.db.first<{ s: number }>(
        'SELECT page_count * page_size AS s FROM pragma_page_count(), pragma_page_size()',
      );
      return r?.s ?? null;
    } catch {
      return null;
    }
  }
}
