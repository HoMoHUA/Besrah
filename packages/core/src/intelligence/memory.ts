import { LIMITS } from './contracts.js';
import type { MemorySnapshot, Preference } from './contracts.js';
import { assertMemory, assertPreference, timestamp } from './validation.js';

export function createMemory(): MemorySnapshot {
  return { schemaVersion: 1, revision: 0, preferences: [] };
}

export function upsertPreference(memory: MemorySnapshot, pref: Preference, at: string): MemorySnapshot {
  assertMemory(memory);
  assertPreference(pref);
  const now = timestamp(at);
  if (pref.scope !== 'device') throw new TypeError('Only device preferences can be stored');
  if (pref.consent.store !== 'granted') throw new TypeError('Storage consent must be granted');
  if (Date.parse(pref.updatedAt) > now) throw new TypeError('updatedAt cannot be in the future');
  if (pref.expiresAt !== undefined && Date.parse(pref.expiresAt) <= now) throw new TypeError('Cannot store an expired preference');
  const index = memory.preferences.findIndex(item => item.id === pref.id);
  const existing = memory.preferences[index];
  if (pref.version !== (existing?.version ?? 0) + 1) throw new TypeError('Preference version must be exactly the next version');
  if (existing && Date.parse(pref.updatedAt) < Date.parse(existing.updatedAt)) throw new TypeError('updatedAt cannot move backwards');
  if (!existing && memory.preferences.length >= LIMITS.preferences) throw new RangeError('Preference capacity is 64');
  const preferences = [...memory.preferences];
  if (existing) preferences[index] = pref;
  else preferences.push(pref);
  return nextSnapshot(memory, preferences);
}

function nextSnapshot(memory: MemorySnapshot, preferences: Preference[]): MemorySnapshot {
  if (!Number.isSafeInteger(memory.revision + 1)) throw new RangeError('Memory revision overflow');
  return structuredClone({ schemaVersion: 1, revision: memory.revision + 1, preferences });
}

export function deletePreference(memory: MemorySnapshot, id: string): MemorySnapshot {
  assertMemory(memory);
  if (typeof id !== 'string' || !id.trim() || id.length > 128) throw new TypeError('Invalid preference id');
  const preferences = memory.preferences.filter(pref => pref.id !== id);
  return preferences.length === memory.preferences.length ? structuredClone(memory) : nextSnapshot(memory, preferences);
}

export function clearMemory(memory: MemorySnapshot): MemorySnapshot {
  assertMemory(memory);
  return memory.preferences.length ? nextSnapshot(memory, []) : structuredClone(memory);
}

// Revocation erases the preference instead of retaining revoked personal data or a tombstone.
export function revokePreference(memory: MemorySnapshot, id: string): MemorySnapshot {
  return deletePreference(memory, id);
}
