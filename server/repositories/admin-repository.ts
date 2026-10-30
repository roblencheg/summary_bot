import type { Db } from '~server/platform';
import type { Admin, AdminRole, AdminSession } from '~server/models/admin';
import { nowIso } from './sql-utils';

interface AdminRow {
  id: number;
  login: string;
  role: string;
  password_hash: string;
  disabled: number;
  created_at: string;
  last_login_at: string | null;
}

const rowToAdmin = (r: AdminRow): Admin => ({
  id: r.id,
  login: r.login,
  role: r.role === 'manager' ? 'manager' : 'superadmin',
  passwordHash: r.password_hash,
  disabled: r.disabled === 1,
  createdAt: r.created_at,
  lastLoginAt: r.last_login_at,
});

export class AdminRepository {
  constructor(private readonly db: Db) {}

  async count(): Promise<number> {
    const r = await this.db.first<{ n: number }>('SELECT COUNT(*) AS n FROM admins');
    return r?.n ?? 0;
  }

  async findByLogin(login: string): Promise<Admin | null> {
    const r = await this.db.first<AdminRow>('SELECT * FROM admins WHERE login = ?', [login]);
    return r ? rowToAdmin(r) : null;
  }

  async findById(id: number): Promise<Admin | null> {
    const r = await this.db.first<AdminRow>('SELECT * FROM admins WHERE id = ?', [id]);
    return r ? rowToAdmin(r) : null;
  }

  async list(): Promise<Admin[]> {
    const rows = await this.db.query<AdminRow>('SELECT * FROM admins ORDER BY id LIMIT 100');
    return rows.map(rowToAdmin);
  }

  /** Возвращает true, если запись создана (логин был свободен). */
  async create(login: string, passwordHash: string, role: AdminRole = 'superadmin'): Promise<boolean> {
    const r = await this.db.exec(
      'INSERT INTO admins (login, password_hash, role, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(login) DO NOTHING',
      [login, passwordHash, role, nowIso()],
    );
    return r.changes > 0;
  }

  async setPassword(id: number, passwordHash: string): Promise<void> {
    await this.db.exec('UPDATE admins SET password_hash = ? WHERE id = ?', [passwordHash, id]);
  }

  async setDisabled(id: number, disabled: boolean): Promise<void> {
    await this.db.exec('UPDATE admins SET disabled = ? WHERE id = ?', [disabled ? 1 : 0, id]);
  }

  async touchLogin(id: number): Promise<void> {
    await this.db.exec('UPDATE admins SET last_login_at = ? WHERE id = ?', [nowIso(), id]);
  }

  // --- сессии ---
  async createSession(s: AdminSession): Promise<void> {
    await this.db.exec(
      'INSERT INTO admin_sessions (token_hash, admin_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      [s.tokenHash, s.adminId, s.createdAt, s.expiresAt],
    );
  }

  async findSession(tokenHash: string): Promise<AdminSession | null> {
    const r = await this.db.first<{ token_hash: string; admin_id: number; created_at: string; expires_at: string }>(
      'SELECT * FROM admin_sessions WHERE token_hash = ?',
      [tokenHash],
    );
    return r ? { tokenHash: r.token_hash, adminId: r.admin_id, createdAt: r.created_at, expiresAt: r.expires_at } : null;
  }

  async extendSession(tokenHash: string, expiresAt: string): Promise<void> {
    await this.db.exec('UPDATE admin_sessions SET expires_at = ? WHERE token_hash = ?', [expiresAt, tokenHash]);
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.db.exec('DELETE FROM admin_sessions WHERE token_hash = ?', [tokenHash]);
  }

  async deleteSessionsOf(adminId: number): Promise<void> {
    await this.db.exec('DELETE FROM admin_sessions WHERE admin_id = ?', [adminId]);
  }

  async deleteExpiredSessions(): Promise<void> {
    await this.db.exec('DELETE FROM admin_sessions WHERE expires_at < ?', [nowIso()]);
  }

  // --- защита от подбора ---
  async getAttempts(login: string): Promise<{ failures: number; lockedUntil: string | null } | null> {
    const r = await this.db.first<{ failures: number; locked_until: string | null }>(
      'SELECT failures, locked_until FROM login_attempts WHERE login = ?',
      [login],
    );
    return r ? { failures: r.failures, lockedUntil: r.locked_until } : null;
  }

  async setAttempts(login: string, failures: number, lockedUntil: string | null): Promise<void> {
    await this.db.exec(
      `INSERT INTO login_attempts (login, failures, locked_until, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(login) DO UPDATE SET failures = excluded.failures, locked_until = excluded.locked_until, updated_at = excluded.updated_at`,
      [login, failures, lockedUntil, nowIso()],
    );
  }
}
