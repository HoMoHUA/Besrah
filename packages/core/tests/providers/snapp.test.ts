import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';
import { createServiceSession, createSnappClient, normalizePhone, parsePrice, type SnappSession } from '../../src/providers/snapp.js';

const CFG = { clientId: 'client-id', clientSecret: 'client-secret', captchaClient: 'captcha-client' };
const SESSION: SnappSession = { access: 'a'.repeat(40), refresh: 'r'.repeat(30), deviceId: '11111111-2222-4333-8444-555555555555' };
// Shape trimmed from a real answer (2026-11-20): rials, eta in minutes, a disabled carpool service.
const PRICE = { status: 200, data: { ttl: 359, services: [
  { id: 1, enabled: true, price: { final: 1930000 }, info: { name: 'اسنپ', description: 'به صرفه' }, estimation: { eta: [13] } },
  { id: 24, enabled: true, price: { final: 0 }, info: { name: 'سفر اشتراکی', description: '' }, estimation: { eta: [] } },
  { id: 2, enabled: true, price: { final: 2570000 }, info: { name: 'اسنپ اکوپلاس', description: 'راحت' }, estimation: { eta: [9] } },
] } };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fakeSnapp(script: (url: string, body: any, headers: Record<string, string>) => Response) {
  const calls: Array<{ url: string; body: any; auth: string | undefined }> = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : null, headers = init.headers as Record<string, string>;
    calls.push({ url, body, auth: headers.Authorization });
    return script(url, body, headers);
  }) as typeof globalThis.fetch;
  return { calls, client: createSnappClient(CFG, { fetch }) };
}
const memoryService = (s: SnappSession | null) => { let v = s; return { get: () => v, set: (n: SnappSession) => { v = n; }, value: () => v }; };
const post = (app: ReturnType<typeof buildServer>, url: string, payload: unknown) => app.inject({ method: 'POST', url, payload: payload as object });

describe('normalising and parsing', () => {
  it('accepts Iranian mobile numbers in every usual spelling', () => {
    for (const p of ['09121234567', '9121234567', '+989121234567', '00989121234567', '۰۹۱۲ ۱۲۳ ۴۵۶۷']) expect(normalizePhone(p)).toBe('+989121234567');
    for (const p of ['0212345678', '0912123456', 'abc', 912, '']) expect(normalizePhone(p)).toBeNull();
  });
  it('turns Snapp services into tomans; a zero price is not available', () => {
    expect(parsePrice(PRICE)).toEqual({ ttlS: 359, services: [
      { id: 1, name: 'اسنپ', description: 'به صرفه', priceToman: 193000, etaMin: 13, enabled: true },
      { id: 24, name: 'سفر اشتراکی', description: '', priceToman: null, etaMin: null, enabled: false },
      { id: 2, name: 'اسنپ اکوپلاس', description: 'راحت', priceToman: 257000, etaMin: 9, enabled: true },
    ] });
    expect(parsePrice({ data: {} })).toBeNull();
  });
});

