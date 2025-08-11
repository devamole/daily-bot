import { DailyService } from "../../../core/daily/DailyService";
import { NormalizedUpdate } from "../../../core/types/NormalizedUpdate";

type TgUser = { id: number; is_bot?: boolean; first_name?: string; language_code?: string };
type TgChat = { id: number; type: string };
type TgMessage = { message_id: number; from: TgUser; chat: TgChat; date: number; text?: string };
type TgUpdate = { update_id: number; message?: TgMessage };

export class TelegramAdapter {
  constructor(private readonly service: DailyService) {}

  async handleUpdate(update: TgUpdate): Promise<void> {
    const msg = update?.message;
    if (!msg || !msg.from || !msg.chat) return;

    const text = msg.text ?? '';
    const isStart = text.startsWith('/start');

    const norm: NormalizedUpdate = {
      provider: 'telegram',
      event_id: String(update.update_id),
      ts: Number(msg.date) || Math.floor(Date.now() / 1000),
      user: { id: String(msg.from.id) },
      chat: { id: String(msg.chat.id) },
      type: isStart ? 'command' : 'message',
      command: isStart ? 'start' : undefined,
      text
    };

    await this.service.handle(norm);
  }
}