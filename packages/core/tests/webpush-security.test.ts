import { describe, it, expect } from 'vitest';
import { validatePushEndpoint, publicPushAddresses, makePinnedLookup } from '../src/webpush/security.js';

describe('web push endpoint boundary', () => {
  it('admits only exact approved HTTPS push service hosts', () => {
    expect(validatePushEndpoint('https://fcm.googleapis.com/fcm/send/token').hostname).toBe('fcm.googleapis.com');
    expect(validatePushEndpoint('https://web.push.apple.com/3/device/token').hostname).toBe('web.push.apple.com');
    for (const endpoint of ['https://fcm.googleapis.com.evil.test/a', 'https://push.apple.com.evil.test/a', 'https://evilpush.apple.com/a', 'http://fcm.googleapis.com/a', 'https://fcm.googleapis.com:444/a', 'https://user@fcm.googleapis.com/a', 'https://127.0.0.1/a', 'https://fcm.googleapis.com/a#fragment']) {
      expect(() => validatePushEndpoint(endpoint)).toThrow();
    }
  });
  it('pins connections to a validated address and refuses endpoint mutation', async () => {
    const lookup = makePinnedLookup('fcm.googleapis.com', [{ address: '8.8.8.8', family: 4 }]);
    const resolve = (host: string) => new Promise((done) => lookup(host, { family: 0, hints: 0 }, (error, address, family) => done({ error: error?.message, address, family })));
    expect(await resolve('fcm.googleapis.com')).toEqual({ error: undefined, address: '8.8.8.8', family: 4 });
    expect((await resolve('evil.example') as {error: string}).error).toBe('unexpected_host');
  });
  it('rejects all DNS results when any result is non-public', () => {
    expect(publicPushAddresses([{ address: '8.8.8.8', family: 4 }])).toEqual([{ address: '8.8.8.8', family: 4 }]);
    for (const address of ['127.0.0.1', '10.2.3.4', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1']) {
      expect(() => publicPushAddresses([{ address: '8.8.8.8', family: 4 }, { address, family: address.includes(':') ? 6 : 4 }])).toThrow();
    }
  });
});
