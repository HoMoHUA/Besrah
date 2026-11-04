// Coordinate input for place search: lets a user paste "36.29, 59.59" or a map share link instead of relying on a
// multi-result place search. Pure and offline. It only reads numbers the user typed; it never guesses a place name.
import type { LatLon } from './neshan.js';

export type CoordinateParse =
  | { kind: 'none' }
  | { kind: 'point'; point: LatLon; swapped: boolean }
  | { kind: 'invalid' };

const DIGITS: Record<string, string> = {
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};
const ascii = (s: string): string => s.replace(/[۰-۹٠-٩]/g, d => DIGITS[d] ?? d).replace(/٫/g, '.').replace(/[،٬]/g, ',');

// Mashhad sits around 36.3N 59.6E; latitude and longitude ranges never overlap there, so a swapped pair is unambiguous.
const looksLat = (n: number) => n >= 35 && n <= 37.5;
const looksLon = (n: number) => n >= 58 && n <= 61;

const NUM = String.raw`(-?\d{1,3}(?:\.\d+)?)`;
const PATTERNS: RegExp[] = [
  new RegExp(String.raw`^geo:${NUM},${NUM}`, 'i'),                       // geo:36.3,59.6
  new RegExp(String.raw`@${NUM},${NUM}`),                                // .../@36.3,59.6,15z (Google, Neshan, OSM style)
  new RegExp(String.raw`[?&#](?:q|query|ll|center|destination|origin)=${NUM}(?:,|%2C)\s*${NUM}`, 'i'),
  new RegExp(String.raw`[?&#]lat=${NUM}&(?:lng|lon)=${NUM}`, 'i'),
  new RegExp(String.raw`#map=\d{1,2}/${NUM}/${NUM}`),                     // openstreetmap.org/#map=15/36.3/59.6
  new RegExp(String.raw`^${NUM}\s*[,\s]\s*${NUM}$`),                     // bare pair
];

/** Detects a coordinate pair or a map link with one. Returns `none` for ordinary text so the caller can search names. */
export function parseCoordinates(input: string): CoordinateParse {
  const s = ascii(input.trim());
  if (!/\d/.test(s)) return { kind: 'none' };
  for (const re of PATTERNS) {
    const m = re.exec(s);
    if (!m) continue;
    const a = Number(m[1]), b = Number(m[2]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) return { kind: 'invalid' };
    // Require some precision: "36, 59" is a whole-degree guess, not a place (about 100 km wide).
    const decimals = (n: string) => (n.split('.')[1] ?? '').length;
    if (decimals(m[1]!) < 3 || decimals(m[2]!) < 3) return { kind: 'invalid' };
    const r = (n: number) => Math.round(n * 1e5) / 1e5;
    if (looksLon(a) && looksLat(b)) return { kind: 'point', point: { lat: r(b), lon: r(a) }, swapped: true };
    return { kind: 'point', point: { lat: r(a), lon: r(b) }, swapped: false };
  }
  // Two or more numbers with a decimal point and nothing else that names a place: the user meant coordinates.
  return /^[\s\d.,+-]+$/.test(s) && /\d\.\d/.test(s) ? { kind: 'invalid' } : { kind: 'none' };
}