describe('linking a person’s own Snapp (SMS code), session kept on their device only', () => {
  it('sends the code, asks for a captcha when Snapp wants one, and returns the session to the caller without storing it', async () => {
    let captchaShown = false;
    const { calls, client } = fakeSnapp((url, body) => {
      if (url.endsWith('/v3/mutotp') && !body.captcha) return json({ status: 2001, message: 'captcha' }, 403);
      if (url.includes('/captcha/api/v1/generate/text/numeric/captcha-client')) { captchaShown = true; return json({ data: { image: 'data:image/png;base64,AAAA', ref_id: 'ref-1' } }); }
      if (url.endsWith('/v3/mutotp')) return json({ method: 'sms', ttl: 120 });
      if (url.endsWith('/v3/mutotp/auth')) return body.token === '12345' ? json({ access_token: 'x'.repeat(40), refresh_token: 'y'.repeat(30) }) : json({ status: 1012 }, 400);
      return json({}, 404);
    });
    const service = memoryService(null);
    const app = buildServer({ snapp: { client, service } });
    const first = await post(app, '/app/api/snapp/otp', { phone: '09121234567' });
    expect(first.json()).toEqual({ status: 'captcha', wrong: false, captcha: { type: 'numeric', image: 'data:image/png;base64,AAAA', refId: 'ref-1' } });
    expect(captchaShown).toBe(true);
    const sent = await post(app, '/app/api/snapp/otp', { phone: '09121234567', captcha: { type: 'numeric', refId: 'ref-1', solution: '48213' } });
    expect(sent.json()).toEqual({ status: 'sent', ttlS: 120 });
    expect(calls.find(c => c.url.endsWith('/v3/mutotp') && c.body.captcha)?.body).toMatchObject({ cellphone: '+989121234567', attestation: { method: 'numeric', platform: 'captcha' }, captcha: { client_id: 'captcha-client', solution: '48213', ref_id: 'ref-1', type: 'numeric' } });
    expect((await post(app, '/app/api/snapp/verify', { phone: '09121234567', code: '11111' })).json()).toEqual({ error: 'wrong_code' });
    const linked = await post(app, '/app/api/snapp/verify', { phone: '09121234567', code: '۱۲۳۴۵' });
    expect(linked.statusCode).toBe(200);
    expect(linked.headers['cache-control']).toBe('no-store');
    const body = linked.json();
    expect(body).toMatchObject({ status: 'linked', phoneHint: '4567', session: { access: 'x'.repeat(40), refresh: 'y'.repeat(30) } });
    expect(body.session.deviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls.find(c => c.url.endsWith('/v3/mutotp/auth') && c.body.token === '12345')?.body).toMatchObject({ grant_type: 'sms', client_id: 'client-id', cellphone: '+989121234567', referrer: 'pwa' });
    expect(service.value()).toBeNull();                                                  // nothing kept on the server
  });
  it('when Snapp wants a captcha for the code check too, a fresh one comes first and goes with the same code; no new SMS', async () => {
    // The loop the owner hit on 2026-11-20: code -> captcha -> (new code) -> captcha ... Snapp's web app shows a fresh
    // captcha before the code check when the code answer says captcha_type, and retries the check with the same code.
    let images = 0;
    const { calls, client } = fakeSnapp((url, body) => {
      if (url.includes('/captcha/api/v1/generate/text/')) { images++; return json({ data: { image: 'data:image/png;base64,AAAA', ref_id: `ref-${images}` } }); }
      if (url.endsWith('/v3/mutotp')) return json({ method: 'sms', ttl: 120, captcha_type: 'numeric' });
      if (url.endsWith('/v3/mutotp/auth')) {
        if (!body.captcha) return json({ status: 2001 }, 403);
        if (body.captcha.solution !== '55555') return json({ status: 2101 }, 403);
        return json({ access_token: 'x'.repeat(40), refresh_token: 'y'.repeat(30) });
      }
      return json({}, 404);
    });
    const app = buildServer({ snapp: { client, service: memoryService(null) } });
    expect((await post(app, '/app/api/snapp/otp', { phone: '09121234567' })).json()).toEqual({ status: 'sent', ttlS: 120 });
    const ask = await post(app, '/app/api/snapp/verify', { phone: '09121234567', code: '12345' });
    expect(ask.json()).toEqual({ status: 'captcha', wrong: false, captcha: { type: 'numeric', image: 'data:image/png;base64,AAAA', refId: 'ref-1' } });
    expect(calls.filter(c => c.url.endsWith('/v3/mutotp/auth'))).toHaveLength(0);     // no code attempt spent on a sure refusal
    const wrong = await post(app, '/app/api/snapp/verify', { phone: '09121234567', code: '12345', captcha: { type: 'numeric', refId: 'ref-1', solution: '11111' } });
    expect(wrong.json()).toMatchObject({ status: 'captcha', wrong: true, captcha: { type: 'numeric', refId: 'ref-2' } });
    const linked = await post(app, '/app/api/snapp/verify', { phone: '09121234567', code: '12345', captcha: { type: 'numeric', refId: 'ref-2', solution: '55555' } });
    expect(linked.json()).toMatchObject({ status: 'linked', phoneHint: '4567' });
    expect(calls.filter(c => c.url.endsWith('/v3/mutotp'))).toHaveLength(1);           // one SMS code for the whole login
    expect(calls.filter(c => c.url.endsWith('/v3/mutotp/auth')).at(-1)?.body).toMatchObject({ token: '12345', attestation: { method: 'numeric', platform: 'captcha' },
      captcha: { client_id: 'captcha-client', solution: '55555', ref_id: 'ref-2', type: 'numeric' } });
  });
  it('validates input, is rate limited, and says so when Snapp is not configured', async () => {
    const { client } = fakeSnapp(() => json({ method: 'sms', ttl: 120 }));
    const app = buildServer({ snapp: { client, service: memoryService(null) }, limiterClock: () => 0 });
    expect((await post(app, '/app/api/snapp/otp', { phone: '123' })).statusCode).toBe(400);
    for (let i = 0; i < 2; i++) expect((await post(app, '/app/api/snapp/otp', { phone: '09121234567' })).statusCode).toBe(200);
    expect((await post(app, '/app/api/snapp/otp', { phone: '09121234567' })).statusCode).toBe(429);
    expect((await post(app, '/app/api/snapp/verify', { phone: '09121234567', code: 'ab' })).json()).toEqual({ error: 'bad_code' });
    const off = buildServer({ snapp: { client: null, service: memoryService(null) } });
    expect((await post(off, '/app/api/snapp/price', { from: { lat: 36.3, lon: 59.6 }, to: { lat: 36.31, lon: 59.61 } })).json()).toEqual({ error: 'not_configured' });
  });
});

