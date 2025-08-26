import type { RepoPort } from "../../../core/ports/RepoPort";
import { DailyService } from "../../../core/daily/DailyService";

/**
 * Adapter de Telegram:
 * - Normaliza el update de Telegram.
 * - Infere el tipo de mensaje ('morning' | 'update' | 'chat') en base al estado diario.
 * - Llama a DailyService.handle(msg, ymd).
 */
export class TelegramAdapter {
  constructor(
    private readonly repo: RepoPort,
    private readonly service: DailyService
  ) {}

  async handleUpdate(update: any): Promise<void> {
    const msg = update?.message ?? update?.edited_message;
    console.log('Telegram update:', msg); // loguea solo los primeros 200 chars
    if (!msg) return;

    const user_id = String(msg.from?.id ?? "");
    const chat_id = String(msg.chat?.id ?? "");
    const text = String(msg.text ?? "");
    const ts = Number(msg.date ?? Math.floor(Date.now() / 1000));
    if (!user_id || !chat_id) return;
    console.log(`Telegram message from user ${user_id} in chat ${chat_id}:`, text.slice(0, 200));
    // yyyy-mm-dd en UTC (si quieres TZ real del user, consulta repo antes)
    const ymd = new Date(ts * 1000).toISOString().slice(0, 10);

    let type: "morning" | "update" | "chat" = "chat";

    if (text.trim() === "/start") {
      type = "morning";
    } else {
      // Inferir en base al estado actual del día:
      const daily = await this.repo.getDailyByDate(user_id, ymd);
      if (!daily || daily.state === "pending_morning") {
        type = "morning";
      } else if (daily.state === "pending_update" || daily.state === "needs_followup") {
        type = "update";
      } else {
        type = "chat";
      }
    }
    const rawMsgId = msg.message_id;
    console.log(`Inferred message type: ${type} (daily state: ${  text})`)
    await this.service.handle(
      {
        user_id,
        chat_id,
        text,
        ts,
        type,
         ...(rawMsgId != null ? { message_id: Number(rawMsgId) } : {})
      },
      ymd
    );
  }
}

export default TelegramAdapter;
