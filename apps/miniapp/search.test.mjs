import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from './logic.js';
import { filterStations, highlightParts, stripStationPrefix, didYouMean } from './search.js';

const S = n => ({ name: n, lines: [1] });
const stations = ['وکیل‌آباد', 'کوهستان پارک', 'شریعتی', 'امام خمینی', 'پارک ملت', 'هفده شهریور', 'فرودگاه شهید هاشمی‌نژاد', 'آزادی'].map(S);
stations.push({ name: 'طبرسی', lines: [2] });
const names = r => r.map(x => x.station.name);

test('normalize folds Arabic letters, digits, diacritics, ZWNJ and spaces', () => {
  assert.equal(normalize(' وكيل‌ آباد '), normalize('وکیل آباد'));
  assert.equal(normalize('آزادی'), normalize('ازادی'));
  assert.equal(normalize('خط ٢'), normalize('خط ۲'));
  assert.equal(normalize('خَط'), normalize('خط'));
});

test('station prefix is optional and a bare prefix means an empty query', () => {
  assert.equal(stripStationPrefix('ایستگاه شریعتی'), 'شریعتی');
  assert.equal(stripStationPrefix('ایستگاهشریعتی'), 'شریعتی');
  assert.equal(stripStationPrefix('ایستگاه'), '');
  assert.equal(stripStationPrefix('شریعتی'), 'شریعتی');
});

test('Arabic typing, missing ZWNJ and the station prefix still match', () => {
  assert.deepEqual(names(filterStations(stations, 'وكيل اباد')), ['وکیل‌آباد']);
  assert.deepEqual(names(filterStations(stations, 'ایستگاه شریعتي')), ['شریعتی']);
  assert.deepEqual(names(filterStations(stations, 'هاشمی نژاد')), ['فرودگاه شهید هاشمی‌نژاد']);
});

test('ranking: exact, then name prefix, then word prefix, then substring', () => {
  const list = [S('پارک ملت'), S('کوهستان پارک'), S('پارکینگ'), S('ملت'), S('خیابان ملتی')];
  assert.deepEqual(names(filterStations(list, 'ملت')), ['ملت', 'پارک ملت', 'خیابان ملتی']);
  assert.deepEqual(names(filterStations(list, 'پارک')), ['پارک ملت', 'پارکینگ', 'کوهستان پارک']);
});

test('stations in the route order rank before unlisted ones on equal relevance', () => {
  const list = [{ name: 'پلان', lines: [2] }, S('پلیس'), S('پله')];
  assert.deepEqual(names(filterStations(list, 'پل', { order: ['پله', 'پلیس'] })), ['پله', 'پلیس', 'پلان']);
});

test('highlight ranges point into the original text, across removed spaces and ZWNJ', () => {
  const [hit] = filterStations(stations, 'وكيل');
  assert.deepEqual(hit.ranges, [[0, 4]]);
  assert.deepEqual(highlightParts(hit.station.name, hit.ranges), [{ text: 'وکیل', mark: true }, { text: '‌آباد', mark: false }]);
  const [hit2] = filterStations(stations, 'اباد');
  assert.equal(highlightParts(hit2.station.name, hit2.ranges).filter(p => p.mark).map(p => p.text).join(''), 'آباد');
  const [hit3] = filterStations(stations, 'پارک ملت');
  assert.deepEqual(highlightParts(hit3.station.name, hit3.ranges), [{ text: 'پارک ملت', mark: true }]);
});

test('empty query returns everything without ranges and respects the limit', () => {
  assert.equal(filterStations(stations, '').length, stations.length);
  assert.deepEqual(filterStations(stations, '')[0].ranges, []);
  assert.equal(filterStations(stations, 'ا', { limit: 3 }).length, 3);
});

test('did-you-mean offers the closest station only for near misses', () => {
  assert.equal(didYouMean(stations, 'شریعتیی').name, 'شریعتی');
  assert.equal(didYouMean(stations, 'شریعطی').name, 'شریعتی');
  assert.equal(didYouMean(stations, 'xyz'), null);
  assert.equal(didYouMean(stations, 'ش'), null);
});
