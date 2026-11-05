// Accounts: Telegram signature, sessions, consent gating, preference validation, IDOR isolation, delete/export, home suggestions.
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';
import { openAccountStore, validatePreferences } from '../../src/account/store.js';
import { verifyTelegramInitData } from '../../src/account/telegram.js';
import { homeRecommendations, slotAt } from '../../src/home/recommendations.js';
import { loadStationGeo } from '../../src/trip/routes.js';

const NOW_MS = Date.parse('2026-11-05T08:30:00Z');   // 12:00 in Mashhad
const NOW = Math.floor(NOW_MS / 1000);
const BOT = '9195157620';
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const PUB_HEX = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');

function initData(over: { id?: number; authDate?: number; bot?: string; tamper?: boolean; noSig?: boolean } = {}): string {
  const user = JSON.stringify({ id: over.id ?? 777001, first_name: 'Ali' });
  const params: Record<string, string> = { auth_date: String(over.authDate ?? NOW - 30), query_id: 'AAH', user };
  const check = `${over.bot ?? BOT}:WebAppData\n` + Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const sig = sign(null, Buffer.from(check), privateKey).toString('base64url');
  const u = new URLSearchParams({ ...params, hash: 'ignored', ...(over.noSig ? {} : { signature: sig }) });
  if (over.tamper) u.set('user', JSON.stringify({ id: 1, first_name: 'Eve' }));
  return u.toString();
}
const opts = { botId: BOT, publicKeyHex: PUB_HEX, nowSec: NOW };

describe('verifyTelegramInitData', () => {
  it('accepts a correctly signed payload and returns only the id and first name', () => {
    expect(verifyTelegramInitData(initData(), opts)).toEqual({ ok: true, telegramId: '777001', authDate: NOW - 30, firstName: 'Ali' });
  });
  it.each([
    ['tampered user field', initData({ tamper: true }), 'bad_signature'],
    ['signed for another bot', initData({ bot: '12345' }), 'bad_signature'],
    ['missing signature', initData({ noSig: true }), 'missing_signature'],
    ['older than a day', initData({ authDate: NOW - 90000 }), 'expired'],
    ['from the future', initData({ authDate: NOW + 4000 }), 'expired'],
  ])('rejects %s', (_n, data, reason) => { expect(verifyTelegramInitData(data, opts)).toEqual({ ok: false, reason }); });
  it('rejects junk, oversize and duplicate keys without throwing', () => {
    for (const bad of [undefined, null, 5, '', 'x'.repeat(5000), 'a=1&a=2&signature=zz']) expect(verifyTelegramInitData(bad, opts).ok).toBe(false);
  });
  it('rejects a payload signed by a different key', () => {
    const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
    expect(verifyTelegramInitData(initData(), { ...opts, publicKeyHex: other })).toEqual({ ok: false, reason: 'bad_signature' });
  });
});

describe('preference validation', () => {
  it('accepts the whitelist and rejects unknown keys and out-of-range values instead of clamping', () => {
    expect(validatePreferences({ transitMaxWalkMin: 12, transitPriority: 'time', foodBudgetToman: 150000 })).toEqual({ ok: true, value: { transitMaxWalkMin: 12, transitPriority: 'time', foodBudgetToman: 150000 } });
    for (const [bad, field] of [[{ x: 1 }, 'x'], [{ transitMaxWalkMin: 2 }, 'transitMaxWalkMin'], [{ transitMaxWalkMin: 12.5 }, 'transitMaxWalkMin'], [{ transitPriority: 'fast' }, 'transitPriority'], [{ foodBudgetToman: -5 }, 'foodBudgetToman'], [[], 'values'], [null, 'values']] as const)
      expect(validatePreferences(bad)).toEqual({ ok: false, field });
  });
});

