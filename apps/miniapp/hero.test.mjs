import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSlides } from './hero.js';

const board = (as_of = '20:27:13') => ({ as_of, passes: [{ toward: 'غدیر', eta_min: 3 }, { toward: 'وکیل‌آباد', eta_min: 5 }, { toward: 'غدیر', eta_min: 18 }] });
const byId = (slides, id) => slides.find(s => s.id === id);

test('before the user asks, the location slide is only a call to action', () => {
  const slides = buildSlides({ locate: { phase: 'idle' }, recent: null, asOf: null });
  assert.deepEqual(slides.map(s => s.id), ['locate', 'note']);
  const s = byId(slides, 'locate');
  assert.equal(s.state, 'cta');
  assert.deepEqual(s.action, { id: 'locate', label: 'یافتن نزدیک ترین ایستگاه' });
  assert.equal(s.lines.some(l => /\d|[۰-۹]/.test(l)), false, 'no invented numbers before data exists');
});

test('after a successful lookup it shows the real board summary, distance and server time', () => {
  const s = byId(buildSlides({
    locate: { phase: 'ok', station: { name: 'شریعتی', lines: [1, 2] }, km: 0.42, boardPhase: 'ok', board: board() }, recent: null, asOf: '20:27:13',
  }), 'locate');
  assert.equal(s.kicker, 'قطار بعدی نزدیک شما');
  assert.equal(s.title, 'شریعتی');
  assert.deepEqual(s.lines, ['به سمت غدیر: ۳ دقیقه', 'به سمت وکیل‌آباد: ۵ دقیقه']);
  assert.match(s.meta, /۴۲۰ متر/);
  assert.match(s.meta, /۲۰:۲۷ به وقت تهران/);
  assert.deepEqual(s.action, { id: 'open', label: 'تابلوی کامل', station: 'شریعتی' });
});

test('a nearest station on line 2 is reported honestly with no fake times', () => {
  const s = byId(buildSlides({ locate: { phase: 'ok', station: { name: 'طبرسی', lines: [2] }, km: 1.2 }, recent: null, asOf: null }), 'locate');
  assert.equal(s.state, 'unsupported');
  assert.match(s.lines.join(' '), /خط ۲/);
  assert.match(s.lines.join(' '), /هنوز/);
  assert.equal(s.action, null);
});

test('denied, unavailable, too far and offline each get their own honest message and a retry', () => {
  const texts = new Set();
  for (const reason of ['denied', 'unavailable', 'too_far', 'offline']) {
    const s = byId(buildSlides({ locate: { phase: 'error', reason }, recent: null, asOf: null }), 'locate');
    assert.equal(s.state, 'error'); assert.equal(s.action.id, 'locate'); texts.add(s.lines.join('|'));
  }
  assert.equal(texts.size, 4);
});

test('the too-far message uses the API distance limit, not a hard-coded one', () => {
  const s = byId(buildSlides({ locate: { phase: 'error', reason: 'too_far', maxKm: 8 } }), 'locate');
  assert.match(s.title, /۸ کیلومتری/);
});

test('loading states are busy and carry no data', () => {
  const s = byId(buildSlides({ locate: { phase: 'loading' }, recent: null, asOf: null }), 'locate');
  assert.equal(s.busy, true); assert.equal(s.action, null);
  const t = byId(buildSlides({ locate: { phase: 'ok', station: { name: 'قائم', lines: [1] }, km: 2, boardPhase: 'loading' }, recent: null, asOf: null }), 'locate');
  assert.equal(t.busy, true);
});

test('the station slide exists only when there is a last viewed or favourite station', () => {
  assert.equal(byId(buildSlides({ locate: { phase: 'idle' }, recent: null, asOf: null }), 'station'), undefined);
  const s = byId(buildSlides({ locate: { phase: 'idle' }, recent: { station: 'غدیر', source: 'favourite', phase: 'ok', board: board('20:30:00') }, asOf: '20:30:00' }), 'station');
  assert.equal(s.kicker, 'ایستگاه مورد علاقه');
  assert.equal(s.title, 'غدیر');
  assert.match(s.meta, /۲۰:۳۰ به وقت تهران/);
  const l = byId(buildSlides({ locate: { phase: 'idle' }, recent: { station: 'غدیر', source: 'last', phase: 'ok', board: board() }, asOf: null }), 'station');
  assert.equal(l.kicker, 'آخرین ایستگاه دیده شده');
  const failed = byId(buildSlides({ locate: { phase: 'idle' }, recent: { station: 'غدیر', source: 'last', phase: 'error' }, asOf: null }), 'station');
  assert.equal(failed.state, 'error'); assert.equal(failed.action.id, 'open');
});

test('an empty board is stated, not hidden', () => {
  const s = byId(buildSlides({ locate: { phase: 'idle' }, recent: { station: 'غدیر', source: 'last', phase: 'ok', board: { as_of: '23:50:00', passes: [] } }, asOf: '23:50:00' }), 'station');
  assert.match(s.lines.join(' '), /قطاری ثبت نشده/);
});

test('the note slide always says schedule estimate, never live, and quotes the server time only when one exists', () => {
  const none = byId(buildSlides({ locate: { phase: 'idle' }, recent: null, asOf: null }), 'note');
  assert.match(none.lines.join(' '), /برنامهٔ حرکت/);
  assert.match(none.lines.join(' '), /موقعیت زندهٔ قطار نیست/);
  assert.match(none.meta, /هنوز زمانی دریافت نشده/);
  const some = byId(buildSlides({ locate: { phase: 'idle' }, recent: null, asOf: '20:27:13' }), 'note');
  assert.match(some.meta, /۲۰:۲۷ به وقت تهران/);
  assert.deepEqual(some.action, { id: 'about', label: 'توضیح بیشتر' });
});
