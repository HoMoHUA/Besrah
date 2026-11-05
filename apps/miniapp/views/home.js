// Home: one question ("where to?"), up to two suggestions built from the clock and, only if the user allows, their position,
// three services, a few shortcuts and an honest note about the data. Product detail belongs behind its own service card.
import { homeLayout, isLive } from '../services.js';
import { h, icon } from '../ui/dom.js';
import { serviceLogo } from '../ui/service-card.js';
import { resolveUserCoords } from '../logic.js';

const REFRESH_MS = 60_000;
const INTENTS = [
  ['now', 'همین حالا'],
  ['coffee', 'کافه'],
  ['sweets', 'شیرینی'],
  ['gift', 'گل و هدیه'],
  ['essentials', 'خرید روزمره'],
];

export function createHomeView({ actions, api, store }) {
  const root = h('div', { class: 'view view--home' });
  const { primary } = homeLayout();
  let suggestions = { status: 'idle', cards: [], locationUsed: false, note: '' }, lastAt = 0, controller = null, locating = false, chosenIntent = 'now', lastPoint = null;

  const tile = service => h('button', {
    type: 'button', class: ['sv-tile', !isLive(service) && 'is-planned'], dataset: { service: service.id },
    'aria-label': `${service.title}، ${service.subtitle}${isLive(service) ? '' : '، به زودی'}`,
    onClick: () => actions.serviceAction(service),
  }, h('span', { class: 'sv-tile__art' }, serviceLogo(service), !isLive(service) && h('span', { class: 'sv-tile__badge', text: 'به زودی' })),
  h('strong', { class: 'sv-tile__name', text: service.title }), h('span', { class: 'sv-tile__sub', text: service.subtitle }));
  const shortcut = (label, ico, onClick) => h('button', { type: 'button', class: 'sc-chip', onClick }, h('span', { class: 'sc-chip__ico' }, icon(ico)), h('span', { text: label }));

  const sugHost = h('section', { class: 'sg-host', 'aria-label': 'پیشنهادهای حالا', 'aria-live': 'polite' });
  const art = h('img', { class: 'rt-card__art', src: 'assets/hero-brand.svg', alt: '', width: 480, height: 220 });

  async function load(point) {
    lastPoint = point;
    controller?.abort(); controller = new AbortController(); const mine = controller;
    suggestions = { ...suggestions, status: suggestions.cards.length ? 'ok' : 'loading' }; drawSuggestions();
    try {
      const data = await api.homeSuggestions(point, mine.signal, store?.prefs?.().foodPreferredVerticals ?? [], chosenIntent);
      if (mine !== controller) return;
      suggestions = { status: 'ok', cards: data.cards, locationUsed: data.locationUsed, note: data.note }; lastAt = Date.now();
    } catch (error) { if (mine !== controller || error?.kind === 'aborted') return; suggestions = { status: 'error', cards: [], locationUsed: false, note: '' }; }
    drawSuggestions();
  }
  async function withPosition() {
    if (locating) return; locating = true;
    try { const c = await resolveUserCoords(globalThis.window?.Telegram?.WebApp); await load({ lat: c.latitude, lon: c.longitude }); }
    catch { await load(null); }   // denied or unavailable: the clock-only suggestion stays
    locating = false;
  }
  function open(card) {
    if (card.cta.type === 'station') actions.openStation(card.cta.station);
    else actions.go('food', { ...(card.cta.q ? { q: card.cta.q } : {}), ...(card.cta.vertical ? { vertical: card.cta.vertical } : {}), ...(card.cta.sort === 'distance' ? { near: true } : {}) });
  }
  function cardEl(card) {
    return h('button', { type: 'button', class: ['sg-card', `sg-card--${card.kind}`], dataset: { id: card.id }, onClick: () => open(card) },
      h('span', { class: 'sg-card__ico' }, icon(card.kind === 'transit' ? 'tram_fill' : 'bag_fill')),
      h('span', { class: 'sg-card__body' }, h('b', { text: card.title }), h('span', { class: 'sg-card__why', text: card.why }), h('span', { class: 'sg-card__detail', text: card.detail })),
      icon('chevron_left'));
  }
  function drawSuggestions() {
    const s = suggestions;
    if (s.status === 'error' || (s.status === 'idle')) { sugHost.replaceChildren(); sugHost.hidden = true; return; }
    sugHost.hidden = false;
    if (s.status === 'loading') { sugHost.replaceChildren(h('div', { class: 'cm-skel sg-skeleton', 'aria-busy': 'true' })); return; }
    sugHost.replaceChildren(...[
      h('div', { class: 'section-head' }, h('h2', { text: 'پیشنهاد حالا' })),
      h('div', { class: 'sg-intents fd-row', role: 'group', 'aria-label': 'موضوع پیشنهاد' },
        INTENTS.map(([id, label]) => h('button', {
          type: 'button', class: ['cm-chip','fd-chip'], 'aria-pressed': String(chosenIntent === id),
          onClick: () => { if (chosenIntent !== id) { chosenIntent = id; load(lastPoint); } },
        }, label))),
      ...s.cards.map(cardEl),
      !s.locationUsed ? h('button', { type: 'button', class: ['cm-btn', 'cm-btn--ghost', 'cm-btn--sm', 'sg-locate'], onClick: withPosition }, 'ایستگاه نزدیک من را هم نشان بده') : null,
      h('p', { class: 'fd-note', text: s.note }),
    ].filter(Boolean));
  }

  root.append(
    h('div', { class: 'home-greeting' }, h('div', {}, h('p', { class: 'eyebrow', text: 'بِسراه · مشهد' }), h('h1', { text: 'امروز، کجا می روید؟' }))),
    h('button', { type: 'button', class: 'rt-card', 'aria-label': 'مقصد را انتخاب کنید؛ مبدأ موقعیت فعلی شماست', onClick: () => actions.go('trip', { focus: 'to' }) },
      art,
      h('span', { class: 'rt-card__kicker', text: 'مسیر مکان به مکان' }),
      h('span', { class: 'rt-card__title', text: 'کجا می روید؟' }),
      h('span', { class: 'rt-card__dest' }, h('span', { class: 'rt-field__ico' }, icon('flag_fill')), h('span', { text: 'نام مکان، نشانی یا ایستگاه مقصد' })),
      h('span', { class: 'rt-card__from' }, icon('location_north_up_right_circle_fill'), h('span', { text: 'از موقعیت فعلی شما' }))),
    sugHost,
    h('section', { class: 'sv-panel', 'aria-labelledby': 'products-title' },
      h('div', { class: 'section-head' }, h('h2', { id: 'products-title', text: 'سرویس های بِسراه' })),
      h('div', { class: 'sv-grid' }, primary.map(tile))),
    h('section', { class: 'sc-row', 'aria-label': 'میان بُرها' },
      shortcut('ایستگاه نزدیک', 'location_north_up_right_circle_fill', () => actions.heroAction({ id: 'locate' })),
      shortcut('ذخیره ها', 'heart', () => actions.go('saved')),
      shortcut('همه سرویس ها', 'square_grid_2x2', () => actions.go('services'))),
    h('button', { type: 'button', class: 'discovery-note', onClick: () => actions.go('about') },
      h('span', { class: 'discovery-note__icon' }, icon('checkmark_shield')),
      h('span', {}, h('strong', { text: 'هر عدد با منشأش می آید' }), h('span', { text: 'زمان مترو برآورد مدل است، قیمت ها ثبت شده اند و هر چه نامعلوم باشد نامعلوم می ماند.' })), icon('chevron_left')));
  drawSuggestions();

  // Inline the (same-origin, test-validated) artwork so its ids can be animated; the <img> stays as the fallback.
  fetch('assets/hero-brand.svg', { credentials: 'omit' }).then(r => r.ok ? r.text() : Promise.reject(new Error('art'))).then(text => {
    const svg = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
    if (svg.nodeName !== 'svg' || svg.querySelector('parsererror')) return;
    svg.querySelectorAll('title, desc').forEach(n => n.remove());
    ['role', 'aria-labelledby'].forEach(a => svg.removeAttribute(a));
    svg.setAttribute('class', 'rt-card__art'); svg.setAttribute('aria-hidden', 'true');
    art.replaceWith(document.importNode(svg, true));
  }).catch(() => { /* the static image remains */ });

  return {
    el: root,
    // Position is requested at load only if the user turned that on in Profile; otherwise the clock-only suggestion appears
    // and the position is asked for solely by tapping the button.
    onShow() {
      if (suggestions.status === 'loading' || (Date.now() - lastAt < REFRESH_MS && suggestions.status === 'ok')) return;
      if (store?.suggestLocation?.()) withPosition(); else load(null);
    },
    onHide() { controller?.abort(); },
  };
}
