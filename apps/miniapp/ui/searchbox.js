// Header search: ARIA combobox + listbox, live suggestions (250 ms debounce), recent searches as chips,
// the matched part marked, near-miss suggestion and full keyboard support.
import { debounce } from '../async.js';
import { didYouMean, filterStations, highlightParts, stripStationPrefix } from '../search.js';
import { fa, lineLabel, isSupported } from '../format.js';
import { h, icon } from './dom.js';

const MAX_SUGGESTIONS = 6;

export function createSearchBox({ host, input, clearButton, popup, listbox, live, getStations, getOrder, getStatus = () => 'ready', onRetry = () => {}, store, onPick, onUnsupported }) {
  let options = [], active = -1, open = false, hasResults = false;

  const setOpen = value => {
    open = value;
    popup.hidden = !value;
    if (value) { popup.classList.remove('is-open'); void popup.offsetWidth; popup.classList.add('is-open'); }
    input.setAttribute('aria-expanded', String(value));
    if (!value) { active = -1; input.removeAttribute('aria-activedescendant'); }
  };
  const supported = isSupported;

  function markActive(index) {
    options.forEach((option, i) => option.setAttribute('aria-selected', String(i === index)));
    active = index;
    const el = options[index];
    if (el) { input.setAttribute('aria-activedescendant', el.id); el.scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  }

  function optionFor(station, ranges, index) {
    const off = !supported(station);
    const label = highlightParts(station.name, ranges).map(part => (part.mark ? h('mark', { text: part.text }) : part.text));
    return h('button', {
      class: ['search-option', off && 'is-disabled'], type: 'button', role: 'option', id: `opt-${index}`, tabindex: '-1', 'aria-selected': 'false',
      'aria-disabled': off ? 'true' : null, dataset: { name: station.name },
      onClick: () => pick(station),
    }, icon(off ? 'subway' : 'subway_fill'), h('span', { class: 'search-option__name' }, label),
    off && h('span', { class: 'cm-badge cm-badge--warn', text: `${lineLabel(station.lines)} · به زودی` }));
  }

  function skeleton() {
    listbox.replaceChildren(...[0, 1].map(() => h('div', { class: 'search-skel', 'aria-hidden': 'true' }, h('span', { class: 'cm-skel search-skel__ico' }), h('span', { class: 'cm-skel cm-skel--line search-skel__line' }))));
    listbox.setAttribute('aria-busy', 'true');
    options = []; hasResults = false;
    setOpen(true);
  }

  function renderRecents() {
    const names = store.recents().filter(name => getStations().some(s => s.name === name));
    if (!names.length) { listbox.replaceChildren(); options = []; setOpen(false); live.textContent = ''; return; }
    const chips = names.map((name, i) => h('button', { class: 'cm-chip search-chip', type: 'button', role: 'option', id: `opt-${i}`, tabindex: '-1', 'aria-selected': 'false', dataset: { name }, onClick: () => pick(getStations().find(s => s.name === name)) }, name));
    listbox.replaceChildren(
      h('div', { class: 'search-head', role: 'presentation' }, h('span', { class: 'cm-menu__label', text: 'جستجوهای اخیر' }),
        h('button', { class: 'search-head__clear', type: 'button', onClick: () => { store.clearRecents(); renderRecents(); input.focus(); } }, 'پاک کردن')),
      h('div', { class: 'cm-chips search-chips', role: 'presentation' }, chips));
    listbox.setAttribute('aria-busy', 'false');
    options = chips; hasResults = true; markActive(-1);
    setOpen(true);
    live.textContent = '';
  }

  function renderResults(query) {
    const stations = getStations();
    const found = filterStations(stations, query, { limit: MAX_SUGGESTIONS, order: getOrder() });
    listbox.setAttribute('aria-busy', 'false');
    if (!found.length) {
      const guess = didYouMean(stations, query);
      listbox.replaceChildren(h('div', { class: 'search-empty', role: 'presentation' },
        h('p', { class: 'search-empty__title', text: `نتیجه ای برای «${query.trim()}» پیدا نشد` }),
        guess && h('p', {}, 'منظورتان ', h('button', { class: 'search-empty__guess', type: 'button', onClick: () => { input.value = guess.name; run(); input.focus(); } }, guess.name), ' بود؟')));
      options = []; hasResults = true; markActive(-1);
      live.textContent = 'نتیجه ای پیدا نشد';
      setOpen(true);
      return;
    }
    options = found.map((hit, i) => optionFor(hit.station, hit.ranges, i));
    listbox.replaceChildren(h('div', { class: 'cm-menu__label', role: 'presentation', text: 'پیشنهادها' }), ...options);
    hasResults = true;
    markActive(-1);
    live.textContent = `${fa(found.length)} پیشنهاد`;
    setOpen(true);
  }

  function renderStatus(status) {
    options = []; hasResults = false; markActive(-1);
    listbox.setAttribute('aria-busy', String(status === 'loading'));
    if (status === 'loading') { skeleton(); live.textContent = 'فهرست ایستگاه ها در حال دریافت است'; return; }
    listbox.replaceChildren(h('div', { class: 'search-empty', role: 'presentation' },
      h('p', { class: 'search-empty__title', text: 'فهرست ایستگاه ها دریافت نشد' }),
      h('button', { class: 'search-empty__guess', type: 'button', onClick: () => onRetry() }, 'تلاش دوباره')));
    setOpen(true);
  }

  function run() {
    clearButton.hidden = input.value === '';
    const status = getStatus();
    if (status !== 'ready') { renderStatus(status); return; }
    const query = stripStationPrefix(input.value);
    if (!query.trim()) renderRecents(); else renderResults(query);
  }
  const debouncedRun = debounce(run, 250);

  function pick(station) {
    if (!station) return;
    if (!supported(station)) { onUnsupported?.(station); return; }
    debouncedRun.cancel();
    input.value = ''; clearButton.hidden = true;
    setOpen(false);
    input.blur();
    onPick(station.name);
  }

  input.addEventListener('focus', () => { if (!input.value) renderRecents(); else if (!open) run(); });
  input.addEventListener('input', () => {
    clearButton.hidden = input.value === '';
    if (!input.value.trim()) { debouncedRun.cancel(); renderRecents(); return; }
    // Keep current suggestions until the debounced search answers; show the skeleton only when there are none.
    if (!listbox.querySelector('.search-option, .search-empty')) skeleton();
    debouncedRun();
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!open) { debouncedRun.flush(); run(); }
      if (!options.length) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      markActive(active < 0 ? (step > 0 ? 0 : options.length - 1) : (active + step + options.length) % options.length);
    } else if (event.key === 'Enter') {
      debouncedRun.flush();
      const target = options[active >= 0 ? active : 0];
      if (open && target && (active >= 0 || input.value.trim())) { event.preventDefault(); target.click(); }
    } else if (event.key === 'Escape') {
      if (open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
      else if (input.value) { input.value = ''; clearButton.hidden = true; }
    }
  });
  clearButton.addEventListener('click', () => { input.value = ''; clearButton.hidden = true; debouncedRun.cancel(); input.focus(); renderRecents(); });
  popup.addEventListener('pointerdown', event => { if (!event.target.closest('.search-head__clear, .search-empty__guess')) event.preventDefault(); });
  host.addEventListener('focusout', event => { if (!host.contains(event.relatedTarget)) setOpen(false); });
  document.addEventListener('pointerdown', event => { if (open && !host.contains(event.target)) setOpen(false); });

  return { close: () => setOpen(false), focus: () => input.focus(), refresh() { if (open || input.value) run(); }, get isOpen() { return open; } };
}
