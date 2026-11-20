// Home: one question ("where to?"), up to two suggestions built from the clock and, only if the user allows, their position,
// three services, a few shortcuts and an honest note about the data. Product detail belongs behind its own service card.
import { homeLayout, isLive } from '../services.js';
import { h, icon } from '../ui/dom.js';
import { serviceLogo } from '../ui/service-card.js';
import { resolveUserCoords } from '../logic.js';
import { nativeTrip } from '../store.js';

const REFRESH_MS = 60_000;
const hhmmTehran = sec => new Date(sec * 1000).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Tehran' });
const faNum = n => Number(n).toLocaleString('fa-IR');
const faDigits = v => String(v).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);

// "Trip in progress" (HarmonyOS Live View pattern): the trip the user started, its next step and planned arrival.
// Times are the plan's estimates (metro timetable model, router durations), never live vehicle positions.
export function activeTripLines(trip, nowSec) {
  const toLeave = Math.round((trip.leaveEpoch - nowSec) / 60), toArrive = Math.round((trip.arriveEpoch - nowSec) / 60);
  const lines = [];
  if (toLeave > 0) lines.push(`حرکت از مبدأ: ساعت ${hhmmTehran(trip.leaveEpoch)} (${faNum(toLeave)} دقیقه دیگر)`);
  else if (toArrive > 0) lines.push('در راه هستید.');
  if (trip.ride) lines.push(`مترو خط ${faNum(trip.ride.line)}${trip.ride.toward ? ` به سمت ${trip.ride.toward}` : ''}: سوار شدن ساعت ${faDigits(trip.ride.departAt)} از ایستگاه ${trip.ride.from}، پیاده شدن ${trip.ride.to}`);
  lines.push(toArrive > 0 ? `رسیدن حدود ساعت ${hhmmTehran(trip.arriveEpoch)} (${faNum(toArrive)} دقیقه دیگر)` : `زمان رسیدن برنامه ریزی شده (${hhmmTehran(trip.arriveEpoch)}) گذشته است.`);
  return lines;
}
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
  const liveHost = h('section', { class: 'lv-host', 'aria-label': 'سفر در جریان', 'aria-live': 'polite' });
  let liveTimer = null, livePhase = null;
  function drawLive() {
    const trip = store?.activeTrip?.();
    if (!trip) { liveHost.replaceChildren(); liveHost.hidden = true; if (livePhase) nativeTrip('end'); livePhase = null; return; }
    // When the trip moves from "before leaving" to "on the way", refresh the app notification's countdown target.
    // Ended from the app notification ("پایان سفر" there): end it here too.
    try { if (livePhase && globalThis.window?.BesrahNative?.tripActive?.() === false) { store.endActiveTrip?.(); drawLive(); return; } } catch { /* no bridge */ }
    const phase = Math.floor(Date.now() / 1000) < trip.leaveEpoch ? 'leave' : 'arrive';
    if (livePhase && livePhase !== phase) nativeTrip('start', trip);
    livePhase = phase;
    liveHost.hidden = false;
    liveHost.replaceChildren(h('div', { class: 'cm-card lv-card' },
      h('div', { class: 'lv-card__head' }, h('span', { class: 'lv-card__dot', 'aria-hidden': 'true' }), h('b', { text: 'سفر در جریان' }), h('span', { class: 'lv-card__title', text: trip.title })),
      h('ul', { class: 'lv-card__lines' }, activeTripLines(trip, Math.floor(Date.now() / 1000)).map(t => h('li', { text: t }))),
      h('p', { class: 'fd-note', text: 'زمان ها برآورد برنامهٔ سفرند، نه موقعیت زندهٔ قطار یا خودرو. این کارت فقط روی همین دستگاه است و خودش پایان می یابد.' }),
      h('div', { class: 'fd-actions' },
        trip.ride && typeof actions.openStation === 'function' ? h('button', { type: 'button', class: ['cm-btn', 'cm-btn--ghost', 'cm-btn--sm'], onClick: () => actions.openStation(trip.ride.from) }, `تابلوی ایستگاه ${trip.ride.from}`) : null,
        h('button', { type: 'button', class: ['cm-btn', 'cm-btn--ghost', 'cm-btn--sm'], onClick: () => { store.endActiveTrip?.(); drawLive(); } }, 'پایان سفر'))));
  }
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
    const open_ = h('button', { type: 'button', class: ['sg-card', `sg-card--${card.kind}`], dataset: { id: card.id }, onClick: () => open(card) },
      h('span', { class: 'sg-card__ico' }, icon(card.kind === 'transit' ? 'tram_fill' : 'bag_fill')),
      h('span', { class: 'sg-card__body' }, h('b', { text: card.title }), h('span', { class: 'sg-card__why', text: card.why }), h('span', { class: 'sg-card__detail', text: card.detail })),
      icon('chevron_left'));
    // Without a store that can remember it (older callers), the card stays a plain button.
    if (typeof store?.dismissSuggestion !== 'function') return open_;
    return h('div', { class: 'sg-item' }, open_,
      h('button', { type: 'button', class: 'sg-dismiss', dataset: { dismiss: card.id }, 'aria-label': `این پیشنهاد به دردم نخورد: ${card.title}`,
        onClick: () => { store.dismissSuggestion(card.id); drawSuggestions(); } }, 'به دردم نخورد'));
  }
  const hiddenIds = () => new Set(store?.dismissedSuggestions?.() ?? []);
  function drawSuggestions() {
    const s = suggestions;
    if (s.status === 'error' || (s.status === 'idle')) { sugHost.replaceChildren(); sugHost.hidden = true; return; }
    sugHost.hidden = false;
    const gone = hiddenIds(), visible = s.cards.filter(c => !gone.has(c.id)), hidden = s.cards.length - visible.length;
    if (s.status === 'loading') { sugHost.replaceChildren(h('div', { class: 'cm-skel sg-skeleton', 'aria-busy': 'true' })); return; }
    sugHost.replaceChildren(...[
      h('div', { class: 'section-head' }, h('h2', { text: 'پیشنهاد حالا' })),
      h('div', { class: 'sg-intents fd-scroll', role: 'group', 'aria-label': 'موضوع پیشنهاد' },
        INTENTS.map(([id, label]) => h('button', {
          type: 'button', class: ['cm-chip','fd-chip'], 'aria-pressed': String(chosenIntent === id),
          onClick: () => { if (chosenIntent !== id) { chosenIntent = id; load(lastPoint); } },
        }, label))),
      ...visible.map(cardEl),
      hidden > 0 ? h('div', { class: 'sg-hidden' },
        h('span', { text: visible.length ? `${hidden} پیشنهاد را پنهان کرده اید.` : 'پیشنهادهای این زمان را پنهان کرده اید؛ تا یک هفته دوباره نشان داده نمی شوند.' }),
        h('button', { type: 'button', class: 'sg-restore', onClick: () => { store.clearDismissed?.(); drawSuggestions(); } }, 'نمایش دوباره')) : null,
      !s.locationUsed ? h('button', { type: 'button', class: ['cm-btn', 'cm-btn--ghost', 'cm-btn--sm', 'sg-locate'], onClick: withPosition }, 'ایستگاه نزدیک من را هم نشان بده') : null,
      h('p', { class: 'fd-note', text: s.note }),
    ].filter(Boolean));
  }

  root.append(
    h('div', { class: 'home-greeting' }, h('div', {}, h('p', { class: 'eyebrow', text: 'بِسراه' }), h('h1', { text: 'سلام! امروز چه برنامه‌ای دارید؟' }))),
    liveHost,
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
      drawLive(); clearInterval(liveTimer); liveTimer = null;
      // Refresh only while a trip is running; never keep a timer alive for nothing (and never hold a test process open).
      if (store?.activeTrip?.()) { liveTimer = setInterval(() => { drawLive(); if (!store.activeTrip?.()) { clearInterval(liveTimer); liveTimer = null; } }, 30_000); liveTimer?.unref?.(); }
      if (suggestions.status === 'loading' || (Date.now() - lastAt < REFRESH_MS && suggestions.status === 'ok')) return;
      if (store?.suggestLocation?.()) withPosition(); else load(null);
    },
    onHide() { controller?.abort(); clearInterval(liveTimer); liveTimer = null; },
  };
}
