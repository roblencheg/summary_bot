import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  BindingCodeSchema,
  ChannelInputSchema,
  CreateRecipientInputSchema,
  DirectorateIdsInputSchema,
  OkSchema,
  RecipientEnabledInputSchema,
  RecipientSchema,
  RecipientsResponseSchema,
  SendMenuResponseSchema,
  SubscriptionsInputSchema,
  UpdateRecipientInputSchema,
} from '~shared/schemas';
import type { Container } from '~server/container';
import type { RecipientWithSubscriptions } from '~server/models/recipient';
import type { Scope } from '~server/models/directorate';
import { actor, idParam, parse, scope } from './http';

export async function registerRecipientRoutes(app: FastifyInstance, c: Container): Promise<void> {
  /** Руководителю — только подписки на видимые ему чаты и только его дирекции. */
  const view = (s: Scope, r: RecipientWithSubscriptions) =>
    s.kind === 'super'
      ? r
      : {
          ...r,
          summaryChatIds: r.summaryChatIds.filter((id) => s.chatIds.has(id)),
          alertChatIds: r.alertChatIds.filter((id) => s.chatIds.has(id)),
          directorateIds: r.directorateIds.filter((id) => s.directorateIds.includes(id)),
        };

  /** id получателя из пути с проверкой, что он виден пользователю. */
  const visibleId = (req: FastifyRequest) => {
    const id = idParam(req);
    c.access.assertRecipient(scope(req), id);
    return id;
  };

  const one = async (req: FastifyRequest, id: number) => RecipientSchema.parse(view(scope(req), await c.recipients.get(id)));

  app.get('/api/recipients', async (req) => {
    const s = scope(req);
    return RecipientsResponseSchema.parse((await c.recipients.list()).filter((r) => c.access.canSeeRecipient(s, r.id)).map((r) => view(s, r)));
  });

  app.post('/api/recipients', async (req, reply) => {
    const input = parse(CreateRecipientInputSchema, req.body);
    const s = scope(req);
    const directorateId = await c.access.targetDirectorate(s, input.directorateId);
    // технические уведомления о сбоях системы назначает только суперадмин
    const created = await c.recipients.create({ ...input, isTechAdmin: s.kind === 'super' && input.isTechAdmin }, directorateId, actor(req));
    reply.status(201);
    return RecipientSchema.parse(view(scope(req), created));
  });

  // меню бота: всем активным — до маршрута с :id; рассылка по всей системе — только суперадмин
  app.post('/api/recipients/menu', async (req) => {
    c.access.requireSuper(scope(req));
    const input = parse(ChannelInputSchema, req.body);
    return SendMenuResponseSchema.parse({ queued: await c.onDemand.sendMenuToAll(actor(req), input.channel) });
  });

  app.post('/api/recipients/:id/menu', async (req) => {
    const input = parse(ChannelInputSchema, req.body);
    await c.onDemand.sendMenu(visibleId(req), actor(req), input.channel);
    return SendMenuResponseSchema.parse({ queued: 1 });
  });

  app.get('/api/recipients/:id', async (req) => one(req, visibleId(req)));

  app.patch('/api/recipients/:id', async (req) => {
    const id = visibleId(req);
    const input = parse(UpdateRecipientInputSchema, req.body);
    if (scope(req).kind !== 'super') delete input.isTechAdmin;
    await c.recipients.update(id, input, actor(req));
    return one(req, id);
  });

  app.post('/api/recipients/:id/enabled', async (req) => {
    const id = visibleId(req);
    const input = parse(RecipientEnabledInputSchema, req.body);
    await c.recipients.setEnabled(id, input.enabled, actor(req));
    return one(req, id);
  });

  app.post('/api/recipients/:id/code', async (req) => {
    const input = parse(ChannelInputSchema, req.body);
    return BindingCodeSchema.parse(await c.recipients.issueCode(visibleId(req), input.channel, actor(req)));
  });

  app.post('/api/recipients/:id/reset-binding', async (req) => {
    const id = visibleId(req);
    const input = parse(ChannelInputSchema, req.body);
    await c.recipients.resetBinding(id, input.channel, actor(req));
    return one(req, id);
  });

  app.delete('/api/recipients/:id', async (req) => {
    await c.recipients.remove(visibleId(req), actor(req), scope(req));
    return OkSchema.parse({ ok: true });
  });

  // состав дирекций получателя — только суперадмин
  app.put('/api/recipients/:id/directorates', async (req) => {
    c.access.requireSuper(scope(req));
    const id = idParam(req);
    const input = parse(DirectorateIdsInputSchema, req.body);
    await c.recipients.get(id);
    await c.directorates.setRecipientDirectorates(id, input.directorateIds, actor(req));
    return one(req, id);
  });

  for (const kind of ['summary', 'alert'] as const) {
    app.put(`/api/recipients/:id/subscriptions/${kind}`, async (req) => {
      const id = visibleId(req);
      const input = parse(SubscriptionsInputSchema, req.body);
      await c.subscriptions.replace(kind, id, input.chatIds, actor(req), c.access.chatFilter(scope(req)));
      return one(req, id);
    });
  }
}
