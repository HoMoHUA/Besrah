import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openReminderStore } from '../src/webpush/store.js';

describe('durable reminder queue', () => {
  it('claims a due reminder at most once and erases its subscription afterward', () => {
    const store = openReminderStore(':memory:', 2);
    store.put('token-one', '{"endpoint":"secret"}', 1000, 2000);
    expect(store.claim(999)).toBeNull();
    expect(store.claim(1000)?.subscription).toBe('{"endpoint":"secret"}');
    expect(store.claim(1000)).toBeNull();
    expect(store.count()).toBe(0);
    store.close();
  });
  it('retains a queued reminder across a restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'push-restart-'));
    try {
      const path = join(dir, 'queue.db');
      const first = openReminderStore(path); first.put('token', '{"endpoint":"secret"}', 1000, 2000); first.close();
      const second = openReminderStore(path); expect(second.claim(1000)?.subscription).toBe('{"endpoint":"secret"}'); second.close();
      const third = openReminderStore(path); expect(third.count()).toBe(0); third.close();
    } finally { rmSync(dir, {recursive:true, force:true}); }
  });
  it('refuses a database symlink without following or changing its target', () => {
    const dir = mkdtempSync(join(tmpdir(), 'push-'));
    try {
      const target = join(dir, 'target'); writeFileSync(target, 'untouched');
      const path = join(dir, 'db'); symlinkSync(target, path);
      expect(() => openReminderStore(path)).toThrow('unsafe_store');
    } finally { rmSync(dir, {recursive:true, force:true}); }
  });
  it('rejects a second pending reminder for the same endpoint', () => {
    const store = openReminderStore(':memory:', 3);
    store.put('one', '{"endpoint":"secret"}', 1000, 2000);
    expect(() => store.put('two', '{"endpoint":"secret"}', 1100, 2100)).toThrow();
    expect(store.count()).toBe(1); store.close();
  });
  it('enforces capacity, expiry and user deletion', () => {
    const store = openReminderStore(':memory:', 1);
    store.put('first', '{}', 1000, 2000);
    expect(() => store.put('second', '{"endpoint":"other"}', 1000, 2000)).toThrow('queue_full');
    store.remove('first');
    store.put('second', '{}', 1000, 2000);
    expect(store.claim(2000)).toBeNull();
    expect(store.count()).toBe(0);
    store.close();
  });
});

it('persists cancellation before create across restart and expires tombstones', () => {
  const dir = mkdtempSync(join(tmpdir(), 'push-tombstone-'));
  try {
    const path = join(dir, 'queue.db');
    const first = openReminderStore(path); first.remove('cancelled', 1000); first.close();
    const next = openReminderStore(path);
    expect(() => next.put('cancelled', '{"endpoint":"secret"}', 2000, 2060, 'hash', 1001)).toThrow('conflict');
    next.expire(1000 + 7*86400 + 61);
    expect(() => next.put('cancelled', '{"endpoint":"secret"}', 1000 + 7*86400 + 100, 1000 + 7*86400 + 160, 'hash', 1000 + 7*86400 + 61)).not.toThrow();
    next.close();
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
