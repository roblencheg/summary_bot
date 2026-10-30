import type { Db } from '~server/platform';
import { IMPORTANCE_LEVELS, QUIET_MODES, type ChatAccess, type ChatClaimCode, type ChatDirectorate, type Directorate, type Importance, type QuietMode } from '~server/models/directorate';
import type { Channel } from '~shared/domain';
import { PAGE, nowIso, placeholders } from './sql-utils';

interface DirectorateRow {
  id: number;
  name: string;
  quiet_chats: string;
  created_at: string;
}

interface ChatDirectorateRow {
  chat_id: number;
  directorate_id: number;
  access: string;
  importance: string;
}

const asQuiet = (v: string): QuietMode => ((QUIET_MODES as readonly string[]).includes(v) ? (v as QuietMode) : 'line');
const asImportance = (v: string): Importance => ((IMPORTANCE_LEVELS as readonly string[]).includes(v) ? (v as Importance) : 'normal');

const rowToDirectorate = (r: DirectorateRow): Directorate => ({ id: r.id, name: r.name, quietChats: asQuiet(r.quiet_chats), createdAt: r.created_at });
const rowToAccess = (r: ChatDirectorateRow): ChatDirectorate => ({
  chatId: r.chat_id,
  directorateId: r.directorate_id,
  access: r.access === 'owner' ? 'owner' : 'reader',
  importance: asImportance(r.importance),
});

const ACCESS_COLS = 'chat_id, directorate_id, access, importance';

/** Дирекции, их руководители, доступ к чатам, состав получателей и коды подключения чатов. */
export class DirectorateRepository {
  constructor(private readonly db: Db) {}

