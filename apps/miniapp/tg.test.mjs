import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelegram } from './tg.js';

function fakeApp(version = '8.0', extra = {}) {
  const calls = [], handlers = new Map();
  const app = {
    platform: 'android', version, colorScheme: 'dark', initData: '',
    isVersionAtLeast: v => parseFloat(version) >= parseFloat(v),
    ready: () => calls.push('ready'), expand: () => calls.push('expand'),
    disableVerticalSwipes: () => calls.push('disableVerticalSwipes'),
    setHeaderColor: c => calls.push(['header', c]), setBackgroundColor: c => calls.push(['background', c]), setBottomBarColor: c => calls.push(['bottom', c]),
    onEvent: (n, f) => handlers.set(n, f), offEvent: n => handlers.delete(n),
    BackButton: { show: () => calls.push('back:show'), hide: () => calls.push('back:hide'), onClick: f => calls.push(['back:on', f]), offClick: f => calls.push(['back:off', f]) },
    HapticFeedback: { impactOccurred: s => calls.push(['impact', s]), notificationOccurred: s => calls.push(['notify', s]), selectionChanged: () => calls.push('select') },
    ...extra,
  };
  return { app, calls, handlers, win: { Telegram: { WebApp: app } } };
}

test('outside Telegram every call is a harmless no-op', () => {
  const tg = createTelegram({});
  assert.equal(tg.inTelegram, false);
  assert.doesNotThrow(() => { tg.start(); tg.applyColors({ header: '#000000' }); tg.setBack(() => {}); tg.setBack(null); });
  assert.equal(tg.haptic('tab'), false);
  const plain = createTelegram({ Telegram: { WebApp: { platform: 'unknown', ready() { throw new Error('must not be called'); } } } });
  assert.equal(plain.inTelegram, false);
  assert.doesNotThrow(() => plain.start());
});

test('start() calls ready and expand and stops accidental swipe-to-close on supported clients', () => {
  const { win, calls } = fakeApp('8.0');
  createTelegram(win).start();
  assert.deepEqual(calls, ['ready', 'expand', 'disableVerticalSwipes']);
  const old = fakeApp('6.1'); createTelegram(old.win).start();
  assert.deepEqual(old.calls, ['ready', 'expand']);
});

test('colours are applied only where the client version supports them, and only valid hex values', () => {
  const modern = fakeApp('8.0'); createTelegram(modern.win).applyColors({ header: '#061C1D', background: '#061C1D', bottom: '#0C2A2B' });
  assert.deepEqual(modern.calls, [['header', '#061C1D'], ['background', '#061C1D'], ['bottom', '#0C2A2B']]);
  const mid = fakeApp('7.0'); createTelegram(mid.win).applyColors({ header: '#061C1D', background: '#061C1D', bottom: '#0C2A2B' });
  assert.deepEqual(mid.calls.map(c => c[0]), ['header', 'background']);
  const bad = fakeApp('8.0'); createTelegram(bad.win).applyColors({ header: 'rgb(1,2,3)', background: 'red', bottom: undefined });
  assert.deepEqual(bad.calls, []);
});

test('the back button keeps exactly one handler and hides when cleared', () => {
  const { win, calls } = fakeApp('8.0');
  const tg = createTelegram(win);
  const a = () => {}, b = () => {};
  tg.setBack(a); tg.setBack(b); tg.setBack(null);
  assert.deepEqual(calls, [['back:on', a], 'back:show', ['back:off', a], ['back:on', b], 'back:show', ['back:off', b], 'back:hide']);
});

test('haptics map HM7 cues to Telegram feedback and report whether they were handled', () => {
  const { win, calls } = fakeApp('8.0');
  const tg = createTelegram(win);
  assert.equal(tg.haptic('tab'), true); assert.equal(tg.haptic('success'), true); assert.equal(tg.haptic('error'), true); assert.equal(tg.haptic('tileOn'), true);
  assert.equal(tg.haptic('unknown-cue'), false);
  assert.deepEqual(calls, ['select', ['notify', 'success'], ['notify', 'error'], ['impact', 'light']]);
});

test('theme changes are delivered and can be unsubscribed', () => {
  const { win, handlers } = fakeApp('8.0');
  const tg = createTelegram(win); let n = 0;
  const off = tg.onThemeChanged(() => n++);
  handlers.get('themeChanged')(); off();
  assert.equal(n, 1); assert.equal(handlers.has('themeChanged'), false);
});
