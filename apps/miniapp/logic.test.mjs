import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, nearestStation, groupPasses } from './logic.js';
test('search normalizes Persian spacing and Arabic letters', () => {
  assert.equal(normalize(' وكيل‌ آباد '), normalize('وکیل آباد'));
});
test('nearest uses all stations and enforces 10km guard', () => {
  const stations = [{name:'خط دو', lat:36.3,lon:59.6,lines:[2]}, {name:'دور',lat:36.4,lon:59.6,lines:[1]}];
  assert.equal(nearestStation(stations,36.3,59.6,10).station.name,'خط دو');
  assert.equal(nearestStation(stations,0,0,10),null);
  assert.equal(nearestStation(stations,NaN,0,10),null);
});
test('arrival board shows only the next two trains per actual destination', () => {
  const passes = [1, 2, 3, 4].map(eta_min => ({ toward: 'غدیر', eta_min }));
  assert.deepEqual(groupPasses(passes), [['غدیر', passes.slice(0, 2)]]);
});

test('groups by actual destination including terminal arrivals', () => {
  const a={toward:'غدیر',eta_min:3},b={toward:'وکیل‌آباد',eta_min:4},c={toward:'غدیر',eta_min:9};
  assert.deepEqual(groupPasses([a,b,c]),[['غدیر',[a,c]],['وکیل‌آباد',[b]]]);
});
