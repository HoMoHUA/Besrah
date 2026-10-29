import test from 'node:test';
import assert from 'node:assert/strict';
import { fa, etaParts, etaText, clockLabel, asOfLabel, dayTypeLabel, confidenceLabel, distanceLabel, headingFor, summarizeBoard, lineLabel } from './format.js';

test('Persian digits and Arabic/ASCII mix', () => {
  assert.equal(fa(1405), '۱۴۰۵');
  assert.equal(fa('20:27'), '۲۰:۲۷');
});

test('ETA text: now, minutes, and a roll-friendly split', () => {
  assert.equal(etaText(0), 'اکنون');
  assert.equal(etaText(3), '۳ دقیقه');
  assert.deepEqual(etaParts(12), { value: '۱۲', unit: 'دقیقه' });
  assert.deepEqual(etaParts(0), { value: 'اکنون', unit: '' });
});

test('clock and as_of labels keep the server time and say it is Tehran time', () => {
  assert.equal(clockLabel('20:28:28'), '۲۰:۲۸');
  assert.equal(clockLabel('20:28:28', { seconds: true }), '۲۰:۲۸:۲۸');
  assert.equal(asOfLabel('20:27:13'), '۲۰:۲۷ به وقت تهران');
  assert.equal(asOfLabel('20:27:13', { seconds: true }), '۲۰:۲۷:۱۳ به وقت تهران');
  assert.equal(asOfLabel(undefined), '');
});

test('day type and confidence labels are honest and tolerate unknown values', () => {
  assert.equal(dayTypeLabel('thursday'), 'برنامهٔ پنجشنبه');
  assert.equal(dayTypeLabel('friday'), 'برنامهٔ جمعه');
  assert.equal(dayTypeLabel('normal'), 'برنامهٔ روز عادی');
  assert.equal(dayTypeLabel('whatever'), '');
  assert.equal(confidenceLabel('official_sheet_phase').tone, 'ok');
  assert.equal(confidenceLabel('site_headway_assumed_phase').tone, 'warn');
  assert.equal(confidenceLabel('measured_phase').tone, 'ok');
  assert.equal(confidenceLabel('???'), null);
});

test('distance is straight-line and rounded the way people say it', () => {
  assert.equal(distanceLabel(0.42), '۴۲۰ متر');
  assert.equal(distanceLabel(0.049), '۵۰ متر');
  assert.equal(distanceLabel(1.26), '۱٫۳ کیلومتر');
  assert.equal(distanceLabel(12), '۱۲ کیلومتر');
});

test('headings keep the API wording for terminal arrivals', () => {
  assert.equal(headingFor('غدیر'), 'به سمت غدیر');
  assert.equal(headingFor('ورودی از غدیر'), 'ورودی از غدیر');
});

test('line label', () => { assert.equal(lineLabel([1]), 'خط ۱'); assert.equal(lineLabel([1, 2]), 'خط ۱ و ۲'); assert.equal(lineLabel([]), ''); });

test('board summary takes the earliest train per direction, two directions at most', () => {
  const passes = [
    { toward: 'وکیل‌آباد', eta_min: 2 }, { toward: 'غدیر', eta_min: 3 }, { toward: 'وکیل‌آباد', eta_min: 3 },
    { toward: 'ورودی از غدیر', eta_min: 9 },
  ];
  assert.deepEqual(summarizeBoard({ passes }), [
    { heading: 'به سمت وکیل‌آباد', eta: 2, text: '۲ دقیقه' },
    { heading: 'به سمت غدیر', eta: 3, text: '۳ دقیقه' },
  ]);
  assert.deepEqual(summarizeBoard({ passes: [] }), []);
});
