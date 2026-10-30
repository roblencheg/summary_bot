import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError, type ZodType } from 'zod';
import type { Admin } from '~server/models/admin';
import { AuthError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '~server/services/errors';
import type { Scope } from '~server/models/directorate';

declare module 'fastify' {
  interface FastifyRequest {
    admin?: Admin;
    scope?: Scope;
  }
}

/** Разбор входа по zod-схеме; ошибка → 400 через общий обработчик. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  return schema.parse(data);
}

export function idParam(req: FastifyRequest): number {
  const id = Number((req.params as { id?: string }).id);
  if (!Number.isSafeInteger(id)) throw new ValidationError('Некорректный идентификатор');
  return id;
}

/** Права запроса — ставит auth guard после проверки сессии. */
export function scope(req: FastifyRequest): Scope {
  if (!req.scope) throw new AuthError();
  return req.scope;
}

export function actor(req: FastifyRequest): string {
  if (!req.admin) throw new AuthError();
  return req.admin.login;
}

/** Маппинг доменных ошибок в HTTP-статусы — один на всё приложение. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply: FastifyReply) => {
    if (err instanceof ZodError) return reply.status(400).send({ error: 'Некорректные данные', details: err.issues });
    if (err instanceof ValidationError) return reply.status(422).send({ error: err.message });
    if (err instanceof NotFoundError) return reply.status(404).send({ error: err.message });
    if (err instanceof AuthError) return reply.status(401).send({ error: err.message });
    if (err instanceof ForbiddenError) return reply.status(403).send({ error: err.message });
    if (err instanceof ConflictError) return reply.status(409).send({ error: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.message });
    console.error('[http]', err);
    return reply.status(500).send({ error: 'Внутренняя ошибка сервера' });
  });
}
