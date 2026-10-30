import type { FastifyInstance } from 'fastify';
import {
  ChatAccessInputSchema,
  CreateManagerInputSchema,
  DirectorateIdsInputSchema,
  DirectorateNameInputSchema,
  DirectoratesOverviewSchema,
  OkSchema,
  QuietChatsInputSchema,
} from '~shared/schemas';
import type { Container } from '~server/container';
import { actor, idParam, parse, scope } from './http';

/** Раздел «Дирекции» — только суперадмин. Пароль и отключение руководителя — общие /api/admins/:id/*. */
export async function registerDirectorateRoutes(app: FastifyInstance, c: Container): Promise<void> {
  app.addHook('preHandler', async (req) => {
    const path = req.url.split('?')[0];
    if (path.startsWith('/api/directorates') || /^\/api\/chats\/[^/]+\/access$/.test(path)) c.access.requireSuper(scope(req));
  });

  app.get('/api/directorates', async () => DirectoratesOverviewSchema.parse(await c.directorates.overview()));

  app.post('/api/directorates', async (req, reply) => {
    const input = parse(DirectorateNameInputSchema, req.body);
    await c.directorates.create(input.name, actor(req));
    reply.status(201);
    return OkSchema.parse({ ok: true });
  });

  app.patch('/api/directorates/:id', async (req) => {
    const input = parse(DirectorateNameInputSchema, req.body);
    await c.directorates.rename(idParam(req), input.name, actor(req));
    return OkSchema.parse({ ok: true });
  });

  app.post('/api/directorates/managers', async (req, reply) => {
    const input = parse(CreateManagerInputSchema, req.body);
    await c.directorates.createManager(input.login, input.password, input.directorateIds, actor(req));
    reply.status(201);
    return OkSchema.parse({ ok: true });
  });

  app.put('/api/directorates/managers/:id', async (req) => {
    const input = parse(DirectorateIdsInputSchema, req.body);
    await c.directorates.setManagerDirectorates(idParam(req), input.directorateIds, actor(req));
    return OkSchema.parse({ ok: true });
  });

  // режим чатов без событий в саммари: руководитель своей дирекции или суперадмин (вне хука «только суперадмин»)
  app.put('/api/directorate-settings/:id', async (req) => {
    const input = parse(QuietChatsInputSchema, req.body);
    await c.directorates.setQuietChats(scope(req), idParam(req), input.quietChats);
    return OkSchema.parse({ ok: true });
  });

  app.put('/api/chats/:id/access', async (req) => {
    const input = parse(ChatAccessInputSchema, req.body);
    await c.directorates.setChatAccess(idParam(req), input.directorateId, input.access, actor(req));
    return OkSchema.parse({ ok: true });
  });
}
