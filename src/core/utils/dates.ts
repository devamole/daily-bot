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