const make = () => {
  const store = openAccountStore(':memory:');
  const app = buildServer({ now: () => NOW_MS, account: { store, botId: BOT, telegramPublicKeyHex: PUB_HEX, secureCookie: false } });
  const post = (url: string, payload: unknown, cookie?: string, headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url, payload: JSON.stringify(payload), headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers } });
  const get = (url: string, cookie?: string) => app.inject({ method: 'GET', url, ...(cookie ? { headers: { cookie } } : {}) });
  const login = async (id: number) => {
    const r = await post('/app/api/account/telegram', { initData: initData({ id }) });
    const set = String(r.headers['set-cookie']);
    return { res: r, cookie: set.split(';')[0]!, set };
  };
  return { app, store, post, get, login };
};

describe('account routes', () => {
  it('guest by default; login sets an HttpOnly SameSite cookie and never returns the token in the body', async () => {
    const { app, get, login } = make();
    expect((await get('/app/api/account/session')).json()).toMatchObject({ authenticated: false, available: true, loginMethods: { telegram: true } });
    const { res, cookie, set } = await login(777001);
    expect(res.statusCode).toBe(200);
    expect(set).toMatch(/HttpOnly/); expect(set).toMatch(/SameSite=Lax/);
    expect(JSON.stringify(res.json())).not.toContain(cookie.split('=')[1]!);
    expect(res.json()).toMatchObject({ authenticated: true, created: true, displayName: 'Ali' });
    expect((await get('/app/api/account/session', cookie)).json()).toMatchObject({ authenticated: true });
    await app.close();
  });

  it('every login failure is the same generic 401; a replayed old payload is expired; no cookie is set', async () => {
    const { app, post } = make();
    for (const payload of [{ initData: initData({ tamper: true }) }, { initData: initData({ authDate: NOW - 90000 }) }, { initData: initData({ noSig: true }) }]) {
      const r = await post('/app/api/account/telegram', payload);
      expect(r.statusCode).toBe(401); expect(r.json()).toEqual({ error: 'invalid_init_data' }); expect(r.headers['set-cookie']).toBeUndefined();
    }
    expect((await post('/app/api/account/telegram', { initData: 'x', extra: 1 })).statusCode).toBe(400);
    await app.close();
  });

  it('a new login rotates the session: the old cookie stops working', async () => {
    const { app, get, post, login } = make();
    const first = await login(5);
    const again = await post('/app/api/account/telegram', { initData: initData({ id: 5 }) }, first.cookie);
    const second = String(again.headers['set-cookie']).split(';')[0]!;
    expect(second).not.toBe(first.cookie);
    expect((await get('/app/api/account/session', first.cookie)).json().authenticated).toBe(false);
    expect((await get('/app/api/account/session', second)).json().authenticated).toBe(true);
    await app.close();
  });

  it('preferences need consent: 401 without session, 403 before consent, versioned after, deleted when consent is revoked', async () => {
    const { app, get, post, login } = make();
    expect((await get('/app/api/account/preferences')).statusCode).toBe(401);
    const { cookie } = await login(10);
    expect((await get('/app/api/account/preferences', cookie)).json()).toEqual({ error: 'consent_required', purpose: 'sync_preferences' });
    expect((await post('/app/api/account/preferences', { expectedVersion: 0, values: { foodBudgetToman: 100000 } }, cookie)).statusCode).toBe(403);
    expect((await post('/app/api/account/consents', { purpose: 'sync_preferences', granted: true }, cookie)).json()).toMatchObject({ status: 'granted' });
    const saved = await post('/app/api/account/preferences', { expectedVersion: 0, values: { foodBudgetToman: 100000, transitPriority: 'cost' } }, cookie);
    expect(saved.json()).toEqual({ version: 1, values: { foodBudgetToman: 100000, transitPriority: 'cost' } });
    expect((await post('/app/api/account/preferences', { expectedVersion: 0, values: { foodBudgetToman: 1 } }, cookie)).statusCode).toBe(400);
    expect((await post('/app/api/account/preferences', { expectedVersion: 0, values: { foodBudgetToman: 200000 } }, cookie)).json()).toEqual({ error: 'version_conflict', version: 1 });
    expect((await post('/app/api/account/preferences', { expectedVersion: 1, values: { admin: true } }, cookie)).json()).toMatchObject({ field: 'admin' });
    await post('/app/api/account/consents', { purpose: 'sync_preferences', granted: false }, cookie);
    expect((await get('/app/api/account/preferences', cookie)).statusCode).toBe(403);
    await post('/app/api/account/consents', { purpose: 'sync_preferences', granted: true }, cookie);
    expect((await get('/app/api/account/preferences', cookie)).json()).toEqual({ version: 0, values: {} });
    await app.close();
  });

  it('accounts are isolated: one user can never read, change or delete another user\'s data', async () => {
    const { app, get, post, login, store } = make();
    const a = await login(1), b = await login(2);
    await post('/app/api/account/consents', { purpose: 'sync_preferences', granted: true }, a.cookie);
    await post('/app/api/account/preferences', { expectedVersion: 0, values: { foodBudgetToman: 99000 } }, a.cookie);
    await post('/app/api/account/consents', { purpose: 'sync_preferences', granted: true }, b.cookie);
    expect((await get('/app/api/account/preferences', b.cookie)).json()).toEqual({ version: 0, values: {} });
    await post('/app/api/account/delete', { confirm: 'DELETE' }, b.cookie);
    expect((await get('/app/api/account/preferences', a.cookie)).json().values).toEqual({ foodBudgetToman: 99000 });
    expect(store.getSession('forged-token-forged-token-forged', NOW)).toBeNull();
    await app.close();
  });

  it('CSRF and abuse guards: wrong content type, foreign origin, bad bodies and rate limits', async () => {
    const { app, post } = make();
    const text = await app.inject({ method: 'POST', url: '/app/api/account/logout', payload: '{}', headers: { 'content-type': 'text/plain' } });
    expect(text.statusCode).toBe(415);
    expect((await post('/app/api/account/logout', {}, undefined, { origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await post('/app/api/account/logout', {}, undefined, { origin: 'http://localhost:80', host: 'localhost:80' })).statusCode).toBe(200);
    let last = 200;
    for (let i = 0; i < 14; i++) last = (await post('/app/api/account/telegram', { initData: initData({ tamper: true }) })).statusCode;
    expect(last).toBe(429);
    await app.close();
  });

  it('export lists exactly what is stored, and delete removes the account, its sessions and its data', async () => {
    const { app, get, post, login, store } = make();
    const { cookie } = await login(33);
    await post('/app/api/account/consents', { purpose: 'sync_preferences', granted: true }, cookie);
    await post('/app/api/account/preferences', { expectedVersion: 0, values: { transitMaxWalkMin: 10 } }, cookie);
    const exp = (await post('/app/api/account/export', {}, cookie)).json();
    expect(exp).toMatchObject({ schemaVersion: 1, identities: [{ provider: 'telegram' }], preferences: { version: 1, values: { transitMaxWalkMin: 10 } } });
    expect(JSON.stringify(exp)).not.toMatch(/777|"33"|token/);
    expect((await post('/app/api/account/delete', { confirm: 'nope' }, cookie)).statusCode).toBe(400);
    expect((await post('/app/api/account/delete', { confirm: 'DELETE' }, cookie)).json()).toEqual({ deleted: true });
    expect((await get('/app/api/account/session', cookie)).json().authenticated).toBe(false);
    expect((store as unknown as { exportAll(id: string, n: number): { account: unknown } }).exportAll('x', NOW).account).toBeNull();
    await app.close();
  });

  it('without a database the app stays guest-only and the metro is untouched', async () => {
    const app = buildServer({ now: () => NOW_MS, account: { store: null } });
    expect((await app.inject({ url: '/app/api/account/session' })).json()).toEqual({ authenticated: false, available: false, loginMethods: { telegram: false } });
    expect((await app.inject({ method: 'POST', url: '/app/api/account/telegram', payload: JSON.stringify({ initData: 'x' }), headers: { 'content-type': 'application/json' } })).statusCode).toBe(503);
    expect((await app.inject({ url: '/app/api/stations' })).statusCode).toBe(200);
    await app.close();
  });
});

describe('home recommendations', () => {
  const stations = loadStationGeo();
  it('meal slots follow Mashhad time', () => {
    expect([5, 10, 11, 15, 16, 17, 18, 22, 23, 3].map(slotAt)).toEqual(['breakfast', 'breakfast', 'lunch', 'lunch', 'snack', 'snack', 'dinner', 'dinner', 'late', 'late']);
  });
  it('without a point: one honest meal card from the clock, no station claim', () => {
    const r = homeRecommendations(NOW, stations, null);
    expect(r).toMatchObject({ slot: 'lunch', locationUsed: false });
    expect(r.cards.map(c => c.id)).toEqual(['food.lunch']);
    expect(r.cards[0]!.why).toContain('12:00');
    expect(JSON.stringify(r)).not.toMatch(/ارزان|باز است|ارسال رایگان/);
  });
  it('with a point inside Mashhad: nearest station labelled as a straight line, never as walking time', () => {
    const r = homeRecommendations(NOW, stations, { lat: 36.2912, lon: 59.5856 });
    expect(r.cards[0]).toMatchObject({ id: 'transit.nearest', cta: { type: 'station', station: 'شریعتی' }, evidence: { kind: 'straight_line' } });
    expect(r.cards[0]!.detail).toMatch(/فاصلهٔ هوایی/); expect(r.cards[0]!.detail).toMatch(/زمان پیاده روی را مسیریاب حساب می کند/);
    expect(r.cards[1]!.cta).toEqual({ type: 'food', vertical: 'restaurant', sort: 'distance' });
    expect(r.cards.length).toBeLessThanOrEqual(2);
  });
  it('context uses explicit preferences only in suitable times; does not invent gift occasions', () => {
    const clockAtNoon = homeRecommendations(NOW, stations, null, ['flowers', 'fast_food']);
    expect(clockAtNoon.cards[0]!.cta).toMatchObject({ type: 'food', vertical: 'fast_food' });
    expect(clockAtNoon.cards[0]!.why).toContain('پروفایل');
    const clockWithGiftOnly = homeRecommendations(NOW, stations, null, ['flowers']);
    expect(clockWithGiftOnly.cards[0]!.cta).toMatchObject({ type: 'food', vertical: 'restaurant' });
  });
  it('a point far from every station yields no transit card', () => {
    expect(homeRecommendations(NOW, stations, { lat: 36.6, lon: 60.1 }).cards.map(c => c.kind)).toEqual(['food']);
  });
  it('the route validates input, ignores points outside Mashhad and never echoes the point', async () => {
    const app = buildServer({ now: () => NOW_MS, account: { store: null } });
    const post = (payload: unknown, type = 'application/json') => app.inject({ method: 'POST', url: '/app/api/recommendations/home', payload: JSON.stringify(payload), headers: { 'content-type': type } });
    const ok = await post({ lat: 36.2912, lon: 59.5856 });
    expect(ok.statusCode).toBe(200); expect(ok.headers['cache-control']).toBe('no-store'); expect(ok.body).not.toContain('36.2912');
    expect((await post({ lat: 35.7, lon: 51.4 })).json().locationUsed).toBe(false);
    expect((await post({})).statusCode).toBe(200);
    expect((await post({ lat: 'x', lon: 1 })).statusCode).toBe(400);
    expect((await post({ lat: 36.3 })).statusCode).toBe(400);
    expect((await post({ lat: 36.3, lon: 59.6, extra: 1 })).statusCode).toBe(400);
    expect((await post({}, 'text/plain')).statusCode).toBe(415);
    await app.close();
  });
});
