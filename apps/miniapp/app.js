// Besrah Mini App entry. Vanilla ES modules, no build step. The page is a super-app style home built from the
// HM7 Commerce design system; all data comes from api/stations and api/next (schedule-based estimates).
import { createApi } from './api.js';
import { createSequencer } from './async.js';
import { nearestStation, requestPosition } from './logic.js';
import { createState } from './state.js';
import { createStore } from './store.js';
import { createTelegram } from './tg.js';
import { createSheetHost } from './ui/sheet.js';
import { createServiceSearch } from './ui/service-search.js';
import { rotatePlaceholder } from './ui/rotating-placeholder.js';
import { createServiceStore } from './service-store.js';
import { NAV_VIEWS, ROUTES, activeNav, createNavigation } from './navigation.js';
import { createStationSheet } from './ui/station.js';
import { $, h, icon, reducedMotion } from './ui/dom.js';
import { bridgeHaptics, init, lensTabs, morph, setToastHost, toast } from './ui/hm7.js';
import { createAboutView } from './views/about.js';
import { createFavouritesView } from './views/favourites.js';
import { createHomeView } from './views/home.js';
import { createServicesView, roadmapList } from './views/services.js';
import { createMetroView } from './views/metro.js';
import { createBusView } from './views/bus.js';
import { createSettingsView } from './views/settings.js';
import { createSavedView } from './views/saved.js';
import { isLive } from './services.js';
import { isSupported, lineLabel } from './format.js';

const TITLES = { home: 'خانه', metro: 'مترو', bus: 'اتوبوس', saved: 'ذخیره ها', services: 'سرویس ها', favourites: 'ایستگاه های من', settings: 'تنظیمات', about: 'درباره' };
const navigation = createNavigation();
try { history.replaceState({ besrahRoute: 'home', besrahIndex: 0 }, ''); } catch { /* embedded browser */ }

const tg = createTelegram(window);
tg.start();

const safeStorage = (() => { try { return window.localStorage; } catch { return undefined; } })();
const store = createStore(safeStorage);
const serviceStore = createServiceStore(safeStorage);
const api = createApi();
const state = createState({
  status: 'loading', stations: [], order: [], order2: [], maxKm: 10, view: 'home',
  nearest: { phase: 'idle' }, recent: null, asOf: null,
});
const boardSeq = createSequencer();   // nearest-station board
const heroSeq = createSequencer();    // last-viewed / favourite summary
const stationsSeq = createSequencer();

const appEl = $('#app'), panel = $('#panel'), nav = $('#nav');
setToastHost($('#toasts'));
const announce = text => { const el = $('#announce'); el.textContent = ''; setTimeout(() => { el.textContent = text; }, 30); };

/* ── theme ── */
const themeApi = window.BesrahTheme;
function syncTelegramColors() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  tg.applyColors({ header: bg, background: bg, bottom: bg });
}
function applyTheme(pref = store.themePref()) {
  themeApi?.apply(pref);
  syncTelegramColors();
  views.settings?.syncTheme(pref);
  paintMenu();
}
function setTheme(pref) { store.setThemePref(pref); applyTheme(pref); }
tg.onThemeChanged(() => { if (store.themePref() === 'auto') applyTheme('auto'); });
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => { if (store.themePref() === 'auto') applyTheme('auto'); });
syncTelegramColors();

/* ── sheets ── */
const sheet = createSheetHost({ root: $('#sheet-root'), appEl, onChange: () => updateBack() });
const stationSheet = createStationSheet({
  sheet, api, store,
  getStations: () => state.get().stations,
  getOrders: () => ({ 1: state.get().order, 2: state.get().order2 }),
  onBoard(name, data) {
    const patch = { asOf: data.as_of };
    const { recent } = state.get();
    if (recent?.station === name) patch.recent = { ...recent, phase: 'ok', board: data };
    state.set(patch);
  },
  onRecent(name) {
    const { recent } = state.get();
    state.set({ recent: { station: name, source: 'last', phase: recent?.station === name ? recent.phase : 'loading', board: recent?.station === name ? recent.board : undefined } });
  },
});

function unsupported(station) {
  toast({ title: `${station.name}، ${lineLabel(station.lines)}`, text: 'زمان رسیدن برای خط این ایستگاه هنوز ساخته نشده است.', icon: 'info_circle_fill', life: 4200 });
}
function openStation(name) {
  const station = state.get().stations.find(s => s.name === name);
  if (!station) return;
  if (!isSupported(station)) return unsupported(station);
  if (state.get().view !== 'metro' && state.get().view !== 'favourites') go('metro');
  stationSheet.show(name);
}
function openRoadmap() {
  const content = h('div', { class: 'station roadmap' },
    h('div', { class: 'station__head' },
      h('div', { class: 'station__titles' }, h('h2', { class: 'station__name', id: 'road-title', tabindex: '-1', 'data-autofocus': '', text: 'سرویس های بعدی' }),
        h('p', { class: 'station__sub', text: 'هنوز ساخته نشده اند و تاریخی برایشان اعلام نشده است.' })),
      h('button', { class: 'cm-icon-btn cm-frost station__close el', type: 'button', 'aria-label': 'بستن', onClick: () => sheet.close() }, icon('xmark'))),
    h('div', { class: 'station__scroll' }, roadmapList()));
  sheet.open(content, { labelledBy: 'road-title' });
  init(content);
}

