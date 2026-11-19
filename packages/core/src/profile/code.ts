// Besrah profile code v1 (owner decision D17, 2026-11-19): a short, versioned code such as "2ACB" that names a user's
// type across the three services. It is built ONLY from what the user stated (profile preferences, answers to the
// Core's one question); nothing is inferred from browsing, orders, places or time of day, and no sensitive category
// (health, religion, diet for medical reasons, ...) is a dimension. Each position carries its own source so the UI can
// say why it has that value, and an unstated position is "X" (or "0" for budget), never a guess.
//
//   position 1  budget tier from the stated food budget per item   0 = not stated, 1..4 (thresholds below)
//   position 2  transit priority                                   A time, B less walking, C cost, D balanced, X
//   position 3  food style, from the first stated favourite        A restaurant, B fast food, C café/bakery,
//                                                                   D sweets, E groceries/cooking, X
//   position 4  shopping priority                                  A lowest price, B quality/brand, C instalments,
//                                                                   D balanced, X
import type { FoodVertical } from '../food/verticals.js';

export const PROFILE_CODE_VERSION = 1 as const;
/** Upper bounds (exclusive) of tiers 1..3 in toman per food item; tier 4 is everything above. Versioned with the code. */
export const BUDGET_TIERS_TOMAN = Object.freeze([150_000, 300_000, 600_000] as const);
export const SHOP_PRIORITIES = ['price', 'quality', 'installment', 'balanced'] as const;
export type ShopPriority = typeof SHOP_PRIORITIES[number];

export interface ProfileInputs {
  foodBudgetToman?: number;
  transitPriority?: 'time' | 'walk' | 'cost' | 'balanced';
  foodPreferredVerticals?: readonly FoodVertical[];
  shopPriority?: ShopPriority;
}
export type ProfileDimension = 'budget' | 'transit' | 'food' | 'shop';
export interface ProfilePosition { dimension: ProfileDimension; symbol: string; meaning: string; source: 'stated' | 'not_stated'; from: string | null }
export interface ProfileCode { version: typeof PROFILE_CODE_VERSION; code: string; complete: boolean; positions: ProfilePosition[] }

const TRANSIT: Record<NonNullable<ProfileInputs['transitPriority']>, [string, string]> = {
  time: ['A', 'سفر: زودتر رسیدن مهم تر است'], walk: ['B', 'سفر: پیاده روی کمتر مهم تر است'],
  cost: ['C', 'سفر: هزینهٔ کمتر مهم تر است'], balanced: ['D', 'سفر: زمان و پیاده روی هر دو'],
};
const FOOD: Partial<Record<FoodVertical, [string, string]>> = {
  restaurant: ['A', 'غذا: غذای رستورانی و ایرانی'], fast_food: ['B', 'غذا: فست فود'],
  cafe: ['C', 'غذا: کافه و سبک'], bakery: ['C', 'غذا: کافه و سبک'], sweets: ['D', 'غذا: شیرینی و دسر'],
  grocery: ['E', 'غذا: خرید مواد و آشپزی در خانه'], produce: ['E', 'غذا: خرید مواد و آشپزی در خانه'],
  protein: ['E', 'غذا: خرید مواد و آشپزی در خانه'], nuts: ['E', 'غذا: خرید مواد و آشپزی در خانه'],
  // flowers and other are not a food style; the next stated favourite is used instead.
};
const SHOP: Record<ShopPriority, [string, string]> = {
  price: ['A', 'خرید: کمترین قیمت'], quality: ['B', 'خرید: کیفیت و برند'],
  installment: ['C', 'خرید: اقساطی'], balanced: ['D', 'خرید: متعادل'],
};
const BUDGET_FA = ['بودجه: اعلام نشده', 'بودجه: تا ۱۵۰ هزار تومان برای هر قلم', 'بودجه: ۱۵۰ تا ۳۰۰ هزار تومان', 'بودجه: ۳۰۰ تا ۶۰۰ هزار تومان', 'بودجه: بیش از ۶۰۰ هزار تومان'];
const UNSTATED: Record<ProfileDimension, string> = { budget: BUDGET_FA[0]!, transit: 'سفر: اعلام نشده', food: 'غذا: اعلام نشده', shop: 'خرید: اعلام نشده' };

export function budgetTier(toman: number | undefined): 0 | 1 | 2 | 3 | 4 {
  if (typeof toman !== 'number' || !Number.isSafeInteger(toman) || toman <= 0) return 0;
  const i = BUDGET_TIERS_TOMAN.findIndex(bound => toman < bound);
  return (i === -1 ? 4 : i + 1) as 1 | 2 | 3 | 4;
}

export function encodeProfile(input: ProfileInputs): ProfileCode {
  const tier = budgetTier(input.foodBudgetToman);
  const budget: ProfilePosition = tier === 0
    ? { dimension: 'budget', symbol: '0', meaning: UNSTATED.budget, source: 'not_stated', from: null }
    : { dimension: 'budget', symbol: String(tier), meaning: BUDGET_FA[tier]!, source: 'stated', from: 'foodBudgetToman' };
  const t = input.transitPriority ? TRANSIT[input.transitPriority] : undefined;
  const transit: ProfilePosition = t ? { dimension: 'transit', symbol: t[0], meaning: t[1], source: 'stated', from: 'transitPriority' }
    : { dimension: 'transit', symbol: 'X', meaning: UNSTATED.transit, source: 'not_stated', from: null };
  const f = (input.foodPreferredVerticals ?? []).map(v => FOOD[v]).find(Boolean);
  const food: ProfilePosition = f ? { dimension: 'food', symbol: f[0], meaning: f[1], source: 'stated', from: 'foodPreferredVerticals' }
    : { dimension: 'food', symbol: 'X', meaning: UNSTATED.food, source: 'not_stated', from: null };
  const s = input.shopPriority ? SHOP[input.shopPriority] : undefined;
  const shop: ProfilePosition = s ? { dimension: 'shop', symbol: s[0], meaning: s[1], source: 'stated', from: 'shopPriority' }
    : { dimension: 'shop', symbol: 'X', meaning: UNSTATED.shop, source: 'not_stated', from: null };
  const positions = [budget, transit, food, shop];
  return { version: PROFILE_CODE_VERSION, code: positions.map(p => p.symbol).join(''), complete: positions.every(p => p.source === 'stated'), positions };
}

export const PROFILE_CODE_PATTERN = /^[0-4][A-DX][A-EX][A-DX]$/;

/** Meaning of a stored code, for display and export. Unknown or malformed codes are rejected, never guessed. */
export function describeProfileCode(code: unknown): ProfilePosition[] | null {
  if (typeof code !== 'string' || !PROFILE_CODE_PATTERN.test(code)) return null;
  const [b, t, f, s] = code.split('') as [string, string, string, string];
  const find = (table: Record<string, [string, string]>, sym: string) => Object.values(table).find(([x]) => x === sym)?.[1];
  const pos = (dimension: ProfileDimension, symbol: string, meaning: string | undefined, unstated: boolean): ProfilePosition =>
    unstated ? { dimension, symbol, meaning: UNSTATED[dimension], source: 'not_stated', from: null } : { dimension, symbol, meaning: meaning!, source: 'stated', from: null };
  return [
    pos('budget', b, BUDGET_FA[Number(b)], b === '0'),
    pos('transit', t, find(TRANSIT, t), t === 'X'),
    pos('food', f, find(FOOD as Record<string, [string, string]>, f), f === 'X'),
    pos('shop', s, find(SHOP, s), s === 'X'),
  ];
}
