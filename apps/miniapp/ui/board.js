// The arrival board: destination-grouped, two trains per direction, ETA digits that roll on refresh.
import { groupPasses } from '../logic.js';
import { arrivalState, clockLabel, confidenceLabel, etaParts, fa, headingFor, ARRIVING_LABEL } from '../format.js';
import { h, icon, reducedMotion } from './dom.js';
import { roll } from './hm7.js';

function skeletonRow(first) {
  return h('li', { class: ['train', 'train--skeleton', first && 'is-next'] },
    h('span', { class: 'cm-skel train__skel-eta' }),
    h('span', { class: 'train__meta' }, h('span', { class: 'cm-skel cm-skel--line train__skel-line' }), h('span', { class: 'cm-skel cm-skel--line train__skel-line train__skel-line--short' })));
}

// Same grid as the final rows, so nothing moves when the real data arrives.
export function boardSkeleton(groups = 2) {
  const root = h('div', { class: 'board board--loading', 'aria-hidden': 'true' });
  for (let g = 0; g < groups; g++) {
    root.append(h('section', { class: 'board-group cm-inset' },
      h('div', { class: 'cm-skel cm-skel--line board-group__skel-title' }),
      h('ol', { class: 'train-list' }, skeletonRow(true), skeletonRow(false))));
  }
  return root;
}

// ETA is counted down on the device between board refreshes (the board itself refreshes once a minute), from the
// server clock stamp and the printed arrival time. A train that was about to arrive and is not in the next response
// is kept as "در حال ورود" for GRACE_S seconds, so a late train never silently vanishes from the board.
export const GRACE_S = 90, TICK_MS = 3000;
const secOfDay = hms => { const [h = NaN, m = NaN, s = 0] = String(hms ?? '').split(':').map(Number); return h * 3600 + m * 60 + s; };
export function etaSecondsAt(pass, asOf, elapsedS) {
  const a = secOfDay(pass.arrive), b = secOfDay(asOf);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  let d = a - b;
  if (d < -43200) d += 86400; else if (d > 43200) d -= 86400;
  return d - elapsedS;
}
const passKey = p => p.event_id ?? `${p.line ?? ''}|${p.toward}|${p.service ?? ''}|${p.arrive}`;
// seconds -> the displayed state; falls back to the server's whole minutes when no clock stamp is available
const stateOf = (pass, seconds) => seconds === null ? { arriving: pass.eta_min <= 1, minutes: pass.eta_min } : arrivalState(seconds);

function etaCell(state) {
  const { value, unit } = state.arriving ? { value: ARRIVING_LABEL, unit: '' } : { value: fa(state.minutes), unit: 'دقیقه' };
  const num = h('b', { class: 'train__num cm-num', 'data-v': value, text: value });
  return h('span', { class: ['train__eta', !unit && 'train__eta--now'] }, num, unit && h('span', { class: 'train__unit', text: unit }));
}

function trainRow(pass, index, showConfidence, state = stateOf(pass, null)) {
  const confidence = showConfidence ? confidenceLabel(pass.confidence) : null;
  return h('li', { class: ['train', index === 0 && 'is-next'], dataset: { eta: state.arriving ? 'arriving' : String(state.minutes), key: passKey(pass) } },
    etaCell(state),
    h('span', { class: 'train__meta' },
      h('span', { class: 'train__when' }, index === 0 ? 'قطار بعدی' : 'پس از آن', ' · رسیدن ', h('bdi', { class: 'cm-num', text: clockLabel(pass.arrive) })),
      h('span', { class: 'train__tags' },
        pass.service && pass.toward !== 'وکیل‌آباد' && h('span', { class: 'train__svc', text: `به سمت ${pass.toward}` }),
        confidence && h('span', { class: ['cm-badge', `cm-badge--${confidence.tone}`], text: confidence.text }))));
}

function signature(groups) { return groups.map(([toward, passes]) => `${passes[0]?.line ?? ''}${toward}:${passes.length}`).join('|'); }
const unrefTimer = t => { t?.unref?.(); return t; };

