// Stations tab: searchable list with three modes — the line-1 and line-2 route spines (in service order) and all stations (A–Z).
import { didYouMean, filterStations, highlightParts } from '../search.js';
import { fa, isSupported, lineLabel } from '../format.js';
import { routeRows } from '../route.js';
import { h, icon } from '../ui/dom.js';
import { init } from '../ui/hm7.js';

export function createStationsView(ctx, { embedded = false } = {}) {
  const { state, actions } = ctx;
  let mode = 'line1', query = '';
  const root = h('div', { class: 'view view--stations' });

  const input = h('input', { class: 'stations__filter', type: 'text', inputmode: 'search', enterkeyhint: 'search', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'فیلتر ایستگاه ها', 'aria-label': 'فیلتر ایستگاه ها' });
  const clearBtn = h('button', { class: 'cm-qty__b search-clear', type: 'button', hidden: true, 'aria-label': 'پاک کردن فیلتر', onClick: () => { input.value = ''; query = ''; clearBtn.hidden = true; paint(); input.focus(); } }, icon('xmark_circle_fill'));
  const filter = h('label', { class: 'cm-search cm-inset stations__search' }, icon('magnifyingglass'), input, clearBtn);
  const count = h('p', { class: 'stations__count', role: 'status' });
  const list = h('ol', { class: 'route-list' });
  const empty = h('div', { class: 'stations__empty', hidden: true });

  // Three tabs must fit one line at 360px: the third shows «همه» and keeps the full name for screen readers.
  const tabItems = [['line1', 'مسیر خط ۱'], ['line2', 'مسیر خط ۲'], ['all', 'همه', 'همهٔ ایستگاه ها']].map(([id, label, full], i) =>
    h('button', { class: ['tb-it', i === 0 && 'on'], type: 'button', role: 'tab', 'aria-selected': String(i === 0), 'aria-label': full ?? null, dataset: { mode: id }, onClick: () => setMode(id) }, h('span', { text: label })));
  const tabs = h('div', { class: 'cm-tabs tb-wrap stations__tabs', role: 'tablist', 'aria-label': 'نمایش ایستگاه ها' }, h('div', { class: 'tb-ind' }), tabItems);

  if (!embedded) root.append(h('header', { class: 'view__head' }, h('h1', { class: 'view__title', text: 'ایستگاه ها' }), h('p', { class: 'view__sub', text: 'برای دیدن قطار بعدی، یک ایستگاه را لمس کنید.' })));
  root.append(tabs);
  if (!embedded) root.append(filter);
  root.append(count, list, empty);

  function setMode(next, { silent = false } = {}) {
    mode = next;
    tabItems.forEach(t => { const on = t.dataset.mode === mode; t.classList.toggle('on', on); t.setAttribute('aria-selected', String(on)); });
    if (!silent) paint();
  }

  input.addEventListener('input', () => { query = input.value; clearBtn.hidden = !query; paint(); });

  const modeLine = () => (mode === 'line1' ? 1 : mode === 'line2' ? 2 : null);

  function row(station, { ranges = [], position, terminal, filtered }) {
    const off = !isSupported(station);
    const label = highlightParts(station.name, ranges).map(p => (p.mark ? h('mark', { text: p.text }) : p.text));
    const line = modeLine();
    const others = line ? station.lines.filter(l => l !== line) : station.lines;
    const inter = !off && (line ? others.length > 0 : station.lines.length > 1);
    const btn = h('button', {
      class: ['route-row', off && 'is-disabled', 'el'], type: 'button', 'aria-disabled': off ? 'true' : null, dataset: { name: station.name },
      onClick: () => (off ? actions.unsupported(station) : actions.openStation(station.name)),
    },
    h('span', { class: 'route-row__rail', 'aria-hidden': 'true' }, h('span', { class: 'route-row__dot' })),
    h('span', { class: 'route-row__name' }, label),
    h('span', { class: 'route-row__meta' },
      terminal && h('span', { class: 'route-row__tag', text: terminal === 'first' ? 'ابتدای خط' : 'انتهای خط' }),
      inter && h('span', { class: 'cm-badge cm-badge--new', text: line ? `تقاطع با ${lineLabel(others)}` : `تقاطع ${lineLabel(station.lines)}` }),
      !line && !off && !inter && h('span', { class: 'route-row__tag', text: lineLabel(station.lines) }),
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
    if (mode === 'line1') pool = routeRows(s.order, s.stations, 1).map(r => ({ station: byName.get(r.name), ...r }));
    else if (mode === 'line2') pool = routeRows(s.order2, s.stations, 2).map(r => ({ station: byName.get(r.name), ...r }));
    else pool = [...s.stations].sort((a, b) => a.name.localeCompare(b.name, 'fa')).map(station => ({ station }));
    const hits = filterStations(pool.map(p => p.station), query, { order: mode === 'line2' ? s.order2 : [...s.order, ...s.order2.filter(n => !s.order.includes(n))] });
    const meta = new Map(pool.map(p => [p.station.name, p]));
    const filtered = Boolean(query.trim());
    // unfiltered list keeps its own order (route or A–Z); a filter ranks by relevance
    const shown = filtered ? hits : pool.map(p => ({ station: p.station, ranges: [] }));
    list.classList.toggle('is-filtered', filtered);
    list.classList.toggle('route-list--spine', mode !== 'all');
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

  state.subscribe(['status', 'stations', 'order', 'order2'], paint);
  paint();

  return {
    el: root,
    mount() { init(root); },
    // `mode` comes from the home tiles: line1 / line2 = route spine, all = A–Z list
    onShow({ mode: wanted } = {}) { if (wanted && wanted !== mode) setMode(wanted); },
  };
}
