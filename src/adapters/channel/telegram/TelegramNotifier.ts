import { NotifierPort, SendTextOptions } from "../../../core/ports/NotifierPort";

export class TelegramNotifier extends NotifierPort {
  private readonly base: string;

  constructor(token: string) {
    super();
    if (!token) throw new Error('TELEGRAM_TOKEN ausente');
    this.base = `https://api.telegram.org/bot${token}`;
  }

  async sendText(userId: string, text: string, opts: SendTextOptions = {}): Promise<void> {
    const parseMode = opts.parseMode && opts.parseMode !== 'None' ? opts.parseMode : undefined;
    const body: Record<string, unknown> = {
      chat_id: userId,
      text,
      disable_web_page_preview: opts.disableWebPagePreview ?? true
    };
    if (parseMode) body.parse_mode = parseMode;
    if (opts.replyToMessageId) body.reply_to_message_id = opts.replyToMessageId;

    const r = await fetch(`${this.base}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!r.ok) {
      const t = await r.text().catch(() => '');
      // Fallback sin parse_mode por errores de marcado
      const r2 = await fetch(`${this.base}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: userId, text })
      });
      if (!r2.ok) {
        const t2 = await r2.text().catch(() => '');
        console.error('Telegram sendMessage error', r.status, t, '| fallback:', r2.status, t2);
      }
    }
  }

  async sendChunks(userId: string, text: string, opts: SendTextOptions = {}): Promise<void> {
    for (const chunk of chunk4096(text)) {
      await this.sendText(userId, chunk, opts);
      await sleep(400);
    }
  }
}

function chunk4096(s: string): string[] {
  const max = 3900; // margen por markup
  const out: string[] = [];
  for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max));
  return out;
}
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));