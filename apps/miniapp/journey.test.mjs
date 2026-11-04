import test from 'node:test';
import assert from 'node:assert/strict';
import * as j from './journey.js';

const now = Date.parse('2026-11-03T12:00:00+03:30');
const response = { modelVersion: 'sha256:' + 'a'.repeat(64), request: { line: 1, originId: 'METRO-101', destinationId: 'METRO-102', readyAt: '2026-11-03T11:55:00+03:30' }, calendar: { serviceDate: '2026-11-03', state: 'estimated' }, options: [{ id: '2026-11-03:L1:out:A:1' }] };

test('cards identify the destination, never internal A/B service letters or seconds', () => {
  const view = j.formatOption({ service: 'B', toward: 'فرودگاه', departAt: '12:01:34.5', arriveAt: '12:14:56', waitSeconds: 95.5, inVehicleSeconds: 800.2 });
  assert.equal(view.toward, 'به سمت فرودگاه');
  assert.equal(view.depart, '۱۲:۰۱');
  assert.equal(view.arrive, '۱۲:۱۴');
  assert.doesNotMatch(JSON.stringify(view), /سرویس|\b[AB]\b|\.5|\.2/);
});

test('observation needs an explicit date and never rolls a future clock time into yesterday', () => {
  assert.equal(j.observedAtFromTime('13:00', now), null);
  assert.equal(j.observedAtFromTime('13:00', now, '2026-11-03'), null);
  assert.equal(j.observedAtFromTime('13:00', now, '2026-11-02'), '2026-11-02T13:00:00+03:30');
  assert.equal(j.observedAtFromTime('00:00', now, '2026-11-01'), null);
  assert.equal(j.observedAtFromTime('10:00', now, '2026-02-31'), null);
});

test('observation payloads reject impossible dates, clocks and non-Tehran wire offsets', () => {
  const values = { consent: true, event: 'train_arrival', stationId: 'METRO-101', direction: 'out', precision: 'minute' };
  for (const observedAt of ['2026-02-31T11:00:00+03:30', '2026-11-03T25:00:00+03:30', '2026-11-03T11:00:00-04:00', '2026-11-03T11:00:00']) {
    assert.throws(() => j.buildObservationPayload(response, { ...values, observedAt }), /bad_observed_at/);
  }
});

test('consent discloses retained station/time context and no personal arrival is inferred', () => {
  assert.match(j.CONSENT_TEXT, /ایستگاه/);
  assert.match(j.CONSENT_TEXT, /زمان/);
  assert.doesNotMatch(j.CONSENT_TEXT, /بدون.*مکان/);
  assert.throws(() => j.buildTimingPayload(response, { quality: 'close' }), /consent_required/);
  const payload = j.buildOutcomePayload(response, { result: 'made_it', consent: true, nowMs: now });
  assert.deepEqual(payload.outcome, { result: 'made_it' });
});

test('Tehran dates are independent of device zone and now sends no selected timestamp', () => {
  assert.deepEqual(j.tehranParts(Date.parse('2026-11-02T21:00:00Z')), { date: '2026-11-03', time: '00:30' });
  assert.equal(j.dayChoices(now).length, 8);
  assert.deepEqual(j.buildJourneyQuery({ line: 2, from: 'a', to: 'b', mode: 'now', date: 'yesterday', time: '12:00' }), { line: 2, from: 'a', to: 'b' });
  assert.equal(j.validateForm({ from: 'a', to: 'b', mode: 'custom', date: '2026-11-04', time: '13:00' }, now), null);
  assert.equal(j.validateForm({ from: 'a', to: 'a' }, now), 'same_station');
  assert.equal(j.validateForm({ from: 'a', to: 'b', mode: 'custom', date: '2026-02-31', time: '10:00' }, now), 'date_out_of_range');
});

test('beta respects global OFF and explicit leave, including storage failures', () => {
  const values = new Map(); const storage = { getItem: k => values.get(k), setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) };
  assert.equal(j.betaVisible({ enabled: false }, { optIn: true }), false);
  j.writeOptIn(storage); assert.equal(j.readOptIn(storage), true);
  j.clearOptIn(storage); assert.equal(j.readOptIn(storage), false);
  assert.equal(j.betaVisible({ enabled: true, rolloutPercent: 100 }, { bucket: 0, optOut: j.readOptOut(storage) }), false);
  assert.equal(j.rolloutBucket({ getItem() { throw Error(); }, setItem() { throw Error(); } }, () => .42), 42);
});

test('feedback kinds remain distinct, notes safe, and retry tracker keeps failed reports available', () => {
  const common = { consent: true, reportId: '11111111-1111-4111-8111-111111111111' };
  const quality = j.buildTimingPayload(response, { ...common, quality: 'close' });
  assert.equal(quality.kind, 'timing_quality');
  assert.equal(quality.observation, undefined);
  for (const event of ['train_arrival', 'train_departure']) {
    const p = j.buildObservationPayload(response, { ...common, event, stationId: 'METRO-101', direction: 'out', observedAt: '2026-11-03T11:00:00+03:30', precision: 'minute', option: response.options[0] });
    assert.equal(p.observation.event, event);
    assert.equal(p.context.tripId, undefined);
  }
  assert.ok(j.checkNote('https://example.com'));
  assert.ok(j.checkNote('09123456789'));
  assert.equal(j.checkNote('قطار دیر رسید'), null);
  const tracker = j.createSentTracker(); assert.equal(tracker.begin(quality), true); assert.equal(tracker.begin(quality), false);
  tracker.fail(quality); assert.equal(tracker.begin(quality), true); tracker.succeed(quality); assert.equal(tracker.begin(quality), false);
});

test('empty, partial, insufficient, network and disabled states remain honest', () => {
  for (const status of ['partial', 'insufficient_data', 'no_feasible_option']) assert.ok(j.statusView({ status, message: 'پیام مدل' }).text.includes('پیام مدل'));
  assert.equal(j.statusView({ kind: 'network' }).retryable, true);
  assert.equal(j.statusView({ kind: 'disabled' }).retryable, false);
  assert.equal(j.feedbackAvailability({ ...response, calendar: { serviceDate: '2026-11-04' } }, now).timing_quality, false);
});
test('consent text tells the truth about anonymity: no later attribution or per-person deletion, and no unscheduled retention promise', () => {
  assert.match(j.CONSENT_TEXT, /ناشناس/);
  assert.match(j.CONSENT_TEXT, /نمی توان آن را به شما نسبت داد یا به طور جداگانه حذف کرد/);
  assert.match(j.CONSENT_TEXT, /GPS/);
  assert.doesNotMatch(j.CONSENT_TEXT, /۳۰ روز|30 روز|حذف می شود|حذف خواهد شد/);
});
