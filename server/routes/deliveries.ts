import type { FastifyInstance } from 'fastify';
import { DeliveryDetailsSchema, DeliveryJobSchema, DeliveryListSchema, DeliveryQuerySchema, OkSchema, TestDeliveryInputSchema } from '~shared/schemas';
import type { Container } from '~server/container';
import { actor, idParam, parse, scope } from './http';

/** Журнал отправок — раздел суперадмина; руководителю — только последние отправки своего получателя и тест. */
export async function registerDeliveryRoutes(app: FastifyInstance, c: Container): Promise<void> {
  app.get('/api/deliveries', async (req) => {
    const q = parse(DeliveryQuerySchema, req.query);
    const s = scope(req);
    if (s.kind !== 'super') {
      if (!q.recipientId) c.access.requireSuper(s);
      else c.access.assertRecipient(s, q.recipientId);
    }
    return DeliveryListSchema.parse(await c.deliveries.list(q));
  });

  app.get('/api/deliveries/:id', async (req) => {
    const d = await c.deliveries.details(idParam(req));
    c.access.assertRecipient(scope(req), d.job.recipientId);
    return DeliveryDetailsSchema.parse(d);
  });

  app.post('/api/deliveries/:id/retry', async (req) => {
    c.access.requireSuper(scope(req));
    return DeliveryJobSchema.parse(await c.deliveries.retry(idParam(req), actor(req)));
  });

  app.post('/api/deliveries/test', async (req) => {
    const input = parse(TestDeliveryInputSchema, req.body);
    c.access.assertRecipient(scope(req), input.recipientId);
    await c.deliveries.sendTest(input.recipientId, input.channel, actor(req));
    return OkSchema.parse({ ok: true });
  });
}
