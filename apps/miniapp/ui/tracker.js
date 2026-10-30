// Estimated train positions along a full line. The server interpolates the timetable (never GPS); between polls the
// client advances each running train at its timetable speed, so markers glide instead of jumping.
import { h } from './dom.js';

const ROW = 44, POLL_MS = 10000, MARKER_H = 24;
const fa = n => String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
export const etaText = seconds => seconds < 45 ? 'کمتر از یک دقیقه' : `حدود ${fa(Math.ceil(seconds / 60))} دقیقه`;
export const advance = (train, dt) => train.state === 'dwelling' ? train.pos : train.pos + train.rate * Math.min(Math.max(dt, 0), train.until_s);

export function createTracker({ api, actions }) {
  let line = 1, data = null, fetchedAt = 0, tickTimer = 0, pollTimer = 0, running = false, selected = null, builtKey = '', token = 0;
  const markers = new Map();
  const chips = h('div', { class: 'cm-chips trk-chips', role: 'group', 'aria-label': 'انتخاب خط' },
    [1, 2].map(n => h('button', { type: 'button', class: 'cm-chip', 'aria-pressed': String(n === line), dataset: { line: String(n) }, onClick: () => setLine(n) }, `خط ${fa(n)}`)));
  const summary = h('p', { class: 'trk-summary', role: 'status' });
  const info = h('div', { class: 'trk-info', hidden: true });
  const rows = h('div', { class: 'trk-rows' });
  const layer = h('div', { class: 'trk-layer' });
  const notes = h('div', { class: 'trk-notes' });
  const el = h('section', { class: 'trk cm-card', 'aria-labelledby': 'trk-title' },
    h('div', { class: 'trk-head' }, h('h2', { id: 'trk-title', class: 'about-card__title', text: 'ردیاب قطارها روی خط' }), h('span', { class: 'cm-badge cm-badge--new', text: 'برآورد برنامه ای' })),
    chips, summary, info, h('div', { class: 'trk-map' }, rows, layer), notes);

  function setLine(n) {
    if (n === line) return;
    line = n; selected = null; data = null; info.hidden = true;
    chips.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.line) === line)));
    markers.forEach(m => m.remove()); markers.clear(); rows.replaceChildren(); builtKey = '';
    summary.textContent = 'در حال دریافت موقعیت قطارها…';
    fetchNow();
  }

  function buildRows() {
    const key = line + '|' + data.order.join('|');
    if (key === builtKey) return;
    builtKey = key;
    rows.replaceChildren(h('i', { class: 'trk-spine', 'aria-hidden': 'true' }), ...data.order.map((name, i) =>
      h('button', { type: 'button', class: ['trk-row', (i === 0 || i === data.order.length - 1) && 'is-terminal'], onClick: () => actions.openStation(name) }, h('span', { class: 'trk-name', text: name }))));
    layer.style.height = data.order.length * ROW + 'px';
  }

  function describe(t) {
    const order = data.order;
    const where = t.state === 'dwelling' ? `در ایستگاه ${order[t.from]}` : `بین ${order[t.from]} و ${order[t.to]}`;
    return { where, svc: t.service ? `سرویس ${t.service} · ` : '', toward: `به سمت ${t.toward}` };
  }

  function sync() {
    const live = new Set();
    for (const t of data.trains) {
      live.add(t.id);
      let m = markers.get(t.id);
      if (!m) {
        m = h('button', { type: 'button', class: 'trk-train', dataset: { id: t.id }, onClick: () => select(t.id) }, h('span', { class: 'trk-train__arrow', 'aria-hidden': 'true' }), t.service && h('bdi', { class: 'trk-train__svc', dir: 'ltr', text: t.service }));
        layer.append(m); markers.set(t.id, m);
      }
      m.dataset.dir = t.direction; m.dataset.state = t.state; m.classList.toggle('is-selected', selected === t.id);
      const d = describe(t);
      m.setAttribute('aria-label', `قطار ${d.svc}${d.toward}، ${d.where}`);
      m.setAttribute('aria-pressed', String(selected === t.id));
    }
    for (const [id, m] of markers) if (!live.has(id)) { markers.delete(id); m.remove(); if (selected === id) { selected = null; info.hidden = true; } }
    const count = data.trains.length;
    summary.textContent = count ? `${fa(count)} قطار در حال حرکت یا توقف · ساعت ${data.as_of} به وقت تهران` : 'الان قطاری روی این خط ثبت نشده است؛ احتمالاً خارج از ساعت کاری.';
    notes.replaceChildren(...data.notes.map(text => h('p', { class: 'bus-note', text })));
    tick();
  }

  function select(id) {
    selected = selected === id ? null : id;
    markers.forEach((m, key) => { m.classList.toggle('is-selected', key === selected); m.setAttribute('aria-pressed', String(key === selected)); });
    info.hidden = !selected;
    paintInfo(true);
  }

  function paintInfo(announce) {
    if (!selected || !data) return;
    const t = data.trains.find(x => x.id === selected);
    if (!t) return;
    const dt = (performance.now() - fetchedAt) / 1000, d = describe(t);
    const next = t.next === null ? 'پایان سفر؛ قطار در انتهای خط منتظر حرکت بعدی است' : `ایستگاه بعد: ${data.order[t.next]} · ${etaText(Math.max(0, (t.eta_s ?? 0) - dt))}`;
    info.replaceChildren(h('strong', { text: `قطار ${d.svc}${d.toward}` }), h('span', { text: d.where }), h('span', { text: next }),
      h('small', { text: 'این موقعیت از برنامه حرکت برآورد شده، نه GPS.' }));
    if (announce) info.setAttribute('role', 'status'); else info.removeAttribute('role');
  }

  function tick() {
    if (!data) return;
    const dt = (performance.now() - fetchedAt) / 1000;
    for (const t of data.trains) {
      const m = markers.get(t.id);
      if (m) m.style.transform = `translateY(${(advance(t, dt) * ROW + ROW / 2 - MARKER_H / 2).toFixed(1)}px)`;
    }
    paintInfo(false);
  }

  async function fetchNow() {
    const mine = ++token;
    try {
      const res = await api.trains(line);
      if (mine !== token) return;
      data = res; fetchedAt = performance.now(); buildRows(); sync();
    } catch { if (mine === token && !data) summary.textContent = 'دریافت موقعیت قطارها انجام نشد؛ چند لحظه بعد دوباره تلاش می شود.'; }
  }

  const onVisible = () => { if (!document.hidden && running) fetchNow(); };
  return {
    el,
    start() {
      if (running) return;
      running = true; fetchNow();
      tickTimer = setInterval(tick, 1000); pollTimer = setInterval(fetchNow, POLL_MS);
      document.addEventListener('visibilitychange', onVisible);
    },
    stop() { running = false; clearInterval(tickTimer); clearInterval(pollTimer); document.removeEventListener('visibilitychange', onVisible); token++; },
  };
}
