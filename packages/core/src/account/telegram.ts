// Telegram Mini App initData validation WITHOUT any bot secret: Telegram signs initData with an Ed25519 key it publishes,
// so the server only needs the public bot id. https://core.telegram.org/bots/webapps#validating-data-for-third-party-use
// Nothing from initData is trusted until the signature, the bot id and the age have all been checked.
import { createPublicKey, verify } from 'node:crypto';

export const TELEGRAM_PUBLIC_KEY_PROD = 'e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d';
export const TELEGRAM_PUBLIC_KEY_TEST = '40055058a4ee38156a06562e52eece92a771bcd8346a8c4615cb7376eddf72ec';
export const MAX_INIT_DATA_BYTES = 4096;

export type TelegramVerdict =
  | { ok: true; telegramId: string; authDate: number; firstName: string | null }
  | { ok: false; reason: 'too_large' | 'malformed' | 'missing_signature' | 'bad_signature' | 'bad_bot' | 'expired' | 'bad_user' };

export interface TelegramVerifyOptions { botId: string; publicKeyHex?: string; nowSec: number; maxAgeSec?: number }

const spki = (hex: string): Buffer => Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(hex, 'hex')]);

export function verifyTelegramInitData(initData: unknown, opts: TelegramVerifyOptions): TelegramVerdict {
  if (typeof initData !== 'string' || !initData) return { ok: false, reason: 'malformed' };
  if (Buffer.byteLength(initData) > MAX_INIT_DATA_BYTES) return { ok: false, reason: 'too_large' };
  let params: URLSearchParams;
  try { params = new URLSearchParams(initData); } catch { return { ok: false, reason: 'malformed' }; }
  const signature = params.get('signature');
  if (!signature) return { ok: false, reason: 'missing_signature' };
  const pairs: string[] = [];
  const seen = new Set<string>();
  for (const [key, value] of params) {
    if (seen.has(key)) return { ok: false, reason: 'malformed' };
    seen.add(key);
    if (key === 'hash' || key === 'signature') continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const checkString = `${opts.botId}:WebAppData\n${pairs.join('\n')}`;
  let valid = false;
  try {
    const key = createPublicKey({ key: spki(opts.publicKeyHex ?? TELEGRAM_PUBLIC_KEY_PROD), format: 'der', type: 'spki' });
    valid = verify(null, Buffer.from(checkString), key, Buffer.from(signature, 'base64url'));
  } catch { valid = false; }
  if (!valid) return { ok: false, reason: 'bad_signature' };
  const authDate = Number(params.get('auth_date'));
  if (!Number.isInteger(authDate) || authDate <= 0) return { ok: false, reason: 'malformed' };
  const age = opts.nowSec - authDate;
  if (age > (opts.maxAgeSec ?? 86400) || age < -300) return { ok: false, reason: 'expired' };
  let user: { id?: unknown; first_name?: unknown };
  try { user = JSON.parse(params.get('user') ?? ''); } catch { return { ok: false, reason: 'bad_user' }; }
  if (typeof user.id !== 'number' || !Number.isSafeInteger(user.id) || user.id <= 0) return { ok: false, reason: 'bad_user' };
  return { ok: true, telegramId: String(user.id), authDate, firstName: typeof user.first_name === 'string' ? user.first_name.slice(0, 40) : null };
}
