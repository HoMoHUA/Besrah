import test from 'node:test';
import assert from 'node:assert/strict';
import { SERVICES, homeLayout, isLive, filterServices } from './services.js';

test('Besrah is one transport service; food and pay are visibly unavailable siblings', () => {
  assert.deepEqual(SERVICES.map(s => s.id), ['besrah', 'food', 'trip', 'shop', 'pay']);
  assert.deepEqual(SERVICES.filter(isLive).map(s => s.id), ['besrah', 'food', 'trip', 'shop']);
  const besrah = SERVICES[0];
  assert.equal(besrah.title, 'بسراه');
  assert.deepEqual(besrah.action, { type: 'view', view: 'metro' });
  for (const service of SERVICES) {
    assert.ok(service.subtitle && service.blurb && service.logo);
    assert.match(service.logo, /^assets\/services\/[a-z]+\.svg$/);
    if (!isLive(service)) { assert.equal(service.status, 'soon'); assert.equal(service.action, undefined); }
  }
  assert.equal(new Set(SERVICES.map(s => s.title)).size, SERVICES.length);
});

test('home lays out every product once, not only products marked live', () => {
  const layout = homeLayout();
  assert.deepEqual(layout.primary.map(s => s.id), ['besrah', 'food', 'trip']);
  assert.deepEqual(layout.secondary.map(s => s.id), ['shop', 'pay']);
  assert.equal(layout.moreCount, 0);
  assert.deepEqual([...layout.primary, ...layout.secondary, ...layout.more], SERVICES);
  const more = [...SERVICES, ...Array.from({ length: 5 }, (_, i) => ({ id: 'extra' + i }))];
  const l = homeLayout(more);
  assert.equal(l.moreCount, SERVICES.length + 5 - 6);
  assert.deepEqual([...l.primary, ...l.secondary, ...l.more], more);
});

test('global search matches product names and categories, never station records', () => {
  assert.deepEqual(filterServices('بسراه').map(s => s.id), ['besrah']);
  assert.deepEqual(filterServices('مترو').map(s => s.id), ['besrah']);
  assert.deepEqual(filterServices('اتوبوس').map(s => s.id), ['besrah']);
  assert.deepEqual(filterServices('  بسفود ').map(s => s.id), ['food']);
  assert.deepEqual(filterServices('غدیر'), []);
  assert.deepEqual(filterServices(''), SERVICES);
  assert.deepEqual(filterServices('<script>'), []);
});
