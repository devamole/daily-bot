// core/daily/DailyService.ts
import type { RepoPort, DailyRow } from "../ports/RepoPort";
import type { NotifierPort } from "../ports/NotifierPort";
import { extractTasksHeuristic, classifyWorkload } from "../analysis/workload";
import { tagReasonsHeuristic, REASONS_HEURISTIC_VERSION } from "../analysis/reasons";
import { ReasonsClassifierLLM } from "../../adapters/llm/ReasonsClassifier";
import { messages } from "./messages";

type EvaluateFn = (
  planText: string,
  updateText: string
) => Promise<{ score: number; rationale?: string; advice?: string; model?: string; version?: string }>;

export class DailyService {
  constructor(
    private readonly repo: RepoPort,
    private readonly notifier: NotifierPort,
    private readonly evaluate: EvaluateFn
  ) {}

  // Onboarding /start centralizado en core
  async startCycle(user_id: string, chat_id: string, ymd: string, ts: number, provider: string): Promise<void> {
    const existing = await this.repo.getDailyByDate(user_id, ymd);
    if (!existing) {
      await this.repo.createDaily(user_id, ymd, "pending_morning");
    } else if (existing.state !== "pending_morning") {
      await this.repo.setDailyState(existing.id, "pending_morning");
    }
    const daily = await this.repo.getDailyByDate(user_id, ymd);
    // Enviar prompt morning
    await this.notifier.sendText(user_id, messages.morning);
    // Persistir salida (system)
    await this.repo.insertMessage({
      daily_id: daily ? daily.id : null,
      user_id,
      chat_id,
      provider,
      text: messages.morning,
      ts,
      type: "system",
    });
  }

  // Manejo del inbound
  async handle(
    msg: {
      user_id: string;
      chat_id: string;
      text: string;
      ts: number;
      type: "morning" | "update" | "followup" | "chat";
      message_id?: number;
      update_id?: string;
      provider?: string;
      daily_id_hint?: number;
    },
    todayYmd: string
  ): Promise<void> {
    const daily =
      (await this.repo.getDailyByDate(msg.user_id, todayYmd)) ??
      (await this.createDailyPendingMorning(msg.user_id, todayYmd));

    // Persistir inbound SIEMPRE (auditoría / idempotencia)
    await this.repo.insertMessage({
      daily_id: daily.id,
      user_id: msg.user_id,
      chat_id: msg.chat_id,
      provider: msg.provider ?? "telegram",
      text: msg.text,
      ts: msg.ts,
      type: msg.type,
      ...(msg.message_id !== undefined ? { message_id: msg.message_id } : {}),
      ...(msg.update_id !== undefined ? { update_id: msg.update_id } : {}),
    });

    if (msg.type === "morning") {
      await this.onMorningMessage(daily, msg);
      return;
    }
    if (msg.type === "update") {
      await this.onUpdateMessage(daily, msg);
      return;
    }
    if (msg.type === "followup") {
      // futuro: procesar followups explícitos si se desea
      return;
    }
    // chat libre: ya quedó persistido; no cambiamos estado
  }

  private async createDailyPendingMorning(userId: string, ymd: string): Promise<DailyRow> {
    const id = await this.repo.createDaily(userId, ymd, "pending_morning");
    return { id, user_id: userId, date: ymd, state: "pending_morning" };
  }

