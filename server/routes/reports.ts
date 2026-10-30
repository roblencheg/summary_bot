import type { FastifyInstance } from 'fastify';
import {
  ManualReportInputSchema,
  OkSchema,
  PageQuerySchema,
  PeriodsResponseSchema,
  ReportDetailsSchema,
  ReportListSchema,
  ReportQuerySchema,
  ReportSchema,
} from '~shared/schemas';
import type { Container } from '~server/container';
import { NotFoundError } from '~server/services/errors';
import { actor, idParam, parse, scope } from './http';

export async function registerReportRoutes(app: FastifyInstance, c: Container): Promise<void> {
  // руководитель — отчёты получателей своих дирекций (целиком, как в Telegram)
  app.get('/api/reports', async (req) => {
    const q = parse(ReportQuerySchema, req.query);
    if (q.recipientId) c.access.assertRecipient(scope(req), q.recipientId);
    return ReportListSchema.parse(await c.reports.list({ ...q, recipientIds: c.access.recipientFilter(scope(req)) }));
  });

  app.get('/api/reports/:id', async (req) => {
    const report = await c.reports.getReport(idParam(req));
    if (!report) throw new NotFoundError('Отчёт не найден');
    c.access.assertRecipient(scope(req), report.recipientId);
    return ReportDetailsSchema.parse(await c.reports.details(report.id));
  });

  app.post('/api/reports/manual', async (req, reply) => {
    const input = parse(ManualReportInputSchema, req.body);
    c.access.assertRecipient(scope(req), input.recipientId);
    reply.status(201);
    return ReportSchema.parse(await c.reports.manualRun(input.recipientId, input.periodType, input.anchor, actor(req)));
  });

  app.get('/api/periods', async (req) => {
    c.access.requireSuper(scope(req));
    const q = parse(PageQuerySchema, req.query);
    return PeriodsResponseSchema.parse(await c.reports.listPeriods(q.limit, q.offset));
  });

  app.post('/api/periods/:id/rebuild', async (req) => {
    c.access.requireSuper(scope(req));
    await c.reports.rebuildDigests(idParam(req), actor(req));
    return OkSchema.parse({ ok: true });
  });
}
