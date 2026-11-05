// POST /app/api/recommendations/home: at most two cards, built only from the clock (Mashhad time) and, when the client sent one,
// a point it chose to share for THIS request. Nothing is stored. A card is only produced when its claim is true:
// "nearest station" needs a point; a meal card says what time it is and links to the search, it never invents a dish, a price or an open shop.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { clientKey, createWindowLimiter } from '../journey-beta/limits.js';
import { epochToTehranHms } from '../time.js';
import { haversineM } from '../trip/plan.js';
import { MASHHAD, loadStationGeo } from '../trip/routes.js';
import type { StationGeo } from '../trip/plan.js';
import { FOOD_VERTICALS, type FoodVertical } from '../food/verticals.js';

export type MealSlot = 'breakfast' | 'lunch' | 'snack' | 'dinner' | 'late';
export const HOME_INTENTS = ['now', 'coffee', 'sweets', 'gift', 'essentials'] as const;
export type HomeIntent = typeof HOME_INTENTS[number];
const INTENT_VERTICAL: Record<Exclude<HomeIntent,'now'>, FoodVertical> = {
  coffee: 'cafe', sweets: 'sweets', gift: 'flowers', essentials: 'grocery'
};
const INTENT_TITLES: Record<Exclude<HomeIntent,'now'>, string> = {
  coffee: 'کافه و نوشیدنی', sweets: 'شیرینی و دسر', gift: 'گل و هدیه', essentials: 'خرید روزمره'
};
export const slotAt = (hour: number): MealSlot => (hour >= 5 && hour < 11 ? 'breakfast' : hour >= 11 && hour < 16 ? 'lunch' : hour >= 16 && hour < 18 ? 'snack' : hour >= 18 && hour < 23 ? 'dinner' : 'late');
const SLOT_FA: Record<MealSlot, string> = { breakfast: 'صبحانه', lunch: 'ناهار', snack: 'عصرانه', dinner: 'شام', late: 'آخر شب' };
// Interest only influences a compatible time slot. Flowers are displayed on explicit gift intent,
// never guessed as an occasion or suggested for lunch by profiling.
export const SLOT_VERTICALS: Record<MealSlot, readonly FoodVertical[]> = {
  breakfast: ['bakery','cafe','restaurant'],
  lunch: ['restaurant','fast_food'],
  snack: ['cafe','sweets'],
  dinner: ['restaurant','fast_food'],
  late: ['sweets','cafe','grocery'],
};
const VERTICAL_WORDS: Partial<Record<FoodVertical,string>> = {
  bakery:'نانوایی و صبحانه',cafe:'کافه و نوشیدنی',restaurant:'غذاهای رستورانی',
  fast_food:'فست‌فود',sweets:'شیرینی و دسر',grocery:'خرید روزانه',
};
export const NEAREST_MAX_M = 5000;

export interface HomeCard {
  id: string; kind: 'transit' | 'food'; title: string; detail: string; why: string;
  evidence: { source: string; kind: 'straight_line' | 'clock' | 'user_intent' };
  cta: { type: 'station'; station: string } | { type: 'food'; vertical: FoodVertical; q?: string; sort?: 'distance' };
}
export interface HomeRecommendations { schemaVersion: 1; at: string; slot: MealSlot; locationUsed: boolean; cards: HomeCard[]; note: string }

const distanceFa = (m: number) => (m < 1000 ? `${Math.max(50, Math.round(m / 50) * 50)} متر` : `${(m / 1000).toFixed(1).replace('.', '٫')} کیلومتر`);

