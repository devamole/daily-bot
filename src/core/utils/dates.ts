// src/core/utils/dates.ts
// Utilidades robustas de tiempo/TZ para cron.

export type NowParts = {
  ymd: string;    // "YYYY-MM-DD" en TZ del usuario
  hour: number;   // 0..23 en TZ del usuario
  minute: number; // 0..59 en TZ del usuario
  epoch: number;  // epoch seconds UTC (del servidor)
};

export function nowEpochSec(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Retorna partes de "ahora" en la TZ dada, de forma determinista.
 * Usamos toLocaleString('sv-SE') que siempre formatea "YYYY-MM-DD HH:mm:ss".
 */
export function nowPartsInTz(timeZone: string): NowParts {
  const now = new Date();

  const local = now.toLocaleString("sv-SE", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  // Ej: "2025-08-24 08:03:12"
  const [datePart, timePart] = local.split(" ");
  if (!datePart || !timePart) {
    throw new Error(`nowPartsInTz(): formato inesperado para TZ=${timeZone}: "${local}"`);
  }

  const [yyyy, mm, dd] = datePart.split("-");
  const [HH, MM] = timePart.split(":"); // ignoramos segundos

  const ymd = `${yyyy}-${mm}-${dd}`;
  const hour = Number(HH);
  const minute = Number(MM);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    throw new Error(`nowPartsInTz(): hora/minuto inválidos para TZ=${timeZone}: "${local}"`);
  }

  return { ymd, hour, minute, epoch: nowEpochSec() };
}

/**
 * Devuelve true si (hour:minute) está dentro de ±windowMin del target (targetH:targetM).
 * - Maneja wrap-around de medianoche.
 * - Borde superior INCLUSIVO (<=), para tolerar jitter.
 */
export function isWithinMinuteWindow(
  hour: number,
  minute: number,
  targetHour: number,
  targetMinute: number,
  windowMinutes: number
): boolean {
  const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
  hour = clamp(Math.floor(hour), 0, 23);
  minute = clamp(Math.floor(minute), 0, 59);
  targetHour = clamp(Math.floor(targetHour), 0, 23);
  targetMinute = clamp(Math.floor(targetMinute), 0, 59);
  windowMinutes = Math.max(0, Math.floor(windowMinutes));

  const cur = hour * 60 + minute;
  const tgt = targetHour * 60 + targetMinute;

  const diff = Math.abs(cur - tgt);
  const minDiff = Math.min(diff, 1440 - diff); // wrap-around

  return minDiff <= windowMinutes; // inclusivo
}

export function localDateStr(epochSec: number, tz: string): string {
  const d = new Date(epochSec * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function dayRangeEpoch(epochSec: number, tz: string): [number, number] {
  const d = new Date(epochSec * 1000);
  const tzDate = new Date(d.toLocaleString("en-US", { timeZone: tz }));
  const startLocal = new Date(tzDate.getFullYear(), tzDate.getMonth(), tzDate.getDate(), 0, 0, 0, 0);
  const endLocal = new Date(tzDate.getFullYear(), tzDate.getMonth(), tzDate.getDate(), 23, 59, 59, 999);
  const offset = d.getTime() - tzDate.getTime();
  const start = Math.floor((startLocal.getTime() + offset) / 1000);
  const end = Math.floor((endLocal.getTime() + offset) / 1000);
  return [start, end];
}
