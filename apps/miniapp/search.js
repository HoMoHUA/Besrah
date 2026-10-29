// Station search: Persian-aware folding, ranking, highlight ranges and a near-miss suggestion.
import { foldWithMap, normalize } from './logic.js';
import { isSupported } from './format.js';

const PREFIX = normalize('ایستگاه');

// "ایستگاه شریعتی" and "شریعتی" mean the same thing; a bare "ایستگاه" is an empty query.
export function stripStationPrefix(query) {
  const folded = normalize(query);
  if (folded === PREFIX) return '';
  if (!folded.startsWith(PREFIX)) return String(query ?? '');
  const { map } = foldWithMap(query);
  return String(query).slice(map[PREFIX.length]);
}

// Lower is better: 0 exact, 1 name prefix, 2 word prefix, 3 substring.
function locate(folded, needle) {
  const at = folded.text.indexOf(needle);
  if (at < 0) return null;
  if (folded.text === needle) return { score: 0, at };
  if (at === 0) return { score: 1, at };
  for (let i = at; i >= 0; i = folded.text.indexOf(needle, i + 1)) {
    if (i < 0) break;
    if (folded.wordStart[i]) return { score: 2, at: i };
  }
  return { score: 3, at };
}

export function filterStations(stations, query, { limit = Infinity, order = [] } = {}) {
  const needle = normalize(stripStationPrefix(query));
  const rank = station => {
    const i = order.indexOf(station.name);
    return i >= 0 ? i : order.length + 1;
  };
  const supported = station => (isSupported(station) ? 0 : 1);
  const hits = [];
  for (const station of stations) {
    if (!needle) { hits.push({ station, score: 0, ranges: [] }); continue; }
    const folded = foldWithMap(station.name);
    const found = locate(folded, needle);
    if (!found) continue;
    const start = folded.map[found.at];
    const end = folded.map[found.at + needle.length - 1] + 1;
    hits.push({ station, score: found.score, ranges: [[start, end]] });
  }
  hits.sort((a, b) => a.score - b.score || supported(a.station) - supported(b.station)
    || rank(a.station) - rank(b.station) || a.station.name.localeCompare(b.station.name, 'fa'));
  return hits.slice(0, limit);
}

export function highlightParts(name, ranges) {
  const parts = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) parts.push({ text: name.slice(cursor, start), mark: false });
    parts.push({ text: name.slice(start, end), mark: true });
    cursor = end;
  }
  if (cursor < name.length) parts.push({ text: name.slice(cursor), mark: false });
  return parts.length ? parts : [{ text: name, mark: false }];
}

function distance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

// "منظورتان … بود؟" — only for near misses (about one slip per four letters).
export function didYouMean(stations, query) {
  const needle = normalize(stripStationPrefix(query));
  if (needle.length < 3) return null;
  const allowed = Math.max(1, Math.floor(needle.length / 4));
  let best = null;
  for (const station of stations) {
    const folded = normalize(station.name);
    const d = Math.min(distance(needle, folded), ...folded.length > needle.length ? [distance(needle, folded.slice(0, needle.length))] : []);
    if (d <= allowed && (!best || d < best.d)) best = { station, d };
  }
  return best ? best.station : null;
}
