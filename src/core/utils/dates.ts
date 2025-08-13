export function localDateStr(epochSec: number | undefined, tz: string): string {
  const ms = (epochSec ?? Math.floor(Date.now() / 1000)) * 1000;
  const d = new Date(ms);
  // 'en-CA' => YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

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