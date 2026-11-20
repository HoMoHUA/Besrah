import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';
import { cellsAround, createSnappPayClient, normalizeMobile } from '../../src/providers/snapppay.js';

const b64u = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const err = (code: number, message: string, data: Record<string, unknown> = {}, status = 400) => json({ successful: false, errorData: { errorCode: code, message, data } }, status);

/** A Snapp Pay SSO + token endpoint that behaves like the real one (2026-11-20), including its internal-host redirect. */
function fakeSnappPay(opts: { otp?: string; sendLimited?: boolean } = {}) {
  const otp = opts.otp ?? '123456';
  const calls: Array<{ method: string; url: string; body: any; headers: Record<string, string> }> = [];
  let state = '', challenge = '', session = '', otpOk = false, sends = 0;
  const fetch = (async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>, method = init.method ?? 'GET';
    const raw = typeof init.body === 'string' ? init.body : '';
    const body = headers['Content-Type'] === 'application/json' && raw ? JSON.parse(raw) : raw ? Object.fromEntries(new URLSearchParams(raw)) : null;
    calls.push({ method, url, body, headers });
    const u = new URL(url), cookie = headers.Cookie ?? '';
    if (u.pathname === '/oauth2/authorize') {
      if (u.searchParams.get('continue') === '1') return otpOk ? new Response(null, { status: 302, headers: { location: `https://app.snapppay.ir/?code=the-code&state=${state}` } }) : new Response(null, { status: 302, headers: { location: 'http://fms-gateway.fms-credit-prod.svc.cluster.local/login' } });
      state = u.searchParams.get('state')!; challenge = u.searchParams.get('code_challenge')!; session = 'S' + Math.random();
      return new Response(null, { status: 302, headers: { location: 'http://fms-gateway.fms-credit-prod.svc.cluster.local/login', 'set-cookie': `FMSSSO_SESSION=${session}; Path=/; Secure; HttpOnly` } });
    }
    if (u.pathname === '/login') return new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    const hasSession = cookie.includes(`FMSSSO_SESSION=${session}`);
    if (u.pathname === '/login/api/csrf') return new Response(null, { status: 204, headers: { 'set-cookie': 'XSRF-TOKEN=x%2Fsrf; Path=/' } });
    if (u.pathname === '/login/client') return hasSession ? json({ successful: true, response: { clientName: 'اسنپ پی' } }) : err(8409, 'نشست ورود شما منقضی شده است.', {}, 409);
    if (u.host === 'sso.snapppay.ir' && method === 'POST' && headers['X-XSRF-TOKEN'] !== 'x/srf') return err(8403, 'csrf', {}, 403);
    if (u.pathname === '/login/mobile') {
      if (opts.sendLimited) return err(8429, 'تا دریافت مجدد کد ۵۵ ثانیه', { retryAfter: 55 }, 429);
      sends++; return json({ successful: true, response: { expiresIn: 120, resendAfter: 60, maskedDestination: '0912***4567' } });
    }
    if (u.pathname === '/login/otp/resend') { sends++; return json({ successful: true, response: { expiresIn: 120, resendAfter: 90 } }); }
    if (u.pathname === '/login/otp/verify') {
      if (body?.otp !== otp) return err(8461, 'کد وارد شده اشتباه است. ۲ تلاش باقی مانده.', { remainingAttempts: 2 });
      otpOk = true; return json({ successful: true, response: { continueUrl: '/oauth2/authorize?continue=1' } });
    }
    if (u.host === 'app.snapppay.ir' && u.pathname === '/api/hodor/oauth2/token') {
      if (body.grant_type === 'authorization_code') {
        const ok = body.code === 'the-code' && body.client_id === 'pay-later' && b64u(createHash('sha256').update(body.code_verifier).digest()) === challenge;
        return ok ? json({ access_token: 'A'.repeat(50), refresh_token: 'R'.repeat(40), expires_in: 3600, token_type: 'Bearer' }) : json({ error: 'invalid_grant' }, 400);
      }
      return body.refresh_token === 'R'.repeat(40) ? json({ access_token: 'B'.repeat(50), refresh_token: 'Q'.repeat(40), expires_in: 3600 }) : json({ error: 'invalid_grant' }, 400);
    }
    return json({}, 404);
  }) as typeof globalThis.fetch;
  return { calls, client: createSnappPayClient({ fetch, now: () => 1_000_000 }), sends: () => sends };
}
const post = (app: ReturnType<typeof buildServer>, url: string, payload: unknown) => app.inject({ method: 'POST', url, payload: payload as object });

