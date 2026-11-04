// Test-only: browser primitives the real Metro view needs on top of the food DOM shim, plus a stub context.
import { installFoodDom, findAll } from './food-dom.mjs';
import { createState } from '../state.js';

export const stations = [{ id: 'METRO-101', name: 'ابتدا', lines: [1] }, { id: 'METRO-117', name: 'مشترک', lines: [1, 2] }, { id: 'METRO-201', name: 'طبرسی', lines: [2] }];
export const registry = () => createState({ status: 'ready', stations, order: ['ابتدا', 'مشترک'], order2: ['طبرسی', 'مشترک'] });
export const config = { enabled: true, feedbackEnabled: false, rolloutPercent: 0, calendarMode: 'weekday_baseline', horizonDays: 7, windowMinutes: 120 };

export function installMetroDom(t) {
  installFoodDom(t); const proto = Object.getPrototypeOf(document.createElement('div'));
  const match = (n, selector) => {
    if (selector.startsWith('#')) return n.getAttribute('id') === selector.slice(1);
    if (selector.startsWith('.')) return n.className.split(' ').includes(selector.slice(1));
    const data = selector.match(/^\[data-([\w-]+)(?:="([^"]+)")?\]$/);
    if (data) return n.dataset[data[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] !== undefined && (!data[2] || n.dataset[data[1]] === data[2]);
    return n.tagName === selector;
  };
  proto.querySelectorAll = function (s) { return findAll(this, n => s.split(',').some(part => match(n, part.trim()))); };
  proto.querySelector = function (s) { return this.querySelectorAll(s)[0] ?? null; };
  proto.removeAttribute = function (k) { delete this.attributes[k]; };
  proto.focus = function () { document.activeElement = this; this.listeners.get('focus')?.({ target: this }); };
  proto.blur = function () { if (document.activeElement === this) document.activeElement = null; };
  proto.click = function () { return this.listeners.get('click')?.({ target: this }); };
  const scrolls = []; proto.scrollIntoView = function (options) { scrolls.push({ node: this, options }); };
  proto.contains = function (n) { return n === this || findAll(this, x => x === n).length > 0; };
  proto.remove = function () {};
  // Real DOM allows several listeners per event; the base shim keeps one. Accumulate so each view's handler runs.
  proto.addEventListener = function (name, fn) { const prev = this.listeners.get(name); this.listeners.set(name, prev ? async e => { await prev(e); return fn(e); } : fn); };
  proto.closest = function (s) { return match(this, s) ? this : null; };
  Object.defineProperty(proto, 'hidden', { configurable: true, get() { return this.attributes.hidden !== undefined; }, set(v) { if (v) this.attributes.hidden = ''; else delete this.attributes.hidden; } });
  Object.defineProperty(proto, 'classList', { configurable: true, get() { const el = this; return { add(...names) { el.className = [...new Set([...el.className.split(' ').filter(Boolean), ...names])].join(' '); }, remove(...names) { el.className = el.className.split(' ').filter(n => !names.includes(n)).join(' '); }, toggle(n, on) { on ??= !el.className.split(' ').includes(n); on ? this.add(n) : this.remove(n); return on; } }; } });
  Object.defineProperty(proto, 'style', { configurable: true, get() { return { setProperty() {} }; } });
  const events = new Map(); document.addEventListener = (n, fn) => events.set(n, fn); document.removeEventListener = n => events.delete(n);
  document.hidden = false; document.visibilityState = 'visible'; document.activeElement = null;
  return { events, scrolls };
}

export function metroContext() {
  const state = registry(); state.set({ nearest: { phase: 'idle' }, recent: null, asOf: null, maxKm: 10, view: 'metro' });
  const calls = [], trains = [], nav = []; let enabled = true;
  const api = { beta: async () => ({ ...config, enabled }), next: (name, options) => { calls.push({ name, ...options }); return Promise.resolve({ passes: [], as_of: '10:00:00', day_type: 'normal', notes: ['یادداشت مدل'] }); },
    trains: (line, signal) => { trains.push({ line, signal }); return Promise.resolve({ order: ['ابتدا', 'مشترک'], trains: [], notes: [], as_of: '10:00:00' }); } };
  const fav = new Set(); const store = { recents: () => [], clearRecents() {}, favourites: () => [...fav], isFavourite: n => fav.has(n), toggleFavourite(n) { fav.has(n) ? fav.delete(n) : fav.add(n); return { on: fav.has(n) }; }, addRecent() {}, setLast() {} };
  const modes = [];
  const actions = { metroModeChanged: on => modes.push(on), back() {}, go: view => nav.push(view), reload() {}, openStation() {}, unsupported() {}, heroAction() {}, locate: () => nav.push('locate') };
  return { state, api, store, actions, calls, trains, modes, nav, off() { enabled = false; } };
}
export { findAll };
