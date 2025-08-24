// src/cron/cronService.ts
import { RepoPort } from "../core/ports/RepoPort";
import { NotifierPort } from "../core/ports/NotifierPort";
import { nowPartsInTz, isWithinMinuteWindow } from "../core/utils/dates";
import { messages } from "../core/daily/messages";

export type CronOptions = {
  /** Hora local para el prompt de la mañana (0-23). Default: 8 */
  morningHour?: number;
  /** Minuto local para el prompt de la mañana (0-59). Default: 0 */
  morningMinute?: number;
  /** Hora local para el prompt de la tarde (0-23). Default: 18 */
  eveningHour?: number;
  /** Minuto local para el prompt de la tarde (0-59). Default: 0 */
  eveningMinute?: number;
  /** Ventana en minutos para considerar que “estamos en la franja”. Default: 10 */
  windowMinutes?: number;

  /**
   * (Temporal) Re-enviar morning cada N minutos mientras el daily siga en 'pending_morning'
   * y estemos dentro de la ventana de la mañana. No afecta a la tarde.
   * Ej: 5 → reenvío cada 5 min.
   */
  repeatMorningEveryMinutes?: number;
};

/**
 * Servicio de cron:
 * - Modo normal: envía mensajes en ventanas locales 08:00/18:00 por usuario (idempotente con locks).
 * - Modo debug (CRON_DEBUG_FORCE): envía cada 5 min sin bloquearse por locks ni ventanas.
 * - Si 'repeatMorningEveryMinutes' > 0: dentro de la ventana de mañana, re-envía cada N minutos
 *   mientras el daily esté en 'pending_morning' (sin cambiar esquema).
 */
export class CronService {
  constructor(
    private readonly repo: RepoPort,
    private readonly notifier: NotifierPort,
    private readonly opts: CronOptions = {}
  ) {}

  /**
   * Ejecuta un tick de cron.
   * @returns conteo de mensajes enviados por tipo.
   */
  async tick(): Promise<{ morning: number; evening: number }> {
    const MORNING_H = this.opts.morningHour ?? 8;
    const MORNING_M = this.opts.morningMinute ?? 0;
    const EVENING_H = this.opts.eveningHour ?? 18;
    const EVENING_M = this.opts.eveningMinute ?? 0;
    const WINDOW = this.opts.windowMinutes ?? 10;

    // Activación opcional de reenvíos en morning (flujo normal)
    const repeatMorningEvery =
      typeof this.opts.repeatMorningEveryMinutes === "number" &&
      isFinite(this.opts.repeatMorningEveryMinutes) &&
      this.opts.repeatMorningEveryMinutes > 0
        ? Math.floor(this.opts.repeatMorningEveryMinutes)
        : undefined;

    let morningCount = 0;
    let eveningCount = 0;

    // =======================
    // MODO DEBUG (opcional)
    // =======================
    // Activa envíos cada 5 minutos ignorando ventanas/locks.
    // Variables:
    //   CRON_DEBUG_FORCE = 'morning' | 'evening' | 'both'
    //   CRON_DEBUG_USER  = '<user_id>'  (opcional: filtra a un solo usuario)
    //   CRON_DEBUG_LIMIT = 'N'          (opcional: limita nº de usuarios a enviar)
    const debugMode = (process.env.CRON_DEBUG_FORCE ?? "").toLowerCase().trim();
    if (debugMode === "morning" || debugMode === "evening" || debugMode === "both") {
      const users = await this.repo.getAllUsers();
      if (users.length === 0) return { morning: 0, evening: 0 };

      const onlyUser = (process.env.CRON_DEBUG_USER ?? "").trim();
      const limitRaw = (process.env.CRON_DEBUG_LIMIT ?? "").trim();
      const limit = Number.isFinite(Number(limitRaw)) && Number(limitRaw) > 0 ? Number(limitRaw) : undefined;

      const target = users
        .filter(u => (onlyUser ? u.user_id === onlyUser : true))
        .slice(0, limit ?? users.length);

      for (const u of target) {
        // En debug se añade un sufijo visible
        if (debugMode === "morning" || debugMode === "both") {
          await safeSend(this.notifier, u.user_id, `${messages.morning}\n\n_(debug every 5m)_`);
          morningCount++;
        }
        if (debugMode === "evening" || debugMode === "both") {
          await safeSend(this.notifier, u.user_id, `${messages.evening}\n\n_(debug every 5m)_`);
          eveningCount++;
        }
      }
      return { morning: morningCount, evening: eveningCount };
    }
    // ===== FIN MODO DEBUG =====

    // =======================
    // MODO NORMAL (producción)
    // =======================
    const users = await this.repo.getAllUsers();
    if (users.length === 0) return { morning: 0, evening: 0 };

    for (const u of users) {
      const tz = u.tz || "America/Bogota";
      const { hour, minute, ymd, epoch } = nowPartsInTz(tz);

      // --- Ventana de MAÑANA ---
      if (isWithinMinuteWindow(hour, minute, MORNING_H, MORNING_M, WINDOW)) {
        const daily =
          (await this.repo.getDailyByDate(u.user_id, ymd)) ||
          (await (async () => {
            const id = await this.repo.createDaily(u.user_id, ymd, "pending_morning");
            return { id, user_id: u.user_id, date: ymd, state: "pending_morning" as const };
          })());

        if (daily.state === "pending_morning") {
          if (repeatMorningEvery) {
            // Camino A (preferido): usa método del repo si existe (persistente y espaciado por N min)
            const maybeRefresh = (this.repo as any).maybeRefreshMorningPrompt as
              | ((dailyId: number, epoch: number, minIntervalSec: number) => Promise<boolean>)
              | undefined;

            if (typeof maybeRefresh === "function") {
              const ok = await maybeRefresh(daily.id, epoch, repeatMorningEvery * 60);
              if (ok) {
                await safeSend(this.notifier, u.user_id, messages.morning);
                morningCount++;
              }
            } else {
              // Camino B (fallback sin tocar repo): filtra por minuto; no persiste último envío.
              // Enviará a los minutos 0,5,10,... dentro de la ventana.
              if ((hour * 60 + minute) % repeatMorningEvery === 0) {
                await safeSend(this.notifier, u.user_id, messages.morning);
                morningCount++;
              }
            }
          } else {
            // One-shot tradicional (idempotente con lock DB)
            if (await this.repo.claimMorningPrompt(daily.id, epoch)) {
              await safeSend(this.notifier, u.user_id, messages.morning);
              morningCount++;
            }
          }
        }
      }

      // --- Ventana de TARDE ---
      if (isWithinMinuteWindow(hour, minute, EVENING_H, EVENING_M, WINDOW)) {
        const daily = await this.repo.getDailyByDate(u.user_id, ymd);
        // Solo recordamos si hubo plan (estado pending_update)
        if (daily && daily.state === "pending_update") {
          if (await this.repo.claimEveningPrompt(daily.id, epoch)) {
            await safeSend(this.notifier, u.user_id, messages.evening);
            eveningCount++;
          }
        }
      }
    }

    return { morning: morningCount, evening: eveningCount };
  }
}

/* ===================== *
 * utilidades internas   *
 * ===================== */

async function safeSend(notifier: NotifierPort, userId: string, text: string): Promise<void> {
  try {
    await notifier.sendText(userId, text);
  } catch (e) {
    // Log no bloqueante para que no afecte al resto de usuarios
    console.error("[CronService] Error enviando notificación:", { userId, err: (e as Error).message });
  }
}
