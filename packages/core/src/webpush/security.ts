import ipaddr from 'ipaddr.js';

/** A subscription URL is a secret. Never include the input or this URL in errors or logs. */
export function validatePushEndpoint(value: unknown): URL {
  if (typeof value !== 'string' || value.length > 2048 || value.length < 20 || /[\u0000-\u0020\u007f\\]/.test(value)) throw new Error('invalid_endpoint');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('invalid_endpoint'); }
  const host = url.hostname;
  const allowed = host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com' || host === 'web.push.apple.com' || (host.endsWith('.push.apple.com') && host.length <= 253 && host.slice(0, -'.push.apple.com'.length).split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)));
  // Reject normalization, credentials, non-default ports, fragments and IP literals.
  if (!allowed || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || ipaddr.isValid(host) || url.href !== value) throw new Error('invalid_endpoint');
  return url;
}

export function makePinnedLookup(host: string, input: { address: string; family: number }[]) {
  const addresses = publicPushAddresses(input).map(({ address, family }) => ({ address, family }));
  return (hostname: string, options: { family?: number; hints?: number; all?: boolean }, callback: (error: Error | null, address: any, family?: number) => void): void => {
    if (hostname !== host) return callback(new Error('unexpected_host'), '');
    const eligible = addresses.filter(item => !options.family || item.family === options.family);
    if (!eligible.length) return callback(new Error('unsafe_dns'), '');
    if (options.all) return callback(null, eligible);
    return callback(null, eligible[0].address, eligible[0].family);
  };
}

export function publicPushAddresses(addresses: { address: string; family: number }[]): { address: string; family: number }[] {
  if (!Array.isArray(addresses) || addresses.length === 0 || addresses.length > 32) throw new Error('unsafe_dns');
  for (const item of addresses) {
    if (!item || !ipaddr.isValid(item.address)) throw new Error('unsafe_dns');
    const parsed = ipaddr.parse(item.address);
    if ((parsed.kind() === 'ipv4' ? 4 : 6) !== item.family || parsed.range() !== 'unicast') throw new Error('unsafe_dns');
    if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) throw new Error('unsafe_dns');
  }
  return addresses;
}
