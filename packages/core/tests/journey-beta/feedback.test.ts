import { describe, expect, it } from 'vitest';
import { toStored, validateFeedback, normalizeNote, type FeedbackContext } from '../../src/journey-beta/feedback.js';
import { at, DA, H7, realSource, uuid } from './helpers.js';

const NOW = at('2026-10-16', '14:30:00') / 1000;
const ctx = (): FeedbackContext => ({ nowSec: NOW, catalog: realSource().catalog, modelVersion: realSource().dataVersion, horizonDays: 7 });
const MV = 'sha256:' + 'a'.repeat(64);
const base = (kind: string, block: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  v: 1, reportId: uuid(1), kind, consent: { storeForModelImprovement: true }, modelVersion: MV,
  context: { line: 1, originId: H7, destinationId: DA, serviceDate: '2026-10-16' }, ...block, ...extra,
});
const timing = (extra: Record<string, unknown> = {}) => base('timing_quality', { timingQuality: 'close' }, extra);
const observation = (o: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => base('train_observation',
  { observation: { event: 'train_arrival', stationId: H7, direction: 'out', observedAt: '2026-10-16T14:20:00+03:30', precision: 'minute', ...o } }, extra);
const issues = (value: unknown) => { const r = validateFeedback(value, ctx()); return r.ok ? [] : r.issues; };

describe('feedback schema: accepted shapes', () => {
  it('accepts each of the four kinds with only their own block', () => {
    expect(validateFeedback(timing(), ctx()).ok).toBe(true);
    expect(validateFeedback(observation(), ctx()).ok).toBe(true);
    expect(validateFeedback(base('boarding_outcome', { outcome: { result: 'missed', platformReadyAt: '2026-10-16T14:00:00+03:30' } }), ctx()).ok).toBe(true);
    expect(validateFeedback(base('problem', { problem: { category: 'cancelled' } }, { context: { line: 2, originId: 'METRO-201', destinationId: 'METRO-205', serviceDate: '2026-10-20' } }), ctx()).ok).toBe(true);
  });
  it('normalises the observation to the Tehran offset and keeps arrival and departure distinct', () => {
    const arrival = validateFeedback(observation({ observedAt: '2026-10-16T10:50:00Z' }), ctx());
    const departure = validateFeedback(observation({ event: 'train_departure' }), ctx());
    expect(arrival.ok && arrival.value.observation).toMatchObject({ event: 'train_arrival', observedAt: '2026-10-16T14:20:00+03:30', observedAtEpoch: NOW - 600 });
    expect(departure.ok && departure.value.observation?.event).toBe('train_departure');
  });
  it('accepts a normalised note', () => {
    expect(normalizeNote('  قطار   زود   آمد  ', 'n', [])).toBe('قطار زود آمد');
  });
});

describe('feedback hardening boundary', () => {
  it('accepts omitted legacy precision as unknown/approximate and preserves explicit claimed precision', () => {
    const body: Record<string, unknown> = observation(); delete (body.observation as Record<string, unknown>).precision;
    const result = validateFeedback(body, ctx());
    expect(result.ok && result.value.observation).toMatchObject({ precision: 'approximate', timePrecision: 'unknown' });
    const second = validateFeedback(observation({ timePrecision: 'second' }), ctx());
    expect(second.ok && second.value.observation?.timePrecision).toBe('second');
    expect(issues(observation({ timePrecision: 'exact' }))).toContain('$.observation.timePrecision:invalid');
  });
  it('rejects calendar normalization and offsets other than UTC or Tehran', () => {
    const feb = { ...ctx(), nowSec: at('2026-03-02', '14:30:00') / 1000 };
    expect(validateFeedback(observation({ observedAt: '2026-02-30T14:20:00+03:30' }, { context: { line: 1, originId: H7, destinationId: DA, serviceDate: '2026-03-02' } }), feb).ok).toBe(false);
    expect(issues(observation({ observedAt: '2026-10-16T12:50:00+02:00' }))).toContain('$.observation.observedAt:invalid_or_missing_offset');
    expect(issues(observation({ observedAt: '2026-10-16T24:00:00+03:30' }))).toContain('$.observation.observedAt:invalid_or_missing_offset');
  });
  it('requires readyAt and platformReadyAt to be bounded and consistent with serviceDate', () => {
    const context = { ...timing().context, readyAt: '2026-10-15T14:20:00+03:30' };
    expect(issues(timing({ context }))).toContain('$.context.readyAt:contradicts_service_date');
    expect(issues(timing({ context: { ...context, readyAt: '2026-10-16T23:20:00+03:30' } }))).toContain('$.context.readyAt:out_of_range');
    expect(issues(base('boarding_outcome', { outcome: { result: 'missed', platformReadyAt: '2026-10-15T14:00:00+03:30' } }))).toContain('$.outcome.platformReadyAt:contradicts_service_date');
  });
  it('rejects accessors, symbols, hidden fields without invoking accessors or echoing their keys', () => {
    let touched = false;
    const accessor = timing(); Object.defineProperty(accessor, 'note', { enumerable: true, get() { touched = true; throw new Error('executed'); } });
    expect(() => issues(accessor)).not.toThrow(); expect(issues(accessor).length).toBeGreaterThan(0); expect(touched).toBe(false);
    const hidden = timing(); Object.defineProperty(hidden, 'private-user@example.invalid', { value: 1 });
    expect(issues(hidden).length).toBeGreaterThan(0);
    expect(issues(hidden).join(' ')).not.toContain('private-user');
    expect(issues(Object.assign(timing(), { [Symbol('secret')]: 1 })).length).toBeGreaterThan(0);
    expect(issues({ ...timing(), ['private-user@example.invalid']: 1 }).join(' ')).not.toContain('private-user');
  });
  it('blocks email, private coordinates, markdown links and controls before whitespace normalization', () => {
    for (const note of ['mail user@internal.invalid', '36.2972, 59.6057', '۳۶٫۲۹۷۲، ۵۹٫۶۰۵۷', '[click](ftp://host.test)', 'x\u000by', 'ftp://example.test', 'geo:36,59']) expect(issues(timing({ note })).some(i => i.startsWith('$.note:'))).toBe(true);
  });
  it('stores explicit server-time consent and anonymous evidence provenance without upgrading matched claims', () => {
    const result = validateFeedback(observation(), ctx()); if (!result.ok) throw new Error('fixture');
    const record = toStored(result.value, { receivedAtEpoch: NOW, modelVersionMatches: true, comparison: { tripMatch: 'matched', modelEventAt: '2026-10-16T14:19:00+03:30', deltaSeconds: 60 } });
    expect(record.reportedAt).toBe(record.receivedAt);
    expect(record.sourceId).toBe('anonymous_feedback:' + record.reportId);
    expect(record.consent).toMatchObject({ granted: true, version: 'r2a-pb-feedback-v1', purpose: 'model_improvement', provenance: 'explicit_client_opt_in' });
    expect(record.provenance).toMatchObject({ source: 'anonymous_public_report', independentlyVerified: false, modelTimetableUpdated: false });
    expect(record.identity).toBe('anonymous_unverified'); expect(record.review).toBe('unreviewed');
  });
});

describe('feedback schema: rejections', () => {
  it('rejects non-objects, arrays, unknown fields and prototype tricks', () => {
    for (const value of [null, 1, 'x', [], [timing()]]) expect(issues(value)).toContain('$:object_required');
    expect(issues({ ...timing(), ip: '1.2.3.4' })).toContain('$:unknown_field');
    expect(issues({ ...timing(), context: { ...(timing().context as object), userId: 5 } })).toContain('$.context:unknown_field');
    expect(issues(JSON.parse('{"__proto__":{"x":1},"v":1}')).length).toBeGreaterThan(0);
    class Evil { v = 1 }
    expect(issues(new Evil())).toContain('$:object_required');
  });
  it('requires explicit consent', () => {
    expect(issues(timing({ consent: { storeForModelImprovement: false } }))).toContain('$.consent.storeForModelImprovement:must_be_true');
    expect(issues(timing({ consent: {} }))).toContain('$.consent.storeForModelImprovement:required');
    const { consent: _c, ...without } = timing();
    expect(issues(without)).toContain('$.consent:required');
  });
  it('requires exactly the block of the declared kind', () => {
    expect(issues(base('timing_quality', {}))).toContain('$.timingQuality:required_for_kind');
    expect(issues(timing({ problem: { category: 'other' } }))).toContain('$.problem:not_allowed_for_kind');
    expect(issues(base('wishful', { timingQuality: 'close' }))).toContain('$.kind:invalid');
  });
  it('rejects bad ids, versions, stations and contradictions', () => {
    expect(issues(timing({ reportId: 'short' }))).toContain('$.reportId:invalid');
    expect(issues(timing({ modelVersion: 'sha256:xyz' }))).toContain('$.modelVersion:invalid');
    expect(issues(timing({ context: { line: 1, originId: 'METRO-201', destinationId: DA, serviceDate: '2026-10-16' } }))).toContain('$.context.originId:unknown_station');
    expect(issues(timing({ context: { line: 1, originId: H7, destinationId: H7, serviceDate: '2026-10-16' } }))).toContain('$.context.destinationId:same_as_origin');
    expect(issues(timing({ context: { line: 3, originId: H7, destinationId: DA, serviceDate: '2026-10-16' } }))).toContain('$.context.line:invalid');
    expect(issues(timing({ context: { line: 1, originId: H7, destinationId: DA, serviceDate: '2026-10-16', tripId: '2026-10-15:L1:out:A:' + 'a'.repeat(64) } }))).toContain('$.context.tripId:contradicts_context');
    expect(issues(timing({ context: { line: 1, originId: H7, destinationId: DA, serviceDate: '2026-10-16', tripId: 'not-a-trip' } }))).toContain('$.context.tripId:invalid');
  });
  it('limits which dates each kind may describe', () => {
    const on = (date: string, kind = timing) => issues(kind({ context: { line: 1, originId: H7, destinationId: DA, serviceDate: date } }));
    expect(on('2026-10-17')).toContain('$.context.serviceDate:out_of_range');
    expect(on('2026-10-13')).toContain('$.context.serviceDate:out_of_range');
    expect(on('2026-10-14')).toEqual([]);
    expect(on('2026-02-30')).toContain('$.context.serviceDate:invalid');
    expect(on('2026-10-20', extra => base('problem', { problem: { category: 'other' } }, extra))).toEqual([]);
    expect(on('2026-10-30', extra => base('problem', { problem: { category: 'other' } }, extra))).toContain('$.context.serviceDate:out_of_range');
  });
  it('treats observation time strictly: offset required, no future, not too old, consistent with the date', () => {
    expect(issues(observation({ observedAt: '2026-10-16T14:20:00' }))).toContain('$.observation.observedAt:invalid_or_missing_offset');
    expect(issues(observation({ observedAt: 'yesterday' }))).toContain('$.observation.observedAt:invalid_or_missing_offset');
    expect(issues(observation({ observedAt: '2026-10-16T16:00:00+03:30' }))).toContain('$.observation.observedAt:in_future');
    expect(issues(observation({ observedAt: '2026-10-14T01:00:00+03:30' }))).toContain('$.observation.observedAt:too_old');
    expect(issues(observation({ event: 'person_arrival' }))).toContain('$.observation.event:invalid');
    expect(issues(observation({ precision: 'exact' }))).toContain('$.observation.precision:invalid');
    expect(issues(observation({ stationId: 'METRO-210' }))).toContain('$.observation.stationId:unknown_station');
    expect(issues(observation({ observedAt: '2026-10-15T14:20:00+03:30' }, {}))).toEqual([]);
  });
  it('rejects non-experience data in a boarding outcome', () => {
    expect(issues(base('boarding_outcome', { outcome: { result: 'sure' } }))).toContain('$.outcome.result:invalid');
    expect(issues(base('boarding_outcome', { outcome: { result: 'missed', platformReadyAt: '2026-10-16T18:00:00+03:30' } }))).toContain('$.outcome.platformReadyAt:out_of_range');
  });
  const BAD_NOTES = ['http://evil.example/x', 'see www.evil.test', 'ping t.me/someone', 'mail me at a.b@evil.com', 'open evil.ir now', '<script>alert(1)</script>', '`rm -rf`', '${jndi}', '=HYPERLINK("x")', '+98912', '-cmd', '@everyone', 'call 09123456789', 'tel ۰۹۱۲ ۳۴۵ ۶۷۸۹', 'ab\u202eevil', 'x\u0000y', 'x'.repeat(201)];
  for (const note of BAD_NOTES) it(`rejects unsafe note ${JSON.stringify(note).slice(0, 30)}`, () => {
    expect(issues(timing({ note })).some(i => i.startsWith('$.note:'))).toBe(true);
  });
  it('keeps legitimate Persian notes, including ZWNJ', () => {
    expect(issues(timing({ note: 'قطار دو دقیقه زودتر از ساعت اعلام\u200cشده رسید' }))).toEqual([]);
  });
  it('never echoes submitted values in its issues', () => {
    const secret = 'SECRETVALUE';
    const all = issues({ ...timing({ reportId: secret + '!' }), ip: secret, note: 'http://' + secret });
    expect(all.join(' ')).not.toContain(secret);
    expect(all.length).toBeLessThanOrEqual(20);
  });
});
