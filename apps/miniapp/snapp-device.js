// Snapp from the person's own phone. Inside the Besrah Android app (window.BesrahNative.snappRequest) the SMS-code login
// and the ride prices and requests go straight from the phone to Snapp over the person's own connection: the phone number, the code
// and the session never pass through Besrah's server. Browsers and Telegram cannot do this (Snapp's API does not allow
// other sites), so there the same calls go through api/snapp/* with the session still kept on the device.
// Same requests and answers as packages/core/src/providers/snapp.ts.
import { ApiError } from './api.js';

const CAPTCHA_REQUIRED = { 2001: 'numeric', 2002: 'alphabetic', 2003: 'alphanumeric', 2201: 'numeric', 2202: 'alphabetic', 2203: 'alphanumeric' };
const CAPTCHA_WRONG = new Set([2101, 2102, 2103]);
const CAPTCHA_TYPES = ['numeric', 'alphabetic', 'alphanumeric'];
const fail = (kind, reason, status = 0) => Object.assign(new ApiError(kind), { reason, status });

let seq = 0;
const waiting = new Map();
/** One native request; resolves { status, body } (status 0 = no connection). */
export function nativeSnapp(native, key, body, bearer = '', extra = '', timeoutMs = 20000) {
  return new Promise(resolve => {
    const id = `s${++seq}`;
    const timer = setTimeout(() => { waiting.delete(id); resolve({ status: 0, body: null }); }, timeoutMs);
    timer.unref?.();
    waiting.set(id, { resolve, timer });
    const w = globalThis.window ?? globalThis;
    w.__besrahSnappDone ??= (doneId, status, text) => {
      const job = waiting.get(doneId); if (!job) return;
      clearTimeout(job.timer); waiting.delete(doneId);
      let parsed = null; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
      job.resolve({ status: Number(status) || 0, body: parsed });
    };
    try { native.snappRequest(id, key, body ? JSON.stringify(body) : '', bearer, extra); }
    catch { clearTimeout(timer); waiting.delete(id); resolve({ status: 0, body: null }); }
  });
}

export function parsePrice(body) {
  const data = body?.data;
  if (!data || !Array.isArray(data.services)) return null;
  const services = [];
  for (const s of data.services.slice(0, 20)) {
    const id = typeof s?.id === 'number' ? s.id : null, name = typeof s?.info?.name === 'string' ? s.info.name.trim().slice(0, 40) : '';
    if (id === null || !name) continue;
    const rial = typeof s.price?.final === 'number' && s.price.final > 0 ? s.price.final : null;
    const eta = Array.isArray(s.estimation?.eta) && typeof s.estimation.eta[0] === 'number' ? s.estimation.eta[0] : null;
    services.push({ id, name, description: typeof s.info?.description === 'string' ? s.info.description.trim().slice(0, 60) : '',
      priceToman: rial === null ? null : Math.round(rial / 10), etaMin: eta, enabled: s.enabled !== false && rial !== null });
  }
  return { services, ttlS: typeof data.ttl === 'number' && data.ttl > 0 ? Math.min(600, Math.round(data.ttl)) : 120 };
}

export const normalizePhone = raw => {
  const d = String(raw ?? '').replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x06f0)).replace(/[\s\-()]/g, '');
  const m = /^(?:\+98|0098|98|0)?(9\d{9})$/.exec(d);
  return m ? `+98${m[1]}` : null;
};
const uuid = () => globalThis.crypto?.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));

