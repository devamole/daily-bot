// src/adapters/channel/telegram/TelegramAdapter.ts
import type { RepoPort } from "../../../core/ports/RepoPort";
import type { NotifierPort } from "../../../core/ports/NotifierPort";
import { DailyService } from "../../../core/daily/DailyService";
import { localDateStr } from "../../../core/utils/dates";

type TgEntity = { offset: number; length: number; type: string };
type TgFrom = { id: number | string; is_bot: boolean; first_name?: string; username?: string; language_code?: string };
type TgChat = { id: number | string; type: string; first_name?: string; username?: string };
type TgMessage = {
  message_id: number;
  date: number; // epoch seconds
  text?: string;
  entities?: TgEntity[];
  from: TgFrom;
  chat: TgChat;
};
type TgUpdate = { update_id: number; message?: TgMessage };

export class TelegramAdapter {
  constructor(
    private readonly repo: RepoPort,
    private readonly notifier: NotifierPort,
    private readonly service: DailyService
  ) {}

  async handleUpdate(update: TgUpdate): Promise<void> {
    const msg = update.message;
    if (!msg || !msg.from || !msg.chat) return;

    const user_id = String(msg.from.id);
    const chat_id = String(msg.chat.id);
    const ts = Number(msg.date || Math.floor(Date.now() / 1000));
    const text = (msg.text ?? "").trim();
    const tz = process.env.DEFAULT_TZ || "America/Bogota";
    const ymd = localDateStr(ts, tz);

    // 1) upsert del usuario SIEMPRE al primer contacto
    await this.repo.upsertUser({
      user_id,
      chat_id,
      tz,
      provider: "telegram",
      provider_user_id: user_id,
    });

    // 2) detectar /start de forma robusta (con entities y backup por texto)
    const hasStartEntity =
      Array.isArray(msg.entities) &&
      msg.entities.some(
        (e) =>
          e.type === "bot_command" &&
          e.offset === 0 &&
          text.slice(e.offset, e.offset + e.length) === "/start"
      );
    const isStart = hasStartEntity || text === "/start";
      console.log(`[TelegramAdapter] Received message from user ${user_id} in chat ${chat_id} at ${ts} (tz: ${tz}, ymd: ${ymd}): "${text}"${isStart ? " [detected as /start]" : ""}`);
    if (isStart) {
      // a) expira dailies abiertos de días anteriores si tu repo lo soporta (opcional)
      const expireOpenBefore = (this.repo as any).expireOpenBefore as
        | ((userId: string, ymd: string, nowEpoch: number) => Promise<number>)
        | undefined;
      if (typeof expireOpenBefore === "function") {
        try {
          await expireOpenBefore(user_id, ymd, ts);
        } catch (e) {
          console.warn("[TelegramAdapter] expireOpenBefore:", (e as Error).message);
        }
      }

      // b) crea o resetea el daily de HOY a 'pending_morning'
      const existing = await this.repo.getDailyByDate(user_id, ymd);
      console.log(`[TelegramAdapter] Existing daily for today: ${existing ? JSON.stringify(existing) : "none"}`);
      if (!existing) {
        await this.repo.createDaily(user_id, ymd, "pending_morning");
      } else if (existing.state !== "pending_morning") {
        const resetDailyToMorning = (this.repo as any).resetDailyToMorning as
          | ((dailyId: number) => Promise<void>)
          | undefined;
        console.log(`[TelegramAdapter] Resetting daily  ${JSON.stringify(resetDailyToMorning)}`);
        const setDailyState = (this.repo as any).setDailyState as
          | ((dailyId: number, state: string) => Promise<void>)
          | undefined;
        try {
          if (typeof resetDailyToMorning === "function") {
            await resetDailyToMorning(existing.id);
          } else if (typeof setDailyState === "function") {
            await setDailyState(existing.id, "pending_morning");
          }
        } catch (e) {
          console.warn("[TelegramAdapter] resetDailyToMorning/setDailyState:", (e as Error).message);
        }
      }

      // c) envía prompt morning (no pasamos /start a DailyService)
      await this.notifier.sendText(
        user_id,
        "👋 ¡Buen día! Recuerda tomar tu Daily ✨\n\n" +
          "Aquí tienes un formato sencillo que puedes seguir:\n\n" +
          "📌 Hoy me enfocaré en:\n" +
          "1. Resolver el algoritmo \"Two Sum\".\n" +
          "2. Aprender sobre \"Reactive Forms en Angular\".\n\n" +
          "Recuerda: sé breve y específico para mantener el enfoque.\n" +
          "¡Tú puedes con todo! 🌟🚀"
      );
      return; // IMPORTANTE: no procesar /start como “morning”
    }

    // 3) resto de mensajes: clasificar por estado actual del daily de HOY
    const daily =
      (await this.repo.getDailyByDate(user_id, ymd)) ??
      ({
        id: await this.repo.createDaily(user_id, ymd, "pending_morning"),
        user_id,
        date: ymd,
        state: "pending_morning" as const,
      } as const);

    let kind: "morning" | "update" | "followup" | "chat";
    switch (daily.state) {
      case "pending_morning":
        kind = "morning";
        break;
      case "pending_update":
        kind = "update";
        break;
      case "needs_followup":
        kind = "followup";
        break;
      default:
        kind = "chat";
    }

    const handlePayload: {
      user_id: string;
      chat_id: string;
      text: string;
      ts: number;
      type: typeof kind;
      message_id?: number;
    } = {
      user_id,
      chat_id,
      text,
      ts,
      type: kind,
    };
    const msgIdNum = Number(msg.message_id);
    if (!isNaN(msgIdNum)) {
      handlePayload.message_id = msgIdNum;
    }
    await this.service.handle(handlePayload, ymd);
  }
}
