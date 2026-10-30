import type { Db, Storage } from '~server/platform';

/**
 * Экспорт таблиц в managed S3. Прямого доступа к файлу БД нет — выгружаем постранично
 * (≤100 строк за запрос) по rowid.
 */
export class BackupRepository {
  constructor(
    private readonly db: Db,
    private readonly storage: Storage,
  ) {}

  async tables(): Promise<string[]> {
    const all = await this.db.tables();
    return all.filter((t) => !t.startsWith('_') && !t.startsWith('sqlite_'));
  }

  async *rows(table: string): AsyncGenerator<Record<string, unknown>[]> {
    let last = -Infinity;
    for (;;) {
      const page = await this.db.query<Record<string, unknown> & { __rowid: number }>(
        `SELECT rowid AS __rowid, * FROM "${table.replace(/"/g, '')}" WHERE rowid > ? ORDER BY rowid LIMIT 100`,
        [Number.isFinite(last) ? last : -1],
      );
      if (!page.length) return;
      last = page[page.length - 1].__rowid;
      yield page.map(({ __rowid, ...rest }) => rest);
      if (page.length < 100) return;
    }
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.storage.upload(key, body, contentType);
  }

  async download(key: string): Promise<Buffer> {
    const res = await this.storage.download(key);
    return Buffer.from(await res.arrayBuffer());
  }

  async listPrefixes(prefix: string): Promise<string[]> {
    const out: string[] = [];
    let token: string | undefined;
    do {
      const r = await this.storage.list({ prefix, delimiter: '/', continuationToken: token, maxKeys: 1000 });
      out.push(...r.prefixes);
      token = r.truncated ? r.continuationToken : undefined;
    } while (token);
    return out.sort();
  }

  async listKeys(prefix: string): Promise<string[]> {
    const out: string[] = [];
    let token: string | undefined;
    do {
      const r = await this.storage.list({ prefix, continuationToken: token, maxKeys: 1000 });
      out.push(...r.objects.map((o) => o.key));
      token = r.truncated ? r.continuationToken : undefined;
    } while (token);
    return out;
  }

  async deleteKey(key: string): Promise<void> {
    await this.storage.delete(key);
  }

  async insertRows(table: string, rows: Record<string, unknown>[]): Promise<void> {
    if (!rows.length) return;
    const cols = Object.keys(rows[0]);
    const safe = (s: string) => `"${s.replace(/"/g, '')}"`;
    for (let i = 0; i < rows.length; i += 20) {
      const chunk = rows.slice(i, i + 20);
      await this.db.exec(
        `INSERT INTO ${safe(table)} (${cols.map(safe).join(', ')}) VALUES ${chunk
          .map(() => `(${cols.map(() => '?').join(', ')})`)
          .join(', ')} ON CONFLICT DO NOTHING`,
        chunk.flatMap((r) => cols.map((c) => r[c] ?? null)),
      );
    }
  }
}
