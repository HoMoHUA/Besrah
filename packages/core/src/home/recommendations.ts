// POST /app/api/recommendations/home: at most two cards, built only from the clock (Mashhad time) and, when the client sent one,
// a point it chose to share for THIS request. Nothing is stored. A card is only produced when its claim is true:
// "nearest station" needs a point; a meal card says what time it is and links to the search, it never invents a dish, a price or an open shop.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { clientKey, createWindowLimiter } from '../journey-beta/limits.js';
import { epochToTehranHms } from '../time.js';
import { haversineM } from '../trip/plan.js';
import { MASHHAD, loadStationGeo } from '../trip/routes.js';
import type { StationGeo } from '../trip/plan.js';

export type MealSlot = 'breakfast' | 'lunch' | 'snack' | 'dinner' | 'late';
export const slotAt = (hour: number): MealSlot => (hour >= 5 && hour < 11 ? 'breakfast' : hour >= 11 && hour < 16 ? 'lunch' : hour >= 16 && hour < 18 ? 'snack' : hour >= 18 && hour < 23 ? 'dinner' : 'late');
const SLOT_FA: Record<MealSlot, string> = { breakfast: 'صبحانه', lunch: 'ناهار', snack: 'عصرانه', dinner: 'شام', late: 'آخر شب' };
export const NEAREST_MAX_M = 5000;

export interface HomeCard {
  id: string; kind: 'transit' | 'food'; title: string; detail: string; why: string;
  evidence: { source: string; kind: 'straight_line' | 'clock' };
  cta: { type: 'station'; station: string } | { type: 'food'; q?: string; sort?: 'distance' };
}
export interface HomeRecommendations { schemaVersion: 1; at: string; slot: MealSlot; locationUsed: boolean; cards: HomeCard[]; note: string }

const distanceFa = (m: number) => (m < 1000 ? `${Math.max(50, Math.round(m / 50) * 50)} متر` : `${(m / 1000).toFixed(1).replace('.', '٫')} کیلومتر`);

export function homeRecommendations(nowSec: number, stations: readonly StationGeo[], point: { lat: number; lon: number } | null): HomeRecommendations {
  const hms = epochToTehranHms(nowSec), hour = Number(hms.slice(0, 2)), slot = slotAt(hour), cards: HomeCard[] = [];
  if (point) {
    const near = stations.map(s => ({ s, m: haversineM(point, s) })).sort((a, b) => a.m - b.m)[0];
    if (near && near.m <= NEAREST_MAX_M) cards.push({ id: 'transit.nearest', kind: 'transit', title: `ایستگاه ${near.s.name}`, why: 'نزدیک ترین ایستگاه به موقعیتی که دادید',
      detail: `حدود ${distanceFa(near.m)} فاصلهٔ هوایی. زمان پیاده روی را مسیریاب حساب می کند و قطارها برآورد مدل برنامه اند، نه موقعیت زنده.`,
      evidence: { source: 'network', kind: 'straight_line' }, cta: { type: 'station', station: near.s.name } });
  }
  const mealLate = slot === 'late';
  cards.push({ id: `food.${slot}`, kind: 'food', title: mealLate ? 'غذای آخر شب' : `${SLOT_FA[slot]}${point ? ' نزدیک شما' : ''}`,
    why: `ساعت ${hms.slice(0, 5)} به وقت مشهد است`,
    detail: mealLate ? 'بسیاری از فروشگاه ها این ساعت بسته اند و وضعیت باز بودن لحظه ای نیست؛ در پلتفرم سفارش بررسی کنید.' : 'قیمت ها همان قیمت ثبت شده اند و لحظه ای نیستند؛ تاریخ ثبت کنار هر نتیجه می آید.',
    evidence: { source: 'clock', kind: 'clock' },
    cta: { type: 'food', ...(slot === 'breakfast' ? { q: 'صبحانه' } : {}), ...(point ? { sort: 'distance' as const } : {}) } });
  return { schemaVersion: 1, at: `${hms.slice(0, 5)}`, slot, locationUsed: Boolean(point), cards: cards.slice(0, 2),
    note: 'پیشنهادها فقط از ساعت و، اگر خودتان دادید، از موقعیت همین درخواست ساخته می شوند و ذخیره نمی شوند.' };
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
    if (typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some(k => k !== 'lat' && k !== 'lon')) return reply.code(400).send({ error: 'bad_request' });
    let point: { lat: number; lon: number } | null = null;
    if (b.lat !== undefined || b.lon !== undefined) {
      if (typeof b.lat !== 'number' || typeof b.lon !== 'number' || !Number.isFinite(b.lat) || !Number.isFinite(b.lon)) return reply.code(400).send({ error: 'bad_request', field: 'lat' });
      if (b.lat >= MASHHAD.latMin && b.lat <= MASHHAD.latMax && b.lon >= MASHHAD.lonMin && b.lon <= MASHHAD.lonMax) point = { lat: b.lat, lon: b.lon };
    }
    stations ??= loadStationGeo();
    return homeRecommendations(Math.floor(now() / 1000), stations, point);
  });
}
