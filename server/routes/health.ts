import type { FastifyInstance } from 'fastify';
import { HealthSchema, OverviewQuerySchema, OverviewSchema, ReadySchema } from '~shared/schemas';
import type { Container } from '~server/container';
import { parse, scope } from './http';

export async function registerHealthRoutes(app: FastifyInstance, c: Container): Promise<void> {
  app.get('/api/health', async () => HealthSchema.parse({ status: 'ok', uptimeSec: Math.round(process.uptime()) }));

  app.get('/api/ready', async (_req, reply) => {
    const r = await c.overview.readiness();
    reply.status(r.ready ? 200 : 503);
    return ReadySchema.parse(r);
  });

  app.get('/api/overview', async (req) => {
    const { hours } = parse(OverviewQuerySchema, req.query);
    const s = scope(req);
    const limit = s.kind === 'manager' ? { chatIds: [...s.chatIds], recipientIds: [...s.recipientIds] } : undefined;
    return OverviewSchema.parse(await c.overview.overview(hours, limit));
  });
}
