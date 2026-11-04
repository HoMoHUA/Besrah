import { describe, expect, it } from 'vitest';
import { clearMemory, createMemory, deletePreference, revokePreference, upsertPreference } from '../../src/intelligence/memory.js';
import type { Preference } from '../../src/intelligence/contracts.js';

const at = '2026-11-02T10:00:00Z';
const preference = (patch: Partial<Preference> = {}): Preference => ({
  schemaVersion: 1, id: 'cost-first', version: 1, domain: 'global', scope: 'device',
  kind: 'objective_order', value: ['totalCostToman', 'durationSeconds'],
  provenance: { kind: 'explicit', source: 'settings' }, confirmedByUser: true,
  updatedAt: at, consent: { store: 'granted', use: 'granted' }, ...patch,
});

describe('explicit local memory', () => {
  it('stores an explicit device preference without aliasing the caller data', () => {
    const memory = createMemory();
    const pref = preference();
    const result = upsertPreference(memory, pref, at);
    expect(result).toEqual({ schemaVersion: 1, revision: 1, preferences: [pref] });
    expect(memory.preferences).toEqual([]);
    pref.value.reverse();
    pref.consent.use = 'denied';
    expect(result.preferences[0].value).toEqual(['totalCostToman', 'durationSeconds']);
    expect(result.preferences[0].consent.use).toBe('granted');
  });

  it('edits by id with exactly the next version and one revision increment', () => {
    const old = preference({ updatedAt: '2026-11-02T09:00:00Z' });
    const memory = { schemaVersion: 1 as const, revision: 5, preferences: [old] };
    const edited = preference({ version: 2, value: ['durationSeconds', 'totalCostToman'] });
    expect(upsertPreference(memory, edited, at)).toEqual({ ...memory, revision: 6, preferences: [edited] });
    for (const version of [1, 3]) {
      expect(() => upsertPreference(memory, preference({ version }), at)).toThrow(/version/i);
    }
    expect(() => upsertPreference(createMemory(), preference({ version: 2 }), at)).toThrow(/version/i);
    expect(memory.preferences).toEqual([old]);
  });

  it('rejects request-only, denied-store, malformed and unclocked writes', () => {
    for (const patch of [
      { scope: 'request' as const, requestId: 'req' },
      { consent: { store: 'denied' as const, use: 'granted' as const } },
      { consent: { store: 'revoked' as const, use: 'granted' as const } },
      { updatedAt: '2026-11-02T10:00:01Z' },
      { expiresAt: at },
      { id: '' }, { schemaVersion: 2 }, { version: 0 },
      { value: ['not_a_metric'] }, { provenance: { kind: 'explicit', source: '' } },
    ]) {
      expect(() => upsertPreference(createMemory(), preference(patch as Partial<Preference>), at)).toThrow();
    }
    expect(() => upsertPreference(createMemory(), preference(), 'not-a-time')).toThrow();
    expect(() => upsertPreference({ ...createMemory(), revision: -1 }, preference(), at)).toThrow();
    const memory = upsertPreference(createMemory(), preference(), at);
    expect(() => upsertPreference(memory, preference({ version: 2, updatedAt: '2026-11-02T09:00:00Z' }), at)).toThrow(/updatedAt/i);
  });

  it('enforces 64 entries but permits an edit at capacity', () => {
    const memory = { schemaVersion: 1 as const, revision: 64, preferences: Array.from({ length: 64 }, (_, i) => preference({ id: `p${i}` })) };
    expect(() => upsertPreference(memory, preference({ id: 'overflow' }), at)).toThrow(/limit|64|capacity/i);
    expect(upsertPreference(memory, preference({ id: 'p0', version: 2 }), at).preferences).toHaveLength(64);
  });

  it.each([['delete', deletePreference], ['revoke', revokePreference]] as const)('removes preference data immutably with %s', (_name, remove) => {
    const memory = upsertPreference(upsertPreference(createMemory(), preference(), at), preference({ id: 'kept' }), at);
    const before = structuredClone(memory);
    const result = remove(memory, 'cost-first');
    expect(result).toEqual({ schemaVersion: 1, revision: 3, preferences: [preference({ id: 'kept' })] });
    expect(JSON.stringify(result)).not.toContain('cost-first');
    result.preferences[0].value.reverse();
    expect(memory).toEqual(before);
    expect(remove(memory, 'missing')).toEqual(memory);
  });

  it('clears all data without resetting the revision history', () => {
    const memory = upsertPreference(createMemory(), preference(), at);
    expect(clearMemory(memory)).toEqual({ schemaVersion: 1, revision: 2, preferences: [] });
    expect(memory.preferences).toHaveLength(1);
    expect(clearMemory(createMemory())).toEqual(createMemory());
  });

  it.each(['2026-02-30T10:00:00Z', '2026-11-02T10:00:00', '2026-11-02'])('rejects non-calendar or non-offset write clock %s', clock => {
    expect(() => upsertPreference(createMemory(), preference({ updatedAt: '2026-01-01T00:00:00Z' }), clock)).toThrow();
  });

  it.each([['delete', deletePreference], ['revoke', revokePreference]] as const)('rejects malformed removal identifiers with %s', (_name, remove) => {
    const memory = createMemory();
    for (const id of ['', '   ', 'x'.repeat(129), null, 12]) {
      expect(() => remove(memory, id as string)).toThrow();
    }
  });

  it('updates use consent explicitly without losing edit history or mutating the old grant', () => {
    const memory = upsertPreference(createMemory(), preference(), at);
    const edited = preference({ version: 2, consent: { store: 'granted', use: 'revoked' } });
    const result = upsertPreference(memory, edited, at);
    expect(result).toEqual({ schemaVersion: 1, revision: 2, preferences: [edited] });
    expect(memory.preferences[0].consent.use).toBe('granted');
  });

  it('supports inferred metadata in snapshots without converting it into explicit preference data', () => {
    const pref = preference({ provenance: { kind: 'inferred', source: 'fixture suggestion' }, confirmedByUser: false });
    expect(upsertPreference(createMemory(), pref, at).preferences).toEqual([pref]);
  });

  it('rejects unsafe revision increments instead of rounding or resetting them', () => {
    const memory = { schemaVersion: 1 as const, revision: Number.MAX_SAFE_INTEGER, preferences: [preference()] };
    expect(() => upsertPreference(memory, preference({ version: 2 }), at)).toThrow(/revision/i);
    expect(() => deletePreference(memory, 'cost-first')).toThrow(/revision/i);
    expect(() => revokePreference(memory, 'cost-first')).toThrow(/revision/i);
    expect(() => clearMemory(memory)).toThrow(/revision/i);
    expect(deletePreference(memory, 'missing').revision).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('validates snapshots before deletion, revocation and clearing', () => {
    const invalid = { ...createMemory(), revision: -1 };
    expect(() => deletePreference(invalid, 'cost-first')).toThrow();
    expect(() => revokePreference(invalid, 'cost-first')).toThrow();
    expect(() => clearMemory(invalid)).toThrow();
  });

  it('creates an independent empty anonymous snapshot', () => {
    const first = createMemory();
    expect(first).toEqual({ schemaVersion: 1, revision: 0, preferences: [] });
    const second = createMemory();
    expect(second).not.toBe(first);
    expect(second.preferences).not.toBe(first.preferences);
  });
});
