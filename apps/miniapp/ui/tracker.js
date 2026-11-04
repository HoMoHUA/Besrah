// Estimated train positions along a full line. The server interpolates the timetable (never GPS); between polls the
// client advances each running train at its timetable speed, frame by frame.
//
// The line is drawn as a serpentine (see line-geometry.js) with numbered pins and name labels; trains ride on the drawn
// line. A train's letter says what kind of run it is: A = out to the main terminus, B = out to the airport branch,
// C = back. The legend under the map explains them and doubles as a filter.
import { h } from './dom.js';
import { arrivalState, arrivalText, fa } from '../format.js';

// ---- serpentine geometry (kept in this file: new Mini App files must be registered in the core asset allowlist) ----
// Serpentine line layout: stations run along rows, alternating direction (the first row starts at the right, as Persian
// reads), joined by U-turns at the edges. Pure geometry, no DOM, so every number is testable.
//
// Coordinates are LTR pixels inside the map box. The drawn line is made of straight row segments plus rounded-corner
// "turn" boxes (a vertical run with a quarter circle at each end); the centre line of that drawing is exactly the path
// used to place trains, so a train never leaves the line it rides on.
export const LINE_W = 8;          // drawn thickness of the line
export const TURN_R = 18;         // radius of the centre line in a U-turn
export const SIDE = 18;           // distance of a turn's vertical run from the map edge
export const STATION_INSET = 56;  // first/last station of a row, from the map edge (room for its label next to the turn)
export const PITCH = 150;         // distance between two rows
export const TOP = 58;            // line y of the first row (room for the pins above it)
export const BOTTOM = 112;        // space under the last row (labels and the arrival chip)
export const MIN_SPACING = 70;

// Prefer a comfortable 70 px between stations; on a narrow phone (360 px wide) keep 4 per row down to 60 px rather than
// fall to 3 per row and stretch the line over eight rows.
export function perRowFor(width) {
  const avail = width - 2 * STATION_INSET;
  let n = Math.floor(avail / MIN_SPACING) + 1;
  if (n < 4 && avail / 3 >= 60) n = 4;
  return Math.max(3, Math.min(6, n));
}

const rad = d => (d * Math.PI) / 180;

