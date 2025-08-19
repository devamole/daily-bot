

export function dayRangeEpoch(epochSec: number, tz: string): [number, number] {
  const d = new Date(epochSec * 1000);
  // Hora "equivalente" en la TZ destino
  const tzDate = new Date(d.toLocaleString('en-US', { timeZone: tz }));
  const startLocal = new Date(tzDate.getFullYear(), tzDate.getMonth(), tzDate.getDate(), 0, 0, 0, 0);
  const endLocal   = new Date(tzDate.getFullYear(), tzDate.getMonth(), tzDate.getDate(), 23, 59, 59, 999);
  // offset entre UTC y la hora en tz para ese instante
  const offset = d.getTime() - tzDate.getTime();
  const start = Math.floor((startLocal.getTime() + offset) / 1000);
  const end   = Math.floor((endLocal.getTime()   + offset) / 1000);
  return [start, end];
}

export function nowEpochSec(): number {
  return Math.floor(Date.now() / 1000);
}

export function localDateStr(epochSec: number, tz: string): string {
  const d = new Date(epochSec * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(d);
}

export function nowPartsInTz(tz: string): { hour: number; minute: number; ymd: string; epoch: number } {
  const epoch = nowEpochSec();
  const d = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(d);

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(d);

  return { hour, minute, ymd, epoch };
}

export function isWithinMinuteWindow(
  hour: number,
  minute: number,
  targetHour: number,
  targetMinute: number,
  windowMinutes: number
): boolean {
  const cur = hour * 60 + minute;
  const tgt = targetHour * 60 + targetMinute;
  return cur >= tgt && cur < tgt + windowMinutes;
}
