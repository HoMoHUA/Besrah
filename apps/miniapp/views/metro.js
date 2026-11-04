// One Metro selection owner; legacy remains the clean OFF / opt-out fallback.
import { buildSlides } from '../hero.js';
import { createStationsView } from './stations.js';
import { createSearchBox } from '../ui/searchbox.js';
import { createRideTabs } from '../ui/ride-tabs.js';
import { createTracker } from '../ui/tracker.js';
import { createPlanner } from '../ui/planner.js';
import { createBoard } from '../ui/board.js';
import { createSequencer } from '../async.js';
import { asOfLabel, dayTypeLabel } from '../format.js';
import { h, icon } from '../ui/dom.js';
import { init } from '../ui/hm7.js';

const BOARD_REFRESH_MS = 3000;

export function createMetroView(ctx) {
  const { actions, state, store, api } = ctx;
  const root = h('div', { class: 'view view--metro' });
  let visible = false, unified = false, panel = 'board', presentation = null, notifiedMode = false, discoveryLine = null, boardKey = '', boardTimer = 0, boardHasData = false, boardFails = 0;
  // The line chips live in the line view too: they set the shared form line, exactly like the line tabs of the stations panel.
  const tracker = createTracker({ api, actions, stationLines: name => state.get().stations.find(s => s.name === name)?.lines ?? [],
    onLineChange: n => { if (controller.get().form.line !== n) controller.setForm({ line: n }); } });
  const storage = (() => { try { return globalThis.window?.localStorage; } catch { return undefined; } })();
  const shortcuts = { get: () => ({ nearest: state.get().nearest, recent: state.get().recent, favourites: store.favourites?.() ?? [] }),
    locate: () => actions.locate(), openFavourites: () => actions.go('favourites') };
  const planner = createPlanner({ api, state, storage, search: globalThis.window?.location?.search ?? '', embedded: true, onRetry: actions.reload, stationStore: store, shortcuts });
  const controller = planner.controller;
  const hero = h('section', { class: 'metro-discovery', 'aria-labelledby': 'metro-discovery-title' });
  const listView = createStationsView(ctx, { embedded: true });
  const input = h('input', { id: 'metro-q', type: 'text', inputmode: 'search', autocomplete: 'off', spellcheck: 'false', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'metro-suggest-list', 'aria-autocomplete': 'list', 'aria-label': 'جست وجوی ایستگاه های مترو', placeholder: 'نام ایستگاه را بنویسید' });
  const clear = h('button', { type: 'button', class: 'search-clear cm-icon-btn', hidden: true, 'aria-label': 'پاک کردن نام ایستگاه' }, icon('xmark_circle_fill'));
  const listbox = h('div', { id: 'metro-suggest-list', role: 'listbox', 'aria-label': 'ایستگاه های مترو' });
  const popup = h('div', { class: 'cm-menu app-suggest metro-suggest', hidden: true }, listbox);
  const live = h('p', { class: 'cm-sr', role: 'status', 'aria-live': 'polite' });
  const searchHost = h('div', { class: 'metro-search' }, h('label', { class: 'cm-search cm-inset', for: 'metro-q' }, icon('magnifyingglass'), input, clear), popup, live);
  const search = createSearchBox({ host: searchHost, input, clearButton: clear, popup, listbox, live,
    getStations: () => state.get().stations,
    getOrder: () => { const s = state.get(); return [...s.order, ...s.order2.filter(n => !s.order.includes(n))]; },
    getStatus: () => state.get().status, onRetry: actions.reload, store, onPick: actions.openStation, onUnsupported: actions.unsupported });
  const btn = (text, onClick, attrs = {}) => h('button', { type: 'button', class: 'cm-btn cm-btn--sm', text, onClick, ...attrs });
  const access = h('div', { class: 'metro-access' });
  const optinNote = h('p', { class: 'metro-optin-note', role: 'status' });
  const favourites = btn('ایستگاه های من', () => actions.go('favourites'), { class: 'metro-favourites' });
  const legacy = h('div', { class: 'metro-legacy' }, searchHost, favourites, hero);
  const board = createBoard(), boardSeq = createSequencer();
  const boardTitle = h('h2', { id: 'metro-board-title', text: 'حرکت های مبدأ · زمان فعلی' });
  const boardStamp = h('p', { class: 'metro-board-stamp' });
  const boardStatus = h('p', { role: 'status', class: 'metro-board-status' });
  const boardNotes = h('ul', { class: 'station__notes' });
  const boardActions = h('div', { class: 'metro-board-actions' });
  const boardHost = h('section', { id: 'metro-panel-board', class: 'metro-current-board metro-panel', role: 'tabpanel', 'aria-labelledby': 'metro-tab-board' }, boardTitle,
    h('p', { class: 'journey-muted', text: 'تابلو برای اکنون است (وقت سرور)، نه زمان انتخاب شده برای سفر. زمان ها برآورد برنامه هستند.' }), boardStamp, boardActions, board.el, boardStatus, boardNotes);
  const trackerPanel = h('div', { id: 'metro-panel-tracker', class: 'metro-tracker-panel metro-panel', role: 'tabpanel', 'aria-labelledby': 'metro-tab-tracker' },
    h('p', { class: 'journey-muted', text: 'موقعیت قطارها از برنامه حرکت و زمان سفر برآورد می شود؛ GPS یا موقعیت زنده نیست.' }));
  const stationsPanel = h('div', { id: 'metro-panel-stations', class: 'metro-stations-panel metro-panel', role: 'tabpanel', 'aria-labelledby': 'metro-tab-stations' });
  const panels = { board: boardHost, tracker: trackerPanel, stations: stationsPanel };
  const tabs = Object.fromEntries([['board', 'حرکت های ایستگاه'], ['tracker', 'نمای خط'], ['stations', 'ایستگاه ها']].map(([id, label]) =>
    [id, h('button', { type: 'button', role: 'tab', id: `metro-tab-${id}`, class: 'metro-tab', 'aria-controls': `metro-panel-${id}`, 'aria-selected': String(id === panel), tabindex: id === panel ? '0' : '-1', onClick: () => selectPanel(id) }, label)]));
  const context = h('div', { class: 'metro-context', role: 'tablist', 'aria-label': 'اطلاعات مترو' }, ...Object.values(tabs));
  for (const [id, el] of Object.entries(panels)) el.hidden = id !== panel;
  const unifiedHost = h('div', { class: 'metro-unified', hidden: true }, planner.el, context, boardHost, trackerPanel, stationsPanel);
  const about = h('section', { class: 'cm-card about-card', 'aria-labelledby': 'rail-method-title' },
    h('h2', { id: 'rail-method-title', class: 'about-card__title', text: 'درباره زمان های مترو' }),
    h('p', { text: 'زمان ها از برنامه حرکت و زمان سفر برآورد می شوند، نه موقعیت زنده قطار. ساعت دریافت پاسخ کنار هر تابلو به وقت تهران نوشته شده است.' }),
    h('p', { text: 'خط ۲: شنبه تا چهارشنبه سرفاصله ۱۰ دقیقه و پنجشنبه و جمعه ۱۲ دقیقه در نظر گرفته شده، اما فاز حرکت اندازه گیری نشده است. زمان بین طبرسی و شریعتی تخمین قدیمی و بین شریعتی و شهید فکوری اندازه گیری شده است.' }),
    h('p', { text: 'خط ۱ قطارهای جداگانه به سمت غدیر و فرودگاه دارد؛ قطار برگشت به سمت وکیل آباد می رود. مقصد قطار را بررسی کنید. دقت داده و نکته های هر ایستگاه در تابلوی آن آمده است.' }));
  const methodDetail = h('details', { class: 'metro-method-detail metro-detail' }, h('summary', { text: 'منبع زمان ها و محدودیت داده' }));
  root.append(h('header', { class: 'metro-head' },
    h('button', { type: 'button', class: 'cm-icon-btn', 'aria-label': 'بازگشت از مترو', onClick: () => actions.back() }, icon('arrow_right')),
    h('img', { src: 'assets/services/rail.svg', alt: '', width: 36, height: 36 }),
    h('h1', { text: 'مترو' }), access),
    h('p', { class: 'metro-model-note', text: 'برآورد از برنامه حرکت؛ نه موقعیت زنده قطار' }), optinNote,
    createRideTabs('metro', actions), legacy, unifiedHost, methodDetail);

  function origin() { return state.get().stations.find(s => s.id === controller.get().form.from); }
  function stopBoard() { clearTimeout(boardTimer); boardTimer = 0; boardSeq.cancel(); }
  function scheduleBoard() {
    clearTimeout(boardTimer);
    if (visible && unified && panel === 'board' && !document.hidden && boardKey) boardTimer = setTimeout(() => loadBoard(true), BOARD_REFRESH_MS);
  }
  // The board refreshes quietly in the background every 3 s (no spinner, no status text); only a hand-pressed refresh shows progress.
  async function loadBoard(background = false) {
    const station = origin(), line = controller.get().form.line, key = `${line}:${station?.id ?? ''}`;
    if (!visible || !unified || panel !== 'board' || document.hidden || !station) return;
    if (!background) { board.busy(true); boardStatus.textContent = 'در حال دریافت حرکت های فعلی…'; }
    const result = await boardSeq.run(signal => api.next(station.name, { line, signal, limit: 10 }));
    if (result.stale || key !== boardKey || !visible || !unified || panel !== 'board') return;
    board.busy(false);
    if (!result.ok) {
      boardFails++;
      if (!boardHasData) board.clear();
      // a single missed background refresh keeps the last board silently; the notice appears after three in a row
      if (background && boardHasData && boardFails < 3) { scheduleBoard(); return; }
      boardStatus.textContent = 'تابلو تازه نشد؛ اتصال را بررسی کنید و تازه سازی را بزنید. زمان پاسخ قبلی، اگر موجود باشد، کنار تابلو مشخص است.';
    } else {
      const data = result.value; boardFails = 0;
      boardHasData = true; board.render(data.passes, { asOf: data.as_of }); boardStatus.textContent = '';
      boardStamp.textContent = `دریافت ${asOfLabel(data.as_of, { seconds: true })} · ${dayTypeLabel(data.day_type)} · تهران`;
      boardNotes.replaceChildren(...(data.notes ?? []).map(text => h('li', { text })));
    }
    scheduleBoard();
  }
  function paintBoard() {
    const station = origin(), line = controller.get().form.line;
    const key = station ? `${line}:${station.id}` : '';
    boardTitle.textContent = `حرکت های ${station?.name ?? 'مبدأ'} · زمان فعلی`;
    boardActions.replaceChildren(...(station ? [btn('تازه سازی تابلو', () => loadBoard()),
      btn(store.isFavourite(station.name) ? 'حذف از علاقه مندی ها' : 'ذخیره ایستگاه', () => {
        const result = store.toggleFavourite(station.name); paintBoard();
        if (result.reason === 'full') boardStatus.textContent = 'فهرست علاقه مندی ها پر است؛ برای افزودن، یک ایستگاه ذخیره شده را حذف کنید.';
      }, { 'aria-pressed': String(store.isFavourite(station.name)) }),
      btn('اطلاعات کامل ایستگاه', () => actions.openStation(station.name))] : []));
    if (panel !== 'board') return;
    if (key && key === boardKey) return;
    stopBoard(); boardKey = key; boardHasData = false; boardStamp.textContent = ''; boardNotes.replaceChildren();
    if (!key) { board.clear(); board.busy(false); boardStatus.textContent = 'برای دیدن حرکت ها، ایستگاه مبدأ را انتخاب کنید.'; return; }
    board.showSkeleton(); loadBoard();
  }
  function trackerLifecycle() {
    if (visible && (unified ? panel === 'tracker' : !['idle', 'loading'].includes(controller.get().phase))) tracker.start();
    else tracker.stop();
  }
  function selectOrigin(name) {
    const current = controller.get();
    if (!current.active || current.config?.enabled !== true || !['ready', 'loading'].includes(current.phase)) return false;
    const station = state.get().stations.find(s => s.name === name);
    if (!station) return false;
    const currentLine = controller.get().form.line;
    const line = station.lines?.includes(currentLine) ? currentLine : station.lines?.find(l => [1, 2].includes(l));
    if (!line) return false;
    controller.setForm({ line, from: station.id });
    planner.el.querySelector('#journey-to')?.focus({ preventScroll: true });
    return true;
  }
  function selectPanel(id, { focus = false } = {}) {
    if (!panels[id]) return;
    const changed = panel !== id; panel = id;
    for (const [key, el] of Object.entries(panels)) { el.hidden = key !== id; tabs[key].setAttribute('aria-selected', String(key === id)); tabs[key].setAttribute('tabindex', key === id ? '0' : '-1'); }
    if (focus) tabs[id].focus();
    if (!changed) return;
    if (id === 'board') { boardKey = ''; if (unified) paintBoard(); } else stopBoard();
    trackerLifecycle();
  }
  context.addEventListener('keydown', event => {
    const ids = Object.keys(tabs), at = ids.indexOf(panel);
    const next = event.key === 'ArrowLeft' ? ids[(at + 1) % ids.length] : event.key === 'ArrowRight' ? ids[(at + ids.length - 1) % ids.length] : null;
    if (next) { event.preventDefault?.(); selectPanel(next, { focus: true }); }
  });
  function sync() {
    const s = controller.get();
    unified = s.phase === 'ready' && s.active && s.config?.enabled === true;
    root.classList.toggle('is-unified', unified); legacy.hidden = unified; unifiedHost.hidden = !unified;
    access.replaceChildren(); optinNote.textContent = '';
    const ghost = (text, onClick) => h('button', { type: 'button', class: 'metro-optout', text, onClick });
    if (s.phase === 'ready') {
      access.append(ghost(unified ? 'خروج از حالت آزمایشی' : 'ورود اختیاری به سفر آزمایشی', () => unified ? controller.leave() : controller.optIn()));
      if (!unified) optinNote.textContent = 'فقط انتخاب ورود ذخیره می شود؛ نه تاریخچه سفر';
    } else if (controller.interested() && ['disabled', 'config_error'].includes(s.phase)) {
      optinNote.textContent = 'سفر آزمایشی اکنون در دسترس نیست؛ امکانات ایستگاه فعال است.';
      if (s.phase === 'config_error') access.append(ghost('بررسی دوباره', () => controller.load()));
    }
    optinNote.hidden = !optinNote.textContent;
    if (presentation !== unified) {
      tracker.stop(); stopBoard(); boardKey = '';
      if (unified) { search.close(); input.value = ''; listbox.replaceChildren(); trackerPanel.append(tracker.el); stationsPanel.append(listView.el); methodDetail.append(about); }
      else { legacy.append(tracker.el, listView.el, about); }
      presentation = unified;
    }
    // Revalidation is not an opt-out: do not restart legacy summary fetching while config is pending.
    if (visible && !['idle', 'loading'].includes(s.phase) && notifiedMode !== unified) {
      notifiedMode = unified; actions.metroModeChanged?.(unified);
    }
    methodDetail.hidden = !unified;
    if (unified) {
      tracker.setLine(s.form.line);
      if (discoveryLine !== s.form.line) { discoveryLine = s.form.line; listView.onShow({ mode: `line${s.form.line}` }); }
      planner.refreshShortcuts(); if (visible) paintBoard();
    } else { stopBoard(); boardKey = ''; }
    trackerLifecycle();
  }
  stationsPanel.addEventListener('click', event => {
    const tab = event.target.closest('[data-mode]');
    if (unified && ['line1', 'line2'].includes(tab?.dataset.mode)) controller.setForm({ line: tab.dataset.mode === 'line2' ? 2 : 1 });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopBoard(); else if (visible && unified && panel === 'board') loadBoard();
  });
  function paint() {
    const s = state.get();
    if (!unified) {
      const slides = buildSlides({ locate: { ...s.nearest, maxKm: s.maxKm }, recent: s.recent, asOf: s.asOf }).filter(slide => slide.id !== 'note');
      hero.replaceChildren(h('h2', { id: 'metro-discovery-title', class: 'cm-sr', text: 'نزدیک ترین ایستگاه و آخرین بازدید' }), ...slides.map(slide =>
        h('article', { class: ['metro-discovery__card', slide.busy && 'is-busy'], 'aria-busy': String(slide.busy) },
          h('p', { class: 'eyebrow', text: slide.kicker }), h('h3', { text: slide.title }),
          ...slide.lines.map(line => h('p', { text: line })), slide.meta && h('small', { text: slide.meta }),
          slide.action && btn(slide.action.label, () => actions.heroAction(slide.action), { dataset: { focusKey: `metro-${slide.id}-${slide.action.id}` } }))));
      search.refresh();
    } else planner.refreshShortcuts();
  }
  store.subscribe?.(key => { if (key === 'favs' && unified) { paintBoard(); planner.refreshShortcuts(); } });
  controller.subscribe(() => { sync(); paint(); });
  state.subscribe(['status', 'stations', 'nearest', 'recent', 'asOf'], paint); sync(); paint();
  return { el: root, controller, isUnified: () => unified, planFrom: selectOrigin,
    mount() { listView.mount(); init(root); },
    onShow(options) {
      visible = true;
      if (['line1', 'line2'].includes(options?.mode)) controller.setForm({ line: options.mode === 'line2' ? 2 : 1 });
      listView.onShow(options); paint(); planner.onShow(); sync();
    },
    onHide() { visible = false; search.close(); tracker.stop(); stopBoard(); boardKey = ''; planner.onHide(); },
    focusHero() { (unified ? planner.el : hero).scrollIntoView({ block: 'nearest', behavior: 'auto' }); } };
}
