import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./theme-boot.js', import.meta.url), 'utf8');
function boot({ pref, tg, light = false, throwingStorage = false } = {}) {
  const attrs = {}, meta = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  const sandbox = {
    document: { documentElement: { style: {}, setAttribute: (k, v) => { attrs[k] = v; } }, querySelector: s => (s === 'meta[name="theme-color"]' ? meta : null) },
    localStorage: throwingStorage ? { getItem() { throw new Error('denied'); } } : { getItem: k => (k === 'besrah:theme' ? pref ?? null : null) },
    matchMedia: q => ({ matches: q.includes('light') ? light : false }),
    Telegram: tg ? { WebApp: tg } : undefined,
  };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox);
  return { sandbox, attrs, meta };
}

test('boot sets data-theme synchronously, before any other script can run', () => {
  const { attrs, sandbox } = boot();
  assert.ok(['light', 'dark'].includes(attrs['data-theme']));
  assert.equal(sandbox.document.documentElement.style.colorScheme, attrs['data-theme']);
});

test('explicit preference wins over Telegram and the operating system', () => {
  assert.equal(boot({ pref: 'light', tg: { platform: 'android', colorScheme: 'dark' }, light: false }).attrs['data-theme'], 'light');
  assert.equal(boot({ pref: 'dark', tg: { platform: 'ios', colorScheme: 'light' }, light: true }).attrs['data-theme'], 'dark');
});

test('automatic mode follows Telegram inside Telegram, otherwise the operating system, default dark', () => {
  assert.equal(boot({ pref: 'auto', tg: { platform: 'android', colorScheme: 'light' } }).attrs['data-theme'], 'light');
  assert.equal(boot({ tg: { platform: 'tdesktop', colorScheme: 'dark' }, light: true }).attrs['data-theme'], 'dark');
  assert.equal(boot({ light: true }).attrs['data-theme'], 'light');
  assert.equal(boot({ light: false }).attrs['data-theme'], 'dark');
});

test('the Telegram SDK default outside Telegram is not trusted', () => {
  assert.equal(boot({ tg: { platform: 'unknown', colorScheme: 'light' }, light: false }).attrs['data-theme'], 'dark');
});

test('unreadable storage or junk values fall back to automatic', () => {
  assert.equal(boot({ throwingStorage: true, light: true }).attrs['data-theme'], 'light');
  assert.equal(boot({ pref: 'neon', light: false }).attrs['data-theme'], 'dark');
});

test('browser theme-color follows the resolved theme and matches the skin background tokens', () => {
  const skin = readFileSync(new URL('./skin.css', import.meta.url), 'utf8');
  const bg = theme => skin.match(new RegExp(`:root\\[data-theme="${theme}"\\][^{]*\\{[^}]*--bg:\\s*(#[0-9a-fA-F]{6})`, 's'))?.[1]?.toLowerCase();
  const dark = boot({ light: false }), light = boot({ light: true });
  assert.equal(dark.meta.attrs.content.toLowerCase(), bg('dark'));
  assert.equal(light.meta.attrs.content.toLowerCase(), bg('light'));
});

test('apply() can be called again when Telegram reports a theme change', () => {
  const tg = { platform: 'android', colorScheme: 'dark' };
  const { sandbox, attrs } = boot({ tg });
  assert.equal(attrs['data-theme'], 'dark');
  tg.colorScheme = 'light';
  assert.equal(sandbox.BesrahTheme.apply(), 'light');
  assert.equal(attrs['data-theme'], 'light');
  assert.equal(sandbox.BesrahTheme.apply('dark'), 'dark');
});
