// New home (three services, route card) and the shared two-tab switcher.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHomeView } from './views/home.js';
import { segmented, TRANSPORT_TABS } from './ui/segmented.js';
import { createNavigation } from './navigation.js';
import { SERVICES } from './services.js';
import { installFoodDom, findAll, byClass } from './test-support/food-dom.mjs';

const click = node => node.listeners.get('click')({ type: 'click', target: node });

test('home shows exactly the three services, a destination-first card, and each control is wired to its own destination', t => {
  installFoodDom(t); globalThis.fetch = () => Promise.reject(new Error('offline'));
  const calls = [];
  const view = createHomeView({ api: { homeSuggestions: async () => ({ cards: [], note: '' }) }, store: { suggestLocation: () => false },
    actions: { go: (v, o) => calls.push(['go', v, o]), serviceAction: s => calls.push(['service', s.id]), heroAction: a => calls.push(['hero', a.id]), openStation: n => calls.push(['station', n]) } });
  const tiles = findAll(view.el, n => n.className === 'sv-tile');
  assert.deepEqual(tiles.map(n => n.dataset.service), ['besrah', 'food', 'pay']);
  assert.deepEqual(SERVICES.map(s => s.id), ['besrah', 'food', 'pay']);
  tiles.forEach(click); click(byClass(view.el, 'rt-card'));
  findAll(view.el, n => n.className === 'sc-chip').forEach(click);
  assert.deepEqual(calls, [['service', 'besrah'], ['service', 'food'], ['service', 'pay'], ['go', 'trip', { focus: 'to' }], ['hero', 'locate'], ['go', 'saved', undefined], ['go', 'services', undefined]]);
  const text = view.el.textContent;
  assert.match(text, /کجا می روید/); assert.match(text, /از موقعیت فعلی شما/); assert.match(text, /هر عدد با منشأش می آید/);
  assert.match(text, /بسخرید/); assert.doesNotMatch(text, /رهیاب|مبدأ\n?مقصد/);
});

test('segmented tabs select once, ignore the active tab and move with the arrow keys', t => {
  installFoodDom(t);
  const picked = [];
  const seg = segmented({ tabs: TRANSPORT_TABS, active: 'metro', label: 'x', onSelect: id => picked.push(id) });
  const [metro, trip] = findAll(seg, n => n.tagName === 'button');
  assert.equal(metro.getAttribute('aria-selected'), 'true'); assert.equal(trip.getAttribute('aria-selected'), 'false'); assert.equal(trip.getAttribute('tabindex'), '-1');
  click(metro); click(trip);
  seg.listeners.get('keydown')({ key: 'ArrowLeft' }); seg.listeners.get('keydown')({ key: 'Enter' });
  assert.deepEqual(picked, ['trip', 'trip']);
});

test('navigation.replace swaps the current entry without stacking history, and refuses unknown routes', () => {
  const nav = createNavigation();
  nav.go('metro'); assert.equal(nav.index(), 1);
  assert.equal(nav.replace('trip'), true); assert.equal(nav.current(), 'trip'); assert.equal(nav.index(), 1);
  assert.equal(nav.replace('nowhere'), false); assert.equal(nav.current(), 'trip');
  assert.equal(nav.back().view, 'home');
});
