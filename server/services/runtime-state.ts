import { EventEmitter } from 'node:events';

/**
 * Состояние процесса в памяти: heartbeat воркеров, здоровье AI и приёма.
 * Процесс один (см. design.md) — этого достаточно для readiness и обзора.
 */

export type WakeTopic = 'intake' | 'max-intake' | 'analysis' | 'delivery' | 'reports';

export class RuntimeState {
  readonly startedAt = new Date().toISOString();
  private heartbeats = new Map<string, { at: number; staleAfterMs: number }>();
  private wakeBus = new EventEmitter();

  ai = { lastOkAt: null as string | null, failingSince: null as string | null, lastError: null as string | null };
  intake = {
    mode: 'off' as string,
    webhookUrl: null as string | null,
    webhookRegisteredAt: null as string | null,
    pendingUpdateCount: null as number | null,
    lastErrorAt: null as string | null,
    lastErrorMessage: null as string | null,
    failingSince: null as string | null,
    lastOkAt: null as string | null,
  };
  bot = { lastGetMeOkAt: null as string | null, username: null as string | null, readsAll: null as boolean | null, error: null as string | null };
  maxIntake = {
    mode: 'off' as string,
    lastErrorAt: null as string | null,
    lastErrorMessage: null as string | null,
    failingSince: null as string | null,
    lastOkAt: null as string | null,
  };
  maxBot = { lastGetMeOkAt: null as string | null, username: null as string | null, error: null as string | null };

  /** staleAfterMs — через сколько без heartbeat компонент считается зависшим. */
  beat(component: string, staleAfterMs = 60_000): void {
    this.heartbeats.set(component, { at: Date.now(), staleAfterMs });
  }

  heartbeatAges(): Record<string, number> {
    const now = Date.now();
    return Object.fromEntries([...this.heartbeats].map(([k, v]) => [k, Math.round((now - v.at) / 1000)]));
  }

  staleComponents(): string[] {
    const now = Date.now();
    return [...this.heartbeats].filter(([, v]) => now - v.at > v.staleAfterMs).map(([k]) => k);
  }

  wake(topic: WakeTopic): void {
    this.wakeBus.emit(topic);
  }

  onWake(topic: WakeTopic, fn: () => void): void {
    this.wakeBus.on(topic, fn);
  }

  aiOk(): void {
    this.ai.lastOkAt = new Date().toISOString();
    this.ai.failingSince = null;
    this.ai.lastError = null;
  }

  aiFailed(error: string): void {
    this.ai.failingSince ??= new Date().toISOString();
    this.ai.lastError = error.slice(0, 300);
  }
}