export function buildSerpentine({ count, width, perRow = perRowFor(width), pitch = PITCH }) {
  const n = Math.max(0, count | 0);
  const R = TURN_R, left = SIDE, right = width - SIDE;
  const xs = STATION_INSET, xe = width - STATION_INSET;
  const spacing = perRow > 1 ? (xe - xs) / (perRow - 1) : 0;
  const rowsCount = Math.max(1, Math.ceil(n / perRow));
  const stations = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / perRow), j = i % perRow, dx = row % 2 === 0 ? -1 : 1;
    stations.push({ i, row, j, dx, x: dx < 0 ? xe - j * spacing : xs + j * spacing, y: TOP + row * pitch });
  }
  // Path primitives between consecutive stations, in order.
  const prims = [];
  const line = (x0, y0, x1, y1) => ({ kind: 'line', x0, y0, x1, y1, len: Math.hypot(x1 - x0, y1 - y0), ang: Math.atan2(y1 - y0, x1 - x0) });
  const arc = (cx, cy, a0, a1) => ({ kind: 'arc', cx, cy, a0: rad(a0), a1: rad(a1), len: (R * Math.abs(rad(a1) - rad(a0))) });
  const S = [0];
  for (let i = 0; i + 1 < n; i++) {
    const a = stations[i], b = stations[i + 1], start = prims.length;
    if (a.row === b.row) prims.push(line(a.x, a.y, b.x, b.y));
    else if (a.dx < 0) { // moving left, turn at the left edge, come back moving right
      prims.push(line(a.x, a.y, left + R, a.y), arc(left + R, a.y + R, -90, -180), line(left, a.y + R, left, b.y - R), arc(left + R, b.y - R, 180, 90), line(left + R, b.y, b.x, b.y));
    } else {
      prims.push(line(a.x, a.y, right - R, a.y), arc(right - R, a.y + R, -90, 0), line(right, a.y + R, right, b.y - R), arc(right - R, b.y - R, 0, 90), line(right - R, b.y, b.x, b.y));
    }
    S.push(S[i] + prims.slice(start).reduce((t, p) => t + p.len, 0));
  }
  const total = S[S.length - 1] ?? 0;
  // cumulative start of every primitive
  let acc = 0; for (const p of prims) { p.s = acc; acc += p.len; }

  function lengthAt(pos) {
    if (!n) return 0;
    const p = Math.min(Math.max(pos, 0), n - 1), i = Math.min(n - 2, Math.floor(p));
    if (i < 0) return 0;
    return S[i] + (p - i) * (S[i + 1] - S[i]);
  }
  function pointAt(s) {
    if (!prims.length) return stations[0] ? { x: stations[0].x, y: stations[0].y, ang: 0 } : { x: 0, y: 0, ang: 0 };
    const t = Math.min(Math.max(s, 0), total);
    let k = prims.findIndex(p => t <= p.s + p.len);
    if (k < 0) k = prims.length - 1;
    const p = prims[k], u = p.len ? (t - p.s) / p.len : 0;
    if (p.kind === 'line') return { x: p.x0 + (p.x1 - p.x0) * u, y: p.y0 + (p.y1 - p.y0) * u, ang: p.ang };
    const a = p.a0 + (p.a1 - p.a0) * u, sgn = p.a1 > p.a0 ? 1 : -1;
    return { x: p.cx + R * Math.cos(a), y: p.cy + R * Math.sin(a), ang: a + sgn * Math.PI / 2 };
  }

  // Drawn pieces: one segment per row and one U-turn box between rows.
  const rows = [], turns = [];
  for (let r = 0; r < rowsCount; r++) {
    const dx = r % 2 === 0 ? -1 : 1, y = TOP + r * pitch, first = stations[r * perRow], last = stations[Math.min(n - 1, r * perRow + perRow - 1)];
    const hasNext = r < rowsCount - 1 && stations[(r + 1) * perRow] !== undefined;
    const startX = r === 0 ? (first ? first.x - dx * 16 : xe) : (dx < 0 ? right - R : left + R);
    const endX = hasNext ? (dx < 0 ? left + R : right - R) : (last ? last.x + dx * 16 : xs);
    rows.push({ y, x1: Math.min(startX, endX), x2: Math.max(startX, endX) });
    if (hasNext) turns.push({ side: dx < 0 ? 'left' : 'right', y, h: pitch, x: dx < 0 ? left - LINE_W / 2 : right - R, w: R + LINE_W / 2 });
  }
  const height = TOP + (rowsCount - 1) * pitch + BOTTOM;
  const labelW = Math.max(46, Math.min(62, Math.floor(perRow > 1 ? spacing : 62) - 6));
  return { width, perRow, spacing, labelW, pitch, rowsCount, stations, rows, turns, total, S, height, lengthAt, pointAt };
}

// ---- tracker ----
// Positions are re-fetched quietly in the background every 3 s; a response older than STALE_MS is shown as stale.
const POLL_MS = 3000, STALE_MS = 10000, MARKER_H = 44, MARKER_GAP = 50;
const BADGE = 40, BADGE_GAP = 30, NUDGE = 17, CROSS = 40, TOUCH = 30, FALLBACK_W = 340;
export const etaText = arrivalText;
export const advance = (train, dt) => train.state === 'dwelling' ? train.pos : train.pos + train.rate * Math.min(Math.max(dt, 0), train.until_s);

