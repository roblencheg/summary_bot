import type { Db } from '~server/platform';
import { nowIso, parseJson } from './sql-utils';

export class SettingsRepository {
  constructor(private readonly db: Db) {}

  async get<T>(key: string): Promise<T | null> {
    const row = await this.db.first<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    return row ? parseJson<T | null>(row.value, null) : null;
  }

  async set(key: string, value: unknown, updatedBy: string | null): Promise<void> {
    await this.db.exec(
      `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      [key, JSON.stringify(value), nowIso(), updatedBy],
    );
  }

  async getChatRules(chatId: number): Promise<Record<string, unknown>> {
    const row = await this.db.first<{ value: string }>('SELECT value FROM chat_rules WHERE chat_id = ?', [chatId]);
    return row ? parseJson<Record<string, unknown>>(row.value, {}) : {};
  }

  async listChatRules(): Promise<Array<{ chatId: number; value: Record<string, unknown> }>> {
    const out: Array<{ chatId: number; value: Record<string, unknown> }> = [];
    for (let offset = 0; ; offset += 100) {
      const rows = await this.db.query<{ chat_id: number; value: string }>(
        'SELECT chat_id, value FROM chat_rules ORDER BY chat_id LIMIT 100 OFFSET ?',
        [offset],
      );
      out.push(...rows.map((r) => ({ chatId: r.chat_id, value: parseJson<Record<string, unknown>>(r.value, {}) })));
      if (rows.length < 100) return out;
    }
  }

  async setChatRules(chatId: number, value: Record<string, unknown>): Promise<void> {
    await this.db.exec(
      `INSERT INTO chat_rules (chat_id, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [chatId, JSON.stringify(value), nowIso()],
    );
  }

  // --- состояние технических уведомлений ---
  async getTechAlertState(kind: string): Promise<{ active: boolean; lastSentAt: string | null } | null> {
    const row = await this.db.first<{ active: number; last_sent_at: string | null }>(
      'SELECT active, last_sent_at FROM tech_alert_state WHERE kind = ?',
      [kind],
    );
    return row ? { active: row.active === 1, lastSentAt: row.last_sent_at } : null;
  }

  async setTechAlertState(kind: string, active: boolean, lastSentAt: string | null, details: string | null): Promise<void> {
    await this.db.exec(
      `INSERT INTO tech_alert_state (kind, active, last_sent_at, details) VALUES (?, ?, ?, ?)
       ON CONFLICT(kind) DO UPDATE SET active = excluded.active,
         last_sent_at = COALESCE(excluded.last_sent_at, tech_alert_state.last_sent_at),
         details = excluded.details`,
      [kind, active ? 1 : 0, lastSentAt, details],
    );
  }
}
