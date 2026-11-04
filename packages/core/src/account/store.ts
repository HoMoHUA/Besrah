// Account storage on node:sqlite (built in, no new dependency). One small file, versioned schema, no personal data beyond the
// provider subject id: no phone, no e-mail, no name, no coordinates, no history. Sessions store only a hash of the token.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const CONSENT_PURPOSES = ['sync_preferences', 'saved_places', 'history', 'notifications'] as const;
export type ConsentPurpose = typeof CONSENT_PURPOSES[number];
export const CONSENT_VERSION = 1;
export const SESSION_TTL_SEC = 14 * 86400;
export const MAX_SESSIONS = 8;

export interface Preferences { transitMaxWalkMin?: number; transitPriority?: 'time' | 'walk' | 'cost' | 'balanced'; foodBudgetToman?: number; shopBudgetToman?: number }
export const PREFERENCE_KEYS = ['transitMaxWalkMin', 'transitPriority', 'foodBudgetToman', 'shopBudgetToman'] as const;

/** Strict, whitelisted validation. Unknown keys and out-of-range values are rejected, never clamped silently. */
export function validatePreferences(input: unknown): { ok: true; value: Preferences } | { ok: false; field: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, field: 'values' };
  const v = input as Record<string, unknown>, out: Preferences = {};
  for (const key of Object.keys(v)) if (!(PREFERENCE_KEYS as readonly string[]).includes(key)) return { ok: false, field: key };
  const int = (x: unknown, lo: number, hi: number) => typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;
  if (v.transitMaxWalkMin !== undefined) { if (!int(v.transitMaxWalkMin, 3, 40)) return { ok: false, field: 'transitMaxWalkMin' }; out.transitMaxWalkMin = v.transitMaxWalkMin as number; }
  if (v.transitPriority !== undefined) { if (v.transitPriority !== 'time' && v.transitPriority !== 'walk' && v.transitPriority !== 'cost' && v.transitPriority !== 'balanced') return { ok: false, field: 'transitPriority' }; out.transitPriority = v.transitPriority; }
  if (v.foodBudgetToman !== undefined) { if (!int(v.foodBudgetToman, 20_000, 5_000_000)) return { ok: false, field: 'foodBudgetToman' }; out.foodBudgetToman = v.foodBudgetToman as number; }
  if (v.shopBudgetToman !== undefined) { if (!int(v.shopBudgetToman, 50_000, 1_000_000_000)) return { ok: false, field: 'shopBudgetToman' }; out.shopBudgetToman = v.shopBudgetToman as number; }
  return { ok: true, value: out };
}

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export interface ConsentState { status: 'granted' | 'revoked'; version: number; updatedAt: number }
export interface AccountStore {
  loginTelegram(telegramId: string, nowSec: number): { accountId: string; created: boolean };
  createSession(accountId: string, nowSec: number): { token: string; expiresAt: number };
  getSession(token: string, nowSec: number): { accountId: string } | null;
  revokeSession(token: string): void;
  revokeAllSessions(accountId: string): void;
  consents(accountId: string): Partial<Record<ConsentPurpose, ConsentState>>;
  setConsent(accountId: string, purpose: ConsentPurpose, granted: boolean, nowSec: number): ConsentState;
  getPreferences(accountId: string): { version: number; values: Preferences };
  putPreferences(accountId: string, expectedVersion: number, values: Preferences, nowSec: number): { ok: true; version: number } | { ok: false; reason: 'version_conflict'; version: number };
  clearPreferences(accountId: string): void;
  exportAll(accountId: string, nowSec: number): unknown;
  deleteAccount(accountId: string): void;
  close(): void;
}

