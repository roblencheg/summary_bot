import { buildApp } from './app';
import { port, isProd } from './config';
import { startWorkers } from './workers/runner';

const { app, container } = await buildApp();

await app.listen({ host: '0.0.0.0', port });
console.log(`Server listening on :${port} (${isProd ? 'prod' : 'dev'})`);

const stopWorkers = container ? await startWorkers(container) : async () => {};

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    try {
      await stopWorkers();
      await app.close();
    } finally {
      process.exit(0);
    }
  });
}
