/** Self-hosted adapters. Repositories use the same asynchronous contract as upstream. */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { mkdir, readFile, writeFile, rename, unlink, readdir, stat } from 'node:fs/promises';
import { resolve, dirname, relative, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from './config';

export interface PlatformOptions { dataDir?: string }
export class PlatformError extends Error {
  constructor(message: string, public readonly status: number, public readonly endpoint: string, public readonly body?: unknown) {
    super(message); this.name = 'PlatformError';
  }
}
export interface DbExecResult { changes: number; lastInsertRowid?: number }
export class Db {
  private readonly database: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(path);
    this.database.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    // AICODE-NOTE: legacy exports restore dependent rows before their parents.
    // Match upstream SQLite's disabled FK enforcement; services maintain relationships.
    this.database.exec('PRAGMA foreign_keys=OFF;');
  }
  async query<Row = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<Row[]> {
    return this.database.prepare(sql).all(...params as SQLInputValue[]) as Row[];
  }
  async first<Row = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<Row | null> {
    return (await this.query<Row>(sql, params))[0] ?? null;
  }
  async exec(sql: string, params: unknown[] = []): Promise<DbExecResult> {
    const r = this.database.prepare(sql).run(...params as SQLInputValue[]);
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }
  async tables(): Promise<string[]> {
    return (await this.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")).map(r => r.name);
  }
  close(): void { this.database.close(); }
}
export interface StorageObject { key: string; size: number; lastModified?: number; etag?: string; contentType?: string }
export interface ListResult { objects: StorageObject[]; prefixes: string[]; truncated: boolean; continuationToken?: string }
export class Storage {
  private readonly root: string;
  constructor(path: string) { this.root = resolve(path); mkdirSync(this.root, { recursive: true, mode: 0o700 }); }
  private path(key: string): string {
    const path = resolve(this.root, key);
    if (!key || key.includes('\\') || key.split('/').includes('..') || !path.startsWith(this.root + sep)) throw new PlatformError('Invalid storage key', 400, key);
    return path;
  }
  async head(key: string): Promise<StorageObject> {
    try {
      const info = await stat(this.path(key));
      return { key, size: info.size, lastModified: info.mtimeMs, contentType: key.endsWith('.mp4') ? 'video/mp4' : key.endsWith('.gz') ? 'application/gzip' : 'application/octet-stream' };
    } catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new PlatformError('Object not found', 404, key); throw err; }
  }
  async upload(key: string, body: Blob | Buffer, _contentType?: string): Promise<StorageObject> {
    const target = this.path(key);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, body instanceof Blob ? Buffer.from(await body.arrayBuffer()) : body, { mode: 0o600 });
      await rename(temporary, target);
    } finally { await unlink(temporary).catch(() => {}); }
    return this.head(key);
  }
  async download(key: string): Promise<Response> {
    const info = await this.head(key);
    return new Response(new Uint8Array(await readFile(this.path(key))), { headers: { 'Content-Type': info.contentType! } });
  }
  async delete(key: string): Promise<void> {
    try { await unlink(this.path(key)); } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
  }
  async list(opts: { prefix?: string; delimiter?: string; continuationToken?: string; maxKeys?: number } = {}): Promise<ListResult> {
    const keys: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const child = resolve(dir, e.name);
        if (e.isDirectory()) await walk(child);
        else if (e.isFile() && !e.name.endsWith('.tmp')) keys.push(relative(this.root, child).split(sep).join('/'));
      }
    };
    await walk(this.root);
    const prefix = opts.prefix ?? '';
    const prefixes = new Set<string>();
    const entries: { key: string; prefix: boolean }[] = [];
    for (const key of keys.sort().filter(k => k.startsWith(prefix))) {
      const index = opts.delimiter ? key.indexOf(opts.delimiter, prefix.length) : -1;
      if (index >= 0) prefixes.add(key.slice(0, index + opts.delimiter!.length));
      else entries.push({ key, prefix: false });
    }
    entries.push(...[...prefixes].map(key => ({ key, prefix: true })));
    entries.sort((a, b) => a.key.localeCompare(b.key));
    const remaining = opts.continuationToken ? entries.filter(e => e.key.localeCompare(opts.continuationToken!) > 0) : entries;
    const page = remaining.slice(0, Math.max(1, Math.min(opts.maxKeys ?? 1000, 1000)));
    const truncated = remaining.length > page.length;
    return { objects: await Promise.all(page.filter(e => !e.prefix).map(e => this.head(e.key))), prefixes: page.filter(e => e.prefix).map(e => e.key), truncated, continuationToken: truncated ? page.at(-1)!.key : undefined };
  }
  async usage(): Promise<{ totalBytes: number; objectCount: number; limitBytes: number }> {
    let totalBytes = 0, objectCount = 0, continuationToken: string | undefined;
    do { const page = await this.list({ continuationToken }); for (const o of page.objects) { totalBytes += o.size; objectCount++; } continuationToken = page.continuationToken; } while (continuationToken);
    return { totalBytes, objectCount, limitBytes: 0 };
  }
}
export function openaiConfig(): { baseURL: string; apiKey: string } {
  if (!env.OPENAI_BASE_URL || !env.OPENAI_API_KEY) throw new Error('Set OPENAI_BASE_URL and OPENAI_API_KEY in server environment');
  return { baseURL: env.OPENAI_BASE_URL, apiKey: env.OPENAI_API_KEY };
}
export function geminiConfig(): { baseURL: string; apiKey: string } {
  if (!env.GEMINI_BASE_URL || !env.GEMINI_API_KEY) throw new Error('Set GEMINI_BASE_URL and GEMINI_API_KEY');
  return { baseURL: `${env.GEMINI_BASE_URL}/openai/v1`, apiKey: env.GEMINI_API_KEY };
}
export interface Platform { db: Db; storage: Storage; readonly configured: boolean; close(): void }
export function createPlatform(opts: PlatformOptions = {}): Platform {
  const root = resolve(opts.dataDir ?? env.DATA_DIR);
  const db = new Db(resolve(root, 'summary.sqlite'));
  return { configured: true, db, storage: new Storage(resolve(root, 'storage')), close: () => db.close() };
}
