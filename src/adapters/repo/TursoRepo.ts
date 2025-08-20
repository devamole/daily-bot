import type { Client } from "@libsql/client";
import type { RepoPort, DailyRow, DailyState } from "../../core/ports/RepoPort";
import type { TaskComplexity } from "../../core/analysis/workload";

export class TursoRepo implements RepoPort {
  constructor(private readonly db: Client) {}

  async getAllUsers(): Promise<Array<{ user_id: string; tz: string }>> {
    const { rows } = await this.db.execute(`SELECT user_id, tz FROM users`);
    return rows.map(r => ({ user_id: String((r as any).user_id), tz: String((r as any).tz) }));
  }

  async getDailyByDate(userId: string, ymd: string): Promise<DailyRow | null> {
    const { rows } = await this.db.execute({
      sql: `SELECT * FROM daily_status WHERE user_id = ? AND date = ? LIMIT 1`,
      args: [userId, ymd],
    });
    if (!rows || rows.length === 0) return null;
    return rows[0] as unknown as DailyRow;
  }

  async createDaily(userId: string, ymd: string, state: DailyState): Promise<number> {
    const res = await this.db.execute({
      sql: `INSERT INTO daily_status (user_id, date, state) VALUES (?, ?, ?)`,
      args: [userId, ymd, state],
    });
    return Number(res.lastInsertRowid);
  }

  async setDailyState(dailyId: number, state: DailyState): Promise<void> {
    await this.db.execute({
      sql: `UPDATE daily_status SET state = ?, updated_at = unixepoch() WHERE id = ?`,
      args: [state, dailyId],
    });
  }

  async claimMorningPrompt(dailyId: number, epoch: number): Promise<boolean> {
    const res = await this.db.execute({
      sql: `UPDATE daily_status SET morning_prompt_at = COALESCE(morning_prompt_at, ?), updated_at = unixepoch() 
            WHERE id = ? AND morning_prompt_at IS NULL`,
      args: [epoch, dailyId],
    });
    return res.rowsAffected > 0;
  }

  async claimEveningPrompt(dailyId: number, epoch: number): Promise<boolean> {
    const res = await this.db.execute({
      sql: `UPDATE daily_status SET evening_prompt_at = COALESCE(evening_prompt_at, ?), updated_at = unixepoch() 
            WHERE id = ? AND evening_prompt_at IS NULL`,
      args: [epoch, dailyId],
    });
    return res.rowsAffected > 0;
  }

  async patchDaily(dailyId: number, patch: Partial<DailyRow>): Promise<void> {
    const sets: string[] = [];
    const args: any[] = [];

    if (patch.first_morning_at !== undefined) {
      sets.push(`first_morning_at = COALESCE(first_morning_at, ?)`);
      args.push(patch.first_morning_at);
    }
    if (patch.first_update_at !== undefined) {
      sets.push(`first_update_at = COALESCE(first_update_at, ?)`);
      args.push(patch.first_update_at);
    }
    if (patch.closed_at !== undefined) {
      sets.push(`closed_at = COALESCE(closed_at, ?)`);
      args.push(patch.closed_at);
    }
    if (patch.workload_points !== undefined) {
      sets.push(`workload_points = ?`);
      args.push(patch.workload_points);
    }
    if (patch.workload_level !== undefined) {
      sets.push(`workload_level = ?`);
      args.push(patch.workload_level);
    }
    if (patch.score !== undefined) {
      sets.push(`score = ?`);
      args.push(patch.score);
    }
    if (patch.eval_model !== undefined) {
      sets.push(`eval_model = ?`);
      args.push(patch.eval_model);
    }
    if (patch.eval_version !== undefined) {
      sets.push(`eval_version = ?`);
      args.push(patch.eval_version);
    }
    if (patch.eval_rationale !== undefined) {
      sets.push(`eval_rationale = ?`);
      args.push(patch.eval_rationale);
    }

    if (sets.length === 0) return;

    sets.push(`updated_at = unixepoch()`);
    const sql = `UPDATE daily_status SET ${sets.join(", ")} WHERE id = ?`;
    args.push(dailyId);

    await this.db.execute({ sql, args });
  }

  async insertTasks(
    dailyId: number,
    userId: string,
    tasks: Array<{ pos: number; text: string; est_complexity: TaskComplexity; est_points: number; source: "heuristic" | "llm" }>
  ): Promise<void> {
    const tx = await this.db.transaction("write");
    let ok = false;
    try {
      // estrategia simple y determinista: delete + insert posicional
      await tx.execute({ sql: `DELETE FROM daily_tasks WHERE daily_id = ?`, args: [dailyId] });

      for (const t of tasks) {
        await tx.execute({
          sql: `INSERT INTO daily_tasks (daily_id, user_id, pos, text, est_complexity, est_points, source)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [dailyId, userId, t.pos, t.text, t.est_complexity, t.est_points, t.source],
        });
      }
      await tx.commit();
      ok = true;
    } finally {
      if (!ok) await tx.rollback();
    }
  }

  async upsertReasons(
    dailyId: number,
    reasons: Array<{
      code: string;
      confidence: number;
      source: "heuristic" | "llm" | "manual";
      raw?: string | null;
      message_id?: number | null;
      model_version?: string | null;
    }>
  ): Promise<void> {
    const tx = await this.db.transaction("write");
    let ok = false;
    try {
      for (const r of reasons) {
        await tx.execute({
          sql: `
            INSERT INTO daily_reasons (daily_id, code, confidence, source, raw, message_id, model_version)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(daily_id, code) DO UPDATE SET
              confidence    = CASE WHEN excluded.confidence > confidence THEN excluded.confidence ELSE confidence END,
              source        = CASE WHEN excluded.confidence > confidence THEN excluded.source     ELSE source     END,
              model_version = CASE WHEN excluded.confidence > confidence THEN excluded.model_version ELSE model_version END,
              raw           = COALESCE(excluded.raw, raw),
              message_id    = COALESCE(excluded.message_id, message_id)
          `,
          args: [
            dailyId,
            r.code,
            r.confidence,
            r.source,
            r.raw ?? null,
            r.message_id ?? null,
            r.model_version ?? null,
          ],
        });
      }
      await tx.commit();
      ok = true;
    } finally {
      if (!ok) await tx.rollback();
    }
  }
}
