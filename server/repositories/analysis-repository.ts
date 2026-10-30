import type { Db } from '~server/platform';
import { nowIso } from './sql-utils';

export class AnalysisRepository {
  constructor(private readonly db: Db) {}

  async insertResult(r: {
    messagePk: number;
    chatId: number;
    batchId: string;
    model: string;
    promptVersion: string;
    rulesVersion: string;
    result: unknown;
    flags: string[];
  }): Promise<number> {
    const res = await this.db.exec(
      `INSERT INTO analysis_results (message_pk, chat_id, batch_id, model, prompt_version, rules_version, analyzed_at, result, flags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(message_pk, batch_id) DO NOTHING`,
      [r.messagePk, r.chatId, r.batchId, r.model, r.promptVersion, r.rulesVersion, nowIso(), JSON.stringify(r.result), JSON.stringify(r.flags)],
    );
    if (res.changes > 0 && res.lastInsertRowid) return res.lastInsertRowid;
    const row = await this.db.first<{ id: number }>('SELECT id FROM analysis_results WHERE message_pk = ? AND batch_id = ?', [
      r.messagePk,
      r.batchId,
    ]);
    if (!row) throw new Error('AnalysisRepository.insertResult: row not found');
    return row.id;
  }

  async latestForMessage(messagePk: number): Promise<{ model: string; promptVersion: string; rulesVersion: string; analyzedAt: string; result: unknown; flags: string[] } | null> {
    const r = await this.db.first<{ model: string; prompt_version: string; rules_version: string; analyzed_at: string; result: string; flags: string | null }>(
      'SELECT model, prompt_version, rules_version, analyzed_at, result, flags FROM analysis_results WHERE message_pk = ? ORDER BY id DESC LIMIT 1',
      [messagePk],
    );
    if (!r) return null;
    return {
      model: r.model,
      promptVersion: r.prompt_version,
      rulesVersion: r.rules_version,
      analyzedAt: r.analyzed_at,
      result: JSON.parse(r.result),
      flags: r.flags ? JSON.parse(r.flags) : [],
    };
  }

  async logCall(c: {
    purpose: string;
    model: string;
    promptVersion: string;
    startedAt: string;
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    ok: boolean;
    error: string | null;
  }): Promise<void> {
    await this.db.exec(
      `INSERT INTO ai_calls (purpose, model, prompt_version, started_at, duration_ms, input_tokens, output_tokens, ok, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [c.purpose, c.model, c.promptVersion, c.startedAt, c.durationMs, c.inputTokens, c.outputTokens, c.ok ? 1 : 0, c.error?.slice(0, 500) ?? null],
    );
  }

  async usageSince(iso: string): Promise<{ calls: number; failed: number; inputTokens: number; outputTokens: number; avgMs: number }> {
    const r = await this.db.first<{ calls: number; failed: number | null; inp: number | null; outp: number | null; avg_ms: number | null }>(
      `SELECT COUNT(*) AS calls, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failed, SUM(input_tokens) AS inp,
              SUM(output_tokens) AS outp, AVG(duration_ms) AS avg_ms
       FROM ai_calls WHERE started_at >= ?`,
      [iso],
    );
    return {
      calls: r?.calls ?? 0,
      failed: r?.failed ?? 0,
      inputTokens: r?.inp ?? 0,
      outputTokens: r?.outp ?? 0,
      avgMs: Math.round(r?.avg_ms ?? 0),
    };
  }

  async lastCall(): Promise<{ ok: boolean; startedAt: string; error: string | null } | null> {
    const r = await this.db.first<{ ok: number; started_at: string; error: string | null }>(
      'SELECT ok, started_at, error FROM ai_calls ORDER BY id DESC LIMIT 1',
    );
    return r ? { ok: r.ok === 1, startedAt: r.started_at, error: r.error } : null;
  }

  async deleteCallsOlderThan(iso: string): Promise<number> {
    const r = await this.db.exec('DELETE FROM ai_calls WHERE id IN (SELECT id FROM ai_calls WHERE started_at < ? LIMIT 500)', [iso]);
    return r.changes;
  }
}