  private async onMorningMessage(
    daily: DailyRow,
    msg: { user_id: string; chat_id: string; text: string; ts: number }
  ) {
    await this.repo.patchDaily(daily.id, { first_morning_at: msg.ts });

    // Extraer tareas y puntuar
    const tasks = extractTasksHeuristic(msg.text);
    if (tasks.length) {
      await this.repo.insertTasks(
        daily.id,
        msg.user_id,
        tasks.map(t => ({ ...t, source: "heuristic" }))
      );
      const totalPoints = tasks.reduce((a, t) => a + t.est_points, 0);
      const baseline = Number(process.env.BASELINE_POINTS_PER_DAY || 5);
      const level = classifyWorkload(totalPoints, baseline); // "low" | "normal" | "high"
      await this.repo.patchDaily(daily.id, { workload_points: totalPoints, workload_level: level });
    }

    // ACK
    await this.notifier.sendText(msg.user_id, messages.ackMorning);
    await this.repo.insertMessage({
      daily_id: daily.id,
      user_id: msg.user_id,
      chat_id: msg.chat_id,
      provider: "telegram",
      text: messages.ackMorning,
      ts: Math.floor(Date.now() / 1000),
      type: "system",
    });

    await this.repo.setDailyState(daily.id, "pending_update");
  }

  private async onUpdateMessage(
    daily: DailyRow,
    msg: { user_id: string; chat_id: string; text: string; ts: number; message_id?: number }
  ) {
    await this.repo.patchDaily(daily.id, { first_update_at: msg.ts });

    const planText = await this.repo.getFirstMorningText(daily.id);
    const updateText = msg.text;

    const res = await this.evaluate(planText ?? "", updateText);
    console.log(`[LLM] Eval result for daily ${planText} user ${updateText}:`, res);
    const score = Math.max(0, Math.min(100, Math.round(res.score)));

    await this.repo.patchDaily(daily.id, {
      score,
      eval_model: res.model ?? process.env.LLM_MODEL ?? "gemini-2.5-flash",
      eval_version: res.version ?? (process.env.LLM_RUBRIC_VERSION || "v1"),
      eval_rationale: res.rationale ?? null,
    });

    if (score < 100) {
      // Razones + follow-up
      await this.labelReasons(daily.id, planText, updateText, msg.message_id ?? null);

      await this.notifier.sendText(msg.user_id, messages.followup);
      await this.repo.insertMessage({
        daily_id: daily.id,
        user_id: msg.user_id,
        chat_id: msg.chat_id,
        provider: "telegram",
        text: messages.followup,
        ts: Math.floor(Date.now() / 1000),
        type: "system",
      });

      await this.repo.setDailyState(daily.id, "needs_followup");
    } else {
      // Felicitación y cierre
      const congrats = messages.congratsPrefix + (res.advice ?? "");
      await this.notifier.sendText(msg.user_id, congrats);
      await this.repo.insertMessage({
        daily_id: daily.id,
        user_id: msg.user_id,
        chat_id: msg.chat_id,
        provider: "telegram",
        text: congrats,
        ts: Math.floor(Date.now() / 1000),
        type: "system",
      });

      const now = Math.floor(Date.now() / 1000);
      await this.repo.patchDaily(daily.id, { closed_at: now });
      await this.repo.setDailyState(daily.id, "done");
    }
  }

  private async labelReasons(dailyId: number, planText: string | null, updateText: string, messageId: number | null) {
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

    const FALLBACK_CONF = 0.6;
    const needsLLM =
      heur.length === 0 ||
      Math.max(...heur.map(x => x.confidence)) < FALLBACK_CONF ||
      this.isAmbiguous(heur);

    if (needsLLM && process.env.GEMINI_API_KEY) {
      const cls = new ReasonsClassifierLLM(process.env.GEMINI_API_KEY, process.env.LLM_REASON_MODEL || "gemini-2.5-flash");
      const { code } = await cls.classify(planText, updateText, 2200);
      await this.repo.upsertReasons(dailyId, [
        { code, confidence: 0.9, source: "llm", raw: null, message_id: messageId ?? null, model_version: process.env.LLM_REASON_MODEL || "gemini-2.5-flash" },
      ]);
    }
  }

  private isAmbiguous(rs: Array<{ code: string; confidence: number }>): boolean {
    if (rs.length < 2) return false;
    const sorted = [...rs].sort((a, b) => b.confidence - a.confidence);
    return ((sorted[0]?.confidence ?? 0) - (sorted[1]?.confidence ?? 0)) < 0.05;
  }
}
