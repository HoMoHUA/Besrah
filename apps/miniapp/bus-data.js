// Pure helpers over the reviewed static bus guide (OSM snapshot). No live data, no coordinates.
import { normalize } from './logic.js';

const STOP_PREFIX = normalize('ایستگاه');

export function formatLineLabel(ref) {
  if (!ref) return '';
  const m = /^EXP-(\d+)$/i.exec(ref);
  if (m) return `${m[1]} تندرو`;
  return ref;
}

export function formatLineTitle(ref) {
  if (!ref) return '';
  const m = /^EXP-(\d+)$/i.exec(ref);
  if (m) return `خط ${m[1]} تندرو`;
  return `خط ${ref}`;
}

const naturalKey = ref => {
  const expMatch = /^EXP-(\d+)$/i.exec(ref);
  if (expMatch) return [0, Number(expMatch[1]), ref];
  const m = /^\d+/.exec(ref);
  return m ? [0, Number(m[0]), ref] : [1, 0, ref];
};
export const compareRefs = (a, b) => { const x = naturalKey(a), y = naturalKey(b); return x[0] - y[0] || x[1] - y[1] || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0); };

export function loopVariant(variant) {
  const { stops } = variant;
  return stops.length > 2 && stops[0] === stops[stops.length - 1];
}

export function buildIndex(data) {
  const names = data.n;
  const lines = data.l.map(line => {
    const isExpress = /^EXP-\d+$/i.test(line.r);
    const label = formatLineLabel(line.r);
    const title = formatLineTitle(line.r);
    return {
      ref: line.r,
      label,
      title,
      isExpress,
      key: normalize(line.r),
      searchKeys: [normalize(line.r), normalize(label), normalize(title)],
      variants: line.v.map(v => ({ id: v.i, from: v.f, to: v.t, derived: Boolean(v.d), stops: v.s.map(i => names[i]),
        fromKey: normalize(v.f), toKey: normalize(v.t) })),
    };
  });
  const byName = new Map();
  for (const line of lines) for (const variant of line.variants) for (const name of new Set(variant.stops)) {
    if (!byName.has(name)) byName.set(name, new Set());
    byName.get(name).add(line.ref);
  }
  const stops = [...byName].map(([name, refs]) => {
    const key = normalize(name);
    return { name, key, short: key.startsWith(STOP_PREFIX) ? key.slice(STOP_PREFIX.length) : key, refs: [...refs].sort(compareRefs) };
  });
  lines.sort((a, b) => compareRefs(a.ref, b.ref));
  return { lines, stops, byRef: new Map(lines.map(l => [l.ref, l])), meta: data.meta ?? {} };
}

// Exact ref first, then ref prefix/substring, then endpoint names.
export function searchLines(index, query) {
  const q = normalize(query ?? '');
  if (!q) return [...index.lines];
  const ranked = [];
  for (const line of index.lines) {
    const isExact = line.searchKeys.some(k => k === q);
    const isPrefix = line.searchKeys.some(k => k.startsWith(q));
    const isSub = line.searchKeys.some(k => k.includes(q));
    let rank = isExact ? 0 : isPrefix ? 1 : isSub ? 2
      : line.variants.some(v => v.fromKey.includes(q) || v.toKey.includes(q)) ? 3 : -1;
    if (rank >= 0) ranked.push([rank, line]);
  }
  return ranked.sort((a, b) => a[0] - b[0] || compareRefs(a[1].ref, b[1].ref)).map(r => r[1]);
}

export function searchStops(index, query, limit = 12) {
  const q = normalize(query ?? '');
  if (q.length < 2) return [];
  const ranked = [];
  for (const stop of index.stops) {
    const rank = stop.short.startsWith(q) ? 0 : stop.key.includes(q) ? 1 : -1;
    if (rank >= 0) ranked.push([rank, stop]);
  }
  return ranked.sort((a, b) => a[0] - b[0] || (a[1].key < b[1].key ? -1 : 1)).slice(0, limit).map(r => r[1]);
}
