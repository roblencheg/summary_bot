import type { FastifyInstance, FastifyRequest } from 'fastify';
import { IncidentDetailsSchema, IncidentListSchema, IncidentQuerySchema, IncidentSchema, IncidentStatusInputSchema } from '~shared/schemas';
import type { Container } from '~server/container';
import { actor, idParam, parse, scope } from './http';

export async function registerIncidentRoutes(app: FastifyInstance, c: Container): Promise<void> {
  /** Инцидент виден, если виден его чат. */
  const visibleIncident = async (req: FastifyRequest) => {
    const id = idParam(req);
    const d = await c.incidents.details(id);
    c.access.assertChat(scope(req), d.incident.chatId);
    return d;
  };

  app.get('/api/incidents', async (req) => {
    const q = parse(IncidentQuerySchema, req.query);
    const res = await c.incidents.list({
      ...q,
      chatIds: c.access.chatFilter(scope(req)),
      borderline: q.borderline === undefined ? undefined : q.borderline === 'true',
    });
    return IncidentListSchema.parse({ ...res, topics: await c.incidents.topics() });
  });

  app.get('/api/incidents/:id', async (req) => {
    const d = await visibleIncident(req);
    const s = scope(req);
    const deliveries = await c.deliveries.list({ incidentId: d.incident.id, limit: 100, offset: 0 });
    return IncidentDetailsSchema.parse({ ...d, deliveries: deliveries.items.filter((j) => c.access.canSeeRecipient(s, j.recipientId)) });
  });

  app.post('/api/incidents/:id/status', async (req) => {
    const d = await visibleIncident(req);
    const input = parse(IncidentStatusInputSchema, req.body);
    return IncidentSchema.parse(await c.incidents.setStatus(d.incident.id, input.status, actor(req)));
  });
}
