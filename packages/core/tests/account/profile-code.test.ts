// D17: the derived profile code is stored server-side only with its own consent; guests can see theirs without storage.
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';
import { openAccountStore, validatePreferences } from '../../src/account/store.js';

const NOW_MS = Date.parse('2026-11-19T08:30:00Z'), NOW = Math.floor(NOW_MS / 1000), BOT = '9195157620';
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const PUB_HEX = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
function initData(id: number): string {
  const params: Record<string, string> = { auth_date: String(NOW - 30), query_id: 'AAH', user: JSON.stringify({ id, first_name: 'Ali' }) };
  const check = `${BOT}:WebAppData\n` + Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  return new URLSearchParams({ ...params, hash: 'ignored', signature: sign(null, Buffer.from(check), privateKey).toString('base64url') }).toString();
}
const make = () => {
  const store = openAccountStore(':memory:');
  const app = buildServer({ now: () => NOW_MS, account: { store, botId: BOT, telegramPublicKeyHex: PUB_HEX, secureCookie: false } });
  const post = (url: string, payload: unknown, cookie?: string) => app.inject({ method: 'POST', url, payload: JSON.stringify(payload), headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } });
  const get = (url: string, cookie?: string) => app.inject({ method: 'GET', url, ...(cookie ? { headers: { cookie } } : {}) });
  const login = async (id: number) => String((await post('/app/api/account/telegram', { initData: initData(id) })).headers['set-cookie']).split(';')[0]!;
  return { app, store, post, get, login };
};
const VALUES = { foodBudgetToman: 250000, transitPriority: 'time', foodPreferredVerticals: ['cafe'], shopPriority: 'quality' };

describe('shopPriority preference', () => {
  it('is whitelisted', () => {
    expect(validatePreferences({ shopPriority: 'installment' })).toEqual({ ok: true, value: { shopPriority: 'installment' } });
    expect(validatePreferences({ shopPriority: 'cheap' })).toEqual({ ok: false, field: 'shopPriority' });
  });
});

describe('profile code routes', () => {
  it('describe works for a guest, stores nothing and validates the body', async () => {
    const { app, post, store } = make();
    const r = await post('/app/api/profile/describe', { values: VALUES });
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.json()).toMatchObject({ version: 1, code: '2ACB', complete: true });
    expect((await post('/app/api/profile/describe', { values: { shopPriority: 'x' } })).json()).toEqual({ error: 'bad_request', field: 'shopPriority' });
    expect((await post('/app/api/profile/describe', { values: {}, extra: 1 })).statusCode).toBe(400);
    expect(store.exportAll('nobody', NOW)).toMatchObject({ profile: null });
    await app.close();
  });
  it('the account copy needs login and the separate profile_code consent; only the code is stored', async () => {
    const { app, post, get, login, store } = make();
    expect((await get('/app/api/account/profile')).statusCode).toBe(401);
    const cookie = await login(901);
    expect((await get('/app/api/account/profile', cookie)).json()).toEqual({ error: 'consent_required', purpose: 'profile_code' });
    expect((await post('/app/api/account/profile', { values: VALUES }, cookie)).statusCode).toBe(403);
    await post('/app/api/account/consents', { purpose: 'profile_code', granted: true }, cookie);
    const saved = (await post('/app/api/account/profile', { values: VALUES }, cookie)).json();
    expect(saved.profile).toMatchObject({ code: '2ACB', codeVersion: 1, updatedAt: NOW });
    expect(saved.profile.positions).toHaveLength(4);
    expect((await get('/app/api/account/profile', cookie)).json().profile.code).toBe('2ACB');
    // Without sync consent the preferences themselves are not on the server; only the code is.
    const exported = (await post('/app/api/account/export', {}, cookie)).json();
    expect(exported.preferences).toEqual({ version: 0, values: {} });
    expect(exported.profile).toMatchObject({ code: '2ACB' });
    expect(JSON.stringify(exported)).not.toContain('250000');
    void store; await app.close();
  });
  it('revoking profile_code deletes the stored code; deleting the account cascades', async () => {
    const { app, post, get, login } = make();
    const cookie = await login(902);
    await post('/app/api/account/consents', { purpose: 'profile_code', granted: true }, cookie);
    await post('/app/api/account/profile', { values: VALUES }, cookie);
    await post('/app/api/account/consents', { purpose: 'profile_code', granted: false }, cookie);
    await post('/app/api/account/consents', { purpose: 'profile_code', granted: true }, cookie);
    expect((await get('/app/api/account/profile', cookie)).json()).toEqual({ profile: null });
    await post('/app/api/account/profile', { values: VALUES }, cookie);
    expect((await post('/app/api/account/delete', { confirm: 'DELETE' }, cookie)).json()).toEqual({ deleted: true });
    await app.close();
  });
  it('with both consents, saving synced preferences also refreshes the code', async () => {
    const { app, post, get, login } = make();
    const cookie = await login(903);
    await post('/app/api/account/consents', { purpose: 'sync_preferences', granted: true }, cookie);
    await post('/app/api/account/consents', { purpose: 'profile_code', granted: true }, cookie);
    await post('/app/api/account/preferences', { expectedVersion: 0, values: { transitPriority: 'walk', shopPriority: 'price' } }, cookie);
    expect((await get('/app/api/account/profile', cookie)).json().profile.code).toBe('0BXA');
    await app.close();
  });
  it('one account never sees another account\'s code', async () => {
    const { app, post, get, login } = make();
    const a = await login(904), b = await login(905);
    for (const c of [a, b]) await post('/app/api/account/consents', { purpose: 'profile_code', granted: true }, c);
    await post('/app/api/account/profile', { values: VALUES }, a);
    expect((await get('/app/api/account/profile', b)).json()).toEqual({ profile: null });
    await app.close();
  });
});
