import test from 'node:test';
import assert from 'node:assert/strict';
import * as logic from './logic.js';

// Synthetic coordinates test provider selection only; no location is requested.
test('location uses native Telegram support or browser fallback and respects native denial', async () => {
  assert.equal(typeof logic.requestPosition, 'function');
  const coordinates = { latitude: 36.3, longitude: 59.6 };
  let browserCalls = 0;
  const browser = { getCurrentPosition(success) { browserCalls++; success({ coords: coordinates }); } };
  const native = { isInited: false, isLocationAvailable: true,
    init(callback) { this.isInited = true; callback(); },
    getLocation(callback) { callback(coordinates); } };
  const telegram = { initData: 'SYNTHETIC_PROVIDER_TEST', isVersionAtLeast: () => true, LocationManager: native };
  assert.deepEqual(await logic.requestPosition(telegram, browser), coordinates);
  assert.equal(browserCalls, 0);
  assert.deepEqual(await logic.requestPosition(undefined, browser), coordinates);
  assert.equal(browserCalls, 1);
  native.getLocation = callback => callback(null);
  await assert.rejects(logic.requestPosition(telegram, browser), /location_unavailable/);
  assert.equal(browserCalls, 1, 'denial must not trigger a second permission request');
  native.isLocationAvailable = false;
  assert.deepEqual(await logic.requestPosition(telegram, browser), coordinates);
  assert.equal(browserCalls, 2);
  await assert.rejects(logic.requestPosition(undefined, undefined), /location_unavailable/);
});
