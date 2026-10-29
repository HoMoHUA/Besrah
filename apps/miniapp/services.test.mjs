import test from 'node:test';
import assert from 'node:assert/strict';
import { SERVICES, homeLayout, isLive, filterServices } from './services.js';

test('one metro product contains both lines; other products are visibly unavailable', () => {
  assert.deepEqual(SERVICES.map(s => s.id), ['metro', 'bus', 'route', 'taxi']);
  assert.deepEqual(SERVICES.filter(isLive).map(s => s.id), ['metro']);
  const metro = SERVICES[0];
  assert.equal(metro.title, 'ریل');
  assert.deepEqual(metro.action, { type: 'view', view: 'metro' });
  for (const service of SERVICES) {
    assert.ok(service.subtitle && service.blurb && service.logo);
    assert.match(service.logo, /^assets\/services\/[a-z]+\.svg$/);
    if (!isLive(service)) { assert.equal(service.status, 'soon'); assert.equal(service.action, undefined); }
  }
  assert.equal(new Set(SERVICES.map(s => s.title)).size, SERVICES.length);
});

test('home lays out every product once, not only products marked live', () => {
  const layout = homeLayout();
  assert.deepEqual(layout.primary.map(s => s.id), ['metro', 'bus', 'route']);
  assert.deepEqual(layout.secondary.map(s => s.id), ['taxi']);
  assert.equal(layout.moreCount, 0);
  assert.deepEqual([...layout.primary, ...layout.secondary, ...layout.more], SERVICES);
  const more = [...SERVICES, ...Array.from({ length: 5 }, (_, i) => ({ id: 'extra' + i }))];
  const l = homeLayout(more);
  assert.equal(l.moreCount, 3);
  assert.deepEqual([...l.primary, ...l.secondary, ...l.more], more);
});

test('global search matches product names and categories, never station records', () => {
  assert.deepEqual(filterServices('ریل').map(s => s.id), ['metro']);
  assert.deepEqual(filterServices('مترو').map(s => s.id), ['metro']);
  assert.deepEqual(filterServices('اتوبوس').map(s => s.id), ['bus']);
  assert.deepEqual(filterServices('  كاروان ').map(s => s.id), ['bus']);
  assert.deepEqual(filterServices('غدیر'), []);
  assert.deepEqual(filterServices(''), SERVICES);
  assert.deepEqual(filterServices('<script>'), []);
});