/* ── Navigation: global tabs and nested products keep separate identities. ── */
const views = {};
let lens = null;
const routeOpeners = new Map();
function showRoute(view, options = {}, scroll = 0) {
  const prev = state.get().view;
  views[prev]?.onHide?.();
  search?.close();
  panel.replaceChildren(views[view].el);
  panel.setAttribute('aria-label', TITLES[view]);
  state.set({ view });
  views[view].onShow?.(options);
  lens?.select(NAV_VIEWS.indexOf(activeNav(view)), true);
  nav.dataset.active = activeNav(view);
  nav.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-current', button.dataset.view === activeNav(view) ? 'page' : 'false'));
  window.scrollTo(0, scroll);
  document.title = `${TITLES[view]} · Besrah`;
  if (view === 'metro' && state.get().status === 'ready') loadRecent();
  updateBack();
}
function go(view, options = {}) {
  if (!ROUTES.includes(view)) return;
  const prev = navigation.current();
  if (view === prev) { views[view].onShow?.(options); return; }
  const opener = document.activeElement;
  navigation.go(view, window.scrollY);
  routeOpeners.set(navigation.index(), opener);
  try { history.pushState({ besrahRoute: view, besrahIndex: navigation.index() }, ''); } catch { /* route stack still works */ }
  showRoute(view, options);
}
function updateBack() { tg.setBack(sheet.isOpen || state.get().view !== 'home' ? onBack : null); }
function onBack() {
  if (sheet.isOpen) { sheet.close(); return; }
  if (navigation.index() === 0) return;
  if (history.state?.besrahIndex === navigation.index()) history.back();
  else { const entry = navigation.back(); if (entry) showRoute(entry.view, {}, entry.scroll); }
}
window.addEventListener('popstate', event => {
  // Sheet entries belong to the sheet host. Closing one returns to the unchanged route index.
  if (event.state?.besrahSheet || event.state?.besrahIndex === navigation.index()) return;
  const from = navigation.index();
  const entry = navigation.restore(event.state?.besrahIndex);
  if (!entry) return;
  showRoute(entry.view, {}, entry.scroll);
  const opener = routeOpeners.get(from);
  if (opener?.isConnected) opener.focus({ preventScroll: true });
});

/* ── nearest station: coordinates stay in this function and are never sent or stored ── */
let locating = false;
async function locate() {
  const s = state.get();
  if (locating) return;
  if (s.status !== 'ready') {
    if (s.status === 'error') return reload();
    return toast({ title: 'فهرست ایستگاه ها در حال دریافت است', text: 'چند لحظه بعد دوباره امتحان کنید.', icon: 'info_circle_fill' });
  }
  locating = true;
  if (state.get().view !== 'metro') go('metro');
  views.metro.focusHero();
  boardSeq.cancel();
  state.set({ nearest: { phase: 'loading' } });
  let code = null;
  const geo = navigator.geolocation && { getCurrentPosition: (ok, fail, opts) => navigator.geolocation.getCurrentPosition(ok, error => { code = error?.code ?? null; fail(error); }, opts) };
  try {
    const { latitude, longitude } = await requestPosition(tg.inTelegram ? tg.app : undefined, geo);
    const hit = nearestStation(s.stations, latitude, longitude, s.maxKm);
    if (!hit) { state.set({ nearest: { phase: 'error', reason: 'too_far' } }); announce('ایستگاهی در نزدیکی شما پیدا نشد'); return; }
    const station = { name: hit.station.name, lines: hit.station.lines };
    state.set({ nearest: { phase: 'ok', station, km: hit.km, boardPhase: isSupported(station) ? 'loading' : undefined } });
    announce(`نزدیک ترین ایستگاه ${station.name}`);
    if (isSupported(station)) {
      const result = await boardSeq.run(signal => api.next(station.name, { signal, limit: 10 }));
      if (result.stale) return;
      const nearest = state.get().nearest;
      if (result.ok) state.set({ nearest: { ...nearest, boardPhase: 'ok', board: result.value }, asOf: result.value.as_of });
      else state.set({ nearest: { ...nearest, boardPhase: 'error' } });
    }
  } catch {
    const denied = code === 1 || (tg.inTelegram && tg.app?.LocationManager?.isInited && tg.app.LocationManager.isAccessGranted === false);
    state.set({ nearest: { phase: 'error', reason: denied ? 'denied' : 'unavailable' } });
  } finally { locating = false; }
}

