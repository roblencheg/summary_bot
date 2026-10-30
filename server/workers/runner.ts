import type { Container } from '~server/container';
import { WorkerLoop } from './loop';

/**
 * Фоновые воркеры процесса. Воркер — «транспорт» наравне с роутом: только вызывает сервисы.
 * Очереди устойчивы (статусы + lease в БД), поэтому рестарт ничего не теряет.
 */
export async function startWorkers(c: Container): Promise<() => Promise<void>> {
  await c.gaps.detectDowntimeOnStart().catch((err) => console.error('[runner] downtime check:', (err as Error).message));
  await c.bot.getMe(true);
  if (c.intake.active) await c.intake.prepare();
  await c.maxBot.getMe(true);
  if (c.maxIntake.active) await c.maxIntake.prepare();

  const loops: WorkerLoop[] = [];

  // приём Telegram: обработка сохранённых апдейтов по порядку update_id
  loops.push(
    new WorkerLoop('intake', c.state, 2_000, async () => {
      const batch = await c.ingestion.claim(20);
      for (const u of batch) await c.ingestion.process(u);
      return batch.length > 0;
    }, 60_000, 'intake'),
  );

  if (c.bot.mode === 'polling' && c.bot.configured) {
    loops.push(new WorkerLoop('polling', c.state, 0, async () => {
      await c.intake.pollOnce();
      return true;
    }, 90_000));
  }

  // приём MAX — независимо от состояния Telegram
  loops.push(
    new WorkerLoop('max-intake', c.state, 2_000, async () => {
      const batch = await c.maxIngestion.claim(20);
      for (const u of batch) await c.maxIngestion.process(u);
      return batch.length > 0;
    }, 60_000, 'max-intake'),
  );

  if (c.maxBot.mode === 'polling' && c.maxBot.configured) {
    loops.push(new WorkerLoop('max-polling', c.state, 0, async () => {
      await c.maxIntake.pollOnce();
      return true;
    }, 90_000));
  }

  // анализ: параллельно по чатам, внутри чата — по одному пакету
  const inFlight = new Set<number>();
  loops.push(
    new WorkerLoop('analysis', c.state, 2_000, async () => {
      const ready = (await c.analysis.readyChats()).filter((id) => !inFlight.has(id)).slice(0, 3);
      if (!ready.length) return false;
      const results = await Promise.all(
        ready.map(async (id) => {
          inFlight.add(id);
          try {
            return await c.analysis.processChat(id);
          } finally {
            inFlight.delete(id);
          }
        }),
      );
      // AI недоступен — не крутимся вхолостую, пакеты отложены с backoff
      return results.every(Boolean);
    }, 180_000, 'analysis'),
  );

  // доставка
  loops.push(
    new WorkerLoop('delivery', c.state, 2_000, async () => {
      const jobs = await c.deliveries.claim(10);
      for (const j of jobs) await c.deliveries.process(j);
      return jobs.length > 0;
    }, 60_000, 'delivery'),
  );

  // всплески считаются по количеству — проверяем и без AI (раз в 30 с по чатам с недавней активностью)
  loops.push(
    new WorkerLoop('spikes', c.state, 30_000, async () => {
      const recent = Date.now() - 10 * 60_000;
      for (const chat of await c.chats.listActive()) {
        if (chat.lastMessageAt && new Date(chat.lastMessageAt).getTime() > recent) await c.spikes.check(chat);
      }
      return false;
    }, 3 * 60_000),
  );

  // расписание саммари
  let lastHeartbeat = 0;
  loops.push(
    new WorkerLoop('scheduler', c.state, 15_000, async () => {
      if (Date.now() - lastHeartbeat > 30_000) {
        await c.gaps.heartbeat();
        lastHeartbeat = Date.now();
      }
      await c.scheduler.tick();
      return c.scheduler.processNext();
    }, 5 * 60_000, 'reports'),
  );

  // мониторинг, отложенные обновления инцидентов, всплески в тихих окнах
  loops.push(
    new WorkerLoop('monitor', c.state, 60_000, async () => {
      await c.bot.getMe();
      await c.maxBot.getMe();
      await c.monitor.check();
      return false;
    }, 3 * 60_000),
  );

  // обслуживание раз в сутки
  loops.push(
    new WorkerLoop('maintenance', c.state, 30 * 60_000, async () => {
      await c.maintenance.runIfDue();
      return false;
    }, 3 * 3600_000),
  );

  for (const l of loops) l.start();
  console.log(
    `[runner] workers started; telegram mode: ${c.bot.configured ? c.bot.mode : 'off (no token)'}; max mode: ${c.maxBot.configured ? c.maxBot.mode : 'off (no token)'}`,
  );
  return async () => {
    await Promise.all(loops.map((l) => l.stop()));
  };
}