export const trainKind = t => t.direction === 'back' ? 'C' : t.toward === 'فرودگاه' ? 'B' : 'A';
export const KIND_ORDER = ['A', 'B', 'C'];
const track = t => t.direction === 'back' ? 1 : 0;
// Legend text comes from the data the server sent, so it can never name a destination the line does not have.
export function legendFor(trains) {
  const towardOf = kind => trains.find(t => trainKind(t) === kind)?.toward ?? null;
  const out = [];
  const a = towardOf('A'), b = towardOf('B'), c = towardOf('C');
  if (a) out.push({ kind: 'A', text: `رفت، به سمت ${a}` });
  if (b) out.push({ kind: 'B', text: `رفت، به سمت ${b}` });
  if (c) out.push({ kind: 'C', text: `برگشت، به سمت ${c}` });
  return out;
}
const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const place = (node, box) => { for (const [k, v] of Object.entries(box)) node.style[k] = typeof v === 'number' ? `${v.toFixed(1)}px` : v; return node; };

// Project positions onto non-overlapping slots while minimizing displacement.
// Isotonic blocks let a collision share the adjustment rather than pushing all
// following trains away from their estimated positions.
export function layoutLane(items, height, gap = MARKER_GAP, markerH = MARKER_H) {
  const ordered = items.slice().sort((a, b) => a.y - b.y || String(a.id).localeCompare(String(b.id)));
  const blocks = [];
  ordered.forEach((item, i) => {
    blocks.push({ start: i, end: i, sum: item.y - i * gap, count: 1 });
    while (blocks.length > 1) {
      const b = blocks.at(-1), a = blocks.at(-2);
      if (a.sum / a.count <= b.sum / b.count) break;
      blocks.splice(-2, 2, { start: a.start, end: b.end, sum: a.sum + b.sum, count: a.count + b.count });
    }
  });
  const maxBase = Math.max(0, height - markerH - Math.max(0, ordered.length - 1) * gap);
  for (const block of blocks) {
    const base = Math.min(maxBase, Math.max(0, block.sum / block.count));
    for (let i = block.start; i <= block.end; i++) ordered[i] = { ...ordered[i], y: base + i * gap };
  }
  return ordered;
}

// Trains of opposite directions share the one line. Where they cross they step aside (out one way, back the other)
// by up to one full step, eased in as they approach and out as they part, so two badges are never stacked on each other.
export function sideStep(items, cross = CROSS, touch = TOUCH) {
  const out = new Map();
  for (const a of items) {
    let nearest = Infinity;
    for (const b of items) if (b.dir !== a.dir) nearest = Math.min(nearest, Math.abs(b.y - a.y));
    const amount = nearest >= cross ? 0 : Math.min(1, (cross - nearest) / (cross - touch));
    out.set(a.id, (a.dir === 'out' ? 1 : -1) * amount);
  }
  return out;
}

