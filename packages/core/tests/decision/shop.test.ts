// Phase 3 for shopping with the real Core: labels only for a real comparison of fresh, resolved offers.
import { describe, expect, it } from 'vitest';
import { decideShop } from '../../src/decision/shop.js';
import { parseShopCatalog, shopProduct } from '../../src/shop/search.js';

const OBS = '2026-11-04T10:00:00Z';
const NOW = Date.parse('2026-11-05T10:00:00Z') / 1000;           // 24 h later: fresh
const offers = (...p: Array<[string, 'resolved' | 'unresolved' | 'quarantined', number | null]>) => p.map(([seller, state, priceToman]) => ({ seller, state, priceToman }));
const run = (o: ReturnType<typeof offers>, nowSec = NOW, observedAt = OBS) => decideShop({ productId: 'tl:1', offers: o, observedAt, nowSec });

describe('decideShop', () => {
  it('labels only the cheapest of at least two resolved offers, with the Core sentence', () => {
    const d = run(offers(['الف', 'resolved', 1_000_000], ['ب', 'resolved', 1_200_000]));
    expect(d.status).toBe('ok');
    expect(d.bySeller['الف']!.labels).toEqual(['کم هزینه ترین پیشنهاد ثبت شده']);
    expect(d.bySeller['الف']!.claims.join(' ')).toMatch(/در میان گزینه های هم ارز و واجد شرایط ارائه شده، کم هزینه ترین است/);
    expect(d.bySeller['ب']).toEqual({ labels: [], claims: [] });
    expect(d.notes.join(' ')).toMatch(/رنگ، گارانتی، ارسال و موجودی مقایسه نشده/);
  });
  it('unresolved and quarantined offers never take part and never get a label', () => {
    const d = run(offers(['الف', 'resolved', 1_000_000], ['ب', 'resolved', 1_100_000], ['ج', 'quarantined', 90_000], ['د', 'unresolved', null]));
    expect(d.bySeller['ج']).toEqual({ labels: [], claims: [] }); expect(d.bySeller['د']).toEqual({ labels: [], claims: [] });
    expect(d.bySeller['الف']!.labels).toHaveLength(1);
  });
  it('a lone resolved offer is not "the cheapest" of anything', () => {
    const d = run(offers(['الف', 'resolved', 1_000_000], ['ب', 'unresolved', null]));
    expect(d.status).toBe('skipped'); expect(d.reason).toBe('fewer_than_two_resolved_offers');
    expect(d.bySeller['الف']!.labels).toEqual([]);
  });
  it('a snapshot older than 72 hours expires its own evidence: no cheapest claim, and it says why', () => {
    const d = run(offers(['الف', 'resolved', 1_000_000], ['ب', 'resolved', 1_200_000]), Date.parse('2026-11-09T10:00:00Z') / 1000);
    expect(d.status).toBe('skipped'); expect(d.reason).toBe('snapshot_too_old'); expect(d.notes.join(' ')).toMatch(/قدیمی/);
    expect(JSON.stringify(d.bySeller)).not.toMatch(/کم هزینه ترین/);
  });
  it('equal prices are both labelled (a tie is not a win), and bad input degrades to skipped', () => {
    const d = run(offers(['الف', 'resolved', 1_000_000], ['ب', 'resolved', 1_000_000]));
    expect(d.bySeller['الف']!.labels).toHaveLength(1); expect(d.bySeller['ب']!.labels).toHaveLength(1);
    expect(run(offers(['الف', 'resolved', 1], ['ب', 'resolved', 2]), NOW, 'not-a-date').status).toBe('skipped');
    expect(run([])).toMatchObject({ status: 'skipped', bySeller: {} });
  });
  it('the product detail carries the decision, computed from the same offers the page lists', () => {
    const offer = (seller: string, state: string, price: number | null) => ({ seller, merchant: 'تکنولایف', url: 'https://www.technolife.com/product-1/', matchState: 'listing_declared', variantUnresolved: [], stock: 'unknown', availabilityDeclared: 'InStock', shipping: 'unknown', state, priceToman: price });
    const cat = parseShopCatalog(JSON.stringify({ v: 1, generatedAt: OBS, licenseNote: 'x', products: [{ canonicalProductId: 'tl:1', sku: '1', title: 'کالا', brand: null, category: null, variantBasis: 'x', observedAt: OBS, source: { kind: 'k', url: 'https://www.technolife.com/product-1/' },
      offers: [offer('الف', 'resolved', 1_000_000), offer('ب', 'resolved', 1_300_000), offer('ج', 'quarantined', null)], summary: { resolved: 2, minToman: 1_000_000, maxToman: 1_300_000 } }] }));
    const p = shopProduct(cat, 'tl:1', NOW * 1000)!;
    expect(p.decision.bySeller['الف']!.labels).toEqual(['کم هزینه ترین پیشنهاد ثبت شده']);
    expect(p.decision.bySeller['ج']!.labels).toEqual([]);
    expect(JSON.stringify(p.decision)).not.toMatch(/ارزان ترین بازار|بازار/);
  });
});
