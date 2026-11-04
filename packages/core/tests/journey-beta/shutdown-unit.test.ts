import { afterEach, describe, expect, it } from 'vitest';
import { installGracefulShutdown } from '../../src/shutdown.js';

// Handler logic with a fake app and exit; real signal delivery is covered by shutdown.test.ts.
const removers: Array<() => void> = [];
afterEach(() => { for (const remove of removers.splice(0)) remove(); });
const tick = () => new Promise(resolve => setTimeout(resolve, 20));

describe('installGracefulShutdown', () => {
  it('closes once and exits 0 even when signalled twice', async () => {
    let closes = 0; const exits: number[] = [];
    removers.push(installGracefulShutdown({ close: async () => { closes++; await tick(); } }, { exit: c => exits.push(c), signals: ['SIGUSR2'] }));
    process.emit('SIGUSR2'); process.emit('SIGUSR2');
    await tick(); await tick();
    expect(closes).toBe(1); expect(exits).toEqual([0]);
  });

  it('exits 1 and logs when close rejects', async () => {
    const exits: number[] = []; const logs: string[] = [];
    removers.push(installGracefulShutdown({ close: async () => { throw new Error('lock_changed'); } }, { exit: c => exits.push(c), log: m => logs.push(m), signals: ['SIGUSR2'] }));
    process.emit('SIGUSR2');
    await tick();
    expect(exits).toEqual([1]); expect(logs.join(' ')).toContain('lock_changed');
  });

  it('forces exit 1 if close never finishes within the ceiling', async () => {
    const exits: number[] = []; const logs: string[] = [];
    removers.push(installGracefulShutdown({ close: () => new Promise<void>(() => undefined) }, { timeoutMs: 30, exit: c => exits.push(c), log: m => logs.push(m), signals: ['SIGUSR2'] }));
    process.emit('SIGUSR2');
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(exits).toEqual([1]); expect(logs.join(' ')).toContain('forcing exit');
  });

  it('the returned remover detaches the handler', () => {
    const remove = installGracefulShutdown({ close: async () => undefined }, { exit: () => undefined, signals: ['SIGUSR2'] });
    expect(process.listenerCount('SIGUSR2')).toBe(1);
    remove();
    expect(process.listenerCount('SIGUSR2')).toBe(0);
  });
});
