import type { MemorySnapshot, Preference, RequestContext, ResolvedPreference } from './contracts.js';
import { assertMemory, assertPreference, timestamp } from './validation.js';

export function resolvePreferences(context: RequestContext, memory?: MemorySnapshot): ResolvedPreference {
  const now = timestamp(context.at);
  if (memory !== undefined) assertMemory(memory);
  const result: ResolvedPreference = { selectedIds: [], ignored: [], conflicts: [] };
  const eligible: Preference[] = [];
  const entries = [
    ...(context.requestPreferences ?? []).map(pref => ({ pref, source: 'request' as const })),
    ...(memory?.preferences ?? []).map(pref => ({ pref, source: 'device' as const })),
  ];
  const objectives = new Set(context.objectives.map(objective => objective.metric));
  for (const { pref, source } of entries) {
    assertPreference(pref);
    let reason: string | undefined;
    if (pref.scope !== source) reason = 'scope_mismatch';
    else if (pref.scope === 'request' && pref.requestId !== context.requestId) reason = 'request_mismatch';
    else if (pref.domain !== 'global' && pref.domain !== context.domain) reason = 'domain_mismatch';
    else if (timestamp(pref.updatedAt) > now) reason = 'future_updated_at';
    else if (pref.expiresAt !== undefined && timestamp(pref.expiresAt) <= now) reason = 'expired';
    else if (pref.consent.use !== 'granted') reason = 'use_not_granted';
    else if (pref.scope === 'device' && pref.consent.store !== 'granted') reason = 'store_not_granted';
    else if (pref.provenance.kind === 'inferred') reason = 'inferred_not_consumed';
    else if (!pref.confirmedByUser) reason = 'unconfirmed';
    else if (pref.value.length !== objectives.size || pref.value.some(metric => !objectives.has(metric))) reason = 'incompatible_objectives';
    if (reason) result.ignored.push({ id: pref.id, reason });
    else eligible.push(pref);
  }
  if (!eligible.length) return result;
  const tier = (pref: Preference): number => pref.scope === 'request' ? 2 : pref.domain === 'global' ? 0 : 1;
  const highestTier = Math.max(...eligible.map(tier));
  const current = eligible.filter(pref => tier(pref) === highestTier);
  const newest = Math.max(...current.map(pref => timestamp(pref.updatedAt)));
  const latest = current.filter(pref => timestamp(pref.updatedAt) === newest);
  const selected = latest[0];
  for (const pref of eligible) {
    if (tier(pref) < highestTier) result.ignored.push({ id: pref.id, reason: 'overridden' });
    else if (timestamp(pref.updatedAt) < newest) result.ignored.push({ id: pref.id, reason: 'older_preference' });
  }
  if (latest.some(pref => pref.value.some((metric, index) => metric !== selected.value[index]))) {
    // Conflict IDs identify every equally current participant; do not fall back to a lower tier.
    result.conflicts = latest.map(pref => pref.id).sort();
    return result;
  }
  result.order = [...selected.value];
  result.selectedIds = latest.map(pref => pref.id).sort();
  return result;
}
