import type { FastifyInstance } from 'fastify';
import type { Container } from '~server/container';
import { registerAuthGuard, registerAuthRoutes } from './auth';
import { registerChatRoutes } from './chats';
import { registerDeliveryRoutes } from './deliveries';
import { registerDirectorateRoutes } from './directorates';
import { registerGuideRoutes } from './guide';
import { registerHealthRoutes } from './health';
import { registerIncidentRoutes } from './incidents';
import { registerRecipientRoutes } from './recipients';
import { registerReportRoutes } from './reports';
import { registerSettingsRoutes } from './settings';
import { registerTelegramRoutes } from './telegram';
import { registerMaxRoutes } from './max';

/**
 * Агрегатор API-роутов. Каждый файл в routes/ экспортирует register*Routes(app, c)
 * и ставит свои endpoints под префикс /api/*.
 */
export async function registerRoutes(app: FastifyInstance, c: Container): Promise<void> {
  await registerAuthGuard(app, c);
  await registerAuthRoutes(app, c);
  await registerHealthRoutes(app, c);
  await registerGuideRoutes(app, c);
  await registerTelegramRoutes(app, c);
  await registerMaxRoutes(app, c);
  await registerChatRoutes(app, c);
  await registerRecipientRoutes(app, c);
  await registerIncidentRoutes(app, c);
  await registerReportRoutes(app, c);
  await registerDeliveryRoutes(app, c);
  await registerSettingsRoutes(app, c);
  await registerDirectorateRoutes(app, c);
}
