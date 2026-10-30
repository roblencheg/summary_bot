import type { Db } from '~server/platform';
import type { Chat, ChatStaff } from '~server/models/chat';
import type { Channel, ChatStatus } from '~shared/domain';
import { boolOrNull, nowIso, placeholders } from './sql-utils';

interface ChatRow {
  id: number;
  title: string;
  type: string;
  username: string | null;
  is_forum: number;
  status: string;
  channel: string;
  collection_started_at: string | null;
  last_message_at: string | null;
  last_event_at: string | null;
  bot_member_status: string | null;
  bot_is_admin: number | null;
  bot_reads_all: number | null;
  rights_checked_at: string | null;
  rights_error: string | null;
  migrated_to: number | null;
  created_at: string;
  updated_at: string;
}

const rowToChat = (r: ChatRow): Chat => ({
  id: r.id,
  title: r.title,
  type: r.type,
  username: r.username,
  isForum: r.is_forum === 1,
  status: r.status as ChatStatus,
  channel: r.channel as Channel,
  collectionStartedAt: r.collection_started_at,
  lastMessageAt: r.last_message_at,
  lastEventAt: r.last_event_at,
  botMemberStatus: r.bot_member_status,
  botIsAdmin: boolOrNull(r.bot_is_admin),
  botReadsAll: boolOrNull(r.bot_reads_all),
  rightsCheckedAt: r.rights_checked_at,
  rightsError: r.rights_error,
  migratedTo: r.migrated_to,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export class ChatRepository {
  constructor(private readonly db: Db) {}

  /**
   * Создать чат при первом событии или обновить его метаданные. Канал фиксируется только при
   * создании (ON CONFLICT его не трогает) — чат живёт в одном канале на всю жизнь.
   */
  async upsertSeen(c: { id: number; title: string; type: string; username: string | null; isForum: boolean; channel: Channel }): Promise<void> {
    const now = nowIso();
    await this.db.exec(
      `INSERT INTO chats (id, title, type, username, is_forum, status, channel, last_event_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, type = excluded.type, username = excluded.username,
         is_forum = excluded.is_forum, last_event_at = excluded.last_event_at, updated_at = excluded.updated_at`,
      [c.id, c.title, c.type, c.username, c.isForum ? 1 : 0, c.channel, now, now, now],
    );
  }

  async get(id: number): Promise<Chat | null> {
    const r = await this.db.first<ChatRow>('SELECT * FROM chats WHERE id = ?', [id]);
    return r ? rowToChat(r) : null;
  }

  async getMany(ids: number[]): Promise<Chat[]> {
    if (!ids.length) return [];
    const rows = await this.db.query<ChatRow>(`SELECT * FROM chats WHERE id IN (${placeholders(ids.length)})`, ids);
    return rows.map(rowToChat);
  }

  async list(): Promise<Chat[]> {
    const out: Chat[] = [];
    for (let offset = 0; ; offset += 100) {
      const rows = await this.db.query<ChatRow>('SELECT * FROM chats ORDER BY title LIMIT 100 OFFSET ?', [offset]);
      out.push(...rows.map(rowToChat));
      if (rows.length < 100) return out;
    }
  }

  async listActive(): Promise<Chat[]> {
    const rows = await this.db.query<ChatRow>("SELECT * FROM chats WHERE status = 'active' ORDER BY id LIMIT 100");
    return rows.map(rowToChat);
  }

  async setStatus(id: number, status: ChatStatus, collectionStartedAt?: string): Promise<void> {
    await this.db.exec(
      `UPDATE chats SET status = ?, collection_started_at = COALESCE(collection_started_at, ?), updated_at = ? WHERE id = ?`,
      [status, collectionStartedAt ?? null, nowIso(), id],
    );
  }

  async setBotMember(id: number, memberStatus: string, isAdmin: boolean): Promise<void> {
    await this.db.exec('UPDATE chats SET bot_member_status = ?, bot_is_admin = ?, last_event_at = ?, updated_at = ? WHERE id = ?', [
      memberStatus,
      isAdmin ? 1 : 0,
      nowIso(),
      nowIso(),
      id,
    ]);
  }

  async setRights(
    id: number,
    r: { memberStatus: string | null; isAdmin: boolean | null; readsAll: boolean | null; error: string | null; isForum?: boolean; username?: string | null; title?: string },
  ): Promise<void> {
    await this.db.exec(
      `UPDATE chats SET bot_member_status = COALESCE(?, bot_member_status), bot_is_admin = ?, bot_reads_all = ?,
         rights_error = ?, rights_checked_at = ?, is_forum = COALESCE(?, is_forum), username = COALESCE(?, username),
         title = COALESCE(?, title), updated_at = ? WHERE id = ?`,
      [
        r.memberStatus,
        r.isAdmin === null ? null : r.isAdmin ? 1 : 0,
        r.readsAll === null ? null : r.readsAll ? 1 : 0,
        r.error,
        nowIso(),
        r.isForum === undefined ? null : r.isForum ? 1 : 0,
        r.username === undefined ? null : r.username,
        r.title ?? null,
        nowIso(),
        id,
      ],
    );
  }

  async touchMessage(id: number, sentAt: string): Promise<void> {
    await this.db.exec(
      `UPDATE chats SET last_message_at = CASE WHEN last_message_at IS NULL OR last_message_at < ? THEN ? ELSE last_message_at END,
         last_event_at = ? WHERE id = ?`,
      [sentAt, sentAt, nowIso(), id],
    );
  }

  async touchEvent(id: number): Promise<void> {
    await this.db.exec('UPDATE chats SET last_event_at = ? WHERE id = ?', [nowIso(), id]);
  }

  /** Группа превратилась в супергруппу: новый ID наследует настройки, подписки и сотрудников. */
  async migrate(oldId: number, newId: number): Promise<void> {
    const now = nowIso();
    await this.db.exec(
      `INSERT INTO chats (id, title, type, username, is_forum, status, channel, collection_started_at, last_event_at, created_at, updated_at)
       SELECT ?, title, 'supergroup', username, is_forum, status, channel, collection_started_at, ?, ?, ? FROM chats WHERE id = ?
       ON CONFLICT(id) DO NOTHING`,
      [newId, now, now, now, oldId],
    );
    await this.db.exec("UPDATE chats SET status = 'migrated', migrated_to = ?, updated_at = ? WHERE id = ?", [newId, now, oldId]);
    await this.db.exec(
      'INSERT INTO chat_rules (chat_id, value, updated_at) SELECT ?, value, updated_at FROM chat_rules WHERE chat_id = ? ON CONFLICT(chat_id) DO NOTHING',
      [newId, oldId],
    );
    await this.db.exec(
      'INSERT INTO chat_staff (chat_id, telegram_user_id, label) SELECT ?, telegram_user_id, label FROM chat_staff WHERE chat_id = ? ON CONFLICT DO NOTHING',
      [newId, oldId],
    );
    await this.db.exec(
      'INSERT INTO summary_subscriptions (recipient_id, chat_id) SELECT recipient_id, ? FROM summary_subscriptions WHERE chat_id = ? ON CONFLICT DO NOTHING',
      [newId, oldId],
    );
    await this.db.exec(
      'INSERT INTO alert_subscriptions (recipient_id, chat_id) SELECT recipient_id, ? FROM alert_subscriptions WHERE chat_id = ? ON CONFLICT DO NOTHING',
      [newId, oldId],
    );
    // дирекции (владелец и доступ на чтение) переходят к супергруппе
    await this.db.exec(
      'INSERT INTO chat_directorates (chat_id, directorate_id, access, created_at) SELECT ?, directorate_id, access, created_at FROM chat_directorates WHERE chat_id = ? ON CONFLICT DO NOTHING',
      [newId, oldId],
    );
  }

  // --- сотрудники поддержки ---
  async listStaff(chatId: number): Promise<ChatStaff[]> {
    const rows = await this.db.query<{ chat_id: number; telegram_user_id: number; label: string | null }>(
      'SELECT * FROM chat_staff WHERE chat_id = ? ORDER BY telegram_user_id LIMIT 100',
      [chatId],
    );
    return rows.map((r) => ({ chatId: r.chat_id, telegramUserId: r.telegram_user_id, label: r.label }));
  }

  async listAllStaff(): Promise<ChatStaff[]> {
    const out: ChatStaff[] = [];
    for (let offset = 0; ; offset += 100) {
      const rows = await this.db.query<{ chat_id: number; telegram_user_id: number; label: string | null }>(
        'SELECT * FROM chat_staff ORDER BY chat_id, telegram_user_id LIMIT 100 OFFSET ?',
        [offset],
      );
      out.push(...rows.map((r) => ({ chatId: r.chat_id, telegramUserId: r.telegram_user_id, label: r.label })));
      if (rows.length < 100) return out;
    }
  }

  async replaceStaff(chatId: number, staff: Array<{ telegramUserId: number; label: string | null }>): Promise<void> {
    for (let i = 0; i < staff.length; i += 50) {
      const chunk = staff.slice(i, i + 50);
      await this.db.exec(
        `INSERT INTO chat_staff (chat_id, telegram_user_id, label) VALUES ${chunk.map(() => '(?, ?, ?)').join(', ')}
         ON CONFLICT(chat_id, telegram_user_id) DO UPDATE SET label = excluded.label`,
        chunk.flatMap((s) => [chatId, s.telegramUserId, s.label]),
      );
    }
    const ids = staff.map((s) => s.telegramUserId);
    await this.db.exec(
      ids.length
        ? `DELETE FROM chat_staff WHERE chat_id = ? AND telegram_user_id NOT IN (${placeholders(ids.length)})`
        : 'DELETE FROM chat_staff WHERE chat_id = ?',
      [chatId, ...ids],
    );
  }
}
