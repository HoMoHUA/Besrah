// The existing v1 Intelligence Core receives an additive, explicit listedItemPriceToman metric.
// A menu-item price is NOT total delivered order cost. Do not compare different items as if
// they were identical: the group key includes normalized title, variation and marketplace vertical.
import { evaluateDecision, type Candidate, type NumericMetric } from '../intelligence/index.js';
import { normalizeFa, type FoodVendorDto } from './search.js';

export interface FoodDecision {
  schemaVersion: 1;
  status: 'ok' | 'partial' | 'insufficient_data' | 'skipped';
  scope: 'same_named_item_in_current_page';
  byVendor: Record<string, { label: string | null; reason: string }>;
  notes: string[];
}
const TTL_MS = 48 * 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();
function selected(v: FoodVendorDto) {
  const priced = v.matched.filter(i => i.priceState === 'known' && Number.isSafeInteger(i.finalPriceToman) && (i.finalPriceToman ?? 0) > 0);
  return priced.sort((a, b) => a.finalPriceToman! - b.finalPriceToman!)[0];
}
export function decideFoodResults(vendors: readonly FoodVendorDto[], nowMs: number): FoodDecision {
  const empty: FoodDecision = { schemaVersion: 1, status: 'skipped', scope: 'same_named_item_in_current_page', byVendor: {}, notes: [
    'قیمت قلم، هزینهٔ نهایی سفارش نیست؛ هزینهٔ ارسال، مالیات و تخفیف روز نامعلوم است.',
    'مقایسه فقط برای اقلام هم‌نام و هم‌گونه در همین صفحه است؛ اندازه، ترکیبات و موجودی تأیید نشده‌اند.',
  ] };
  if (!Number.isFinite(nowMs) || vendors.length === 0) return empty;
  const taskId = 'food-browse', at = iso(nowMs);
  const candidates: Candidate[] = [];
  const groupCounts = new Map<string, number>();
  for (const v of vendors.slice(0, 20)) {
    empty.byVendor[v.id] = { label: null, reason: 'not_comparable' };
    const item = selected(v);
    if (!item || !v.capturedAt || !Number.isFinite(Date.parse(v.capturedAt))) {
      empty.byVendor[v.id] = { label: null, reason: 'price_or_capture_unknown' }; continue;
    }
    const captured = Date.parse(v.capturedAt);
    if (captured > nowMs || nowMs - captured > TTL_MS) {
      empty.byVendor[v.id] = { label: null, reason: 'snapshot_stale' }; continue;
    }
    const key = [v.vertical, normalizeFa(item.name), normalizeFa(item.variation ?? '')].join('|');
    const ev = [{ id: v.id + ':item', sourceId: v.provider + '_menu_snapshot', kind: 'provider' as const,
      dataVersion: 'menu_index_v1', live: false, observedAt: iso(captured), retrievedAt: iso(captured),
      validUntil: iso(captured + TTL_MS) }];
    const metric: NumericMetric = { state: 'known', unit: 'toman', value: item.finalPriceToman!, evidence: ev };
    candidates.push({ schemaVersion: 1, id: v.id, providerId: v.provider, domain: 'food', taskId,
      equivalenceKey: key, title: item.name, availability: 'available', metrics: { listedItemPriceToman: metric } });
    groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
  }
  if (candidates.length < 2) return empty;
  try {
    const decision = evaluateDecision({ schemaVersion: 1,
      context: { schemaVersion: 1, requestId: 'food-page', taskId, domain: 'food', at,
        decisionPermission: 'granted', objectives: [{ metric: 'listedItemPriceToman', direction: 'min' }], constraints: [] },
      candidates });
    for (const item of decision.options) {
      const candidate = candidates.find(c => c.id === item.candidateId)!;
      if ((groupCounts.get(candidate.equivalenceKey) ?? 0) < 2) continue;
      const label = item.labels.includes('lowest_listed_item_price') ? 'کمترین قیمت ثبت‌شده برای قلم هم‌نام در این صفحه' : null;
      empty.byVendor[candidate.id] = { label, reason: label ? 'core_compared_fresh_listing' : 'fresh_alternative' };
    }
    empty.status = decision.status === 'ok' ? 'ok' : decision.status === 'partial' ? 'partial' : 'insufficient_data';
  } catch {
    empty.notes.push('مقایسهٔ هوشمند در این درخواست انجام نشد؛ نتایج جست‌وجو همچنان نمایش داده می‌شوند.');
  }
  return empty;
}
