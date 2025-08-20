// src/adapters/notifier/TelegramHttpNotifier.ts
import type { NotifierPort } from "../../core/ports/NotifierPort";

/**
 * Notificador vía Telegram Bot API (HTTP directo).
 * Implementa sendText y sendChunks (multi-mensaje, con rate-limit básico).
 */
export class TelegramHttpNotifier implements NotifierPort {
  constructor(
    private readonly token: string,
    private readonly defaultParseMode?: "Markdown" | "HTML"
  ) {
    if (!this.token) throw new Error("Telegram token required");
  }

  // ---- API core ----
  private async call(method: string, payload: Record<string, unknown>): Promise<void> {
    const url = `https://api.telegram.org/bot${this.token}/${method}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      throw new Error(`Telegram ${method} ${res.status}: ${raw.slice(0, 500)}`);
    }
  }

  // ---- NotifierPort ----

  async sendText(userId: string, text: string): Promise<void> {
    const body: Record<string, unknown> = { chat_id: userId, text };
    if (this.defaultParseMode) body.parse_mode = this.defaultParseMode;
    await this.call("sendMessage", body);
  }

  /**
   * Envía un texto largo en múltiples mensajes.
   * Firma laxa para ser compatible con el Port:
   *   - (userId, text)
   *   - (userId, text, { chunkSize?, delayMs?, parseMode? })
   */
  async sendChunks(...args: any[]): Promise<void> {
    const userId: string = args[0];
    const text: string = args[1] ?? "";
    const opts: { chunkSize?: number; delayMs?: number; parseMode?: "Markdown" | "HTML" } =
      (args[2] ?? {}) as any;

    const max = Math.max(128, Math.min(4096, opts.chunkSize ?? 3500)); // seguro para Telegram
    const delayMs = Math.max(0, Math.min(10_000, opts.delayMs ?? 500));
    const parseMode = opts.parseMode ?? this.defaultParseMode;

    const chunks = splitForTelegram(text, max);
    for (const part of chunks) {
      const body: Record<string, unknown> = { chat_id: userId, text: part };
      if (parseMode) body.parse_mode = parseMode;
      await this.call("sendMessage", body);
      if (delayMs > 0) await sleep(delayMs);
    }
  }
}

// ---------- helpers ----------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Divide texto respetando límites y cortes “amables”.
 * Prioriza doble salto de línea, luego salto de línea, luego espacios; si no, corta duro.
 */
function splitForTelegram(text: string, max: number): string[] {
  if (!text || text.length <= max) return [text];

  const out: string[] = [];
  let rest = text;

  while (rest.length > max) {
    // intenta cortes agradables en ventana [0, max]
    const window = rest.slice(0, max);

    let cut =
      window.lastIndexOf("\n\n") >= max * 0.6
        ? window.lastIndexOf("\n\n")
        : window.lastIndexOf("\n") >= max * 0.6
        ? window.lastIndexOf("\n")
        : window.lastIndexOf(" ") >= max * 0.6
        ? window.lastIndexOf(" ")
        : -1;

    if (cut <= 0) cut = max; // corte duro como último recurso

    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }

  if (rest.length) out.push(rest);
  return out;
}

export default TelegramHttpNotifier;