describe('POST /app/api/snapp/price', () => {
  const from = { lat: 36.2975, lon: 59.6059 }, to = { lat: 36.3341, lon: 59.5462 };
  it('with the person’s session: an expired session is refreshed once and the new one handed back', async () => {
    let refreshed = 0;
    const { calls, client } = fakeSnapp((url, _b, h) => {
      if (url.endsWith('/v2/auth')) { refreshed++; return json({ access_token: 'n'.repeat(40), refresh_token: 'm'.repeat(30) }); }
      if (url.endsWith('/v3/price')) return h.Authorization === `Bearer ${'n'.repeat(40)}` ? json(PRICE) : json({ status: 401 }, 401);
      return json({}, 404);
    });
    const app = buildServer({ snapp: { client, service: memoryService(null) } });
    const r = (await post(app, '/app/api/snapp/price', { from, to, session: SESSION })).json();
    expect(refreshed).toBe(1);
    expect(r).toMatchObject({ schemaVersion: 1, source: 'snapp_live', sessionKind: 'user', ttlS: 359, session: { access: 'n'.repeat(40), refresh: 'm'.repeat(30), deviceId: SESSION.deviceId } });
    expect(r.services[0]).toEqual({ id: 1, name: 'اسنپ', description: 'به صرفه', priceToman: 193000, etaMin: 13, enabled: true });
    expect(calls.filter(c => c.url.endsWith('/v3/price'))[0]!.body).toEqual({ points: [{ lat: '36.2975', lng: '59.6059' }, { lat: '36.3341', lng: '59.5462' }], price_ride_recom: false, options: {}, locale: 'fa', os: 6, version: 0 });
  });
  it('without a session: the shared session answers once per cell pair while the answer is fresh', async () => {
    const { calls, client } = fakeSnapp(url => (url.endsWith('/v3/price') ? json(PRICE) : json({}, 404)));
    let t = 1_000_000;
    const app = buildServer({ snapp: { client, service: memoryService(SESSION) }, now: () => t });
    const a = (await post(app, '/app/api/snapp/price', { from, to })).json();
    const b = (await post(app, '/app/api/snapp/price', { from: { lat: 36.2972, lon: 59.6061 }, to })).json();   // same ~110 m cell
    expect(a).toMatchObject({ sessionKind: 'shared', services: expect.any(Array) });
    expect(b.retrievedAt).toBe(a.retrievedAt);
    expect(calls.length).toBe(1);
    t += 301_000;
    await post(app, '/app/api/snapp/price', { from, to });
    expect(calls.length).toBe(2);
  });
  it('rejects points outside Mashhad and malformed sessions; no shared session is a clear 503', async () => {
    const { client } = fakeSnapp(() => json(PRICE));
    const app = buildServer({ snapp: { client, service: memoryService(null) } });
    expect((await post(app, '/app/api/snapp/price', { from: { lat: 35.7, lon: 51.4 }, to })).json()).toEqual({ error: 'bad_points' });
    expect((await post(app, '/app/api/snapp/price', { from, to, session: { access: 'x' } })).json()).toEqual({ error: 'bad_session' });
    expect((await post(app, '/app/api/snapp/price', { from, to })).json()).toEqual({ error: 'no_shared_session' });
  });
  it('the service session file is read once and rewritten atomically after a refresh', () => {
    const svc = createServiceSession(undefined);
    expect(svc.get()).toBeNull();
    svc.set(SESSION);
    expect(svc.get()).toEqual(SESSION);
  });
});

describe('GET /app/api/snapp/config', () => {
  it('gives the Android app Snapp’s public web-app constants; 503 when not configured', async () => {
    const app = buildServer({ snapp: { config: CFG, client: null } });
    const r = await app.inject({ method: 'GET', url: '/app/api/snapp/config' });
    expect(r.json()).toEqual({ schemaVersion: 1, clientId: 'client-id', clientSecret: 'client-secret', captchaClient: 'captcha-client' });
    expect(r.headers['cache-control']).toBe('private, max-age=3600');
    expect((await buildServer({ snapp: { config: null, client: null } }).inject({ method: 'GET', url: '/app/api/snapp/config' })).statusCode).toBe(503);
  });
});

describe('confirmed Snapp requests', () => {
  it('sends both selected coordinates and the service once, using only the personal session', async () => {
    const { calls, client } = fakeSnapp(() => json({ status: 200 }));
    const app = buildServer({ snapp: { client, service: memoryService(SESSION) } });
    const from = { lat: 36.2975, lon: 59.6059 }, to = { lat: 36.3341, lon: 59.5462 };
    const payload = { from, to, serviceId: 2 };
    const url = '/app/api/snapp/request';
    try {
      expect((await post(app, url, payload)).statusCode).toBe(401);
      const response = await post(app, url, { ...payload, session: SESSION });
      expect(response.json()).toEqual({ status: 'requested' });
      expect(response.headers['cache-control']).toBe('no-store');
      expect((await post(app, url, { ...payload, session: SESSION })).statusCode).toBe(429);
      expect(calls).toMatchObject([{
        url: 'https://app.snapp.taxi/api/api-base/v2/passenger/ride',
        auth: `Bearer ${SESSION.access}`,
        body: { origin_lat: from.lat, origin_lng: from.lon, destination_lat: to.lat, destination_lng: to.lon, service_type: 2 },
      }]);
    } finally {
      await app.close();
    }
  });
});
