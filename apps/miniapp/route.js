// Route helpers. `order` is one line's station order from the API (line1Order: Vakilabad -> airport, line2Order: Tabarsi -> Fakouri); it is a diagram, not a map.
import { fa } from './format.js';

const terminalOf = (i, total) => (i === 0 ? 'first' : i === total - 1 ? 'last' : null);

export function spine(order, name, { radius = 2 } = {}) {
  const index = order.indexOf(name);
  if (index < 0) return null;
  const from = Math.max(0, index - radius), to = Math.min(order.length - 1, index + radius);
  const items = [];
  for (let i = from; i <= to; i++) items.push({ name: order[i], index: i, offset: i - index, terminal: terminalOf(i, order.length) });
  return { index, total: order.length, items, hasBefore: from > 0, hasAfter: to < order.length - 1 };
}

export function neighbours(order, name) {
  const index = order.indexOf(name);
  if (index < 0) return null;
  return { prev: order[index - 1] ?? null, next: order[index + 1] ?? null };
}

export function positionLabel(order, name) {
  const index = order.indexOf(name);
  return index < 0 ? '' : `ایستگاه ${fa(index + 1)} از ${fa(order.length)}`;
}

export function routeRows(order, stations, line = 1) {
  const byName = new Map(stations.map(s => [s.name, s]));
  return order.filter(name => byName.has(name)).map((name, i, all) => ({
    name, position: order.indexOf(name) + 1, terminal: terminalOf(order.indexOf(name), order.length),
    interchange: (byName.get(name).lines ?? []).some(l => l !== line),
  }));
}