export function homeRecommendations(nowSec: number, stations: readonly StationGeo[], point: { lat: number; lon: number } | null, preferredVerticals: readonly FoodVertical[] = [], intent: HomeIntent = 'now'): HomeRecommendations {
  const hms = epochToTehranHms(nowSec), hour = Number(hms.slice(0, 2)), slot = slotAt(hour), cards: HomeCard[] = [];
  if (point) {
    const near = stations.map(s => ({ s, m: haversineM(point, s) })).sort((a, b) => a.m - b.m)[0];
    if (near && near.m <= NEAREST_MAX_M) cards.push({ id: 'transit.nearest', kind: 'transit', title: `ایستگاه ${near.s.name}`, why: 'نزدیک ترین ایستگاه به موقعیتی که دادید',
      detail: `حدود ${distanceFa(near.m)} فاصلهٔ هوایی. زمان پیاده روی را مسیریاب حساب می کند و قطارها برآورد مدل برنامه اند، نه موقعیت زنده.`,
      evidence: { source: 'network', kind: 'straight_line' }, cta: { type: 'station', station: near.s.name } });
  }
  const mealLate = slot === 'late', userIntent = intent !== 'now';
  const eligible = SLOT_VERTICALS[slot];
  const preferred = preferredVerticals.find(v => eligible.includes(v));
  const vertical = userIntent ? INTENT_VERTICAL[intent] : (preferred ?? eligible[0]);
  const title = userIntent ? INTENT_TITLES[intent] : (VERTICAL_WORDS[vertical] ?? SLOT_FA[slot]);
  cards.push({ id: userIntent ? `food.intent.${intent}` : `food.${slot}`, kind: 'food',
    title: `${title}${point ? ' در اطراف شما' : ''}`,
    why: userIntent ? 'این موضوع را خودتان برای جست‌وجو انتخاب کردید' :
      `ساعت ${hms.slice(0, 5)} به وقت مشهد است${preferred ? '؛ این دسته را در پروفایل انتخاب کرده‌اید' : ''}`,
    detail: mealLate && !userIntent ? 'بسیاری از فروشگاه ها این ساعت بسته اند و وضعیت باز بودن لحظه ای نیست؛ در پلتفرم سفارش بررسی کنید.' :
      'این پیشنهاد، فهرست فروشگاه‌های مرتبط را باز می‌کند؛ موجودی، قیمت و ساعات فعالیت باید در پلتفرم اصلی تأیید شوند.',
    evidence: { source: userIntent ? 'user_selection' : 'clock', kind: userIntent ? 'user_intent' : 'clock' },
    cta: { type: 'food', vertical, ...(point ? { sort: 'distance' as const } : {}) } });
  return { schemaVersion: 1, at: `${hms.slice(0, 5)}`, slot, locationUsed: Boolean(point), cards: cards.slice(0, 2),
    note: 'پیشنهادها از ساعت، دسته‌های انتخاب‌شده و موضوعی که خودتان خواستید ساخته می‌شوند؛ موقعیت فقط با رضایت شما در همین درخواست استفاده و ذخیره نمی‌شود.' };
}

export interface HomeRoutesOptions { stations?: readonly StationGeo[]; now?: () => number; limiterClock?: () => number }
export function registerHomeRecommendations(app: FastifyInstance, opts: HomeRoutesOptions = {}) {
  const now = opts.now ?? Date.now, limiter = createWindowLimiter(30, 60_000, opts.limiterClock ?? Date.now);
  let stations: readonly StationGeo[] | null = opts.stations ?? null;
  const head = (r: FastifyReply) => r.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
  app.post('/app/api/recommendations/home', { bodyLimit: 256 }, async (req, reply) => {
    head(reply);
    if (!limiter.allow(clientKey(req))) return reply.code(429).header('Retry-After', '10').send({ error: 'rate_limited' });
    if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return reply.code(415).send({ error: 'unsupported_media_type' });
    const b = (req.body ?? {}) as { lat?: unknown; lon?: unknown };
    if (typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some(k => k !== 'lat' && k !== 'lon' && k !== 'preferredVerticals' && k !== 'intent')) return reply.code(400).send({ error: 'bad_request' });
    let point: { lat: number; lon: number } | null = null;
    if (b.lat !== undefined || b.lon !== undefined) {
      if (typeof b.lat !== 'number' || typeof b.lon !== 'number' || !Number.isFinite(b.lat) || !Number.isFinite(b.lon)) return reply.code(400).send({ error: 'bad_request', field: 'lat' });
      if (b.lat >= MASHHAD.latMin && b.lat <= MASHHAD.latMax && b.lon >= MASHHAD.lonMin && b.lon <= MASHHAD.lonMax) point = { lat: b.lat, lon: b.lon };
    }
    const prefs = (b as typeof b & { preferredVerticals?: unknown }).preferredVerticals;
    if (prefs !== undefined && (!Array.isArray(prefs) || prefs.length > 4 ||
      new Set(prefs).size !== prefs.length || prefs.some(x => typeof x !== 'string' || !FOOD_VERTICALS.includes(x as FoodVertical))))
      return reply.code(400).send({ error: 'bad_request', field: 'preferredVerticals' });
    const intent = (b as typeof b & { intent?: unknown }).intent ?? 'now';
    if (typeof intent !== 'string' || !HOME_INTENTS.includes(intent as HomeIntent)) return reply.code(400).send({ error:'bad_request', field:'intent' });
    stations ??= loadStationGeo();
    return homeRecommendations(Math.floor(now() / 1000), stations, point, (prefs ?? []) as FoodVertical[], intent as HomeIntent);
  });
}
