import { describe, expect, it } from 'vitest';
import { resolvePreferences } from '../../src/intelligence/preferences.js';
import type { MemorySnapshot, Preference, RequestContext } from '../../src/intelligence/contracts.js';

const at = '2026-11-02T10:00:00Z';
const context = (patch: Partial<RequestContext> = {}): RequestContext => ({
  schemaVersion: 1, requestId: 'request-1', taskId: 'travel', domain: 'transit', at,
  decisionPermission: 'granted', constraints: [],
  objectives: [{ metric: 'totalCostToman', direction: 'min' }, { metric: 'durationSeconds', direction: 'min' }], ...patch,
});
const preference = (patch: Partial<Preference> = {}): Preference => ({
  schemaVersion: 1, id: 'cost-first', version: 1, domain: 'global', scope: 'device',
  kind: 'objective_order', value: ['totalCostToman', 'durationSeconds'],
  provenance: { kind: 'explicit', source: 'settings' }, confirmedByUser: true,
  updatedAt: '2026-11-02T09:00:00Z', consent: { store: 'granted', use: 'granted' }, ...patch,
});
const memory = (...preferences: Preference[]): MemorySnapshot => ({ schemaVersion: 1, revision: 1, preferences });

describe('explicit preference resolution', () => {
  it('uses a confirmed explicit device preference and detaches the result order', () => {
    const pref = preference();
    const snapshot = memory(pref);
    const before = structuredClone(snapshot);
    const result = resolvePreferences(context(), snapshot);
    expect(result).toEqual({ order: pref.value, selectedIds: [pref.id], ignored: [], conflicts: [] });
    result.order!.reverse();
    expect(snapshot).toEqual(before);
  });

  it.each([
    ['different domain', { domain: 'food' }, 'domain_mismatch'],
    ['future update', { updatedAt: '2026-11-02T10:00:01Z' }, 'future_updated_at'],
    ['expiry boundary', { expiresAt: at }, 'expired'],
    ['past expiry', { expiresAt: '2026-11-02T09:30:00Z' }, 'expired'],
    ['use denied', { consent: { store: 'granted', use: 'denied' } }, 'use_not_granted'],
    ['use revoked', { consent: { store: 'granted', use: 'revoked' } }, 'use_not_granted'],
    ['storage denied', { consent: { store: 'denied', use: 'granted' } }, 'store_not_granted'],
    ['storage revoked', { consent: { store: 'revoked', use: 'granted' } }, 'store_not_granted'],
    ['unconfirmed explicit', { confirmedByUser: false }, 'unconfirmed'],
    ['confirmed inferred', { provenance: { kind: 'inferred', source: 'history' } }, 'inferred_not_consumed'],
    ['unconfirmed inferred', { provenance: { kind: 'inferred', source: 'history' }, confirmedByUser: false }, 'inferred_not_consumed'],
    ['partial order', { value: ['totalCostToman'] }, 'incompatible_objectives'],
    ['extra objective', { value: ['totalCostToman', 'durationSeconds', 'quality'] }, 'incompatible_objectives'],
    ['different metric set', { value: ['quality', 'durationSeconds'] }, 'incompatible_objectives'],
    ['request scope in memory', { scope: 'request', requestId: 'request-1' }, 'scope_mismatch'],
  ] as const)('ignores %s with an explicit reason', (_name, patch, reason) => {
    const pref = preference(patch as Partial<Preference>);
    expect(resolvePreferences(context(), memory(pref))).toEqual({ selectedIds: [], ignored: [{ id: pref.id, reason }], conflicts: [] });
  });

  it('validates preference metadata, memory, and the injected clock', () => {
    expect(() => resolvePreferences(context(), memory(preference({ id: '' })))).toThrow();
    expect(() => resolvePreferences(context({ requestPreferences: [preference({ scope: 'request', requestId: 'request-1', version: 0 })] }))).toThrow();
    expect(() => resolvePreferences(context(), { ...memory(), revision: -1 })).toThrow();
    expect(() => resolvePreferences(context({ at: '2026-02-30T10:00:00Z' }))).toThrow();
  });

  it('request explicit use overrides device preferences even when request storage is denied', () => {
    const global = preference({ id: 'global', updatedAt: at });
    const domain = preference({ id: 'domain', domain: 'transit', updatedAt: at });
    const request = preference({ id: 'request', scope: 'request', requestId: 'request-1', value: ['durationSeconds', 'totalCostToman'], consent: { store: 'denied', use: 'granted' } });
    const snapshot = memory(global, domain);
    const ctx = context({ requestPreferences: [request] });
    const before = structuredClone({ ctx, snapshot });
    expect(resolvePreferences(ctx, snapshot)).toEqual({
      order: request.value, selectedIds: ['request'], conflicts: [],
      ignored: [{ id: 'global', reason: 'overridden' }, { id: 'domain', reason: 'overridden' }],
    });
    expect({ ctx, snapshot }).toEqual(before);
    expect(resolvePreferences(ctx).selectedIds).toEqual(['request']);
  });

  it('domain device preference overrides newer global device preference', () => {
    const global = preference({ id: 'global', updatedAt: at });
    const domain = preference({ id: 'domain', domain: 'transit', value: ['durationSeconds', 'totalCostToman'] });
    expect(resolvePreferences(context(), memory(global, domain))).toEqual({
      order: domain.value, selectedIds: ['domain'], conflicts: [], ignored: [{ id: 'global', reason: 'overridden' }],
    });
  });

  it.each(['device', 'request'] as const)('uses the newest updatedAt within the %s tier, not a preference version or input order', scope => {
    const base = scope === 'request' ? { scope, requestId: 'request-1' } : { scope };
    const old = preference({ ...base, id: 'old', version: 99 });
    const fresh = preference({ ...base, id: 'fresh', updatedAt: at, value: ['durationSeconds', 'totalCostToman'] });
    for (const prefs of [[old, fresh], [fresh, old]]) {
      const result = scope === 'device' ? resolvePreferences(context(), memory(...prefs)) : resolvePreferences(context({ requestPreferences: prefs }));
      expect(result).toEqual({ order: fresh.value, selectedIds: ['fresh'], conflicts: [], ignored: [{ id: 'old', reason: 'older_preference' }] });
    }
  });

  it('rejects a request preference for a different request and falls back to device', () => {
    const request = preference({ id: 'foreign', scope: 'request', requestId: 'other-request' });
    expect(resolvePreferences(context({ requestPreferences: [request] }), memory(preference()))).toEqual({
      order: preference().value, selectedIds: ['cost-first'], conflicts: [], ignored: [{ id: 'foreign', reason: 'request_mismatch' }],
    });
  });

  it.each(['device', 'request'] as const)('surfaces equally current contradictory %s orders without a winner or fallback', scope => {
    const base = scope === 'request' ? { scope, requestId: 'request-1' } : { scope, domain: 'transit' as const };
    const a = preference({ ...base, id: 'a', updatedAt: at });
    const b = preference({ ...base, id: 'b', updatedAt: '2026-11-02T13:30:00+03:30', value: ['durationSeconds', 'totalCostToman'] });
    const fallback = preference({ id: 'fallback' });
    for (const prefs of [[a, b], [b, a]]) {
      const result = scope === 'device' ? resolvePreferences(context(), memory(...prefs, fallback)) : resolvePreferences(context({ requestPreferences: prefs }), memory(fallback));
      expect(result.order).toBeUndefined();
      expect(result.selectedIds).toEqual([]);
      expect(result.conflicts).toEqual(['a', 'b']);
      expect(result.ignored).toContainEqual({ id: 'fallback', reason: 'overridden' });
    }
  });

  it('keeps all equally current agreeing preference ids rather than picking by array order', () => {
    const a = preference({ id: 'a' });
    const b = preference({ id: 'b' });
    for (const prefs of [[a, b], [b, a]]) {
      expect(resolvePreferences(context(), memory(...prefs))).toEqual({ order: a.value, selectedIds: ['a', 'b'], ignored: [], conflicts: [] });
    }
  });

  it.each([
    ['expired', { expiresAt: at }, 'expired'],
    ['inferred', { provenance: { kind: 'inferred', source: 'fixture' } }, 'inferred_not_consumed'],
    ['revoked use', { consent: { store: 'denied', use: 'revoked' } }, 'use_not_granted'],
    ['incompatible', { value: ['quality'] }, 'incompatible_objectives'],
  ] as const)('does not let %s request overrides suppress an eligible device preference', (_name, patch, reason) => {
    const request = preference({ id: 'request', scope: 'request', requestId: 'request-1', ...patch } as Partial<Preference>);
    expect(resolvePreferences(context({ requestPreferences: [request] }), memory(preference()))).toEqual({
      order: preference().value, selectedIds: ['cost-first'], conflicts: [], ignored: [{ id: 'request', reason }],
    });
  });

  it('uses a still-current older preference when a newer preference has expired', () => {
    const old = preference({ id: 'old', updatedAt: '2026-11-02T08:00:00Z' });
    const expired = preference({ id: 'expired', expiresAt: at, value: ['durationSeconds', 'totalCostToman'] });
    expect(resolvePreferences(context(), memory(expired, old))).toEqual({
      order: old.value, selectedIds: ['old'], conflicts: [], ignored: [{ id: 'expired', reason: 'expired' }],
    });
  });

  it('allows anonymous requests without inventing priorities', () => {
    expect(resolvePreferences(context())).toEqual({ selectedIds: [], ignored: [], conflicts: [] });
  });
});
