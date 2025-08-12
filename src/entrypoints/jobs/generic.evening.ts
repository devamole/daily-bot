import { db } from '../../db/db';
import { messages } from '../../core/daily/messages';
import { TelegramNotifier } from '../../adapters/channel/telegram/TelegramNotifier';

const notifier = new TelegramNotifier(process.env.TELEGRAM_TOKEN || '');
const defaultTz = process.env.DEFAULT_TZ || 'America/Bogota';

function todayStr(tz: string): string {
  const d = new Date();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

export async function runEveningJob(): Promise<void> {
  const today = todayStr(defaultTz);

  const result = await db.execute({
    sql: `SELECT DISTINCT user_id FROM daily_status WHERE date = ? AND state = 'pending_update'`,
    args: [today]
  });

  // Evita casteos incompatibles: itera como unknown y extrae user_id con runtime checks
  const rows = (result.rows as unknown[]) || [];
  for (const row of rows) {
    const userIdVal = (row as Record<string, unknown>)?.user_id;
    if (userIdVal == null) continue;
    const userId = String(userIdVal);
    if (!userId) continue;

    await notifier.sendText(userId, messages.evening);
  }
}
