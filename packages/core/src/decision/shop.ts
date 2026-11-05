// Phase 3 for shopping: the Intelligence Core compares the RESOLVED offers of one listing. Quarantined and unresolved offers never
// enter the comparison (they are shown as such). Price here is the listed product price: shipping, warranty and colour are not
// included and the Core text says it only compares "the provided, equivalent options". A snapshot older than 72 h expires its own
// evidence, so a stale price is never called the cheapest.
import { evaluateDecision } from '../intelligence/index.js';
import type { Candidate } from '../intelligence/index.js';

export interface ShopOfferInput { seller: string; state: 'resolved' | 'unresolved' | 'quarantined'; priceToman: number | null; variantUnresolved?: readonly string[]; matchState?: string; merchant?: string }
export interface ShopDecision {
  schemaVersion: 1; status: 'ok' | 'partial' | 'insufficient_data' | 'no_feasible_option' | 'skipped'; reason: string;
  bySeller: Record<string, { labels: string[]; claims: string[] }>; notes: string[];
}
export const SHOP_EVIDENCE_TTL_SEC = 72 * 3600;

export function decideShop(input: { productId: string; offers: readonly ShopOfferInput[]; observedAt: string; nowSec: number }): ShopDecision {
  const skipped = (reason: string, notes: string[] = []): ShopDecision => ({ schemaVersion: 1, status: 'skipped', reason, bySeller: {}, notes });
  const observedMs = Date.parse(input.observedAt);
  if (!Number.isFinite(observedMs)) return skipped('bad_observation_time');
  const resolved = input.offers.filter((o): o is ShopOfferInput & { priceToman: number } =>
    o.state === 'resolved' && typeof o.priceToman === 'number' && Number.isSafeInteger(o.priceToman) &&
    o.priceToman > 0 && (!o.variantUnresolved || o.variantUnresolved.length === 0) &&
    (!o.matchState || o.matchState === 'verified_variant' || o.matchState === 'exact_sku'));
  // A resolved price does not establish colour, capacity, warranty or variant equality.
  // Unverified listings remain visible but may not receive price superlatives.
  const bySeller: ShopDecision['bySeller'] = {};
  for (const o of input.offers) bySeller[o.seller] = { labels: [], claims: [] };
  // One resolved offer has nothing to be compared with; no label is better than a vacuous "cheapest".
  if (resolved.length < 2) return { ...skipped('fewer_than_two_resolved_offers'), bySeller };
  const at = new Date(input.nowSec * 1000).toISOString();
  const expires = new Date(observedMs + SHOP_EVIDENCE_TTL_SEC * 1000).toISOString();
  if (Date.parse(expires) <= input.nowSec * 1000) return { ...skipped('snapshot_too_old', ['قیمت‌ها قدیمی‌اند؛ «کمترین قیمت ثبت‌شده» ادعا نمی‌شود.']), bySeller };
  const taskId = `shop:${input.productId}`;
  const candidates: Candidate[] = resolved.map((o, i) => ({ schemaVersion: 1, id: `offer-${i}`,
    providerId: o.merchant || 'product_page_snapshot', domain: 'shopping', taskId, equivalenceKey: input.productId,
    title: o.seller, availability: 'available',
    metrics: { listedItemPriceToman: { state: 'known', unit: 'toman', value: o.priceToman, evidence: [{
      id: `offer-${i}:page`, sourceId: 'product_page_snapshot', kind: 'provider',
      dataVersion: 'snapshot', live: false, observedAt: input.observedAt,
      retrievedAt: input.observedAt, validUntil: expires }] } } }));
  let result;
  try { result = evaluateDecision({ schemaVersion: 1, context: { schemaVersion: 1, requestId: `shop-${input.nowSec}`, taskId, domain: 'shopping', at, decisionPermission: 'granted', objectives: [{ metric: 'listedItemPriceToman', direction: 'min' }], constraints: [] }, candidates }); }
  catch { return { ...skipped('decision_input_rejected'), bySeller }; }
  const bySellerOut = bySeller;
  for (const o of result.options) {
    const idx = Number(o.candidateId.slice('offer-'.length)), seller = resolved[idx]?.seller;
    if (!seller) continue;
    bySellerOut[seller] = {
      labels: o.labels.includes('lowest_listed_item_price') ? ['کمترین قیمت ثبت‌شدهٔ کالا در همین فهرست'] : [],
      claims: o.explanation.claims.filter(c => c.code === 'label:lowest_listed_item_price').map(c => c.text),
    };
  }
  const notes = result.status === 'ok' ? ['برچسب فقط برای کالاهای دارای واریانت تأییدشده و قیمت تازه در همین فهرست است؛ ارسال، گارانتی و موجودی بررسی نشده‌اند.'] : [];
  return { schemaVersion: 1, status: result.status, reason: result.reason, bySeller: bySellerOut, notes };
}
