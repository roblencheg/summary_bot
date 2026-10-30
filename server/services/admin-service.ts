import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { AdminRepository } from '~server/repositories/admin-repository';
import type { Admin, AdminRole } from '~server/models/admin';
import type { AuditService } from './audit-service';
import { AuthError, ConflictError, NotFoundError, ValidationError } from './errors';
import { TECH } from './settings-defaults';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, saltB64, keyB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(pw, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export class AdminService {
  constructor(
    private readonly repo: AdminRepository,
    private readonly audit: AuditService,
  ) {}

  /** Первый администратор из секретов — только если администраторов ещё нет. */
  async bootstrap(login: string | undefined, password: string | undefined): Promise<'created' | 'exists' | 'no_secrets'> {
    if ((await this.repo.count()) > 0) return 'exists';
    if (!login || !password) return 'no_secrets';
    if (!/^[\w.@-]{3,64}$/.test(login.trim())) throw new ValidationError('ADMIN_INITIAL_LOGIN: 3–64 characters');
    if (password.length < 10) throw new ValidationError('ADMIN_INITIAL_PASSWORD: minimum 10 characters');
    const created = await this.repo.create(login.trim(), await hashPassword(password), 'superadmin');
    if (created) await this.audit.record('system', 'admin.bootstrap', 'admin', login.trim(), null, { login: login.trim() });
    return 'created';
  }

  async hasAdmins(): Promise<boolean> {
    return (await this.repo.count()) > 0;
  }

  async login(login: string, password: string): Promise<{ token: string; admin: Admin; expiresAt: string }> {
    const now = Date.now();
    const attempts = await this.repo.getAttempts(login);
    if (attempts?.lockedUntil && new Date(attempts.lockedUntil).getTime() > now) {
      throw new AuthError('Слишком много попыток. Повторите позже');
    }
    const admin = await this.repo.findByLogin(login);
    const ok = admin && !admin.disabled && (await verifyPassword(password, admin.passwordHash));
    if (!ok || !admin) {
      const failures = (attempts?.failures ?? 0) + 1;
      const lock = failures >= TECH.loginMaxFailures ? new Date(now + TECH.loginLockMin * 60_000).toISOString() : null;
      await this.repo.setAttempts(login, lock ? 0 : failures, lock);
      if (lock) await this.audit.record('system', 'admin.login.locked', 'admin', login, null, { lockedUntil: lock });
      throw new AuthError('Неверный логин или пароль');
    }
    await this.repo.setAttempts(login, 0, null);
    await this.repo.touchLogin(admin.id);
    await this.repo.deleteExpiredSessions();
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now + TECH.sessionTtlHours * 3600_000).toISOString();
    await this.repo.createSession({ tokenHash: sha256(token), adminId: admin.id, createdAt: new Date(now).toISOString(), expiresAt });
    return { token, admin, expiresAt };
  }

  /** Проверка сессии со скользящим продлением (не чаще раза в 5 минут). */
  async authenticate(token: string): Promise<Admin> {
    const hash = sha256(token);
    const session = await this.repo.findSession(hash);
    if (!session) throw new AuthError();
    const expires = new Date(session.expiresAt).getTime();
    if (expires < Date.now()) {
      await this.repo.deleteSession(hash);
      throw new AuthError('Сессия истекла');
    }
    const admin = await this.repo.findById(session.adminId);
    if (!admin || admin.disabled) throw new AuthError();
    const fresh = Date.now() + TECH.sessionTtlHours * 3600_000;
    if (fresh - expires > 5 * 60_000) await this.repo.extendSession(hash, new Date(fresh).toISOString());
    return admin;
  }

  async logout(token: string): Promise<void> {
    await this.repo.deleteSession(sha256(token));
  }

  list(): Promise<Admin[]> {
    return this.repo.list();
  }

  /** Возвращает id новой учётной записи. */
  async create(login: string, password: string, actor: string, role: AdminRole = 'superadmin'): Promise<number> {
    const l = login.trim();
    if (!/^[\w.@-]{3,64}$/.test(l)) throw new ValidationError('Логин: 3–64 символа, буквы, цифры, . _ @ -');
    if (password.length < 10) throw new ValidationError('Пароль — не короче 10 символов');
    if (!(await this.repo.create(l, await hashPassword(password), role))) throw new ConflictError('Такой логин уже есть');
    await this.audit.record(actor, 'admin.create', 'admin', l, null, { login: l, role });
    return (await this.repo.findByLogin(l))!.id;
  }

  async changePassword(id: number, password: string, actor: string): Promise<void> {
    if (password.length < 10) throw new ValidationError('Пароль — не короче 10 символов');
    const admin = await this.repo.findById(id);
    if (!admin) throw new NotFoundError();
    await this.repo.setPassword(id, await hashPassword(password));
    await this.repo.deleteSessionsOf(id);
    await this.audit.record(actor, 'admin.password', 'admin', admin.login, null, { changed: true });
  }

  async setDisabled(id: number, disabled: boolean, actor: Admin): Promise<void> {
    const admin = await this.repo.findById(id);
    if (!admin) throw new NotFoundError();
    if (admin.id === actor.id && disabled) throw new ValidationError('Нельзя отключить самого себя');
    await this.repo.setDisabled(id, disabled);
    if (disabled) await this.repo.deleteSessionsOf(id);
    await this.audit.record(actor.login, disabled ? 'admin.disable' : 'admin.enable', 'admin', admin.login, { disabled: admin.disabled }, { disabled });
  }
}
