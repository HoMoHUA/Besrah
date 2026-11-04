import { createHash } from 'node:crypto';
import { fchmodSync, closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const digest = (token: string) => createHash('sha256').update(token).digest('hex');

/** Single-process durable queue. Claim deletes before send: at-most-once; a crash can lose a reminder. */
export function openReminderStore(path: string, limit = 1000) {
  if (path !== ':memory:') {
    const dir = dirname(path);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const parent = lstatSync(dir);
    if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) !== 0 || (process.getuid && parent.uid !== process.getuid())) throw new Error('unsafe_store');
    let fd: number;
    try { fd = openSync(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600); } catch { throw new Error('unsafe_store'); }
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || (process.getuid && stat.uid !== process.getuid())) throw new Error('unsafe_store');
      fchmodSync(fd, 0o600);
    } finally { closeSync(fd); }
  }
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON; PRAGMA temp_store=MEMORY; PRAGMA busy_timeout=2000;
    CREATE TABLE IF NOT EXISTS reminders (token_hash TEXT PRIMARY KEY, endpoint_hash TEXT NOT NULL UNIQUE, subscription TEXT NOT NULL, due INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS reminder_due ON reminders(due);
    CREATE TABLE IF NOT EXISTS reminder_cancellations (token_hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS cancellation_expiry ON reminder_cancellations(expires);`);
  const columns = db.prepare('PRAGMA table_info(reminders)').all() as {name:string}[];
  if (!columns.some(c => c.name === 'request_hash')) db.exec('ALTER TABLE reminders ADD COLUMN request_hash TEXT');
  const inspect = (token: string, subscription: string, requestHash: string) => {
    const endpoint = JSON.parse(subscription).endpoint ?? subscription;
    const row = db.prepare('SELECT token_hash AS tokenHash, request_hash AS requestHash FROM reminders WHERE token_hash = ? OR endpoint_hash = ?').get(digest(token), digest(endpoint)) as {tokenHash:string; requestHash:string | null} | undefined;
    if (!row) return 'new' as const;
    return row.tokenHash === digest(token) && row.requestHash === requestHash ? 'replay' as const : 'conflict' as const;
  };
  const count = () => Number((db.prepare('SELECT COUNT(*) AS n FROM reminders').get() as {n: number}).n);
  const expire = (now: number) => { db.prepare('DELETE FROM reminder_cancellations WHERE expires <= ?').run(now); return db.prepare('DELETE FROM reminders WHERE expires <= ?').run(now); };
  return {
    inspect,
    put(token: string, subscription: string, due: number, expires: number, requestHash = digest(subscription + due + ":" + expires), now = Math.floor(Date.now()/1000)) {
      db.exec('BEGIN IMMEDIATE');
      try {
        if (db.prepare('SELECT 1 FROM reminder_cancellations WHERE token_hash = ? AND expires > ?').get(digest(token), now)) throw new Error('conflict');
        const state = inspect(token, subscription, requestHash);
        if (state === 'replay') { db.exec('COMMIT'); return; }
        if (state === 'conflict') throw new Error('conflict');
        if (count() >= limit || Number((db.prepare('SELECT COUNT(*) AS n FROM reminders WHERE due BETWEEN ? AND ?').get(due - 59, due + 59) as {n:number}).n) >= 10) throw new Error('queue_full');
        const endpoint = JSON.parse(subscription).endpoint ?? subscription;
        db.prepare('INSERT INTO reminders (token_hash, endpoint_hash, subscription, due, expires, request_hash) VALUES (?, ?, ?, ?, ?, ?)').run(digest(token), digest(endpoint), subscription, due, expires, requestHash);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    claim(now: number): { subscription: string } | null {
      db.exec('BEGIN IMMEDIATE');
      try {
        expire(now);
        const row = db.prepare('SELECT token_hash AS tokenHash, subscription FROM reminders WHERE due <= ? ORDER BY due LIMIT 1').get(now) as {tokenHash: string; subscription: string} | undefined;
        if (row) db.prepare('DELETE FROM reminders WHERE token_hash = ?').run(row.tokenHash);
        db.exec('COMMIT');
        return row ? { subscription: row.subscription } : null;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    remove(token: string, now = Math.floor(Date.now()/1000)) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('DELETE FROM reminder_cancellations WHERE expires <= ?').run(now);
        const hash = digest(token);
        const exists = db.prepare('SELECT 1 FROM reminder_cancellations WHERE token_hash = ?').get(hash);
        const count = Number((db.prepare('SELECT COUNT(*) AS n FROM reminder_cancellations').get() as {n:number}).n);
        const queued = db.prepare('SELECT 1 FROM reminders WHERE token_hash = ?').get(hash);
        // Reserve one slot per possible queued reminder, so random tokens cannot block its cancellation.
        if (!exists && count >= (queued ? 10000 : 9000)) throw new Error('cancellation_full');
        db.prepare('INSERT INTO reminder_cancellations (token_hash, expires) VALUES (?, ?) ON CONFLICT(token_hash) DO UPDATE SET expires = MAX(expires, excluded.expires)').run(hash, now + 7*86400 + 60);
        db.prepare('DELETE FROM reminders WHERE token_hash = ?').run(hash);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    expire, count,
    close() { db.close(); },
  };
}
