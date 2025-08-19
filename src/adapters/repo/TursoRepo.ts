import { RepoPort, UserRow, DailyRow, MessageRow, DailyState } from "../../core/ports/RepoPort";
import { db } from "../../db/db";

export class TursoRepo extends RepoPort {
  async upsertUser(u: Pick<UserRow, "user_id" | "chat_id" | "tz" | "provider" | "provider_user_id">): Promise<void> {
    await db.execute({
      sql: `
        INSERT INTO users (user_id, chat_id, tz, provider, provider_user_id, created_at)
        VALUES (?, ?, ?, ?, ?, unixepoch())
        ON CONFLICT(user_id) DO UPDATE SET
          chat_id = excluded.chat_id,
          tz = excluded.tz
      `,
      args: [u.user_id, u.chat_id, u.tz, u.provider, u.provider_user_id]
    });
  }

  async getUser(user_id: string): Promise<UserRow | null> {
    const { rows } = await db.execute({ sql: `SELECT * FROM users WHERE user_id = ?`, args: [user_id] });
    const r = rows?.[0] as any;
    if (!r) return null;
    const out: UserRow = {
      user_id: String(r.user_id),
      chat_id: String(r.chat_id),
      tz: String(r.tz ?? "America/Bogota"),
      provider: String(r.provider ?? "telegram"),
      provider_user_id: String(r.provider_user_id ?? r.user_id),
      ...(r.created_at != null ? { created_at: Number(r.created_at) } : {})
    };
    return out;
  }

  async getAllUsers(): Promise<UserRow[]> {
    const { rows } = await db.execute({ sql: `SELECT * FROM users` });
    return rows.map((r: any) => ({
      user_id: String(r.user_id),
      chat_id: String(r.chat_id),
      tz: String(r.tz ?? "America/Bogota"),
      provider: String(r.provider ?? "telegram"),
      provider_user_id: String(r.provider_user_id ?? r.user_id),
      ...(r.created_at != null ? { created_at: Number(r.created_at) } : {})
    }));
  }

  async getDailyByDate(user_id: string, date: string): Promise<DailyRow | null> {
    const { rows } = await db.execute({
      sql: `SELECT * FROM daily_status WHERE user_id = ? AND date = ? LIMIT 1`,
      args: [user_id, date]
    });
    const r = rows?.[0] as any;
    if (!r) return null;
    return this.mapDaily(r);
  }

  async getLastDaily(user_id: string): Promise<DailyRow | null> {
    const { rows } = await db.execute({
      sql: `SELECT * FROM daily_status WHERE user_id = ? ORDER BY date DESC, id DESC LIMIT 1`,
      args: [user_id]
    });
    const r = rows?.[0] as any;
    if (!r) return null;
    return this.mapDaily(r);
  }

  private mapDaily(r: any): DailyRow {
    return {
      id: Number(r.id),
      user_id: String(r.user_id),
      date: String(r.date),
      state: String(r.state) as DailyState,
      score: r.score != null ? Number(r.score) : null,
      eval_model: r.eval_model ?? null,
      eval_version: r.eval_version ?? null,
      eval_rationale: r.eval_rationale ?? null,
      morning_prompt_at: r.morning_prompt_at != null ? Number(r.morning_prompt_at) : null,
      evening_prompt_at: r.evening_prompt_at != null ? Number(r.evening_prompt_at) : null,
      ...(r.created_at != null ? { created_at: Number(r.created_at) } : {}),
      ...(r.updated_at != null ? { updated_at: Number(r.updated_at) } : {})
    };
  }

  async createDaily(user_id: string, date: string, state: DailyState, opts?: { overwriteToday?: boolean }): Promise<number> {
    if (opts?.overwriteToday) {
      await db.execute({ sql: `DELETE FROM daily_status WHERE user_id = ? AND date = ?`, args: [user_id, date] });
    }
    const r = await db.execute({
      sql: `
        INSERT INTO daily_status (user_id, date, state, created_at, updated_at)
        VALUES (?, ?, ?, unixepoch(), unixepoch())
      `,
      args: [user_id, date, state]
    });
    const id = Number((r as any).lastInsertRowid ?? 0);
    return id;
  }

  async setDailyState(dailyId: number, state: DailyState, patch: Partial<DailyRow> = {}): Promise<void> {
    const cols: string[] = [`state = ?`, `updated_at = unixepoch()`];
    const args: any[] = [state];
    for (const [k, v] of Object.entries(patch)) {
      cols.push(`${k} = ?`);
      args.push(v);
    }
    args.push(dailyId);
    await db.execute({
      sql: `UPDATE daily_status SET ${cols.join(", ")} WHERE id = ?`,
      args
    });
  }

  async insertMessage(row: Omit<MessageRow, "id">): Promise<void> {
    await db.execute({
      sql: `
        INSERT INTO messages
          (daily_id, chat_id, user_id, message_id, update_id, provider, text, timestamp, type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
      `,
      args: [
        row.daily_id ?? null,
        row.chat_id,
        row.user_id,
        row.message_id ?? 0,
        row.update_id ?? null,
        row.provider ?? "telegram",
        row.text,
        row.timestamp,
        row.type
      ]
    });
  }

  async getMorningTextByDailyId(dailyId: number): Promise<string> {
    const { rows } = await db.execute({
      sql: `
        SELECT text
        FROM messages
        WHERE daily_id = ? AND type = 'morning'
        ORDER BY id ASC
        LIMIT 1
      `,
      args: [dailyId]
    });
    return rows?.[0]?.text ? String(rows[0].text) : "";
  }

  async getFirstUpdateTextByDailyId(dailyId: number): Promise<string> {
    const { rows } = await db.execute({
      sql: `
        SELECT text
        FROM messages
        WHERE daily_id = ? AND type = 'update'
        ORDER BY id ASC
        LIMIT 1
      `,
      args: [dailyId]
    });
    return rows?.[0]?.text ? String(rows[0].text) : "";
  }

  async claimMorningPrompt(dailyId: number, ts: number): Promise<boolean> {
    const r: any = await db.execute({
      sql: `
        UPDATE daily_status
           SET morning_prompt_at = COALESCE(morning_prompt_at, ?)
         WHERE id = ? AND morning_prompt_at IS NULL
      `,
      args: [ts, dailyId]
    });
    return Number(r.rowsAffected ?? 0) > 0;
  }

  async claimEveningPrompt(dailyId: number, ts: number): Promise<boolean> {
    const r: any = await db.execute({
      sql: `
        UPDATE daily_status
           SET evening_prompt_at = COALESCE(evening_prompt_at, ?)
         WHERE id = ? AND evening_prompt_at IS NULL
      `,
      args: [ts, dailyId]
    });
    return Number(r.rowsAffected ?? 0) > 0;
  }

  async hasEvent(provider: string, event_id: string): Promise<boolean> {
    if (!event_id) return false;
    const { rows } = await db.execute({
      sql: `SELECT 1 AS ok FROM messages WHERE provider = ? AND update_id = ? LIMIT 1`,
      args: [provider, event_id]
    });
    return rows.length > 0;
  }
}
