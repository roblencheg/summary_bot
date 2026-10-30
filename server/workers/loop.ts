import type { RuntimeState, WakeTopic } from '~server/services/runtime-state';

/**
 * Цикл фонового воркера: шаг выполняется по таймеру или сразу по сигналу wake.
 * Шаг возвращает true, если работа была — тогда следующий запускается без паузы.
 */
export class WorkerLoop {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private again = false;
  private current: Promise<void> = Promise.resolve();

  constructor(
    private readonly name: string,
    private readonly state: RuntimeState,
    private readonly intervalMs: number,
    private readonly step: () => Promise<boolean>,
    // через сколько без heartbeat воркер считается зависшим (учитывает долгие шаги: AI, бэкап)
    private readonly staleAfterMs: number,
    wakeOn?: WakeTopic,
  ) {
    if (wakeOn) state.onWake(wakeOn, () => this.kick());
  }

  start(): void {
    this.state.beat(this.name, this.staleAfterMs);
    this.schedule(0);
  }

  kick(): void {
    if (this.stopped) return;
    if (this.running) {
      this.again = true;
      return;
    }
    this.schedule(0);
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.current = this.run();
    }, ms);
  }

  private async run(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    this.again = false;
    let busy = false;
    try {
      busy = await this.step();
    } catch (err) {
      console.error(`[${this.name}]`, (err as Error).message);
    } finally {
      this.state.beat(this.name, this.staleAfterMs);
      this.running = false;
    }
    this.schedule(busy || this.again ? 0 : this.intervalMs);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await Promise.race([this.current, new Promise((r) => setTimeout(r, 10_000))]);
  }
}
