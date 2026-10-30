import type { FastifyInstance } from 'fastify';
import {
  AdminDisabledInputSchema,
  AdminPasswordInputSchema,
  AdminsResponseSchema,
  AuthStatusSchema,
  CreateAdminInputSchema,
  LoginInputSchema,
  LoginResponseSchema,
  MeSchema,
  OkSchema,
} from '~shared/schemas';
import type { Container } from '~server/container';
import { isProd, publicBaseUrl } from '~server/config';
import { AuthError } from '~server/services/errors';
import type { Admin } from '~server/models/admin';
import { actor, idParam, parse, scope } from './http';

export const SESSION_COOKIE = 'sid';

const PUBLIC_PATHS = new Set(['/api/auth/login', '/api/auth/status', '/api/health', '/api/ready', '/api/telegram/webhook', '/api/max/webhook']);

/**
 * Сессия администратора обязательна для всех /api/*, кроме входа, health/ready и webhook.
 * Изменяющие запросы дополнительно проверяют Origin (CSRF) в prod.
 */
export async function registerAuthGuard(app: FastifyInstance, c: Container): Promise<void> {
  app.addHook('preHandler', async (req, reply) => {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/')) return;
    if (isProd && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && path !== '/api/telegram/webhook' && path !== '/api/max/webhook') {
      const origin = req.headers.origin;
      if (origin && origin !== publicBaseUrl) return reply.status(403).send({ error: 'Запрос с чужого источника отклонён' });
    }
    if (PUBLIC_PATHS.has(path)) return;
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return reply.status(401).send({ error: 'Требуется вход' });
    try {
      req.admin = await c.admins.authenticate(token);
      req.scope = await c.access.scopeFor(req.admin);
    } catch (err) {
      if (err instanceof AuthError) return reply.status(401).send({ error: err.message });
      throw err;
    }
  });
}

function cookieOptions(expires?: Date) {
  // AICODE-NOTE: cookie привязана к origin приложения; Secure включается при HTTPS.
  // В prod — строгий режим на собственном домене.
  return {
    path: '/',
    httpOnly: true,
    secure: publicBaseUrl.startsWith('https://'),
    sameSite: 'strict' as const,
    expires,
  };
}

export async function registerAuthRoutes(app: FastifyInstance, c: Container): Promise<void> {
  const me = async (admin: Admin) => {
    const s = await c.access.scopeFor(admin);
    const directorates = s.kind === 'manager' ? await c.directorates.directoratesOf(s.directorateIds) : [];
    return MeSchema.parse({ id: admin.id, login: admin.login, role: admin.role, directorates: directorates.map((d) => ({ id: d.id, name: d.name, quietChats: d.quietChats })) });
  };

  app.get('/api/auth/status', async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    let admin = null;
    if (token) {
      try {
        admin = await c.admins.authenticate(token);
      } catch {
        admin = null;
      }
    }
    return AuthStatusSchema.parse({
      authenticated: Boolean(admin),
      admin: admin ? await me(admin) : null,
      bootstrapNeeded: !(await c.admins.hasAdmins()),
    });
  });

  app.post('/api/auth/login', async (req, reply) => {
    const input = parse(LoginInputSchema, req.body);
    const { token, admin, expiresAt } = await c.admins.login(input.login, input.password);
    reply.setCookie(SESSION_COOKIE, token, cookieOptions(new Date(expiresAt)));
    // admin.lastLoginAt тут — значение ДО этого входа (login() читает его перед touchLogin), поэтому null означает первый вход.
    return LoginResponseSchema.parse({ ...(await me(admin)), firstLogin: admin.lastLoginAt === null });
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await c.admins.logout(token);
    reply.clearCookie(SESSION_COOKIE, cookieOptions());
    return OkSchema.parse({ ok: true });
  });

  app.get('/api/auth/me', async (req) => me(req.admin!));

  // учётные записи — только суперадмин (руководителей он создаёт в «Дирекциях»)
  app.get('/api/admins', async (req) => {
    c.access.requireSuper(scope(req));
    return AdminsResponseSchema.parse(await c.admins.list());
  });

  app.post('/api/admins', async (req, reply) => {
    c.access.requireSuper(scope(req));
    const input = parse(CreateAdminInputSchema, req.body);
    await c.admins.create(input.login, input.password, actor(req));
    reply.status(201);
    return OkSchema.parse({ ok: true });
  });

  app.post('/api/admins/:id/password', async (req) => {
    c.access.requireSuper(scope(req));
    const input = parse(AdminPasswordInputSchema, req.body);
    await c.admins.changePassword(idParam(req), input.password, actor(req));
    return OkSchema.parse({ ok: true });
  });

  app.post('/api/admins/:id/disabled', async (req) => {
    c.access.requireSuper(scope(req));
    const input = parse(AdminDisabledInputSchema, req.body);
    await c.admins.setDisabled(idParam(req), input.disabled, req.admin!);
    return OkSchema.parse({ ok: true });
  });
}
