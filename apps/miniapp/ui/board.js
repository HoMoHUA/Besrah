// The arrival board: destination-grouped, two trains per direction, ETA digits that roll on refresh.
import { groupPasses } from '../logic.js';
import { clockLabel, confidenceLabel, etaParts, fa, headingFor } from '../format.js';
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

function trainRow(pass, index, showConfidence) {
  const { value, unit } = etaParts(pass.eta_min);
  const num = h('b', { class: 'train__num cm-num', 'data-v': value, text: value });
  const confidence = showConfidence ? confidenceLabel(pass.confidence) : null;
  return h('li', { class: ['train', index === 0 && 'is-next'], dataset: { eta: String(pass.eta_min) } },
    h('span', { class: ['train__eta', !unit && 'train__eta--now'] }, num, unit && h('span', { class: 'train__unit', text: unit })),
    h('span', { class: 'train__meta' },
      h('span', { class: 'train__when' }, index === 0 ? 'قطار بعدی' : 'پس از آن', ' · رسیدن ', h('bdi', { class: 'cm-num', text: clockLabel(pass.arrive) })),
      h('span', { class: 'train__tags' },
        pass.service && h('span', { class: 'train__svc', text: `سرویس ${pass.service}` }),
        confidence && h('span', { class: ['cm-badge', `cm-badge--${confidence.tone}`], text: confidence.text }))));
}

function signature(groups) { return groups.map(([toward, passes]) => `${passes[0]?.line ?? ''}${toward}:${passes.length}`).join('|'); }

// Returns an object that owns `.el`; call render(data) for each fresh board.
export function createBoard() {
  const el = h('div', { class: 'board-host', 'aria-live': 'polite', 'aria-busy': 'true' });
  let sig = '';
  el.append(boardSkeleton());

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
        h('ol', { class: 'train-list' }, passes.map((pass, i) => trainRow(pass, i, kinds.size > 1)))));
    }
    return box;
  }

  return {
    el,
    busy(on) { el.setAttribute('aria-busy', String(on)); },
    showSkeleton() { sig = ''; el.replaceChildren(boardSkeleton()); el.setAttribute('aria-busy', 'true'); },
    // Same destinations as the previous board -> only the numbers change (and roll); otherwise rebuild.
    render(passes) {
      const groups = groupPasses(passes);
      const next = signature(groups);
      const existing = el.querySelector('.board:not(.board--loading)');
      const rows = existing ? [...existing.querySelectorAll('.train')] : [];
      const flat = groups.flatMap(([, list]) => list);
      // "اکنون" has no unit, so a train changing to or from "now" changes the row's shape: rebuild then.
      const sameShape = rows.length === flat.length && flat.every((pass, i) => (pass.eta_min === 0) === (rows[i].dataset.eta === '0'));
      if (existing && next === sig && sameShape && !reducedMotion()) {
        rows.forEach((row, i) => {
          const pass = flat[i], { value } = etaParts(pass.eta_min);
          row.dataset.eta = String(pass.eta_min);
          const num = row.querySelector('.train__num');
          if (num && num.getAttribute('data-v') !== value) roll(num, value);
          const when = row.querySelector('bdi');
          if (when) when.textContent = clockLabel(pass.arrive);
        });
      } else {
        sig = next;
        el.replaceChildren(build(groups));
      }
      el.setAttribute('aria-busy', 'false');
    },
    clear() { sig = ''; el.replaceChildren(); },
  };
}
