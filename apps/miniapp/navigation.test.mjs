import test from 'node:test';
import assert from 'node:assert/strict';
import { NAV_VIEWS, createNavigation, activeNav } from './navigation.js';

test('global navigation contains no station-specific tabs', () => {
  assert.deepEqual(NAV_VIEWS, ['home', 'saved', 'services', 'settings', 'about']);
  assert.equal(activeNav('metro'), 'services');
  assert.equal(activeNav('favourites'), 'services');
});

test('nested metro screens return to their actual source and keep scroll', () => {
  const nav = createNavigation();
  assert.equal(nav.current(), 'home');
  nav.go('services', 400); nav.go('metro', 220); nav.go('favourites', 700);
  assert.equal(nav.back().view, 'metro');
  assert.equal(nav.back().view, 'services');
  assert.deepEqual(nav.back(), { view: 'home', scroll: 400 });
  assert.equal(nav.back(), null);
});

test('same-screen and invalid navigation do not corrupt the back stack', () => {
  const nav = createNavigation();
  nav.go('metro', 10); nav.go('metro', 80);
  assert.equal(nav.go('not-a-route'), false);
  assert.equal(nav.current(), 'metro');
  assert.deepEqual(nav.back(), { view: 'home', scroll: 10 });
});

test('browser forward restores the correct nested route instead of losing the stack', () => {
  const nav = createNavigation(); nav.go('services', 100); nav.go('metro', 200);
  const index = nav.index(); nav.back();
  assert.equal(nav.restore(index).view, 'metro');
  assert.equal(nav.restore(0).view, 'home');
  assert.equal(nav.restore(999), null);
});
