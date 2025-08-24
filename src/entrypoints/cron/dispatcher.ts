// src/entrypoints/cron/dispatcher.ts
import { migrateOnce } from "../../db/migrate";
import { db } from "../../db/db";
import { TursoRepo } from "../../adapters/repo/TursoRepo";
import { TelegramHttpNotifier } from "../../adapters/notifier/TelegramHttpNotifier";
import { CronService } from "../../cron/cronService";

/**
 * Ejecuta un tick del cron.
 * Este entrypoint es invocado por tu endpoint /api/cron.dispatcher ó por GH Actions.
 */
export default async function dispatcher(): Promise<{ morning: number; evening: number }> {
  await migrateOnce();

  const repo = new TursoRepo(db); // <-- requiere 1 argumento
  const token = process.env.TG_TOKEN || "";
  if (!token) throw new Error("TG_TOKEN is required");
  const notifier = new TelegramHttpNotifier(token);

  const cron = new CronService(repo, notifier, {
    morningHour: 8,
    morningMinute: 0,
    eveningHour: 18,
    eveningMinute: 0,
    windowMinutes: Number(process.env.CRON_WINDOW_MIN || 10),
    repeatMorningEveryMinutes: 5
  });

  return await cron.tick();
}
