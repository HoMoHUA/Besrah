// Stations tab: searchable list with two modes — the line-1 route spine (in service order) and all stations (A–Z).
import { didYouMean, filterStations, highlightParts } from '../search.js';
import { fa, lineLabel } from '../format.js';
import { routeRows } from '../route.js';
import { h, icon } from '../ui/dom.js';
import { init } from '../ui/hm7.js';

export function createStationsView(ctx) {
  const { state, actions } = ctx;
  let mode = 'line1', query = '';
  const root = h('div', { class: 'view view--stations' });

  const input = h('input', { class: 'stations__filter', type: 'text', inputmode: 'search', enterkeyhint: 'search', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'فیلتر ایستگاه ها', 'aria-label': 'فیلتر ایستگاه ها' });
  const clearBtn = h('button', { class: 'cm-qty__b search-clear', type: 'button', hidden: true, 'aria-label': 'پاک کردن فیلتر', onClick: () => { input.value = ''; query = ''; clearBtn.hidden = true; paint(); input.focus(); } }, icon('xmark_circle_fill'));
  const filter = h('label', { class: 'cm-search cm-inset stations__search' }, icon('magnifyingglass'), input, clearBtn);
  const count = h('p', { class: 'stations__count', role: 'status' });
  const list = h('ol', { class: 'route-list' });
  const empty = h('div', { class: 'stations__empty', hidden: true });

  const tabItems = [['line1', 'مسیر خط ۱'], ['all', 'همهٔ ایستگاه ها']].map(([id, label], i) =>
    h('button', { class: ['tb-it', i === 0 && 'on'], type: 'button', role: 'tab', 'aria-selected': String(i === 0), dataset: { mode: id }, onClick: () => setMode(id) }, h('span', { text: label })));
  const tabs = h('div', { class: 'cm-tabs tb-wrap stations__tabs', role: 'tablist', 'aria-label': 'نمایش ایستگاه ها' }, h('div', { class: 'tb-ind' }), tabItems);

  root.append(
    h('header', { class: 'view__head' }, h('h1', { class: 'view__title', text: 'ایستگاه ها' }), h('p', { class: 'view__sub', text: 'برای دیدن قطار بعدی، یک ایستگاه را لمس کنید.' })),
    tabs, filter, count, list, empty);

  function setMode(next, { silent = false } = {}) {
    mode = next;
    tabItems.forEach(t => { const on = t.dataset.mode === mode; t.classList.toggle('on', on); t.setAttribute('aria-selected', String(on)); });
    if (!silent) paint();
  }

  input.addEventListener('input', () => { query = input.value; clearBtn.hidden = !query; paint(); });

  function row(station, { ranges = [], position, terminal, filtered }) {
    const off = !station.lines.includes(1);
    const label = highlightParts(station.name, ranges).map(p => (p.mark ? h('mark', { text: p.text }) : p.text));
    const inter = station.lines.some(l => l !== 1) && !off;
    const btn = h('button', {
      class: ['route-row', off && 'is-disabled', 'el'], type: 'button', 'aria-disabled': off ? 'true' : null, dataset: { name: station.name },
      onClick: () => (off ? actions.unsupported(station) : actions.openStation(station.name)),
    },
    h('span', { class: 'route-row__rail', 'aria-hidden': 'true' }, h('span', { class: 'route-row__dot' })),
    h('span', { class: 'route-row__name' }, label),
    h('span', { class: 'route-row__meta' },
      terminal && h('span', { class: 'route-row__tag', text: terminal === 'first' ? 'ابتدای خط' : 'انتهای خط' }),
      inter && h('span', { class: 'cm-badge cm-badge--new', text: `تقاطع با ${lineLabel(station.lines.filter(l => l !== 1))}` }),
      off && h('span', { class: 'cm-badge cm-badge--warn', text: `${lineLabel(station.lines)} · به زودی` }),
      position && !filtered && h('span', { class: 'route-row__pos cm-num', 'aria-hidden': 'true', text: fa(position) })),
    icon('chevron_left', 'route-row__go'));
    return h('li', { class: ['route-item', terminal && `is-${terminal}`, filtered && 'is-filtered', off && 'is-off'] }, btn);
  }

  function paint() {
    const s = state.get();
    if (s.status === 'loading') {
      list.replaceChildren(...Array.from({ length: 9 }, () => h('li', { class: 'route-item route-item--skeleton', 'aria-hidden': 'true' }, h('span', { class: 'cm-skel route-skel__dot' }), h('span', { class: 'cm-skel cm-skel--line route-skel__line' }))));
      count.textContent = ''; empty.hidden = true; return;
    }
    if (s.status === 'error') {
      list.replaceChildren(); count.textContent = ''; empty.hidden = false;
      empty.replaceChildren(h('div', { class: 'cm-card cm-empty' }, h('div', { class: 'cm-empty__art' }, icon('wifi')), h('h3', { text: 'فهرست ایستگاه ها دریافت نشد' }),
        h('p', { text: 'اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.' }), h('button', { class: 'cm-btn cm-btn--sm el', type: 'button', onClick: () => actions.reload() }, icon('arrow_clockwise'), 'تلاش دوباره')));
      return;
    }
    const byName = new Map(s.stations.map(st => [st.name, st]));
    let pool;
    if (mode === 'line1') pool = routeRows(s.order, s.stations).map(r => ({ station: byName.get(r.name), ...r }));
    else pool = [...s.stations].sort((a, b) => a.name.localeCompare(b.name, 'fa')).map(station => ({ station }));
    const hits = filterStations(pool.map(p => p.station), query, { order: s.order });
    const meta = new Map(pool.map(p => [p.station.name, p]));
    const filtered = Boolean(query.trim());
    // unfiltered list keeps its own order (route or A–Z); a filter ranks by relevance
    const shown = filtered ? hits : pool.map(p => ({ station: p.station, ranges: [] }));
    list.classList.toggle('is-filtered', filtered);
    list.classList.toggle('route-list--spine', mode === 'line1');
    list.replaceChildren(...shown.map(hit => row(hit.station, { ranges: hit.ranges, ...meta.get(hit.station.name), filtered })));
    count.textContent = filtered ? (shown.length ? `${fa(shown.length)} نتیجه` : '') : `${fa(shown.length)} ایستگاه`;
    empty.hidden = shown.length > 0;
    if (!shown.length) {
      const guess = didYouMean(pool.map(p => p.station), query);
      empty.replaceChildren(h('div', { class: 'cm-card cm-empty' }, h('div', { class: 'cm-empty__art' }, icon('magnifyingglass')),
        h('h3', { text: `نتیجه ای برای «${query.trim()}» پیدا نشد` }),
        guess ? h('p', {}, 'منظورتان ', h('button', { class: 'search-empty__guess', type: 'button', onClick: () => { input.value = guess.name; query = guess.name; clearBtn.hidden = false; paint(); } }, guess.name), ' بود؟')
          : h('p', { text: 'نام را کوتاه تر بنویسید یا پیشوند «ایستگاه» را حذف کنید.' })));
    }
    init(list);
  }

  state.subscribe(['status', 'stations', 'order'], paint);
  paint();

  return {
    el: root,
    mount() { init(root); },
    // `mode` comes from the home tiles: line1 = route spine, all = A–Z list
    onShow({ mode: wanted } = {}) { if (wanted && wanted !== mode) setMode(wanted); },
  };
}