describe('Snapp Pay login (the person’s own account; session goes back to the device only)', () => {
  it('normalises Iranian mobile numbers to the SSO form', () => {
    for (const p of ['09121234567', '9121234567', '+989121234567', '۰۹۱۲ ۱۲۳ ۴۵۶۷']) expect(normalizeMobile(p)).toBe('09121234567');
    expect(normalizeMobile('0212345678')).toBeNull();
  });

  it('number -> SMS code -> wrong code -> right code -> tokens, through the SSO cookie session with PKCE', async () => {
    const fake = fakeSnappPay();
    const app = buildServer({ snappPay: { client: fake.client } });
    const sent = await post(app, '/app/api/snapppay/login', { phone: '۰۹۱۲۱۲۳۴۵۶۷' });
    expect(sent.statusCode).toBe(200);
    expect(sent.headers['cache-control']).toBe('no-store');
    const s = sent.json();
    expect(s).toMatchObject({ status: 'sent', expiresInS: 120, resendAfterS: 60, masked: '0912***4567' });
    expect(s.loginId).toMatch(/^[0-9a-f-]{36}$/);
    expect(fake.calls.find(c => c.url.endsWith('/login/mobile'))?.body).toEqual({ mobile: '09121234567' });
    expect(fake.calls.find(c => c.url.endsWith('/login/mobile'))?.headers['X-XSRF-TOKEN']).toBe('x/srf');
    expect(fake.calls.some(c => c.url.startsWith('https://sso.snapppay.ir/login') && c.method === 'GET')).toBe(true);   // the internal host was rebased

    const wrong = await post(app, '/app/api/snapppay/verify', { loginId: s.loginId, code: '000000' });
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json()).toEqual({ error: 'wrong_code', message: 'کد وارد شده اشتباه است. ۲ تلاش باقی مانده.', remaining: 2 });

    const linked = await post(app, '/app/api/snapppay/verify', { loginId: s.loginId, code: '۱۲۳۴۵۶' });
    expect(linked.statusCode).toBe(200);
    expect(linked.json()).toEqual({ status: 'linked', phoneHint: '4567', session: { access: 'A'.repeat(50), refresh: 'R'.repeat(40), expAt: 1_000_000 + 3_600_000 } });
    const tokenCall = fake.calls.find(c => c.url.endsWith('/api/hodor/oauth2/token'))!;
    expect(tokenCall.body).toMatchObject({ client_id: 'pay-later', grant_type: 'authorization_code', code: 'the-code', redirect_uri: 'https://app.snapppay.ir/' });
    expect(fake.sends()).toBe(1);
    expect((await post(app, '/app/api/snapppay/verify', { loginId: s.loginId, code: '123456' })).json()).toEqual({ error: 'restart' });   // one login, then gone
  });

  it('Snapp Pay’s own limits come back with their wait; bad input is refused before Snapp Pay; resend works', async () => {
    const limitedApp = buildServer({ snappPay: { client: fakeSnappPay({ sendLimited: true }).client } });
    const lim = await post(limitedApp, '/app/api/snapppay/login', { phone: '09121234567' });
    expect(lim.statusCode).toBe(429);
    expect(lim.headers['retry-after']).toBe('55');
    expect(lim.json()).toMatchObject({ error: 'rate_limited', retryAfterS: 55 });
    const fake = fakeSnappPay();
    const app = buildServer({ snappPay: { client: fake.client } });
    expect((await post(app, '/app/api/snapppay/login', { phone: '021' })).json()).toEqual({ error: 'bad_phone' });
    const s = (await post(app, '/app/api/snapppay/login', { phone: '09121234567' })).json();
    expect((await post(app, '/app/api/snapppay/resend', { loginId: s.loginId })).json()).toEqual({ status: 'sent', expiresInS: 120, resendAfterS: 90 });
    expect((await post(app, '/app/api/snapppay/verify', { loginId: s.loginId, code: '12' })).json()).toEqual({ error: 'bad_code' });
    expect((await post(app, '/app/api/snapppay/verify', { loginId: '11111111-2222-4333-8444-555555555555', code: '123456' })).json()).toEqual({ error: 'restart' });
    for (let i = 0; i < 2; i++) await post(app, '/app/api/snapppay/login', { phone: '09121234567' });
    expect((await post(app, '/app/api/snapppay/login', { phone: '09121234567' })).statusCode).toBe(429);   // 3 per 10 minutes here
  });

  it('refresh hands a new session back; an unknown refresh token is 401', async () => {
    const app = buildServer({ snappPay: { client: fakeSnappPay().client } });
    expect((await post(app, '/app/api/snapppay/refresh', { refresh: 'R'.repeat(40) })).json()).toMatchObject({ status: 'ok', session: { access: 'B'.repeat(50), refresh: 'Q'.repeat(40) } });
    expect((await post(app, '/app/api/snapppay/refresh', { refresh: 'X'.repeat(40) })).statusCode).toBe(401);
  });
});

describe('H3 cells for the in-store map, anywhere in Iran', () => {
  it('Mashhad and Ahvaz get the centre cell and its ring; outside Iran is refused', async () => {
    expect(cellsAround(36.2975, 59.6059, 7, 1)).toHaveLength(7);
    expect(cellsAround(36.2975, 59.6059, 7, 1)).toContain('8743608e9ffffff');     // the cell Snapp Pay answered for Shohada square
    const app = buildServer({ snappPay: { client: null } });
    const ahvaz = (await post(app, '/app/api/geo/h3', { lat: 31.3183, lon: 48.6706 })).json();
    expect(ahvaz.resolution).toBe(7);
    expect(ahvaz.cells).toHaveLength(7);
    expect((await post(app, '/app/api/geo/h3', { lat: 48.85, lon: 2.35 })).statusCode).toBe(400);
    expect((await post(app, '/app/api/snapppay/login', { phone: '09121234567' })).json()).toEqual({ error: 'not_configured' });
  });
});
