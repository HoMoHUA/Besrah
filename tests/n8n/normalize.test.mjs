import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const network = JSON.parse(readFileSync(new URL('data/network.json', root), 'utf8'));
const metro = { stations: network.stations, line1: network.lines['1'].order_vakilabad_to_airport, maxNearestKm: 10 };
function normalize(message, extra = {}) {
  const file = new URL('integrations/n8n/normalize.js', root);
  assert.ok(existsSync(file), 'normalize Code node source must exist');
  const result = vm.runInNewContext(`(function() {${readFileSync(file, 'utf8')}\n})()`, {
    $json: { message, metro, ...extra },
  }, { timeout: 1000 });
  return result === null ? null : JSON.parse(JSON.stringify(result.json));
}
const message = (text, more = {}) => ({ chat: { id: 123456789, type: 'private' }, from: { is_bot: false }, text, ...more });

test('Persian station lookup ignores spacing, diacritics, Arabic yeh and kaf', () => {
  for (const text of ['وكيل آباد', ' وکیل  آباد ', 'وکیلآباد', 'وَکیل‌آباد', 'ایستگاه وكيل آباد']) {
    assert.equal(normalize(message(text)).station, 'وکیل‌آباد', text);
  }
  assert.equal(normalize(message('هفت تير')).station, 'هفت‌تیر');
  assert.equal(normalize(message('دانش آموز')).station, 'دانش‌آموز');
});

test('private human messages only: bot, group, channel and malformed updates are dropped', () => {
  for (const update of [undefined, {}, message('وکیل‌آباد', { from: { is_bot: true } }),
    message('وکیل‌آباد', { chat: { id: -55, type: 'group' } }),
    message('وکیل‌آباد', { chat: { id: -66, type: 'supergroup' } }),
    message('وکیل‌آباد', { chat: { id: 77, type: 'channel' } }),
    message('وکیل‌آباد', { chat: { type: 'private' } }),
    message('وکیل‌آباد', { from: undefined })]) {
    assert.equal(normalize(update), null);
  }
});

test('commands and unknown input become safe local replies without a core request', () => {
  for (const [text, kind] of [['/start', 'help'], ['/help', 'help'], ['/start@besrah_bot', 'help'],
    ['/stations', 'stations'], ['<b>نام ناشناخته &</b>', 'unknown'], ['/unknown', 'unknown'], [undefined, 'help']]) {
    const result = normalize(message(text));
    assert.equal(result.route, 'reply');
    assert.equal(result.kind, kind);
    assert.equal(result.chat_id, 123456789);
    assert.ok(result.reply_text.length > 0);
    assert.equal('station' in result, false);
    if (kind === 'stations') {
      for (const name of metro.line1) assert.ok(result.reply_text.includes(name));
      assert.equal(result.reply_text.includes('طبرسی'), false);
    }
  }
});

test('known line 2 station is unsupported rather than silently mapped to line 1', () => {
  const result = normalize(message('راه آهن'));
  assert.equal(result.route, 'reply');
  assert.equal(result.kind, 'unsupported_line');
  assert.match(result.reply_text, /خط ۲/);
  assert.match(result.reply_text, /پشتیبانی/);
  assert.equal(normalize(message('شریعتی')).route, 'query');
});

test('location finds nearest across all stations and reports straight-line distance without retaining GPS', () => {
  for (const station of metro.stations) {
    const result = normalize(message(undefined, { location: { latitude: station.lat, longitude: station.lon } }));
    if (metro.line1.includes(station.name)) {
      assert.equal(result.route, 'query');
      assert.equal(result.station, station.name);
      assert.equal(result.kind, 'location');
      assert.ok(result.distance_km < 0.001);
    } else {
      assert.equal(result.kind, 'unsupported_line');
      assert.ok(result.reply_text.includes(station.name));
    }
    assert.equal('location' in result, false);
    assert.equal('latitude' in result, false);
    assert.equal('metro' in result, false);
  }
  const near = normalize(message(undefined, { location: { latitude: 36.3471444, longitude: 59.4422694 } }));
  assert.equal(near.station, 'وکیل‌آباد');
  assert.ok(near.distance_km > 0.11 && near.distance_km < 0.12);
});

test('invalid GPS coordinates are rejected without coercion or a core request', () => {
  for (const location of [null, {}, { latitude: NaN, longitude: 59 }, { latitude: Infinity, longitude: 59 },
    { latitude: 91, longitude: 59 }, { latitude: -91, longitude: 59 }, { latitude: 36, longitude: 181 },
    { latitude: 36, longitude: -181 }, { latitude: '36.3', longitude: 59 },
    { latitude: null, longitude: 59 }, { latitude: 36, longitude: false }]) {
    const result = normalize(message(undefined, { location }));
    assert.equal(result.route, 'reply');
    assert.equal(result.kind, 'invalid_location');
  }
});

test('service radius rejects distant coordinates before line support and honors local configuration', () => {
  for (const location of [{ latitude: 35.6892, longitude: 51.389 }, { latitude: 0, longitude: 0 },
    { latitude: 36.5, longitude: 59.9 }]) {
    const result = normalize(message(undefined, { location }));
    assert.equal(result.kind, 'outside_service_area');
    assert.equal(result.route, 'reply');
    assert.match(result.reply_text, /محدوده/);
  }
  const location = { latitude: 36.3471444, longitude: 59.4422694 };
  assert.equal(normalize(message(undefined, { location }), { metro: { ...metro, maxNearestKm: 0.05 } }).kind, 'outside_service_area');
});

test('welcome uses the owner-approved Besrah Persian name', () => {
  const result = normalize(message('/start'));
  assert.ok(result.reply_text.includes('بِسراه'));
  assert.equal(result.reply_text.includes('بِسرَه'), false);
});

test('supported station becomes canonical core query and preserves chat ID', () => {
  const result = normalize(message('وکیل‌آباد'));
  assert.equal(result.route, 'query');
  assert.equal(result.station, 'وکیل‌آباد');
  assert.equal(result.chat_id, 123456789);
  assert.equal(result.kind, 'station');
  assert.equal('message' in result, false);
});
