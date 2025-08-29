// adapters/channel/telegram/TelegramAdapter.ts
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

    const provider = "telegram";
    const update_id = String(update.update_id);

    // Idempotencia: ¿ya procesado?
    if (await this.repo.wasUpdateProcessed(provider, update_id)) {
      return;
    }

    const user_id = String(msg.from.id);
    const chat_id = String(msg.chat.id);
    const ts = Number(msg.date || Math.floor(Date.now() / 1000));
    const text = (msg.text ?? "").trim();

    // Registrar/actualizar usuario (tz por defecto si no hay aún registro)
    await this.repo.upsertUser({
      user_id,
      chat_id,
      tz: process.env.DEFAULT_TZ || "America/Bogota",
      provider,
      provider_user_id: user_id,
    });

    // Usar tz guardada del usuario para el día lógico
    const u = await this.repo.getUserById(user_id);
    const tz = u?.tz || process.env.DEFAULT_TZ || "America/Bogota";
    const ymd = localDateStr(ts, tz);

    // Detectar /start (por entities o texto)
    const hasStartEntity =
      Array.isArray(msg.entities) &&
      msg.entities.some(
        e => e.type === "bot_command" && e.offset === 0 && text.slice(e.offset, e.offset + e.length) === "/start"
      );
    const isStart = hasStartEntity || text === "/start";

    if (isStart) {
      await this.service.startCycle(user_id, chat_id, ymd, ts, provider);
      // Persistimos el evento entrante (/start) como chat (auditoría + dedupe)
      const daily = await this.repo.getDailyByDate(user_id, ymd);
      await this.repo.insertMessage({
        daily_id: daily ? daily.id : null,
        user_id,
        chat_id,
        provider,
        text,
        ts,
        type: "chat",
        message_id: Number(msg.message_id),
        update_id,
      });
      return;
    }

    // Clasificar por estado actual del daily
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
      case "pending_morning":  kind = "morning";  break;
      case "pending_update":   kind = "update";   break;
      case "needs_followup":   kind = "followup"; break;
      default:                 kind = "chat";
    }

    await this.service.handle(
      {
        user_id,
        chat_id,
        text,
        ts,
        type: kind,
        message_id: Number(msg.message_id),
        update_id,
        provider,
        daily_id_hint: daily.id,
      },
      ymd
    );
  }
}
