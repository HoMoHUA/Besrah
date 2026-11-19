// D17 profile code card: shown for guests (computed, not stored), stored on the account only with its own consent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfileView } from './views/profile.js';
import { createStore, sanitizePrefs } from './store.js';
import { installFoodDom, flushView, findAll, button } from './test-support/food-dom.mjs';

const click = node => node.listeners.get('click')({ type: 'click', target: node });
const POS = (code) => [
  { dimension: 'budget', symbol: code[0], meaning: code[0] === '0' ? 'بودجه: اعلام نشده' : 'بودجه: ۱۵۰ تا ۳۰۰ هزار تومان', source: code[0] === '0' ? 'not_stated' : 'stated' },
  { dimension: 'transit', symbol: code[1], meaning: code[1] === 'X' ? 'سفر: اعلام نشده' : 'سفر: زودتر رسیدن مهم تر است', source: code[1] === 'X' ? 'not_stated' : 'stated' },
  { dimension: 'food', symbol: code[2], meaning: 'غذا: اعلام نشده', source: 'not_stated' },
  { dimension: 'shop', symbol: code[3], meaning: code[3] === 'X' ? 'خرید: اعلام نشده' : 'خرید: کیفیت و برند', source: code[3] === 'X' ? 'not_stated' : 'stated' },
];
// Same rules as the server for the two positions these tests touch.
const fakeCode = p => `${p.foodBudgetToman ? '2' : '0'}${p.transitPriority === 'time' ? 'A' : 'X'}X${p.shopPriority === 'quality' ? 'B' : 'X'}`;

function profile(t, session) {
  installFoodDom(t);
  const store = createStore(undefined), calls = [];
  let s = session;
  const api = {
    accountSession: async () => s,
    accountConsent: async (p, g) => { calls.push(['consent', p, g]); s = { ...s, consents: { ...s.consents, [p]: { status: g ? 'granted' : 'revoked' } } }; },
    accountPreferences: async () => ({ version: 0, values: {} }), accountSavePreferences: async v => ({ version: v + 1 }),
    profileDescribe: async values => { calls.push(['describe', values]); const code = fakeCode(values); return { version: 1, code, complete: false, positions: POS(code) }; },
    accountSaveProfile: async values => { calls.push(['saveProfile', values]); return { profile: { code: fakeCode(values) } }; },
  };
  const view = createProfileView({ api, store, actions: { go() {} } });
  return { view, store, calls };
}

test('shop priority is a whitelisted device preference', () => {
  assert.deepEqual(sanitizePrefs({ shopPriority: 'installment' }), { shopPriority: 'installment' });
  assert.deepEqual(sanitizePrefs({ shopPriority: 'cheapest' }), {});
});

test('a guest sees their code from their own choices, nothing is saved to an account, and it updates when a choice changes', async t => {
  const { view, calls } = profile(t, { authenticated: false, available: true });
  view.onShow(); await flushView();
  assert.match(view.el.textContent, /تیپ بسراه/);
  assert.equal(findAll(view.el, n => n.className === 'pf-code')[0].textContent, '0XXX');
  assert.match(view.el.textContent, /۴ بخش هنوز اعلام نشده است/);
  await click(button(view.el, 'کیفیت و برند')); await flushView();
  assert.equal(findAll(view.el, n => n.className === 'pf-code')[0].textContent, '0XXB');
  assert.deepEqual(calls.at(-1), ['describe', { shopPriority: 'quality' }]);
  assert.equal(calls.filter(c => c[0] === 'saveProfile').length, 0, 'a guest never stores a code');
  assert.equal(findAll(view.el, n => n.textContent === 'ذخیرهٔ تیپ در حساب').length, 0);
});

test('a logged-in user stores the code only after turning on its own consent, and the stored copy follows later changes', async t => {
  const { view, calls } = profile(t, { authenticated: true, available: true, consents: {} });
  view.onShow(); await flushView();
  assert.ok(findAll(view.el, n => n.textContent === 'ذخیرهٔ تیپ در حساب').length);
  assert.equal(calls.filter(c => c[0] === 'saveProfile').length, 0);
  const group = findAll(view.el, n => n.getAttribute?.('aria-label') === 'ذخیرهٔ تیپ در حساب')[0];
  const on = findAll(group, n => n.tagName === 'button' && n.textContent === 'روشن')[0];
  assert.ok(on); await click(on); await flushView();
  assert.deepEqual(calls.find(c => c[0] === 'consent'), ['consent', 'profile_code', true]);
  assert.equal(calls.filter(c => c[0] === 'saveProfile').length, 1);
  await click(button(view.el, 'زمان رسیدن')); await flushView();
  assert.deepEqual(calls.filter(c => c[0] === 'saveProfile').at(-1), ['saveProfile', { transitPriority: 'time' }]);
  assert.match(view.el.textContent, /فقط همین کد چهار حرفی روی سرور می ماند/);
});

test('if the code cannot be computed, the page says so and keeps working', async t => {
  installFoodDom(t);
  const store = createStore(undefined);
  const view = createProfileView({ api: { accountSession: async () => ({ authenticated: false, available: true }), profileDescribe: async () => { throw new Error('offline'); } }, store, actions: { go() {} } });
  view.onShow(); await flushView();
  assert.match(view.el.textContent, /تیپ شما الان محاسبه نشد/);
});
