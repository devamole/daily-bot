import type { RepoPort, DailyRow } from "../ports/RepoPort";
import type { NotifierPort } from "../ports/NotifierPort";
import { extractTasksHeuristic, classifyWorkload } from "../analysis/workload";
import { tagReasonsHeuristic, REASONS_HEURISTIC_VERSION } from "../analysis/reasons";
import { ReasonsClassifierLLM } from "../../adapters/llm/ReasonsClassifier";

type EvaluateFn = (planText: string, updateText: string) => Promise<{ score: number; rationale?: string; advice?: string; model?: string; version?: string }>;

export class DailyService {
  constructor(
    private readonly repo: RepoPort,
    private readonly notifier: NotifierPort,
    private readonly evaluate: EvaluateFn
  ) {}

  // Procesa mensaje del usuario con tipo ya determinado: 'morning' | 'update' | 'followup' | 'chat'
  async handle(
    msg: {
      user_id: string;
      chat_id: string;
      text: string;
      ts: number;       // epoch seconds
      type: "morning" | "update" | "followup" | "chat";
      message_id?: number;
    },
    todayYmd: string
  ): Promise<void> {
    // asegura daily del día lógico
    console.log("Handling message", msg)
    let daily = (await this.repo.getDailyByDate(msg.user_id, todayYmd)) ?? await this.createDailyPendingMorning(msg.user_id, todayYmd);
    console.log(`2. Found daily  ${daily} with state ${daily.state} for user ${msg.user_id} on ${todayYmd}`);
    if (msg.type === "morning") {
      await this.onMorningMessage(daily, msg);
      return;
    }

    if (msg.type === "update") {
      console.log(`Processing update for daily id ${daily.id} (state: ${daily.state})`);
      await this.onUpdateMessage(daily, msg);
      return;
    }

    if (msg.type === "followup") {
      // opcional: podrías reetiquetar razones aquí, pero no es necesario
      return;
    }

    if (msg.type === "chat") {
      // chat libre: no toca estado
      return;
    }
  }

  private async createDailyPendingMorning(userId: string, ymd: string): Promise<DailyRow> {
    const id = await this.repo.createDaily(userId, ymd, "pending_morning");
    return { id, user_id: userId, date: ymd, state: "pending_morning" };
  }

  private async onMorningMessage(daily: DailyRow, msg: { user_id: string; text: string; ts: number }) {
    // marca primer plan si no estaba
    await this.repo.patchDaily(daily.id, { first_morning_at: msg.ts });

    // extrae tareas y puntúa (heurística)
    const tasks = extractTasksHeuristic(msg.text);
    if (tasks.length) {
      await this.repo.insertTasks(daily.id, msg.user_id, tasks.map(t => ({ ...t, source: "heuristic" })));
      const totalPoints = tasks.reduce((a, t) => a + t.est_points, 0);
      const baseline = Number(process.env.BASELINE_POINTS_PER_DAY || 5);
      const level = classifyWorkload(totalPoints, baseline);
      await this.repo.patchDaily(daily.id, { workload_points: totalPoints, workload_level: level });
    }

    // pasa a pending_update
    await this.repo.setDailyState(daily.id, "pending_update");
  }

  private async onUpdateMessage(
    daily: DailyRow,
    msg: { user_id: string; text: string; ts: number; message_id?: number }
  ) {
    await this.repo.patchDaily(daily.id, { first_update_at: msg.ts });

    // Recupera textos necesarios: plan y update. (Asumimos que el primer 'morning' del día fue persistido en messages.)
    // Si ya llevas el plan en otra parte, injéctalo aquí. Para estabilidad, usa el último plan guardado para daily_id.
    const planText = await this.getFirstMorningText(daily.id);
    const updateText = msg.text;

    // Evalúa con LLM (el que ya usas)
    const res = await this.evaluate(planText ?? "", updateText);
    const score = Math.max(0, Math.min(100, Math.round(res.score)));
    await this.repo.patchDaily(daily.id, {
      score,
      eval_model: res.model ?? process.env.LLM_MODEL ?? "gemini-2.5-flash",
      eval_version: res.version ?? (process.env.LLM_RUBRIC_VERSION || "v1"),
      eval_rationale: res.rationale ?? null,
    });

    // Si no es 100, clasificamos razones (heurística + fallback LLM si hace falta)
    if (score < 100) {
      await this.labelReasons(daily.id, planText, updateText, msg.message_id ?? null);
      await this.repo.setDailyState(daily.id, "needs_followup");
    } else {
      // Completado: cerramos ciclo
      const now = Math.floor(Date.now() / 1000);
      await this.repo.patchDaily(daily.id, { closed_at: now });
      await this.repo.setDailyState(daily.id, "done");
    }
  }

  private async getFirstMorningText(dailyId: number): Promise<string | null> {
    // obtener el primer mensaje tipo 'morning' del día (si lo persistes en messages)
    // sustituye esta consulta por un método del repo si ya lo tienes centralizado
    // Mantengo SQL aquí mínimo, pero idealmente RepoPort tendría getFirstMorningText(dailyId)
    try {
      // @ts-ignore acceso directo si tienes db en otra capa; si no, ignora y retorna null.
      const { db } = await import("../../db/db");
      const { rows } = await db.execute({
        sql: `SELECT text FROM messages WHERE daily_id = ? AND type = 'morning' ORDER BY id ASC LIMIT 1`,
        args: [dailyId],
      });
      return rows?.[0]?.text ? String((rows as any)[0].text) : null;
    } catch {
      return null;
    }
  }

  private async labelReasons(dailyId: number, planText: string | null, updateText: string, messageId: number | null) {
    // Heurística multi-etiqueta
    const heur = tagReasonsHeuristic(updateText, { topK: 3, minConfidence: 0.45, debug: false });

    if (heur.length) {
      await this.repo.upsertReasons(
        dailyId,
        heur.map(r => ({
          code: r.code,
          confidence: r.confidence,
          source: "heuristic",
          raw: updateText.slice(0, 300),
          message_id: messageId ?? null,
          model_version: REASONS_HEURISTIC_VERSION,
        }))
      );
    }

    // ¿Fallback LLM a UNA etiqueta?
    const FALLBACK_CONF = 0.6;
    const needsLLM =
      heur.length === 0 ||
      Math.max(...heur.map(x => x.confidence)) < FALLBACK_CONF ||
      this.isAmbiguous(heur);

    if (needsLLM && process.env.GEMINI_API_KEY) {
      const cls = new ReasonsClassifierLLM(process.env.GEMINI_API_KEY, process.env.LLM_REASON_MODEL || "gemini-2.5-flash");
      const { code } = await cls.classify(planText, updateText, 2200);
      await this.repo.upsertReasons(dailyId, [
        {
          code,
          confidence: 0.9,
          source: "llm",
          raw: null,
          message_id: messageId ?? null,
          model_version: process.env.LLM_REASON_MODEL || "gemini-2.5-flash",
        },
      ]);
    }
  }

  private isAmbiguous(rs: Array<{ code: string; confidence: number }>): boolean {
    if (rs.length < 2) return false;
    const sorted = [...rs].sort((a, b) => b.confidence - a.confidence);
    return ((sorted[0]?.confidence ?? 0) - (sorted[1]?.confidence ?? 0)) < 0.05;
  }
}