// Returns an object that owns `.el`; call render(data) for each fresh board.
export function createBoard() {
  const el = h('div', { class: 'board-host', 'aria-live': 'polite', 'aria-busy': 'true' });
  let sig = '', model = null, ticker = 0;
  el.append(boardSkeleton());
  const stopTicker = () => { if (ticker) clearInterval(ticker); ticker = 0; };
  const elapsed = () => (Date.now() - model.fetchedAt) / 1000;
  const secondsOf = pass => model.asOf ? etaSecondsAt(pass, model.asOf, elapsed()) : null;
  const stateFor = pass => stateOf(pass, secondsOf(pass));

  function build(groups) {
    const mixed = new Set(groups.flatMap(([, list]) => list.map(p => p.line)).filter(Boolean)).size > 1;
    const box = h('div', { class: 'board is-loaded' });
    if (!groups.length) {
      box.append(h('div', { class: 'cm-inset board-empty' }, icon('clock'), h('p', { text: 'در این ساعت قطاری ثبت نشده است؛ ممکن است خارج از ساعت سرویس باشد.' })));
    }
    for (const [toward, passes] of groups) {
      // One confidence label per direction when all its trains share it; per train only when they differ.
      const kinds = new Set(passes.map(p => p.confidence));
      const groupLabel = kinds.size === 1 ? confidenceLabel([...kinds][0]) : null;
      box.append(h('section', { class: 'board-group cm-inset', dataset: { toward } },
        h('h3', { class: 'board-group__title' }, icon(toward.startsWith('ورودی') ? 'arrow_down_circle' : 'flag'), h('span', { class: 'board-group__name', text: headingFor(toward) }),
          mixed && passes[0].line && h('span', { class: ['cm-badge', 'board-group__line'], text: `خط ${fa(passes[0].line)}` }),
          groupLabel && h('span', { class: ['cm-badge', `cm-badge--${groupLabel.tone}`, 'board-group__badge'], text: groupLabel.text })),
        h('ol', { class: 'train-list' }, passes.map((pass, i) => trainRow(pass, i, kinds.size > 1, model ? stateFor(pass) : undefined)))));
    }
    return box;
  }

  function draw(list) {
    const groups = groupPasses(list);
    const next = signature(groups);
    const existing = el.querySelector('.board:not(.board--loading)');
    const rows = existing ? [...existing.querySelectorAll('.train')] : [];
    const flat = groups.flatMap(([, g]) => g);
    const states = flat.map(pass => (model ? stateFor(pass) : stateOf(pass, null)));
    // "در حال ورود" has no unit, so a train changing to or from it changes the row's shape: rebuild then.
    const sameShape = rows.length === flat.length && flat.every((pass, i) => (states[i].arriving) === (rows[i].dataset.eta === 'arriving') && passKey(pass) === rows[i].dataset.key);
    if (existing && next === sig && sameShape && !reducedMotion()) {
      rows.forEach((row, i) => {
        const pass = flat[i], state = states[i];
        row.dataset.eta = state.arriving ? 'arriving' : String(state.minutes);
        const value = state.arriving ? ARRIVING_LABEL : fa(state.minutes);
        const num = row.querySelector('.train__num');
        if (num && num.getAttribute('data-v') !== value) roll(num, value);
        const when = row.querySelector('bdi');
        if (when) when.textContent = clockLabel(pass.arrive);
      });
    } else {
      sig = next;
      el.replaceChildren(build(groups));
    }
  }
  function tick() {
    if (!model || (el.isConnected === false)) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    const before = model.passes.length;
    model.passes = model.passes.filter(p => !p.held || (secondsOf(p) ?? 0) > -GRACE_S);
    draw(model.passes);
    if (model.passes.length !== before) el.setAttribute('aria-busy', 'false');
  }

  return {
    el,
    busy(on) { el.setAttribute('aria-busy', String(on)); },
    showSkeleton() { sig = ''; model = null; stopTicker(); el.replaceChildren(boardSkeleton()); el.setAttribute('aria-busy', 'true'); },
    // Same destinations as the previous board -> only the numbers change (and roll); otherwise rebuild.
    // `meta.asOf` (server clock stamp of this response) turns on the on-device countdown and the late-train hold.
    render(passes, meta = {}) {
      const now = Date.now();
      const kept = [];
      if (model && meta.asOf) {
        const fresh = new Set(passes.map(passKey));
        for (const old of model.passes) {
          if (fresh.has(passKey(old))) continue;
          const left = etaSecondsAt(old, model.asOf, (now - model.fetchedAt) / 1000);
          if (left !== null && left > -GRACE_S && (old.held || left <= 120)) kept.push({ ...old, held: true });
        }
      }
      const all = kept.length ? [...passes, ...kept].sort((a, b) => String(a.arrive).localeCompare(String(b.arrive))) : passes;
      model = meta.asOf ? { passes: all, asOf: meta.asOf, fetchedAt: now } : null;
      if (!meta.asOf) stopTicker();
      draw(all);
      if (model && !ticker) ticker = unrefTimer(setInterval(tick, TICK_MS));
      el.setAttribute('aria-busy', 'false');
    },
    tick() { tick(); },
    clear() { sig = ''; model = null; stopTicker(); el.replaceChildren(); },
  };
}
