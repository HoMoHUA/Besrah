// All domain times are epoch seconds. Iran has no DST (UTC+03:30 fixed), but we still
// go through Intl with Asia/Tehran so the day type is never computed from server time.

export const TEHRAN_TZ = 'Asia/Tehran';
const TEHRAN_OFFSET_S = 3.5 * 3600;

export type DayType = 'friday' | 'thursday' | 'normal';

/** "2026-10-16" + "13:59:51" (Tehran local) -> epoch seconds */
export function tehranToEpoch(day: string, hms: string): number {
  const [y, m, d] = day.split('-').map(Number);
  const [h, mi, s = 0] = hms.split(':').map(Number);
  return Date.UTC(y, m - 1, d, h, mi, s) / 1000 - TEHRAN_OFFSET_S;
}

/** epoch seconds -> "HH:MM:SS" in Tehran */
export function epochToTehranHms(epoch: number): string {
  const p = tehranParts(epoch);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

// Constructing an Intl.DateTimeFormat is expensive and it is stateless once built: create it once.
const TEHRAN_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: TEHRAN_TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  weekday: 'short', hourCycle: 'h23',
});

export function tehranParts(epoch: number) {
  const parts = Object.fromEntries(TEHRAN_FORMAT.formatToParts(new Date(epoch * 1000)).map(p => [p.type, p.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
    weekday: parts.weekday as string, // 'Fri', 'Thu', ...
  };
}

export function tehranDay(epoch: number): string {
  const p = tehranParts(epoch);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Friday -> friday; Thursday -> thursday; everything else is a normal (Sat-Wed) day. Holidays not yet handled. */
export function dayTypeOf(epoch: number, holidays: ReadonlySet<string> = new Set()): DayType {
  const p = tehranParts(epoch);
  if (holidays.has(tehranDay(epoch))) return 'friday';
  if (p.weekday === 'Fri') return 'friday';
  if (p.weekday === 'Thu') return 'thursday';
  return 'normal';
}
