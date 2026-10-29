import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { tehranToEpoch } from '../src/time.js';

const fridayAt = (hms: string) => tehranToEpoch('2026-10-16', hms) * 1000;
const app = buildServer({ now: () => fridayAt('14:00:00') });

describe('HTTP API /v1/next', () => {
  it('health ok', async () => {
    const r = await app.inject({ method: 'GET', url: '/health' });
    expect(r.statusCode).toBe(200);
  });

  it('returns structured passes and a Persian text for a Friday station', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/next?station=' + encodeURIComponent('شریعتی') + '&limit=3&line=1' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.station).toBe('شریعتی');
    expect(body.line).toBe(1);
    expect(body.day_type).toBe('friday');
    expect(body.passes.length).toBe(3);
    expect(body.passes.every((p: any) => p.eta_min >= 0)).toBe(true);
    expect(body.text).toContain('🚉 *شریعتی* (خط ۱)');
    expect(body.text).toContain('به سمت');
    expect(body.text).not.toContain('تقریبی');
  });

  it('accepts alternative spellings (ZWNJ / spaces) for station names', async () => {
    const r2 = await app.inject({ method: 'GET', url: '/v1/next?station=' + encodeURIComponent('فرودگاه شهید هاشمی نژاد') });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().station).toBe('فرودگاه شهید هاشمی‌نژاد');
  });

  it('a train that ends at Ghadir is shown as an arrival, not "toward Ghadir"', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/next?station=' + encodeURIComponent('غدیر') + '&limit=6' });
    const body = r.json();
    expect(body.passes.some((p: any) => p.toward === 'ورودی از وکیل‌آباد')).toBe(true);
    expect(body.passes.some((p: any) => p.toward === 'غدیر')).toBe(false);
  });

  it('at Vakilabad, back-trains are arrivals from Ghadir/Airport, not "toward Vakilabad"', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/next?station=' + encodeURIComponent('وکیل‌آباد') + '&limit=6' });
    const labels = r.json().passes.map((p: any) => p.toward);
    expect(labels).not.toContain('وکیل‌آباد');
    expect(labels.some((l: string) => l.startsWith('ورودی از'))).toBe(true);
  });

  it('unknown station gives 404 (not a guess)', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/next?station=' + encodeURIComponent('کاخ سفید') });
    expect(r.statusCode).toBe(404);
    expect(r.json().error).toBe('unknown_station');
  });

  it('missing station gives 400', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/next' });
    expect(r.statusCode).toBe(400);
  });

  it('marks normal days as approximate in text and notes', async () => {
    const normalApp = buildServer({ now: () => tehranToEpoch('2026-10-21', '10:00:00') * 1000 });
    const r = await normalApp.inject({ method: 'GET', url: '/v1/next?station=' + encodeURIComponent('وکیل‌آباد') });
    const body = r.json();
    expect(body.day_type).toBe('normal');
    expect(body.text).toContain('تقریبی');
    expect(body.passes.length).toBeGreaterThan(0);
  });

  it('after last service it says so instead of inventing trains', async () => {
    const lateApp = buildServer({ now: () => tehranToEpoch('2026-10-16', '23:30:00') * 1000 });
    const r = await lateApp.inject({ method: 'GET', url: '/v1/next?station=' + encodeURIComponent('غدیر') });
    expect(r.json().passes.length).toBe(0);
    expect(r.json().text).toContain('قطاری');
  });

  it('line 2: a line-2-only station answers instead of unknown_station', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/next?station=' + encodeURIComponent('شهید فکوری') + '&limit=4' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.line).toBe(2);
    expect(body.lines).toEqual([2]);
    expect(body.passes.length).toBeGreaterThan(0);
    expect(body.passes.every((p: any) => p.line === 2 && p.service === null)).toBe(true);
    expect(body.text).toContain('🚉 *شهید فکوری* (خط ۲)');
  });

  it('interchange: Shariati without `line` returns both lines, with `line` only that one', async () => {
    const q = (extra = '') => app.inject({ method: 'GET', url: '/v1/next?station=' + encodeURIComponent('شریعتی') + '&limit=3' + extra });
    const both = (await q()).json();
    expect(both.lines).toEqual([1, 2]);
    expect(new Set(both.passes.map((p: any) => p.line))).toEqual(new Set([1, 2]));
    expect((await q('&line=2')).json().passes.every((p: any) => p.line === 2)).toBe(true);
  });

  it('rejects a bad or mismatching line', async () => {
    const get = (qs: string) => app.inject({ method: 'GET', url: '/v1/next?' + qs });
    expect((await get('station=' + encodeURIComponent('غدیر') + '&line=3')).statusCode).toBe(400);
    expect((await get('station=' + encodeURIComponent('غدیر') + '&line=x')).statusCode).toBe(400);
    expect((await get('station=' + encodeURIComponent('غدیر') + '&line=2')).statusCode).toBe(404);
  });
});
