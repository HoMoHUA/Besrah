import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const network = JSON.parse(readFileSync(new URL('data/network.json', root), 'utf8'));
const metro = { stations: network.stations, line1: network.lines['1'].order_vakilabad_to_airport, line2: network.lines['2'].order_tabarsi_to_fakouri, maxNearestKm: 10 };
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
      for (const name of [...metro.line1, ...metro.line2]) assert.ok(result.reply_text.includes(name), name);
      assert.ok(result.reply_text.includes('خط ۱') && result.reply_text.includes('خط ۲'));
    }
  }
});

test('app command returns the configured trusted Mini App URL without a timing request', () => {
  const result = normalize(message('/app'), { metro: { ...metro, appUrl: 'https://besrah.arklyn.ir/' } });
  assert.equal(result.kind, 'app');
  assert.equal(result.route, 'reply');
  assert.ok(result.reply_text.includes('https://besrah.arklyn.ir/'));
});

test('help lists every supported user-facing command', () => {
  const result = normalize(message('/help'));
  for (const command of ['/start', '/help', '/stations', '/app', '/about', '/privacy']) {
    assert.ok(result.reply_text.includes(command), command + ' must be discoverable');
  }
});

test('about and privacy commands describe real limits and temporary execution retention', () => {
  const about = normalize(message('/about'));
  assert.equal(about.kind, 'about');
  assert.ok(about.reply_text.includes('Besrah'));
  assert.ok(about.reply_text.includes('خط ۱') && about.reply_text.includes('خط ۲'));
  assert.equal(about.reply_text.includes('خط ۲ و مسیریابی ترکیبی هنوز فعال نیستند'), false);
  assert.ok(about.reply_text.includes('مسیریابی ترکیبی هنوز فعال نیست'));
  const privacy = normalize(message('/privacy'));
  assert.equal(privacy.kind, 'privacy');
  assert.ok(privacy.reply_text.includes('پاک سازی'));
  assert.ok(privacy.reply_text.includes('دستگاه'));
  assert.equal(privacy.reply_text.includes('ذخیره نمی شود'), false);
  assert.ok(privacy.reply_text.includes('علاقه مندی'), 'must disclose on-device favourites');
  assert.ok(privacy.reply_text.includes('نام ایستگاه'), 'must say only station names are kept');
  assert.equal(privacy.reply_text.includes('موقعیت را ذخیره'), false);
});

test('line 2 stations are normal timing queries; Shariati (both lines) is one query', () => {
  for (const [text, station] of [['راه آهن', 'راه‌آهن'], ['طبرسی', 'طبرسی'], ['مفتح', 'مفتح'], ['شریعتی', 'شریعتی'], ['ایستگاه سعدی', 'سعدی']]) {
    const result = normalize(message(text));
    assert.equal(result.route, 'query', text);
    assert.equal(result.station, station, text);
    assert.equal(result.kind, 'station');
  }
});

test('a line 2 station can be typed without the «شهید» prefix, but only when that is unambiguous', () => {
  assert.equal(normalize(message('فکوری')).station, 'شهید فکوری');
  assert.equal(normalize(message('کاوه')).station, 'شهید کاوه');
  assert.equal(normalize(message('شهید فکوری')).station, 'شهید فکوری');
  assert.equal(normalize(message('شهید')).kind, 'unknown');
  assert.equal(normalize(message('شهدا')).station, 'شهدا');
});

test('a station on no supported line is still refused instead of silently mapped', () => {
  const limited = { ...metro, line2: [] };
  const result = normalize(message('طبرسی'), { metro: limited });
  assert.equal(result.route, 'reply');
  assert.equal(result.kind, 'unsupported_line');
  assert.match(result.reply_text, /پشتیبانی/);
});

test('location finds nearest across all stations and reports straight-line distance without retaining GPS', () => {
  for (const station of metro.stations) {
    const result = normalize(message(undefined, { location: { latitude: station.lat, longitude: station.lon } }));
    if (metro.line1.includes(station.name) || metro.line2.includes(station.name)) {
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
