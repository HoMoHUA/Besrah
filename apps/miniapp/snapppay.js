// Snapp Pay from the person's own device (F6). With the session from «حساب اسنپ‌پی» (Profile), this device itself asks
// Snapp Pay for the account summary, product search (searchwise) and in-store shops near a point: those APIs answer any
// site, so the requests go over the person's own connection and Besrah's server never sees them. Only the token refresh
// goes through Besrah's server (api.snappPayRefresh) because Snapp Pay's token endpoint is closed to other sites, and the
// server turns a point into H3 map cells (api.geoCells) for the in-store map.
// Snapp Pay amounts are rials; everything returned from here is tomans.
const BASE = 'https://app.snapppay.ir';
// The account summary refuses requests without `locale` (Snapp Pay error 1005); both headers pass Snapp Pay's CORS.
const HEADERS = { Accept: 'application/json', 'X-Parent-App': 'snappPayPWA', locale: 'fa' };
const toman = v => { const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v; return Number.isFinite(n) && n >= 0 ? Math.round(n / 10) : null; };
const str = (v, n = 120) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const httpsUrl = v => (typeof v === 'string' && /^https:\/\/[\w.-]+\//.test(v) ? v : null);
const pct = v => { const m = /(\d{1,3})/.exec(String(v ?? '')); return m ? Number(m[1]) : null; };
export const PAY_WAYS = { INSTALLMENT_PAYMENT_METHOD_TYPE: 'چهار قسط', POSTPAID_PAYMENT_METHOD_TYPE: 'پرداخت آخر ماه', FINANCING_PAYMENT_METHOD_TYPE: 'اعتبار بانکی', PAY_NOW_PAYMENT_METHOD_TYPE: 'پرداخت نقدی' };

export class SnappPayError extends Error { constructor(kind, status = 0) { super(kind); this.kind = kind; this.status = status; } }

/** The account summary: credit, the three balances, score and the dates the person must know. */
export function parseAccount(r) {
  if (!r || typeof r !== 'object') return null;
  return {
    score: Number.isFinite(r.score) ? r.score : null,
    totalCreditToman: toman(r.totalCredit), debtToman: toman(r.totalDebt), balanceToman: toman(r.currentBalance),
    installmentToman: toman(r.installmentBalance), postpaidToman: toman(r.postpaidBalance),
    snappOnlyToman: toman(r.postpaidLimitedBalance), snappOnlyUsedToman: toman(r.postpaidLimitedUsage),
    settleDeadline: str(r.settleDeadline, 10) || null, contractEnd: str(r.contractEndDate, 10) || null,
    settlePassed: r.settleDateHasPassed === true, contractPassed: r.contractDateHasPassed === true,
    badDebt: r.badDebtUser === true, status: str(r.walletStatus, 30) || null, inStore: r.inStoreFeatureEnabled !== false,
  };
}

function storeOf(x) {
  const p = x?.properties ?? {};
  const name = str(p.MERCHANT_NAME, 60) || str(x?.name, 60);
  if (!name) return null;
  return { name, venture: str(x?.venture_name || p.MERCHANT_NAME_EN, 80), logo: httpsUrl(p.LOGO_LINK), cashback: pct(p.CASH_BACK), link: httpsUrl(p.REFERRAL_LINK),
    channels: str((x?.tags ?? []).join(','), 60).split(',').map(s => s.trim()).filter(Boolean), category: str(x?.categories?.[0]?.display_name, 40) || null,
    inStore: x?.item_group_type === 'IN_STORE' || /حضوری/.test((x?.tags ?? []).join(',')), payWays: (x?.flags ?? []).map(f => PAY_WAYS[f]).filter(Boolean) };
}
function productOf(x) {
  const p = x?.properties ?? {};
  const name = str(p.PRODUCT_NAME, 140), price = toman(p.PRODUCT_PRICE);
  if (!name) return null;
  const old = toman(p.OLD_PRODUCT_PRICE);
  return { name, priceToman: price, oldPriceToman: old && price && old > price ? old : null, discount: pct(p.DISCOUNT), cashback: pct(p.CASH_BACK), merchant: str(p.MERCHANT_NAME, 60),
    image: httpsUrl(p.IMAGE_LINK), link: httpsUrl(p.REFERRAL_LINK), available: x?.available !== false, freeShipping: x?.has_free_shipping === true, ad: x?.ad === true,
    sellers: Number.isInteger(x?.merchant_count) ? x.merchant_count : null, payWays: (x?.flags ?? []).map(f => PAY_WAYS[f]).filter(Boolean) };
}
/** Online search answer: products (no banners), the shops that match, and whether there is more. */
export function parseSearch(r) {
  return { products: (r?.items ?? []).filter(x => x?.type === 'PRODUCT').map(productOf).filter(Boolean),
    stores: (r?.merchant_items ?? r?.merchants ?? []).filter(x => x?.type === 'STORE').map(storeOf).filter(Boolean),
    hasNext: r?.has_next === true, sessionId: typeof r?.session_id === 'string' ? r.session_id : null,
    corrected: r?.query_correction?.correction_type && r.query_correction.correction_type !== 'NONE' ? str(r.query_correction.searched_query, 80) : null };
}
/** In-store map answer: one entry per branch, nearest first, with where it is and when it is open. */
export function parseNearby(r) {
  const out = [];
  for (const s of r?.stores ?? []) {
    const shop = storeOf(s); if (!shop) continue;
    for (const b of s.branches ?? []) {
      const lat = b?.location?.latitude, lon = b?.location?.longitude;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      out.push({ ...shop, branch: str(b.display_name, 80), city: str(b.city, 40), hours: str(b.work_time, 80), address: str(b.address, 200), lat, lon,
        distanceM: Number.isFinite(b.distance) ? Math.round(b.distance) : null, color: /^#[0-9a-f]{6}$/i.test(s.categories?.[0]?.map_icon_color ?? '') ? s.categories[0].map_icon_color : null });
    }
  }
  return out.sort((a, b) => (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9));
}
export function parseBranch(r) {
  if (!r || !Number.isFinite(r.latitude) || !Number.isFinite(r.longitude)) return null;
  return { branch: str(r.displayName, 80), city: str(r.city, 40), address: str(r.address, 200), hours: str(r.workTime, 80), phone: /^0\d{9,10}$/.test(r.phoneNumber ?? '') ? r.phoneNumber : null,
    distanceM: Number.isFinite(r.distance) ? Math.round(r.distance) : null, lat: r.latitude, lon: r.longitude };
}

export function createSnappPay({ api, store, fetchImpl = globalThis.fetch?.bind(globalThis), now = () => Date.now() }) {
  let ids = null;                                     // analyticsId / universalAnalyticsId from the account summary, memory only
  let refreshing = null;
  async function refresh() {
    const s = store.snappPaySession(); if (!s) throw new SnappPayError('unauthenticated', 401);
    refreshing ??= api.snappPayRefresh(s.refresh).then(n => { store.setSnappPaySession(n); return n; })
      .catch(e => { if (e?.status === 401) store.setSnappPaySession(null); throw new SnappPayError(e?.status === 401 ? 'unauthenticated' : 'unavailable', e?.status ?? 0); })
      .finally(() => { refreshing = null; });
    return refreshing;
  }
  async function call(method, path, body, signal) {
    let s = store.snappPaySession();
    if (!s) throw new SnappPayError('unauthenticated', 401);
    if (s.expAt && s.expAt - now() < 60_000) s = await refresh();
    for (let attempt = 0; attempt < 2; attempt++) {
      let r;
      try {
        r = await fetchImpl(BASE + path, { method, signal, credentials: 'omit', cache: 'no-store', headers: { ...HEADERS, Authorization: `Bearer ${s.access}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      } catch (e) { if (signal?.aborted || e?.name === 'AbortError') throw new SnappPayError('aborted'); throw new SnappPayError('network'); }
      if (r.status === 401 && attempt === 0) { s = await refresh(); continue; }
      let j = null; try { j = await r.json(); } catch { j = null; }
      if (r.status === 401) { store.setSnappPaySession(null); throw new SnappPayError('unauthenticated', 401); }
      if (r.status === 429) throw new SnappPayError('rate_limited', 429);
      if (!r.ok || j?.successful === false) throw new SnappPayError('unavailable', r.status);
      return j?.response ?? null;
    }
    throw new SnappPayError('unauthenticated', 401);
  }
  async function account(signal) {
    const r = await call('GET', '/api/credit/api/v1/web/wallet/credit/homepage', null, signal);
    if (typeof r?.analyticsId === 'string') ids = { user: r.analyticsId, universal: typeof r.universalAnalyticsId === 'string' ? r.universalAnalyticsId : undefined };
    return parseAccount(r);
  }
  const who = async signal => { if (!ids) await account(signal); return ids ? { user_id: ids.user, ...(ids.universal ? { universal_id: ids.universal } : {}) } : {}; };
  return {
    linked: () => Boolean(store.snappPaySession()),
    account,
    /** Online products and shops for a query (Snapp Pay's searchwise). `page` starts at 1. */
    async search(query, { page = 1, sessionId = null, minToman, maxToman } = {}, signal) {
      const price = minToman || maxToman ? { price: { ...(minToman ? { min: minToman * 10 } : {}), ...(maxToman ? { max: maxToman * 10 } : {}) } } : {};
      return parseSearch(await call('POST', '/api/credit/api/v2/web/wallet/credit/homepage/content/search', { ...(await who(signal)), query: String(query).slice(0, 80), sort_type: 'SIMILAR', page_number: page,
        session_id: sessionId, disable_product_ads: false, disable_banner_ads: true, source: 'SNAPP_PAY', filters: { is_available: true, ...price }, auto_correction: true }, signal));
    },
    async suggest(query, signal) {
      const r = await call('POST', '/api/credit/api/v2/web/wallet/credit/homepage/content/search/suggest', { ...(await who(signal)), query: String(query).slice(0, 80), disable_product_ads: false }, signal);
      return { words: (r?.suggested_keywords ?? []).map(w => str(w, 60)).filter(Boolean).slice(0, 6) };
    },
    /** In-store shops for a query; each with its nearest branch to `at` when a point is given (at most 6 shops). */
    async instore(query, at, signal) {
      const r = await call('POST', '/api/credit/api/v1/web/wallet/credit/homepage/content/search/instore', { query: String(query).slice(0, 80), page_number: 1, session_id: null, auto_correction: true }, signal);
      const shops = (r?.merchants ?? []).map(storeOf).filter(Boolean).slice(0, 6);
      if (!at) return shops.map(s => ({ ...s, nearest: null }));
      const out = [];
      for (let i = 0; i < shops.length; i += 3) {
        out.push(...await Promise.all(shops.slice(i, i + 3).map(async s => {
          try {
            const d = await call('GET', `/vitrine/api/v1/ventures/detail?name=${encodeURIComponent(s.venture)}`, null, signal);
            const n = d?.id ? await call('GET', `/vitrine/api/v1/venture-branches/nearest?ventureId=${encodeURIComponent(d.id)}&latitude=${at.lat}&longitude=${at.lon}`, null, signal) : null;
            return { ...s, nearest: parseBranch(n) };
          } catch (e) { if (e?.kind === 'unauthenticated' || e?.kind === 'aborted') throw e; return { ...s, nearest: null }; }
        })));
      }
      return out.sort((a, b) => (a.nearest?.distanceM ?? 1e9) - (b.nearest?.distanceM ?? 1e9));
    },
    /** Every in-store branch around a point (Snapp Pay's map), nearest first. */
    async nearby(at, { page = 1, category } = {}, signal) {
      const g = await api.geoCells(at.lat, at.lon, 7, 1, signal);
      // As Snapp Pay's own app sends it: the cell list with plain commas.
      const q = `resolution=${g.resolution}&page_size=20&page_number=${page}&hexagon_ids=${g.cells.join(',')}&latitude=${at.lat}&longitude=${at.lon}${category ? `&category=${encodeURIComponent(category)}` : ''}`;
      const r = await call('GET', `/api/map/api/v1/map/store/list?${q}`, null, signal);
      return { branches: parseNearby(r), hasNext: r?.has_next === true };
    },
  };
}
