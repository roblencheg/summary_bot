import Fastify, { type FastifyInstance } from 'fastify';
import FastifyCors from '@fastify/cors';
import FastifyCookie from '@fastify/cookie';
import FastifyStatic from '@fastify/static';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { env, isProd, publicBaseUrl } from './config';
import { createPlatform } from './platform';
import { applySchema } from './migrations';
import { registerRoutes } from './routes';
import { registerErrorHandler } from './routes/http';
import { buildContainer, type Container } from './container';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function buildApp(): Promise<{ app: FastifyInstance; container: Container | null }> {
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });

  // CORS: в prod — только собственный домен; в dev превью открывается с адреса платформы.
  await app.register(FastifyCors, { origin: isProd ? publicBaseUrl : true, credentials: true });
  await app.register(FastifyCookie);
  registerErrorHandler(app);

  const platform = createPlatform();
  app.addHook('onClose', async () => platform.close());
  let container: Container | null = null;
  if (platform.configured) {
    // Падение миграции НЕ глушим: лучше остановить старт и дать контейнеру перезапуститься,
    // чем отдать preview с битой БД и 500-ми на всех эндпоинтах.
    await applySchema(platform);
    container = buildContainer(platform);
    const bootstrap = await container.admins.bootstrap(env.ADMIN_INITIAL_LOGIN, env.ADMIN_INITIAL_PASSWORD);
    if (bootstrap === 'created') console.log('[auth] initial admin created from secrets');
    if (bootstrap === 'no_secrets') console.warn('[auth] no admins: set ADMIN_INITIAL_LOGIN / ADMIN_INITIAL_PASSWORD');
    await registerRoutes(app, container);
  } else {
    app.all('/api/*', async (_req, reply) => reply.status(503).send({ error: 'База данных недоступна.' }));
  }

  if (isProd) {
    await app.register(FastifyStatic, {
      root: join(__dirname, '..', 'dist'),
      prefix: '/',
    });
    // SPA-fallback ТОЛЬКО для GET не-/api/* — API-404 возвращает JSON, не index.html
    app.setNotFoundHandler((req, reply) => {
      if (req.method !== 'GET' || req.url.startsWith('/api/')) {
        return reply.status(404).send({ error: 'Not Found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return { app, container };
}
