import { describe, it, expect } from 'vitest';
import webpush from 'web-push';
import { createECDH, randomBytes } from 'node:crypto';
import { sendReminder } from '../src/webpush/send.js';

function fixture() {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  return { endpoint: 'https://fcm.googleapis.com/fcm/send/secret', keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
}
const vapid = { ...webpush.generateVAPIDKeys(), subject: 'mailto:admin@example.org' };
describe('privacy-preserving push transport', () => {
  it('encrypts the generic message, uses a pinned DNS address and a bounded TTL', async () => {
    let seen: any;
    await sendReminder(fixture(), vapid, { lookup: async () => [{ address: '8.8.8.8', family: 4 }], send: async request => { seen = request; return 201; } });
    expect(seen.hostname).toBe('fcm.googleapis.com');
    expect(String(seen.headers.TTL)).toBe('60');
    expect(seen.headers['Content-Encoding']).toBe('aes128gcm');
    expect(seen.body.includes(Buffer.from('قطار'))).toBe(false);
    expect(seen.lookup).toBeTypeOf('function');
  });
  it('refuses unsafe DNS before any outbound request', async () => {
    let sent = false;
    await expect(sendReminder(fixture(), vapid, { lookup: async () => [{ address: '127.0.0.1', family: 4 }], send: async () => { sent = true; return 201; } })).rejects.toThrow('unsafe_dns');
    expect(sent).toBe(false);
  });
});