export function createTracker({ api, actions, controlled = false, onLineChange = () => {}, stationLines = () => [] }) {
  let legendKey = '', notesKey = null, line = 1, data = null, geo = null, fetchedAt = 0, tickTimer = 0, pollTimer = 0, rafId = 0, lastFrame = 0, running = false, selected = null, builtKey = '', token = 0, watcher = null;
  const hidden = new Set();
  const markers = new Map(), positions = new Map(), etaEls = [], etaKey = [], stationEls = [];
  const chips = h('div', { class: 'cm-chips trk-chips', role: 'group', 'aria-label': 'انتخاب خط' },
    [1, 2].map(n => h('button', { type: 'button', class: 'cm-chip', 'aria-pressed': String(n === line), dataset: { line: String(n) }, onClick: () => setLine(n) }, `خط ${fa(n)}`)));
  chips.hidden = controlled;
  let request = null, stale = false;
  const count = h('span', { role: 'status' }), clock = h('span', { class: 'trk-clock' });
  const summary = h('p', { class: 'trk-summary' }, count, clock);
  const info = h('div', { class: 'trk-info', hidden: true });
  const rows = h('div', { class: 'trk-rows' });
  const layer = h('div', { class: 'trk-layer' });
  const map = h('div', { class: 'trk-map' }, rows, layer);
  const legend = h('div', { class: 'trk-legend', hidden: true, role: 'group', 'aria-label': 'راهنمای نشانگرها' });
  const spacingNote = h('p', { class: 'bus-note', hidden: true, text: 'برای جلوگیری از هم پوشانی، بعضی نشانگرها کمی جابه جا نمایش داده می شوند؛ برای دیدن موقعیت برآوردی، قطار را انتخاب کنید.' });
  const notes = h('div', { class: 'trk-notes' });
  const el = h('section', { class: 'trk cm-card', dataset: { line: String(line) }, 'aria-labelledby': 'trk-title' },
    h('div', { class: 'trk-head' }, h('h2', { id: 'trk-title', class: 'about-card__title', text: 'نمای قطارها روی خط' }), h('span', { class: 'cm-badge cm-badge--new', text: 'برآورد برنامه ای' })),
    chips, summary, info, map, legend, notes);

  function setLine(n) {
    if (![1, 2].includes(n) || n === line) return;
    token++; request?.abort(); request = null;
    line = n; selected = null; data = null; geo = null; info.hidden = true; el.dataset.line = String(n);
    chips.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.line) === line)));
    markers.forEach(m => m.remove()); markers.clear(); positions.clear(); stopFrames(); legend.hidden = true; legendKey = ''; hidden.clear(); rows.replaceChildren(); etaEls.length = 0; etaKey.length = 0; stationEls.length = 0; builtKey = '';
    count.textContent = 'در حال دریافت موقعیت قطارها…'; clock.textContent = '';
    onLineChange(n);
    if (running && !document.hidden) fetchNow();
  }

  const mapWidth = () => Math.round(map.clientWidth) || FALLBACK_W;

  function buildRows() {
    const width = mapWidth();
    const key = line + '|' + width + '|' + data.order.join('|');
    if (key === builtKey) return;
    builtKey = key;
    geo = buildSerpentine({ count: data.order.length, width });
    place(map, { height: geo.height });
    map.style.setProperty('--trk-lw', `${geo.labelW}px`);
    place(layer, { height: geo.height });
    etaEls.length = 0; etaKey.length = 0; stationEls.length = 0; positions.clear();
    const last = data.order.length - 1;
    rows.replaceChildren(
      ...geo.rows.map(r => place(h('i', { class: 'trk-seg', 'aria-hidden': 'true' }), { left: r.x1 - LINE_W / 2, top: r.y - LINE_W / 2, width: r.x2 - r.x1 + LINE_W, height: LINE_W })),
      ...geo.turns.map(t => place(h('i', { class: 'trk-turn', dataset: { side: t.side }, 'aria-hidden': 'true' }), { left: t.x, top: t.y - LINE_W / 2, width: t.w, height: t.h + LINE_W })),
      ...geo.stations.map(s => {
        const name = data.order[s.i], lines = stationLines(name) ?? [];
        const eta = h('span', { class: 'trk-eta' });
        etaEls.push(eta); etaKey.push('');
        const node = place(h('button', { type: 'button', class: ['trk-st', (s.i === 0 || s.i === last) && 'is-end', lines.length > 1 && 'is-interchange'], dataset: { i: String(s.i) }, onClick: () => actions.openStation(name) },
          h('span', { class: 'trk-pin', 'aria-hidden': 'true' }, h('b', { text: fa(s.i + 1) })),
          h('i', { class: 'trk-stem', 'aria-hidden': 'true' }),
          h('span', { class: 'trk-below' },
            h('span', { class: 'trk-label' }, h('span', { class: 'trk-name', text: name }), lines.length > 1 && h('small', { class: 'trk-xfer', text: `تقاطع با خط ${lines.filter(n => n !== line).map(fa).join(' و ')}` })),
            eta)), { left: s.x - (geo.labelW + 8) / 2, top: s.y - 50 });
        stationEls.push(node);
        return node;
      }));
    for (const m of markers.values()) layer.append(m);
  }

  function describe(t) {
    const order = data.order;
    const where = t.state === 'dwelling' ? `در ایستگاه ${order[t.from]}` : `بین ${order[t.from]} و ${order[t.to]}`;
    return { where, toward: `به سمت ${t.toward}`, kind: trainKind(t) };
  }
  const elapsed = () => (performance.now() - fetchedAt) / 1000;
  // seconds until the train reaches its next station (may go below zero when the model is late: it then still reads "arriving")
  const remaining = t => (t.next === null || t.eta_s === null || t.eta_s === undefined ? null : t.eta_s - elapsed());

  function sync() {
    const live = new Set();
    for (const t of data.trains) {
      live.add(t.id);
      let m = markers.get(t.id);
      const d = describe(t);
      if (!m) {
        m = h('button', { type: 'button', class: 'trk-train', dataset: { id: t.id }, onClick: () => select(t.id) },
          h('span', { class: 'trk-train__dot' }, h('span', { class: 'trk-train__label' })), h('i', { class: 'trk-train__arrow', 'aria-hidden': 'true' }));
        layer.append(m); markers.set(t.id, m);
        m.classList.add('is-entering'); setTimeout(() => m.classList.remove('is-entering'), 700);
      }
      m.querySelector('.trk-train__label').textContent = d.kind;
      m.dataset.dir = t.direction; m.dataset.state = t.state; m.dataset.kind = d.kind; m.dataset.toward = t.toward;
      m.classList.toggle('is-selected', selected === t.id);
      m.classList.toggle('is-dim', hidden.has(d.kind));
      m.setAttribute('aria-label', `قطار ${d.kind}، ${d.toward}، ${d.where}`);
      m.setAttribute('aria-pressed', String(selected === t.id));
      m.tabIndex = hidden.has(d.kind) ? -1 : 0;
    }
    for (const [id, m] of markers) if (!live.has(id)) {
      markers.delete(id); positions.delete(id); if (selected === id) { selected = null; info.hidden = true; }
      m.classList.add('is-leaving'); setTimeout(() => m.remove(), 400);
    }
    paintLegend();
    const n = data.trains.length, text = n ? `${fa(n)} قطار در حال حرکت یا توقف` : 'الان قطاری روی این خط ثبت نشده است.';
    // the clock changes every poll: it lives outside the live region so screen readers are not interrupted every 3 s
    if (count.textContent !== text) count.textContent = text;
    clock.textContent = n ? ` · ساعت ${data.as_of} به وقت تهران` : '';
    const noteKey = data.notes.join('|');
    if (noteKey !== notesKey) { notesKey = noteKey; notes.replaceChildren(spacingNote, ...data.notes.map(t => h('p', { class: 'bus-note', text: t }))); }
    render(0, rafId !== 0); paintInfo(false); paintEta();
  }

  // The selected train's next station is highlighted and carries its arrival: "در حال ورود" up to one minute, minutes
  // (2 or more) otherwise. Not shown for every train: with a station every ~100 s, "arriving" would be true for most of
  // them at any moment.
  function paintEta() {
    if (!data || stale) return;
    const target = data.order.map(() => null);
    const t = selected && data.trains.find(x => x.id === selected);
    if (t && !hidden.has(trainKind(t)) && t.state !== 'dwelling' && t.next !== null) {
      const st = arrivalState(remaining(t));
      if (st) target[t.next] = { kind: trainKind(t), state: st.arriving ? 'arriving' : 'soon', text: st.arriving ? 'در حال ورود' : `${fa(st.minutes)} دقیقه` };
    }
    target.forEach((x, i) => {
      stationEls[i]?.classList.toggle('is-target', x !== null);
      const key = x ? x.kind + x.state + x.text : '';
      if (key === etaKey[i]) return;
      etaKey[i] = key;
      etaEls[i].replaceChildren(...(x ? [h('span', { class: 'trk-eta__chip', dataset: { kind: x.kind, state: x.state }, text: x.text })] : []));
    });
  }

  function paintLegend() {
    const items = legendFor(data.trains);
    legend.hidden = items.length === 0;
    const key = items.map(it => it.kind + it.text).join('|');
    if (key === legendKey) return;
    legendKey = key;
    legend.replaceChildren(
      h('p', { class: 'trk-legend__title', text: 'راهنما' }),
      h('ul', { class: 'trk-legend__list' }, items.map(it => h('li', {},
        h('button', { type: 'button', class: 'trk-legend__item', dataset: { kind: it.kind }, 'aria-pressed': String(!hidden.has(it.kind)), onClick: () => toggleKind(it.kind) },
          h('span', { class: 'trk-key', dataset: { kind: it.kind }, 'aria-hidden': 'true' }, it.kind),
          h('span', { class: 'trk-legend__text', text: `قطار ${it.kind}: ${it.text}` }))))),
      h('p', { class: 'trk-legend__hint', text: 'نشانگر روی خط، موقعیت برآوردی قطار است و پیکان کوچک کنار آن جهت حرکت را نشان می دهد. هر مورد بالا را لمس کنید تا فقط همان قطارها دیده شوند؛ دوباره لمس کنید تا برگردند.' }));
  }
  function toggleKind(kind) {
    if (hidden.has(kind)) hidden.delete(kind); else hidden.add(kind);
    legend.querySelectorAll('.trk-legend__item').forEach(b => b.setAttribute('aria-pressed', String(!hidden.has(b.dataset.kind))));
    markers.forEach(m => { const off = hidden.has(m.dataset.kind); m.classList.toggle('is-dim', off); m.tabIndex = off ? -1 : 0; });
    const sel = selected && data?.trains.find(x => x.id === selected);
    if (sel && hidden.has(trainKind(sel))) { selected = null; info.hidden = true; markers.forEach(m => m.classList.remove('is-selected')); }
    paintEta();
  }

  function select(id) {
    selected = selected === id ? null : id;
    markers.forEach((m, key) => { m.classList.toggle('is-selected', key === selected); m.setAttribute('aria-pressed', String(key === selected)); });
    info.hidden = !selected;
    paintInfo(true); paintEta();
    const m = selected && markers.get(selected);
    if (m && typeof m.scrollIntoView === 'function') m.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
  }

  function paintInfo(announce) {
    if (!selected || !data) return;
    if (stale) { info.replaceChildren(h('small', { text: 'این نمودار قدیمی است؛ زمان باقی مانده معتبر نیست. پس از برقراری اتصال، دوباره انتخاب کنید.' })); return; }
    const t = data.trains.find(x => x.id === selected);
    if (!t) return;
    const d = describe(t);
    const s = remaining(t);
    const next = t.next === null ? 'پایان سفر؛ قطار در انتهای خط منتظر حرکت بعدی است'
      : t.state === 'dwelling' ? `در ایستگاه ${data.order[t.from]} · ایستگاه بعد: ${data.order[t.next]}`
      : `ایستگاه بعد: ${data.order[t.next]} · ${arrivalText(s)}`;
    info.replaceChildren(
      h('div', { class: 'trk-info__head' }, h('span', { class: 'trk-key', dataset: { kind: d.kind }, 'aria-hidden': 'true' }, d.kind), h('strong', { text: `قطار ${d.kind} · ${d.toward}` }),
        h('button', { type: 'button', class: 'trk-info__close', 'aria-label': 'بستن جزئیات قطار', onClick: () => select(selected) }, '×')),
      h('span', { text: d.where }), h('span', { class: 'trk-info__next', text: next }),
      h('small', { text: 'این موقعیت از برنامه حرکت برآورد شده، نه GPS.' }));
    if (announce) info.setAttribute('role', 'status'); else info.removeAttribute('role');
  }

  // Positions are recomputed from the timetable rate every frame, so motion is continuous between polls. A new poll that
  // moves a train (re-sync, crowding) is eased in rather than snapped; the first placement and reduced motion snap.
  function render(dt, smooth) {
    if (!data || stale || !geo) return;
    const t = elapsed();
    let displaced = false;
    const items = [];
    for (const n of [0, 1]) {
      const lane = data.trains.filter(x => track(x) === n).map(x => ({ id: x.id, dir: x.direction, y: geo.lengthAt(advance(x, t)) }));
      for (const item of layoutLane(lane, geo.total, BADGE_GAP, 0)) {
        const original = lane.find(c => c.id === item.id);
        if (Math.abs(item.y - original.y) > 1) displaced = true;
        items.push({ ...item, dir: original.dir });
      }
    }
    const side = sideStep(items);
    for (const item of items) {
      const m = markers.get(item.id);
      if (!m) continue;
      const p = geo.pointAt(item.y), step = side.get(item.id) * NUDGE;
      // step aside along the normal of the line; the arrow follows the direction of travel
      const want = { x: p.x - Math.sin(p.ang) * step, y: p.y + Math.cos(p.ang) * step };
      const shown = positions.get(item.id);
      const ease = shown === undefined || !smooth ? 1 : Math.min(1, dt * 7);
      const cur = shown ? { x: shown.x + (want.x - shown.x) * ease, y: shown.y + (want.y - shown.y) * ease } : want;
      positions.set(item.id, cur);
      m.style.transform = `translate3d(${(cur.x - BADGE / 2).toFixed(2)}px, ${(cur.y - BADGE / 2).toFixed(2)}px, 0)`;
      const travel = (p.ang * 180) / Math.PI + (m.dataset.dir === 'back' ? 180 : 0);
      m.style.setProperty('--a', `${travel.toFixed(1)}deg`);
    }
    spacingNote.hidden = !displaced;
  }
  function tick() { if (!rafId) render(1, false); paintInfo(false); paintEta(); }
  function frame(ts) {
    rafId = 0;
    if (!running || document.hidden || !data || stale) return;
    render(Math.min(0.1, (ts - (lastFrame || ts)) / 1000), true); lastFrame = ts;
    rafId = requestAnimationFrame(frame);
  }
  function startFrames() {
    if (rafId || typeof requestAnimationFrame !== 'function' || reduceMotion()) return;
    lastFrame = 0; rafId = requestAnimationFrame(frame);
  }
  function stopFrames() { if (rafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId); rafId = 0; }

  // Re-draw when the map's width changes (rotation, panel first shown): the serpentine depends on it.
  function watchWidth() {
    if (watcher || typeof ResizeObserver !== 'function') return;
    watcher = new ResizeObserver(() => { if (data && !stale && Math.abs(mapWidth() - (geo?.width ?? 0)) > 8) { buildRows(); sync(); } });
    watcher.observe(map);
  }

  async function fetchNow() {
    if (!running || document.hidden || request) return;
    const pendingRequest = new AbortController(); request = pendingRequest;
    const mine = ++token;
    try {
      const res = await api.trains(line, pendingRequest.signal);
      if (mine !== token) return;
      data = res; stale = false; fetchedAt = performance.now(); buildRows(); sync(); startFrames(); watchWidth();
    } catch {
      if (mine === token) {
        // one missed 3 s refresh is not news; the diagram is called stale only once the data is older than STALE_MS
        stale = !!data && performance.now() - fetchedAt > STALE_MS;
        if (data && !stale) return;
        count.textContent = data ? `نمودار قدیمی است؛ دریافت تازه انجام نشد. آخرین داده: ${data.as_of} به وقت تهران.` : 'دریافت موقعیت قطارها انجام نشد؛ اتصال را بررسی کنید.'; clock.textContent = '';
        paintInfo(false);
      }
    }
    finally { if (request === pendingRequest) request = null; }
  }

  function pause() { stopFrames(); clearInterval(tickTimer); clearInterval(pollTimer); request?.abort(); request = null; token++; }
  function resume() {
    pause();
    if (!running || document.hidden) return;
    if (data && performance.now() - fetchedAt > STALE_MS) {
      stale = true; count.textContent = `نمودار قدیمی است؛ در حال دریافت تازه. آخرین داده: ${data.as_of} به وقت تهران.`; clock.textContent = ''; paintInfo(false);
    }
    fetchNow(); tickTimer = setInterval(tick, 1000); pollTimer = setInterval(fetchNow, POLL_MS);
  }
  const onVisible = () => resume();
  return {
    el, setLine,
    start() {
      if (running) return;
      running = true; resume();
      document.addEventListener('visibilitychange', onVisible);
    },
    stop() { running = false; pause(); watcher?.disconnect(); watcher = null; document.removeEventListener('visibilitychange', onVisible); },
  };
}
