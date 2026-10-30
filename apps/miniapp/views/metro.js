// Rail is a self-contained product: discovery, timetables, station search and favourites never leak to home.
import { buildSlides } from '../hero.js';
import { createStationsView } from './stations.js';
import { createSearchBox } from '../ui/searchbox.js';
import { createRideTabs } from '../ui/ride-tabs.js';
import { createTracker } from '../ui/tracker.js';
import { h, icon } from '../ui/dom.js';
import { init } from '../ui/hm7.js';
export function createMetroView(ctx) {
  const { actions, state, store } = ctx;
  const root = h('div', { class: 'view view--metro' });
  const tracker = createTracker({ api: ctx.api, actions });
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
  function paint() {
    const s = state.get();
    const slides = buildSlides({ locate: { ...s.nearest, maxKm: s.maxKm }, recent: s.recent, asOf: s.asOf }).filter(slide => slide.id !== 'note');
    hero.replaceChildren(h('h2', { id: 'metro-discovery-title', class: 'cm-sr', text: 'نزدیک ترین ایستگاه و آخرین بازدید' }), ...slides.map(slide =>
      h('article', { class: ['metro-discovery__card', slide.busy && 'is-busy'], 'aria-busy': String(slide.busy) },
        h('p', { class: 'eyebrow', text: slide.kicker }), h('h3', { text: slide.title }),
        ...slide.lines.map(line => h('p', { text: line })), slide.meta && h('small', { text: slide.meta }),
        slide.action && h('button', { type: 'button', class: 'cm-btn cm-btn--sm', dataset: { focusKey: `metro-${slide.id}-${slide.action.id}` }, onClick: () => actions.heroAction(slide.action), text: slide.action.label }))));
    search.refresh();
  }
  root.append(
    h('header', { class: 'metro-head' },
      h('button', { type: 'button', class: 'cm-icon-btn', 'aria-label': 'بازگشت از مترو', onClick: () => actions.back() }, icon('arrow_right')),
      h('img', { src: 'assets/services/rail.svg', alt: '', width: 60, height: 60 }),
      h('div', {}, h('h1', { text: 'مترو' }), h('p', { text: 'مترو مشهد · خط ۱ و خط ۲' }))),
    createRideTabs('metro', actions),
    searchHost,
    h('button', { type: 'button', class: 'metro-favourites', onClick: () => actions.go('favourites') }, icon('heart'), 'ایستگاه های من', icon('chevron_left')),
    hero, tracker.el, listView.el,
    h('section', { class: 'cm-card about-card', 'aria-labelledby': 'rail-method-title' },
      h('h2', { id: 'rail-method-title', class: 'about-card__title', text: 'درباره زمان های مترو' }),
      h('p', { text: 'زمان ها از برنامه حرکت و زمان سفر برآورد می شوند، نه موقعیت زنده قطار. ساعت دریافت پاسخ کنار هر تابلو به وقت تهران نوشته شده است.' }),
      h('p', { text: 'خط ۲: شنبه تا چهارشنبه سرفاصله ۱۰ دقیقه و پنجشنبه و جمعه ۱۲ دقیقه در نظر گرفته شده، اما فاز حرکت اندازه گیری نشده است. زمان بین طبرسی و شریعتی تخمین قدیمی و بین شریعتی و شهید فکوری اندازه گیری شده است.' }),
      h('p', { text: 'خط ۱ دو سرویس دارد: A بین وکیل آباد و غدیر و B بین وکیل آباد و فرودگاه. دقت داده و نکته های هر ایستگاه در تابلوی آن آمده است.' })));
  state.subscribe(['status', 'stations', 'nearest', 'recent', 'asOf'], paint); paint();
  return { el: root, mount() { listView.mount(); init(root); },
    onShow(options) { listView.onShow(options); paint(); tracker.start(); },
    onHide() { search.close(); tracker.stop(); },
    focusHero() { hero.scrollIntoView({ block: 'nearest', behavior: 'auto' }); } };
}
