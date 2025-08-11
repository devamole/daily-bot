import { db } from "../../db/db";
import { messages } from "../../core/daily/messages";
import { TelegramNotifier } from "../../adapters/channel/telegram/TelegramNotifier";

const notifier = new TelegramNotifier(process.env.TELEGRAM_TOKEN || '');
const defaultTz = process.env.DEFAULT_TZ || 'America/Bogota';

function todayStr(tz: string): string {
  const d = new Date();
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export async function runEveningJob(): Promise<void> {
  const today = todayStr(defaultTz);

  // Simplificado: usa DEFAULT_TZ; si manejas TZ por usuario, evoluciona a una selección por usuario
  const { rows } = await db.execute({
    sql: `SELECT DISTINCT user_id FROM daily_status WHERE date = ? AND state = 'pending_update'`,
    args: [today]
  });

  for (const r of rows as Array<{ user_id: string }>) {
    await notifier.sendText(r.user_id, messages.evening);
  }
}