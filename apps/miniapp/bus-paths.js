// Static, strictly direction-aware bus discovery over Besrah's existing reviewed OSM guide.
// It is NEVER a timetable, GPS tracker, proof of active service, or "fastest" ranking.
// A shared NAME is not proof of a shared physical transfer platform.
import { normalize } from './logic.js';

const MAX_RESULTS = 3;
const MAX_VARIANTS = 800;
const MAX_STOPS_PER_VARIANT = 180;
const MAX_TRANSFER_VARIANTS_PER_STOP = 24;

const positionsAfter = (stops, needle, start = -1) => {
  const positions = [];
  for (let i = start + 1; i < stops.length; i++) if (stops[i] === needle) positions.push(i);
  return positions;
};
const exactName = (index, text) => {
  const key = normalize(text ?? '');
  if (!key || key.length > 100) return null;
  const matches = index.stops.filter(s => s.key === key);
  return matches.length === 1 ? matches[0].name : null;
};
const leg = (row, from, to, count) => ({
  ref: row.ref, label: row.label, variantId: row.variant.id,
  from, to, stopCount: count,
});
const rowsOf = index => index.lines.flatMap(line => line.variants
  .filter(v => Array.isArray(v.stops) && v.stops.length > 1 && v.stops.length <= MAX_STOPS_PER_VARIANT)
  .map(variant => ({ ref: line.ref, label: line.label, variant })));

export function findBusConnections(index, rawFrom, rawTo, { maxResults = MAX_RESULTS } = {}) {
  if (!index || !Array.isArray(index.lines) || !Array.isArray(index.stops)) return [];
  const from = exactName(index, rawFrom), to = exactName(index, rawTo);
  if (!from || !to || from === to || !Number.isInteger(maxResults) || maxResults < 1 || maxResults > MAX_RESULTS) return [];
  const all = rowsOf(index);
  if (all.length > MAX_VARIANTS) return []; // Bounded work for unexpected catalog.
  const candidates = [];
  const fromRoutes = [], toRoutes = [];
  for (const row of all) {
    const stops = row.variant.stops;
    const o = positionsAfter(stops, from), d = positionsAfter(stops, to);
    if (o.length) fromRoutes.push({ row, origins: o });
    if (d.length) toRoutes.push({ row, destinations: d });
    if (!o.length || !d.length) continue;
    for (const i of o) for (const j of d) {
      if (j <= i) continue;
      candidates.push({ type: 'direct', transfer: null, stopCount: j - i, legs: [leg(row, from, to, j - i)] });
    }
  }

  // One interchange at most. Require stops in forward source order on BOTH
  // variants. Same-named transfers remain unverified until platform geometry
  // and operator route identity are checked.
  const destinationByStop = new Map();
  for (const { row, destinations } of toRoutes) {
    const stops = row.variant.stops;
    for (const j of destinations) for (let k = 0; k < j; k++) {
      const stop = stops[k];
      if (stop === from || stop === to) continue;
      const arr = destinationByStop.get(stop) ?? [];
      if (arr.length < MAX_TRANSFER_VARIANTS_PER_STOP) arr.push({ row, k, j });
      destinationByStop.set(stop, arr);
    }
  }
  for (const { row: first, origins } of fromRoutes) for (const i of origins) {
    const stops = first.variant.stops;
    for (let k = i + 1; k < stops.length; k++) {
      const stop = stops[k];
      if (stop === from || stop === to) continue;
      for (const next of destinationByStop.get(stop) ?? []) {
        if (next.row.ref === first.ref) continue; // Changing vehicles on the same line isn't established.
        candidates.push({ type: 'transfer', transfer: stop, stopCount: (k - i) + (next.j - next.k),
          legs: [leg(first, from, stop, k - i), leg(next.row, stop, to, next.j - next.k)] });
      }
    }
  }
  // Rank solely by number of changes and OSM stop occurrences, not minutes.
  // One direction variant may repeat stop names (loops); retain the least-
  // stops candidate for each identical pattern, without claiming travel time.
  candidates.sort((a, b) => a.legs.length - b.legs.length || a.stopCount - b.stopCount ||
    a.legs.map(l => l.ref + ':' + l.variantId).join('|').localeCompare(b.legs.map(l => l.ref + ':' + l.variantId).join('|')));
  const seen = new Set(), out = [];
  for (const value of candidates) {
    const key = JSON.stringify(value.legs.map(l => [l.ref, l.variantId, l.from, l.to]));
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...value, durationS: null, waitS: null, fareToman: null,
      verified: false, source: 'osm_unverified_directional_stop_sequence',
      warning: value.type === 'transfer'
        ? 'هم‌نام بودن ایستگاه تعویض، اتصال واقعی سکوها یا جهت حرکت را تأیید نمی‌کند.'
        : 'ترتیب ایستگاه‌ها از OSM است؛ خدمت فعال و زمان‌بندی تأیید نشده‌اند.' });
    if (out.length >= maxResults) break;
  }
  return out;
}
