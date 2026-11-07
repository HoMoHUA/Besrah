import test from 'node:test';
import assert from 'node:assert/strict';
import { BUS_ARRIVAL_SOURCES, busHandoffNote, sourceById, openBusSource } from './bus-sources.js';

test('arrival sources are allowlisted public landing pages, never pretend stop-specific deep links', () => {
  assert.deepEqual(BUS_ARRIVAL_SOURCES.map(s => s.url), ['https://map.mashhad.ir/', 'https://neshan.org/maps']);
  assert.equal(Object.isFrozen(BUS_ARRIVAL_SOURCES), true);
  assert.equal(sourceById('missing'), null);
  assert.equal(sourceById('neshan_map').type, 'provider_public_page');
  for (const src of BUS_ARRIVAL_SOURCES) {
    assert.equal(src.url.includes('?'), false);
    assert.equal(src.url.includes('#'), false);
    assert.equal(Object.isFrozen(src), true);
  }
});
test('stop labels never enter URL and are not claimed to be official stop ids', () => {
  assert.match(busHandoffNote('ایستگاه نمونه'), /ایستگاه نمونه/);
  assert.match(busHandoffNote('ایستگاه نمونه'), /همان کد\/سکوی رسمی نیست/);
  assert.match(busHandoffNote(''), /ایستگاه موردنظر/);
  let opened = null;
  const host = { window: { Telegram: { WebApp: { openLink(url) { opened = url; } } } } };
  assert.equal(openBusSource('mashhad_map', host), true);
  assert.equal(opened, 'https://map.mashhad.ir/');
  assert.equal(openBusSource('javascript:alert(1)', host), false);
  assert.equal(opened, 'https://map.mashhad.ir/');
});
test('browser external-link fallback uses noopener and does not request geolocation', () => {
  let values;
  assert.equal(openBusSource('neshan_map', {window: {open(...x) {values=x;}}}), true);
  assert.deepEqual(values,['https://neshan.org/maps','_blank','noopener,noreferrer']);
  assert.equal(openBusSource('neshan_map', {}), false);
});