export function openAccountStore(path: string): AccountStore {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS account(id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS identity(provider TEXT NOT NULL, subject TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE, linked_at INTEGER NOT NULL, PRIMARY KEY(provider, subject));
    CREATE TABLE IF NOT EXISTS session(token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE, issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS session_account ON session(account_id);
    CREATE TABLE IF NOT EXISTS consent(account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE, purpose TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(account_id, purpose));
    CREATE TABLE IF NOT EXISTS pref(account_id TEXT PRIMARY KEY REFERENCES account(id) ON DELETE CASCADE, version INTEGER NOT NULL, json TEXT NOT NULL, updated_at INTEGER NOT NULL);
    INSERT OR IGNORE INTO meta(k, v) VALUES('schema', '1');`);
  const q = {
    findIdentity: db.prepare('SELECT account_id AS accountId FROM identity WHERE provider = ? AND subject = ?'),
    insertAccount: db.prepare('INSERT INTO account(id, created_at) VALUES(?, ?)'),
    insertIdentity: db.prepare('INSERT INTO identity(provider, subject, account_id, linked_at) VALUES(?, ?, ?, ?)'),
    insertSession: db.prepare('INSERT INTO session(token_hash, account_id, issued_at, expires_at) VALUES(?, ?, ?, ?)'),
    sessionCount: db.prepare('SELECT COUNT(*) AS n FROM session WHERE account_id = ?'),
    dropOldest: db.prepare('DELETE FROM session WHERE token_hash IN (SELECT token_hash FROM session WHERE account_id = ? ORDER BY issued_at ASC LIMIT ?)'),
    getSession: db.prepare('SELECT account_id AS accountId, expires_at AS expiresAt FROM session WHERE token_hash = ?'),
    delSession: db.prepare('DELETE FROM session WHERE token_hash = ?'),
    delSessions: db.prepare('DELETE FROM session WHERE account_id = ?'),
    purgeExpired: db.prepare('DELETE FROM session WHERE expires_at <= ?'),
    consents: db.prepare('SELECT purpose, status, version, updated_at AS updatedAt FROM consent WHERE account_id = ?'),
    upsertConsent: db.prepare('INSERT INTO consent(account_id, purpose, status, version, updated_at) VALUES(?, ?, ?, ?, ?) ON CONFLICT(account_id, purpose) DO UPDATE SET status = excluded.status, version = excluded.version, updated_at = excluded.updated_at'),
    getPref: db.prepare('SELECT version, json FROM pref WHERE account_id = ?'),
    upsertPref: db.prepare('INSERT INTO pref(account_id, version, json, updated_at) VALUES(?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET version = excluded.version, json = excluded.json, updated_at = excluded.updated_at'),
    delPref: db.prepare('DELETE FROM pref WHERE account_id = ?'),
    account: db.prepare('SELECT created_at AS createdAt FROM account WHERE id = ?'),
    identities: db.prepare('SELECT provider, linked_at AS linkedAt FROM identity WHERE account_id = ?'),
    delAccount: db.prepare('DELETE FROM account WHERE id = ?'),
  };
  const tx = <T>(fn: () => T): T => { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

  const store: AccountStore = {
    loginTelegram: (telegramId, nowSec) => tx(() => {
      const found = q.findIdentity.get('telegram', telegramId) as { accountId: string } | undefined;
      if (found) return { accountId: found.accountId, created: false };
      const accountId = randomUUID();
      q.insertAccount.run(accountId, nowSec); q.insertIdentity.run('telegram', telegramId, accountId, nowSec);
      return { accountId, created: true };
    }),
    createSession: (accountId, nowSec) => tx(() => {
      q.purgeExpired.run(nowSec);
      const token = randomBytes(32).toString('base64url'), expiresAt = nowSec + SESSION_TTL_SEC;
      const n = (q.sessionCount.get(accountId) as { n: number }).n;
      if (n >= MAX_SESSIONS) q.dropOldest.run(accountId, n - MAX_SESSIONS + 1);
      q.insertSession.run(hashToken(token), accountId, nowSec, expiresAt);
      return { token, expiresAt };
    }),
    getSession(token, nowSec) {
      if (typeof token !== 'string' || token.length < 20 || token.length > 128) return null;
      const row = q.getSession.get(hashToken(token)) as { accountId: string; expiresAt: number } | undefined;
      if (!row) return null;
      if (row.expiresAt <= nowSec) { q.delSession.run(hashToken(token)); return null; }
      return { accountId: row.accountId };
    },
    revokeSession: token => { q.delSession.run(hashToken(token)); },
    revokeAllSessions: accountId => { q.delSessions.run(accountId); },
    consents(accountId) {
      const out: Partial<Record<ConsentPurpose, ConsentState>> = {};
      for (const r of q.consents.all(accountId) as Array<{ purpose: ConsentPurpose; status: 'granted' | 'revoked'; version: number; updatedAt: number }>) out[r.purpose] = { status: r.status, version: r.version, updatedAt: r.updatedAt };
      return out;
    },
    setConsent(accountId, purpose, granted, nowSec) {
      return tx(() => {
        q.upsertConsent.run(accountId, purpose, granted ? 'granted' : 'revoked', CONSENT_VERSION, nowSec);
        // Revoking sync deletes what sync stored: the consent is the only reason that data exists.
        if (!granted && purpose === 'sync_preferences') q.delPref.run(accountId);
        return { status: granted ? 'granted' : 'revoked', version: CONSENT_VERSION, updatedAt: nowSec } as ConsentState;
      });
    },
    getPreferences(accountId) {
      const row = q.getPref.get(accountId) as { version: number; json: string } | undefined;
      return row ? { version: row.version, values: JSON.parse(row.json) as Preferences } : { version: 0, values: {} };
    },
    putPreferences: (accountId, expectedVersion, values, nowSec) => tx(() => {
      const row = q.getPref.get(accountId) as { version: number } | undefined, current = row?.version ?? 0;
      if (current !== expectedVersion) return { ok: false as const, reason: 'version_conflict' as const, version: current };
      q.upsertPref.run(accountId, current + 1, JSON.stringify(values), nowSec);
      return { ok: true as const, version: current + 1 };
    }),
    clearPreferences: accountId => { q.delPref.run(accountId); },
    exportAll(accountId, nowSec) {
      const account = q.account.get(accountId) as { createdAt: number } | undefined;
      return { schemaVersion: 1, exportedAt: nowSec, account: account ? { createdAt: account.createdAt } : null,
        identities: q.identities.all(accountId), consents: store.consents(accountId), preferences: store.getPreferences(accountId) };
    },
    deleteAccount: accountId => { q.delAccount.run(accountId); },
    close: () => { db.close(); },
  };
  return store;
}