/** The api object with Snapp's login and price calls made by the phone itself; candidates stay on the server (OSM). */
export function withDeviceSnapp(api, native, { now = () => Date.now() } = {}) {
  let config = null;
  const canRequestRide = (native.version?.() ?? 0) >= 3;
  const cfg = async () => (config ??= await api.snappConfig());
  const methods = new Map();            // phone -> { method, captchaType } Snapp gave with the code, memory only
  const attestation = c => ({ method: c ? c.type : 'skip', platform: c ? 'captcha' : 'skip' });
  const captchaBody = async c => (c ? { client_id: (await cfg()).captchaClient, solution: c.solution, ref_id: c.refId, type: c.type } : undefined);
  async function freshCaptcha(type, wrong = false) {
    const r = await nativeSnapp(native, 'captcha', null, '', `${type}/${(await cfg()).captchaClient}`);
    const d = r.body?.data ?? r.body;
    if (r.status !== 200 || typeof d?.image !== 'string' || typeof d?.ref_id !== 'string') throw fail('server', 'unavailable');
    return { status: 'captcha', wrong, captcha: { type, image: d.image, refId: d.ref_id } };
  }
  const captchaAnswer = code => freshCaptcha(CAPTCHA_REQUIRED[code] ?? CAPTCHA_TYPES[(code % 10) - 1] ?? 'numeric', CAPTCHA_WRONG.has(code));
  const codeOf = r => (typeof r.body?.status === 'number' ? r.body.status : r.status);
  return {
    ...api,
    deviceSnapp: true,
    snappRequestAvailable: canRequestRide,
    async snappRequest(from, to, serviceId, session) {
      if (!canRequestRide || !session?.access) throw fail('server', 'unavailable');
      const r = await nativeSnapp(native, 'ride', {
        origin_lat: from.lat, origin_lng: from.lon, destination_lat: to.lat, destination_lng: to.lon,
        service_type: serviceId, preferences: {}, is_paid_by_recipient: false,
      }, session.access);
      const accepted = r.status === 204 || (r.status >= 200 && r.status < 300
        && r.body && typeof r.body === 'object' && !(r.body.status >= 400));
      if (!accepted) throw fail('server', 'unavailable', r.status);
      return { status: 'requested' };
    },
    async snappOtp(phone, captcha) {
      const cellphone = normalizePhone(phone);
      if (!cellphone) throw fail('server', 'bad_phone', 400);
      const r = await nativeSnapp(native, 'otp', { cellphone, attestation: attestation(captcha), extra_methods: [], captcha: await captchaBody(captcha) });
      if (r.status >= 200 && r.status < 300 && r.body) {
        methods.set(cellphone, { method: typeof r.body.method === 'string' ? r.body.method : null, captchaType: CAPTCHA_TYPES.includes(r.body.captcha_type) ? r.body.captcha_type : null });
        return { status: 'sent', ttlS: typeof r.body.ttl === 'number' ? r.body.ttl : null };
      }
      const code = codeOf(r);
      if (CAPTCHA_REQUIRED[code] || CAPTCHA_WRONG.has(code)) return captchaAnswer(code);
      throw fail(code === 429 ? 'rate_limited' : 'server', code === 429 ? 'rate_limited' : code === 400 ? 'bad_phone' : 'unavailable', r.status);
    },
    async snappVerify(phone, code, captcha) {
      const cellphone = normalizePhone(phone), token = String(code ?? '').replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x06f0)).trim();
      if (!cellphone || !/^\d{4,6}$/.test(token)) throw fail('server', cellphone ? 'bad_code' : 'bad_phone', 400);
      // As in Snapp's web app: when Snapp said the code check needs a captcha, a fresh one comes first.
      const wants = methods.get(cellphone)?.captchaType;
      if (!captcha && wants) return freshCaptcha(wants);
      const c = await cfg(), deviceId = uuid();
      const r = await nativeSnapp(native, 'verify', { attestation: attestation(captcha), grant_type: methods.get(cellphone)?.method ?? 'sms', client_id: c.clientId, client_secret: c.clientSecret,
        cellphone, token, referrer: 'pwa', device_id: deviceId, captcha: await captchaBody(captcha) });
      if (r.status >= 200 && r.status < 300 && typeof r.body?.access_token === 'string' && typeof r.body?.refresh_token === 'string') {
        methods.delete(cellphone);
        return { status: 'linked', session: { access: r.body.access_token, refresh: r.body.refresh_token, deviceId }, phoneHint: cellphone.slice(-4) };
      }
      const st = codeOf(r);
      if (CAPTCHA_REQUIRED[st] || CAPTCHA_WRONG.has(st)) return captchaAnswer(st);
      throw fail(st === 429 ? 'rate_limited' : 'server', st === 429 ? 'rate_limited' : [400, 401, 1012, 1041].includes(st) ? 'wrong_code' : 'unavailable', r.status);
    },
    async snappPrice(from, to, session) {
      if (!session) throw fail('server', 'no_shared_session', 503);
      const body = { points: [{ lat: String(from.lat), lng: String(from.lon) }, { lat: String(to.lat), lng: String(to.lon) }], price_ride_recom: false, options: {}, locale: 'fa', os: 6, version: 0 };
      let s = session, rotated = null;
      let r = await nativeSnapp(native, 'price', body, s.access);
      if (r.status === 401 || r.status === 403) {
        const c = await cfg();
        const f = await nativeSnapp(native, 'refresh', { grant_type: 'refresh_token', client_id: c.clientId, client_secret: c.clientSecret, device_id: s.deviceId, refresh_token: s.refresh });
        if (f.status !== 200 || typeof f.body?.access_token !== 'string') throw fail('unauthenticated', 'unauthorized', 401);
        s = rotated = { access: f.body.access_token, refresh: typeof f.body.refresh_token === 'string' ? f.body.refresh_token : s.refresh, deviceId: s.deviceId };
        r = await nativeSnapp(native, 'price', body, s.access);
      }
      if (r.status === 429) throw fail('rate_limited', 'rate_limited', 429);
      const parsed = r.status === 200 ? parsePrice(r.body) : null;
      if (!parsed) throw fail('server', 'unavailable', r.status);
      return { schemaVersion: 1, source: 'snapp_live', sessionKind: 'user', viaDevice: true, retrievedAt: new Date(now()).toISOString(), ttlS: parsed.ttlS, services: parsed.services, ...(rotated ? { session: rotated } : {}) };
    },
  };
}
