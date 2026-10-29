import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, KEYS } from './store.js';

const memory = (seed = {}) => {
  const data = new Map(Object.entries(seed));
  return { data, getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => { data.set(k, String(v)); }, removeItem: k => { data.delete(k); } };
};

test('recent stations keep the newest first, without duplicates, capped', () => {
  const storage = memory();
  const store = createStore(storage, { maxRecents: 3 });
  for (const n of ['الف', 'ب', 'ج', 'الف', 'د']) store.addRecent(n);
  assert.deepEqual(store.recents(), ['د', 'الف', 'ج']);
  assert.deepEqual(JSON.parse(storage.getItem(KEYS.recents)), ['د', 'الف', 'ج']);
});

test('state survives a reload from the same storage', () => {
  const storage = memory();
  const a = createStore(storage);
  a.addRecent('شریعتی'); a.toggleFavourite('غدیر'); a.setLast('قائم'); a.setThemePref('light');
  const b = createStore(storage);
  assert.deepEqual([b.recents(), b.favourites(), b.last(), b.themePref()], [['شریعتی'], ['غدیر'], 'قائم', 'light']);
});

test('favourites toggle, report the new state and stop at the cap', () => {
  const store = createStore(memory(), { maxFavourites: 2 });
  assert.deepEqual(store.toggleFavourite('الف'), { on: true });
  assert.deepEqual(store.toggleFavourite('ب'), { on: true });
  assert.deepEqual(store.toggleFavourite('ج'), { on: false, reason: 'full' });
  assert.equal(store.isFavourite('ج'), false);
  assert.deepEqual(store.toggleFavourite('الف'), { on: false });
  assert.deepEqual(store.favourites(), ['ب']);
});

test('corrupt, foreign or oversized stored values are ignored, not trusted', () => {
  const storage = memory({
    [KEYS.recents]: '{not json', [KEYS.favs]: JSON.stringify(['ok', 7, null, { a: 1 }, 'x'.repeat(500)]),
    [KEYS.last]: JSON.stringify({ lat: 36.3, lon: 59.6 }), [KEYS.theme]: 'neon',
  });
  const store = createStore(storage);
  assert.deepEqual(store.recents(), []);
  assert.deepEqual(store.favourites(), ['ok']);
  assert.equal(store.last(), null);
  assert.equal(store.themePref(), 'auto');
});

test('prune drops names that are no longer real stations', () => {
  const store = createStore(memory());
  store.addRecent('الف'); store.addRecent('ب'); store.toggleFavourite('الف'); store.toggleFavourite('ج'); store.setLast('ج');
  store.prune(['الف', 'ب']);
  assert.deepEqual([store.recents(), store.favourites(), store.last()], [['ب', 'الف'], ['الف'], null]);
});

test('unavailable or full storage never throws and the session keeps working', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('denied'); } };
  const store = createStore(broken);
  assert.doesNotThrow(() => { store.addRecent('الف'); store.toggleFavourite('ب'); store.setThemePref('dark'); });
  assert.deepEqual([store.recents(), store.favourites(), store.themePref()], [['الف'], ['ب'], 'dark']);
  const none = createStore(undefined);
  none.addRecent('الف');
  assert.deepEqual(none.recents(), ['الف']);
});

test('only station names are stored, never coordinates', () => {
  const storage = memory();
  const store = createStore(storage);
  store.addRecent({ name: 'x', lat: 36.3, lon: 59.6 }); store.setLast({ lat: 1, lon: 2 }); store.toggleFavourite(36.3);
  assert.deepEqual([store.recents(), store.favourites(), store.last()], [[], [], null]);
  assert.equal([...storage.data.values()].join('|').includes('36.3'), false);
});

test('clearing recents and change listeners', () => {
  const store = createStore(memory());
  const seen = [];
  const off = store.subscribe(key => seen.push(key));
  store.addRecent('الف'); store.clearRecents(); store.toggleFavourite('ب'); off(); store.setLast('ب');
  assert.deepEqual(seen, ['recents', 'recents', 'favs']);
  assert.deepEqual(store.recents(), []);
});
