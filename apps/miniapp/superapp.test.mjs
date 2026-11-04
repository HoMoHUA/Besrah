import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = file => readFileSync(new URL(file, import.meta.url), 'utf8');
test('home is product discovery, not a timetable or a location lookup', () => {
  const home = source('views/home.js');
  for (const leak of ['buildSlides', 'paintRail', 'focusHero', 'station-chip', 'api.next', 'ایستگاه های خط']) assert.equal(home.includes(leak), false, leak);
  assert.ok(home.includes('hero-brand.svg'));
});
test('metro owns discovery, route lists, station favourites and its confidence explanation', () => {
  const metro = source('views/metro.js');
  for (const capability of ['createSearchBox', 'createStationsView', 'buildSlides', 'favourites', 'فاز']) assert.ok(metro.includes(capability), capability);
});
test('global tab order matches the route contract and contains no station tab', () => {
  const html = source('index.html');
  assert.deepEqual([...html.matchAll(/data-view="([^"]+)"/g)].map(m => m[1]), ['home','saved','services','settings','profile']);
  assert.ok(html.includes('سرویس ها'));
  assert.ok(!html.includes('placeholder="جست وجوی ایستگاه ها"'));
});

test('the raised hub is not duplicated by the magnification lens', () => {
  assert.ok(source('app.js').includes('nav.dataset.active = activeNav(view)'));
  assert.ok(source('app.css').includes('.app-nav[data-active="services"] .hm7-lens { visibility: hidden; }'));
});