  /** Все строки запроса страницами по PAGE — списки читаются порциями для ограничения памяти. */
  private async all<T>(sql: string, params: unknown[]): Promise<T[]> {
    const out: T[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const rows = await this.db.query<T>(`${sql} LIMIT ${PAGE} OFFSET ?`, [...params, offset]);
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }

  // --- дирекции ---
  list(): Promise<Directorate[]> {
    return this.all<DirectorateRow>('SELECT * FROM directorates ORDER BY name', []).then((rows) => rows.map(rowToDirectorate));
  }

  async get(id: number): Promise<Directorate | null> {
    const r = await this.db.first<DirectorateRow>('SELECT * FROM directorates WHERE id = ?', [id]);
    return r ? rowToDirectorate(r) : null;
  }

  async getMany(ids: number[]): Promise<Directorate[]> {
    if (!ids.length) return [];
    const rows = await this.db.query<DirectorateRow>(`SELECT * FROM directorates WHERE id IN (${placeholders(ids.length)}) ORDER BY name`, ids);
    return rows.map(rowToDirectorate);
  }

  /** null — имя занято. */
  async create(name: string): Promise<number | null> {
    const r = await this.db.exec('INSERT INTO directorates (name, created_at) VALUES (?, ?) ON CONFLICT(name) DO NOTHING', [name, nowIso()]);
    if (!r.changes) return null;
    return (await this.db.first<{ id: number }>('SELECT id FROM directorates WHERE name = ?', [name]))?.id ?? null;
  }

  async rename(id: number, name: string): Promise<boolean> {
    const taken = await this.db.first<{ id: number }>('SELECT id FROM directorates WHERE name = ? AND id <> ?', [name, id]);
    if (taken) return false;
    await this.db.exec('UPDATE directorates SET name = ? WHERE id = ?', [name, id]);
    return true;
  }

  // --- руководители ---
  async directoratesOfAdmin(adminId: number): Promise<number[]> {
    const rows = await this.db.query<{ directorate_id: number }>('SELECT directorate_id FROM admin_directorates WHERE admin_id = ? LIMIT 100', [adminId]);
    return rows.map((r) => r.directorate_id);
  }

  async allAdminDirectorates(): Promise<Array<{ adminId: number; directorateId: number }>> {
    const rows = await this.all<{ admin_id: number; directorate_id: number }>('SELECT admin_id, directorate_id FROM admin_directorates ORDER BY admin_id', []);
    return rows.map((r) => ({ adminId: r.admin_id, directorateId: r.directorate_id }));
  }

  // AICODE-NOTE: транзакций нет — сначала добавляем новые, потом удаляем лишние.
  async setAdminDirectorates(adminId: number, ids: number[]): Promise<void> {
    for (const id of ids) {
      await this.db.exec('INSERT INTO admin_directorates (admin_id, directorate_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [adminId, id]);
    }
    if (ids.length) {
      await this.db.exec(`DELETE FROM admin_directorates WHERE admin_id = ? AND directorate_id NOT IN (${placeholders(ids.length)})`, [adminId, ...ids]);
    } else {
      await this.db.exec('DELETE FROM admin_directorates WHERE admin_id = ?', [adminId]);
    }
  }

  // --- доступ к чатам ---
  async chatAccessOfDirectorates(directorateIds: number[]): Promise<ChatDirectorate[]> {
    if (!directorateIds.length) return [];
    const rows = await this.all<ChatDirectorateRow>(
      `SELECT ${ACCESS_COLS} FROM chat_directorates WHERE directorate_id IN (${placeholders(directorateIds.length)}) ORDER BY chat_id`,
      directorateIds,
    );
    return rows.map(rowToAccess);
  }

  async chatAccessOfChat(chatId: number): Promise<ChatDirectorate[]> {
    const rows = await this.db.query<ChatDirectorateRow>(`SELECT ${ACCESS_COLS} FROM chat_directorates WHERE chat_id = ? LIMIT 100`, [chatId]);
    return rows.map(rowToAccess);
  }

  async allChatAccess(): Promise<ChatDirectorate[]> {
    const rows = await this.all<ChatDirectorateRow>(`SELECT ${ACCESS_COLS} FROM chat_directorates ORDER BY chat_id, directorate_id`, []);
    return rows.map(rowToAccess);
  }

  /** Владелец назначается только если у чата его нет. true — назначен. */
  async setOwnerIfNone(chatId: number, directorateId: number): Promise<boolean> {
    if (await this.db.first("SELECT chat_id FROM chat_directorates WHERE chat_id = ? AND access = 'owner'", [chatId])) return false;
    await this.db.exec('DELETE FROM chat_directorates WHERE chat_id = ? AND directorate_id = ?', [chatId, directorateId]);
    const r = await this.db.exec(
      "INSERT INTO chat_directorates (chat_id, directorate_id, access, created_at) VALUES (?, ?, 'owner', ?) ON CONFLICT DO NOTHING",
      [chatId, directorateId, nowIso()],
    );
    return r.changes > 0;
  }

  /** Назначение суперадмином: owner заменяет прежнего владельца, reader — доступ на чтение. */
  async setAccess(chatId: number, directorateId: number, access: ChatAccess): Promise<void> {
    if (access === 'owner') {
      await this.db.exec("DELETE FROM chat_directorates WHERE chat_id = ? AND access = 'owner' AND directorate_id <> ?", [chatId, directorateId]);
    }
    await this.db.exec(
      `INSERT INTO chat_directorates (chat_id, directorate_id, access, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(chat_id, directorate_id) DO UPDATE SET access = excluded.access`,
      [chatId, directorateId, access, nowIso()],
    );
  }

  /** false — у дирекции нет доступа к чату. */
  async setImportance(chatId: number, directorateId: number, importance: Importance): Promise<boolean> {
    const r = await this.db.exec('UPDATE chat_directorates SET importance = ? WHERE chat_id = ? AND directorate_id = ?', [importance, chatId, directorateId]);
    return r.changes > 0;
  }

  async setQuietChats(directorateId: number, mode: QuietMode): Promise<void> {
    await this.db.exec('UPDATE directorates SET quiet_chats = ? WHERE id = ?', [mode, directorateId]);
  }

  /** Важность чатов по всем дирекциям получателя и режимы тихих чатов этих дирекций. */
  async prefsOfRecipient(recipientId: number): Promise<{ access: Array<{ chatId: number; importance: Importance }>; quiet: QuietMode[] }> {
    const rows = await this.all<{ chat_id: number; importance: string }>(
      `SELECT cd.chat_id, cd.importance FROM chat_directorates cd JOIN recipient_directorates rd ON rd.directorate_id = cd.directorate_id
       WHERE rd.recipient_id = ? ORDER BY cd.chat_id`,
      [recipientId],
    );
    const dirs = await this.db.query<{ quiet_chats: string }>(
      'SELECT d.quiet_chats FROM directorates d JOIN recipient_directorates rd ON rd.directorate_id = d.id WHERE rd.recipient_id = ? LIMIT 100',
      [recipientId],
    );
    return { access: rows.map((r) => ({ chatId: r.chat_id, importance: asImportance(r.importance) })), quiet: dirs.map((d) => asQuiet(d.quiet_chats)) };
  }

  async removeAccess(chatId: number, directorateId: number): Promise<void> {
    await this.db.exec('DELETE FROM chat_directorates WHERE chat_id = ? AND directorate_id = ?', [chatId, directorateId]);
  }

  // --- получатели ---
  async recipientIdsOfDirectorates(directorateIds: number[]): Promise<number[]> {
    if (!directorateIds.length) return [];
    const rows = await this.all<{ recipient_id: number }>(
      `SELECT DISTINCT recipient_id FROM recipient_directorates WHERE directorate_id IN (${placeholders(directorateIds.length)}) ORDER BY recipient_id`,
      directorateIds,
    );
    return rows.map((r) => r.recipient_id);
  }

  async directoratesOfRecipient(recipientId: number): Promise<number[]> {
    const rows = await this.db.query<{ directorate_id: number }>('SELECT directorate_id FROM recipient_directorates WHERE recipient_id = ? LIMIT 100', [recipientId]);
    return rows.map((r) => r.directorate_id);
  }

  async allRecipientDirectorates(): Promise<Array<{ recipientId: number; directorateId: number }>> {
    const rows = await this.all<{ recipient_id: number; directorate_id: number }>(
      'SELECT recipient_id, directorate_id FROM recipient_directorates ORDER BY recipient_id',
      [],
    );
    return rows.map((r) => ({ recipientId: r.recipient_id, directorateId: r.directorate_id }));
  }

  async addRecipient(recipientId: number, directorateId: number): Promise<void> {
    await this.db.exec('INSERT INTO recipient_directorates (recipient_id, directorate_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [recipientId, directorateId]);
  }

  async removeRecipient(recipientId: number, directorateIds: number[]): Promise<void> {
    if (!directorateIds.length) return;
    await this.db.exec(`DELETE FROM recipient_directorates WHERE recipient_id = ? AND directorate_id IN (${placeholders(directorateIds.length)})`, [
      recipientId,
      ...directorateIds,
    ]);
  }

  /** Объединение получателей: членство from переносится на to. */
  async moveRecipient(fromId: number, toId: number): Promise<void> {
    await this.db.exec(
      'INSERT INTO recipient_directorates (recipient_id, directorate_id) SELECT ?, directorate_id FROM recipient_directorates WHERE recipient_id = ? ON CONFLICT DO NOTHING',
      [toId, fromId],
    );
    await this.db.exec('DELETE FROM recipient_directorates WHERE recipient_id = ?', [fromId]);
  }

  async deleteRecipientMemberships(recipientId: number): Promise<void> {
    await this.db.exec('DELETE FROM recipient_directorates WHERE recipient_id = ?', [recipientId]);
  }

  // --- коды подключения чата ---
  async insertClaimCode(c: { codeHash: string; directorateId: number; createdBy: string; expiresAt: string; channel: Channel }): Promise<void> {
    await this.db.exec(
      'INSERT INTO chat_claim_codes (code_hash, directorate_id, created_by, created_at, expires_at, channel) VALUES (?, ?, ?, ?, ?, ?)',
      [c.codeHash, c.directorateId, c.createdBy, nowIso(), c.expiresAt, c.channel],
    );
  }

  async findClaimCode(codeHash: string): Promise<ChatClaimCode | null> {
    const r = await this.db.first<{
      code_hash: string;
      directorate_id: number;
      created_by: string;
      created_at: string;
      expires_at: string;
      used_at: string | null;
      chat_id: number | null;
      channel: string;
    }>('SELECT * FROM chat_claim_codes WHERE code_hash = ?', [codeHash]);
    return r
      ? {
          codeHash: r.code_hash,
          directorateId: r.directorate_id,
          createdBy: r.created_by,
          createdAt: r.created_at,
          expiresAt: r.expires_at,
          usedAt: r.used_at,
          chatId: r.chat_id,
          channel: r.channel as Channel,
        }
      : null;
  }

  /** Гасит код атомарно; false — уже использован. */
  async useClaimCode(codeHash: string, chatId: number): Promise<boolean> {
    const r = await this.db.exec('UPDATE chat_claim_codes SET used_at = ?, chat_id = ? WHERE code_hash = ? AND used_at IS NULL', [nowIso(), chatId, codeHash]);
    return r.changes > 0;
  }

  async deleteExpiredClaimCodes(beforeIso: string): Promise<void> {
    await this.db.exec('DELETE FROM chat_claim_codes WHERE expires_at < ?', [beforeIso]);
  }
}