/* ── hero summary for the last viewed (or first favourite) station ── */
function pickRecent() {
  const known = new Set(state.get().stations.filter(isSupported).map(s => s.name));
  const last = store.last();
  if (last && known.has(last)) return { station: last, source: 'last' };
  const fav = store.favourites().find(n => known.has(n));
  return fav ? { station: fav, source: 'favourite' } : null;
}
async function loadRecent() {
  const pick = pickRecent();
  if (!pick) { state.set({ recent: null }); return; }
  state.set({ recent: { ...pick, phase: 'loading' } });
  const result = await heroSeq.run(signal => api.next(pick.station, { signal, limit: 10 }));
  if (result.stale) return;
  const current = state.get().recent;
  if (current?.station !== pick.station) return;
  if (result.ok) state.set({ recent: { ...current, phase: 'ok', board: result.value }, asOf: result.value.as_of });
  else state.set({ recent: { ...current, phase: 'error' } });
}

/* ── stations ── */
async function loadStations() {
  state.set({ status: 'loading' });
  const result = await stationsSeq.run(signal => api.stations(signal));
  if (result.stale) return;
  if (!result.ok) { state.set({ status: 'error' }); return; }
  const data = result.value;
  store.prune(data.stations.map(s => s.name));
  state.set({ status: 'ready', stations: data.stations, order: data.line1Order, order2: data.line2Order ?? [], maxKm: data.maxNearestKm ?? 10 });
  if (state.get().view === 'metro') loadRecent();
}
const reload = () => loadStations();
// Search ranks stations by route position on either line (line 1 first).
const combinedOrder = () => { const { order, order2 } = state.get(); return [...order, ...order2.filter(n => !order.includes(n))]; };

const actions = {
  go, back: onBack, openStation, locate, openRoadmap, reload, unsupported, setTheme,
  heroAction(action) {
    if (action.id === 'locate') locate();
    else if (action.id === 'open') openStation(action.station);
    else if (action.id === 'about') go('about');
  },
  serviceAction(service) {
    if (!isLive(service)) return toast({ title: service.title, text: 'این سرویس هنوز در دسترس نیست. زمان عرضه ای اعلام نشده است.', icon: 'info_circle_fill' });
    const a = service.action;
    if (a.type === 'view') go(a.view, { mode: a.mode });
    else if (a.type === 'locate') locate();
  },
};

const ctx = { state, store, serviceStore, actions, api, sheet };
views.home = createHomeView(ctx);
views.metro = createMetroView(ctx);
views.bus = createBusView(ctx);
views.settings = createSettingsView(ctx);
views.saved = createSavedView(ctx);
views.services = createServicesView(ctx);
views.favourites = createFavouritesView(ctx);
views.about = createAboutView(ctx);

/* ── header: search + menu ── */
const search = createServiceSearch({
  host: $('#search-host'), input: $('#q'), clearButton: $('#q-clear'), popup: $('#suggest'), listbox: $('#suggest-list'), live: $('#suggest-live'),
  onPick: actions.serviceAction,
});

rotatePlaceholder({ input: $('#q'), phrases: ['جست وجو', 'مترو مشهد', 'خط های اتوبوس', 'رفت و آمد شهری', 'بسفود، به زودی', 'بسپی، به زودی'] });

let menuApi = null;
function paintMenu() {
  const content = $('#menu-content');
  const pref = store.themePref();
  const item = (label, onClick, extra = {}) => h('button', { type: 'button', role: extra.role ?? 'menuitem', 'aria-checked': extra.checked, onClick: () => { onClick(); menuApi?.close(); } }, extra.icon && icon(extra.icon), h('span', { class: 'app-menu__label', text: label }), extra.checked === 'true' && icon('checkmark', 'app-menu__check'));
  content.replaceChildren(
    h('div', { class: 'cm-menu__label', role: 'presentation', text: 'پوسته' }),
    item('خودکار', () => setTheme('auto'), { role: 'menuitemradio', checked: String(pref === 'auto'), icon: 'circle_lefthalf_inset_filled' }),
    item('روشن', () => setTheme('light'), { role: 'menuitemradio', checked: String(pref === 'light'), icon: 'sun_max' }),
    item('تیره', () => setTheme('dark'), { role: 'menuitemradio', checked: String(pref === 'dark'), icon: 'moon' }),
    h('hr', { class: 'cm-divider', role: 'separator' }),
    item('تنظیمات', () => go('settings'), { icon: 'gearshape' }),
    item('درباره و حریم خصوصی', () => go('about'), { icon: 'info_circle' }));
  content.querySelectorAll('[aria-checked="true"]').forEach(b => b.setAttribute('aria-selected', 'true'));
}

/* ── start ── */
panel.append(views.home.el);
panel.setAttribute('aria-label', TITLES.home);
paintMenu();
init(document);
Object.values(views).forEach(v => v.mount?.());
menuApi = $('#menu')._hm7morph ?? morph($('#menu-btn'), $('#menu'));
lens = lensTabs(nav, index => { const view = NAV_VIEWS[index]; if (view && view !== state.get().view) go(view); });
bridgeHaptics(tg);
tg.setBack(null);
window.addEventListener('pageshow', () => syncTelegramColors());
loadStations();
