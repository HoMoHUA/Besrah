// "Ask Besrah" (F1): a free Persian, colloquial or Finglish question -> one structured intent for an existing engine.
// This file is the deterministic half: normalisation, numbers, vocabulary and a rule parser that answers clear
// questions instantly and without any model. Numbers (budgets, line numbers) are ONLY ever read from the person's own
// words here; the language model is never trusted with a number.

export const INTENTS = ['trip', 'food', 'shop', 'metro_board', 'bus_eta', 'unknown'] as const;
export type Intent = typeof INTENTS[number];
export const FOOD_BUDGETS = [100000, 150000, 250000, 400000] as const;
export const SHOP_BUDGETS = [500000, 1000000, 2000000, 5000000] as const;
export const VERTICALS = ['meals', 'restaurant', 'fast_food', 'cafe', 'sweets', 'bakery', 'flowers', 'grocery', 'produce', 'protein', 'nuts'] as const;
export type Vertical = typeof VERTICALS[number];

export interface AskParams {
  from?: string; to?: string;                                   // trip: place text as the person wrote it
  q?: string; vertical?: Vertical; budget?: number; near?: boolean;   // food / shop
  station?: string;                                             // metro_board: an exact network station name
  line?: string; stop?: string;                                 // bus_eta
}
export interface Parsed { intent: Intent; params: AskParams; confident: boolean }

/** One spelling per letter, Latin digits, no diacritics, ZWNJ as a space, punctuation removed (but 38/1 and 2.5 kept). */
export function normalize(text: string): string {
  return text.normalize('NFC')
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/ي|ى/g, 'ی').replace(/ك/g, 'ک').replace(/ۀ|ة/g, 'ه').replace(/[أإ]/g, 'ا').replace(/ؤ/g, 'و')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/(\d)[٫](\d)/g, '$1.$2').replace(/(\d)[٬,](\d{3})/g, '$1$2')
    .replace(/[‌‍ ]/g, ' ')
    .replace(/(\d)[/.](\d)/g, '$1\u0001$2')                    // protect 38/1, 2.5
    .replace(/[؟?!.,،؛;:«»"'`()[\]{}…\-_/\\|+*=#@%^&~<>]+/g, ' ')
    .replace(/\u0001/g, '.')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}
/** For "is this name in the question" checks: no spaces at all (وکیل آباد == وکیل‌آباد == وکیلآباد). */
export const compact = (s: string) => normalize(s).replace(/ /g, '');

const hasWord = (t: string, w: string) => ` ${t} `.includes(` ${w} `);
// Persian attaches ezafe and plural endings: پیتزای، پیتزایی، کافه‌ها. Prefix match for longer keywords only.
const hasStem = (t: string, w: string) => (w.length < 3 || w.includes(' ') ? hasWord(t, w) : t.split(' ').some(tok => tok === w || (tok.startsWith(w) && tok.length - w.length <= 3)));
const anyStem = (t: string, words: readonly string[]) => words.some(w => hasStem(t, w));

// ── amounts ─────────────────────────────────────────────────────────────────────────────────────────────────────
const UNITS: Record<string, number> = { 'یک': 1, 'یه': 1, 'دو': 2, 'سه': 3, 'چهار': 4, 'پنج': 5, 'شش': 6, 'شیش': 6, 'هفت': 7, 'هشت': 8, 'نه': 9, 'ده': 10,
  'بیست': 20, 'سی': 30, 'چهل': 40, 'پنجاه': 50, 'شصت': 60, 'هفتاد': 70, 'هشتاد': 80, 'نود': 90,
  'صد': 100, 'یکصد': 100, 'دویست': 200, 'سیصد': 300, 'چهارصد': 400, 'پانصد': 500, 'پونصد': 500, 'ششصد': 600, 'هفتصد': 700, 'هشتصد': 800, 'نهصد': 900, 'نیم': 0.5 };
const THOUSAND = ['هزار', 'تومنی', 'k', 'hezar', 'tomani'];
const MILLION = ['میلیون', 'ملیون', 'میلیونی', 'تومن میلیون', 'm', 'milion', 'million', 'melyon', 'toman million'];
const TOMAN = ['تومن', 'تومان', 'toman', 'tomen', 'تومنه'];
const BUDGET_CUES = ['زیر', 'زیره', 'تا', 'حداکثر', 'کمتر', 'کمتراز', 'بودجه', 'ماکسیمم', 'zire', 'zir', 'ta', 'max', 'budget', 'حدود', 'حدودا'];

/** Toman amounts the person stated, e.g. «زیر ۲ میلیون»، «تا ۱۵۰ هزار»، «۲۵۰ تومن» (colloquial for 250,000). */
export function amounts(text: string): number[] {
  const toks = normalize(text).split(' ');
  const out: number[] = [];
  for (let i = 0; i < toks.length; i++) {
    let n: number | null = null, j = i;
    if (/^\d+(\.\d+)?$/.test(toks[i]!)) { n = Number(toks[i]); j = i + 1; }
    else if (toks[i]! in UNITS) {
      n = 0; j = i;
      while (j < toks.length && (toks[j]! in UNITS || (toks[j] === 'و' && toks[j + 1]! in UNITS))) { if (toks[j] !== 'و') n += UNITS[toks[j]!]!; j++; }
    }
    if (n === null || !(n > 0)) continue;
    const unit = toks[j] ?? '', after = toks[j + 1] ?? '';
    const cue = BUDGET_CUES.includes(toks[i - 1] ?? '') || BUDGET_CUES.includes(toks[i - 2] ?? '');
    let value: number | null = null;
    if (MILLION.includes(unit)) value = n * 1_000_000;
    else if (THOUSAND.includes(unit)) value = n * 1000;
    else if (TOMAN.includes(unit) || (cue && TOMAN.includes(after))) value = n < 1000 ? n * 1000 : n >= 100000 ? n : null;   // 1000..99999 tomans is ambiguous: not used
    else if (cue && n >= 10000) value = n;
    if (value !== null && Number.isFinite(value) && value >= 1000 && value <= 1e9) out.push(Math.round(value));
    i = Math.max(i, j - 1);
  }
  return out;
}
/** The strictest offered cap that still respects the stated one (never a cap above what the person said). Above every
 *  offered cap there is no fitting chip: no cap is set rather than one that would hide nearly everything. */
export function snapBudget(amount: number | undefined, chips: readonly number[]): number | undefined {
  if (!amount || amount > chips[chips.length - 1]!) return undefined;
  const fits = chips.filter(c => c <= amount);
  return fits.length ? fits[fits.length - 1] : undefined;
}

// ── vocabulary ──────────────────────────────────────────────────────────────────────────────────────────────────
// Finglish words mapped to the Persian term the search engines index.
const FINGLISH: Record<string, string> = { pizza: 'پیتزا', pitza: 'پیتزا', burger: 'برگر', berger: 'برگر', kabab: 'کباب', kebab: 'کباب', joje: 'جوجه کباب',
  ghahve: 'قهوه', coffee: 'قهوه', cafe: 'کافه', kafe: 'کافه', shirini: 'شیرینی', cake: 'کیک', keyk: 'کیک', sobhane: 'صبحانه', sobhaneh: 'صبحانه',
  headphone: 'هدفون', hedfon: 'هدفون', headset: 'هدفون', airpod: 'ایرپاد', airpods: 'ایرپاد', powerbank: 'پاوربانک', speaker: 'اسپیکر', keyboard: 'کیبورد',
  mouse: 'ماوس', gooshi: 'گوشی', goshi: 'گوشی', mobile: 'گوشی', laptop: 'لپ تاپ', charger: 'شارژر', watch: 'ساعت هوشمند', smartwatch: 'ساعت هوشمند' };

// Each food term: [Persian keyword, vertical, keep it as the search text?]
const FOOD: Array<[string, Vertical, boolean]> = [
  ['پیتزا', 'fast_food', true], ['برگر', 'fast_food', true], ['همبرگر', 'fast_food', true], ['ساندویچ', 'fast_food', true], ['سوخاری', 'fast_food', true], ['فست فود', 'fast_food', false], ['فستفود', 'fast_food', false], ['هات داگ', 'fast_food', true],
  ['چلو کباب', 'restaurant', true], ['چلوکباب', 'restaurant', true], ['جوجه کباب', 'restaurant', true], ['کباب', 'restaurant', true], ['قیمه', 'restaurant', true], ['قورمه سبزی', 'restaurant', true], ['قورمه', 'restaurant', true], ['زرشک پلو', 'restaurant', true], ['دیزی', 'restaurant', true], ['شیشلیک', 'restaurant', true], ['رستوران', 'restaurant', false], ['کبابی', 'restaurant', false],
  ['کافه', 'cafe', false], ['کافی شاپ', 'cafe', false], ['قهوه', 'cafe', true], ['لاته', 'cafe', true], ['اسپرسو', 'cafe', true],
  ['شیرینی', 'sweets', false], ['شیرینی فروشی', 'sweets', false], ['کیک', 'sweets', true], ['بستنی', 'sweets', true], ['دسر', 'sweets', false],
  ['نان', 'bakery', false], ['نون', 'bakery', false], ['نانوایی', 'bakery', false], ['بربری', 'bakery', true], ['سنگک', 'bakery', true],
  ['دسته گل', 'flowers', true], ['گل فروشی', 'flowers', false], ['گلفروشی', 'flowers', false], ['گل', 'flowers', false],
  ['سوپرمارکت', 'grocery', false], ['سوپر مارکت', 'grocery', false], ['خواربار', 'grocery', false], ['هایپر', 'grocery', false],
  ['میوه', 'produce', false], ['سبزی', 'produce', false], ['تره بار', 'produce', false],
  ['گوشت', 'protein', false], ['مرغ', 'protein', false], ['ماهی', 'protein', false], ['پروتئینی', 'protein', false],
  ['آجیل', 'nuts', false], ['خشکبار', 'nuts', false],
  ['صبحانه', 'meals', true], ['ناهار', 'meals', false], ['نهار', 'meals', false], ['شام', 'meals', false], ['غذا', 'meals', false],
];
const FOOD_CUES = ['گشنمه', 'گرسنمه', 'گرسنه', 'بخورم', 'بخوریم', 'میخورم', 'سفارش غذا', 'gorosnam', 'gashname', 'bokhoram', 'bokhorim', 'ghaza', 'nahar', 'shaam', 'sham'];
const SHOP: string[] = ['هدفون', 'هندزفری', 'هنذفری', 'ایرپاد', 'ایربادز', 'گوشی', 'موبایل', 'ساعت هوشمند', 'مچ بند', 'مچبند', 'پاوربانک', 'پاور بانک', 'اسپیکر', 'کیبورد', 'کیبرد', 'ماوس', 'موس', 'لپ تاپ', 'لپتاپ', 'تبلت', 'شارژر', 'کابل', 'هارد', 'فلش', 'مانیتور', 'کنسول', 'دسته بازی', 'تلویزیون', 'کتاب', 'کفش', 'کوله'];
const BRANDS = ['سونی', 'شیائومی', 'سامسونگ', 'اپل', 'انکر', 'جی بی ال', 'هواوی', 'لنوو', 'ایسوس', 'ریلمی', 'نوکیا', 'لاجیتک', 'بیسوس', 'گیمینگ', 'بلوتوثی', 'بی سیم'];
const SHOP_CUES = ['بخرم', 'بخریم', 'خرید', 'میخرم', 'قیمت', 'چنده', 'bekharam', 'kharid', 'gheymat'];
const BUS = ['اتوبوس', 'اتوبوسی', 'اتوبوسا', 'bus', 'otobus', 'otoboos', 'utobus', 'brt', 'بی آر تی'];
const METRO = ['مترو', 'قطار', 'قطارش', 'metro', 'ghatar', 'train', 'تابلو', 'تابلوی'];
const METRO_ASK = ['کی میاد', 'کی میرسه', 'بعدی', 'حرکت', 'key miad', 'badi'];
const TRIP_VERBS = ['برم', 'بریم', 'برسم', 'برسیم', 'بروم', 'میرم', 'میریم', 'رفتن', 'برگردم', 'beram', 'berim', 'beresam', 'miram'];
// Words that end a place name in «از X تا Y چطوری برم».
const PLACE_END = ['برم', 'بریم', 'برسم', 'برسیم', 'بروم', 'میرم', 'میریم', 'چطوری', 'چطور', 'چجوری', 'چقدر', 'چند', 'با', 'یا', 'بهتره', 'سریع', 'سریعترین', 'کدوم', 'الان', 'امروز', 'فردا', 'beram', 'berim', 'chetori', 'ba', 'chejori', 'cheghadr', 'راهه', 'راه', 'میشه', 'برای', 'رو', 'را', 'مترو', 'اتوبوس', 'ماشین', 'تاکسی', 'پیاده',
  'بگو', 'بده', 'نشون', 'نشان', 'پیدا', 'سوار', 'کی', 'bego', 'kojast'];
const PLACE_START_DROP = ['مسیر', 'masir', 'راه', 'برم', 'برسم', 'میرم', 'beram', 'miram', 'میخوام', 'mikham', 'چطوری', 'چطور', 'چجوری', 'chetori', 'به', 'be', 'ایستگاه'];
// Greetings and thanks need no model: the help sentence answers them at once.
const SMALL_TALK = ['سلام', 'درود', 'سلام علیکم', 'خوبی', 'مرسی', 'ممنون', 'ممنونم', 'متشکرم', 'تشکر', 'خداحافظ', 'hi', 'hello', 'salam', 'merci', 'mamnoon', 'thanks', 'ok', 'باشه'];
const HERE = ['اینجا', 'همینجا', 'اینجام', 'injam', 'inja', 'موقعیتم', 'جای فعلیم'];

function placeSpan(words: string[]): string | undefined {
  let w = [...words];
  while (w.length && PLACE_START_DROP.includes(w[0]!)) w.shift();
  const cut = w.findIndex((x, i) => i > 0 && PLACE_END.includes(x));
  if (cut > 0) w = w.slice(0, cut);
  while (w.length && PLACE_END.includes(w[w.length - 1]!)) w.pop();
  const s = w.join(' ').trim();
  if (!s || s.length > 60 || /^\d+$/.test(s) || amounts(s).length) return undefined;
  return s;
}

/** Trip: «از X تا|به Y», «برم|برسم Y», «تا Y چقدر راهه», «راه به Y», Finglish «az X ta Y», «beram Y». */
export function tripSpans(text: string): { from?: string; to?: string } | null {
  // «راه آهن» is a place (the railway station), not the word «راه» (way) followed by something.
  const t = text.replace(/(^| )راه آهن( |$)/g, '$1راه\u0002آهن$2');
  const restore = (r: { from?: string; to?: string } | null) => r && Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.replace(/\u0002/g, ' ')])) as { from?: string; to?: string };
  return restore(spans(t));
}
function spans(t: string): { from?: string; to?: string } | null {
  const toks = t.split(' ');
  const fromAt = toks.findIndex(x => x === 'از' || x === 'az');
  if (fromAt >= 0) {
    const sep = toks.findIndex((x, i) => i > fromAt + 1 && (x === 'تا' || x === 'به' || x === 'ta' || x === 'be'));
    if (sep > fromAt) {
      const from = placeSpan(toks.slice(fromAt + 1, sep)), to = placeSpan(toks.slice(sep + 1));
      if (to) return { ...(from && !HERE.includes(from) ? { from } : {}), to };
    }
  }
  // «مسیر X تا Y», «راه X تا Y» (no «از»).
  if (['مسیر', 'masir', 'راه'].includes(toks[0]!)) {
    const sep = toks.findIndex((x, i) => i > 1 && (x === 'تا' || x === 'ta'));
    if (sep > 1) { const from = placeSpan(toks.slice(1, sep)), to = placeSpan(toks.slice(sep + 1)); if (to) return { ...(from ? { from } : {}), to }; }
  }
  const verb = toks.findIndex(x => TRIP_VERBS.includes(x));
  if (verb >= 0) {
    const after = placeSpan(toks.slice(verb + 1).filter(x => x !== 'به' && x !== 'be'));
    if (after) return { to: after };
    const before = placeSpan(toks.slice(0, verb).filter((x, i) => !(i === 0 && (x === 'تا' || x === 'به'))));
    if (before && !['میخوام', 'میخواهم', 'mikham'].includes(before)) return { to: before };
  }
  if (toks[0] === 'تا' || toks[0] === 'ta') { const to = placeSpan(toks.slice(1)); if (to) return { to }; }
  const road = toks.findIndex((x, i) => (x === 'راه' || x === 'مسیر') && (toks[i + 1] === 'به' || toks[i + 1] === 'تا'));
  if (road >= 0) { const to = placeSpan(toks.slice(road + 2)); if (to) return { to }; }
  return null;
}

/** The longest network station whose name occurs in the question («وکیل آباد» finds «وکیل‌آباد»; «فرودگاه» the airport). */
/** A category name typed as a search («فست فود»، «رستوران»): the vertical, not the text, is what to search. */
export function genericFood(term: string): Vertical | undefined {
  const f = FOOD.find(([w, , keep]) => !keep && compact(w) === compact(term));
  return f?.[1];
}

export function findStation(text: string, stations: readonly string[]): string | undefined {
  const c = compact(text);
  const named = [...stations].sort((a, b) => compact(b).length - compact(a).length).find(s => c.includes(compact(s)));
  if (named) return named;
  if (c.includes('فرودگاه')) return stations.find(s => s.startsWith('فرودگاه'));
  return undefined;
}

const lineNumber = (toks: string[]) => toks.find(x => /^\d{1,3}(\.\d)?$/.test(x));

function foodParams(t: string): AskParams | null {
  const hits = FOOD.filter(([w]) => hasStem(t, w));
  const finglish = Object.entries(FINGLISH).filter(([k]) => hasWord(t, k)).map(([, v]) => FOOD.find(([w]) => w === v)).filter(Boolean) as Array<[string, Vertical, boolean]>;
  const all = [...hits, ...finglish];
  if (!all.length && !anyStem(t, FOOD_CUES)) return null;
  const specific = all.filter(([, , keep]) => keep).sort((a, b) => b[0].length - a[0].length)[0];
  const vertical = (specific ?? all[0])?.[1] ?? 'meals';
  const budget = snapBudget(amounts(t)[0], FOOD_BUDGETS);
  return { ...(specific ? { q: specific[0] } : {}), vertical, ...(budget ? { budget } : {}), ...(nearby(t) ? { near: true } : {}) };
}
function shopParams(t: string): AskParams | null {
  const term = [...SHOP].sort((a, b) => b.length - a.length).find(w => hasStem(t, w))
    ?? Object.entries(FINGLISH).find(([k, v]) => hasWord(t, k) && SHOP.some(s => v.startsWith(s) || s === v))?.[1];
  if (!term) return null;
  const toks = t.split(' '), at = toks.findIndex(x => x.startsWith(term.split(' ')[0]!));
  const brand = at >= 0 ? BRANDS.find(b => ` ${toks.slice(at + term.split(' ').length, at + term.split(' ').length + 3).join(' ')} `.startsWith(` ${b} `)) : undefined;
  const budget = snapBudget(amounts(t)[0], SHOP_BUDGETS);
  return { q: brand ? `${term} ${brand}` : term, ...(budget ? { budget } : {}) };
}
const nearby = (t: string) => anyStem(t, ['نزدیک', 'نزدیکی', 'نزدیکم', 'اطراف', 'اطرافم', 'nazdik', 'nazdikam']) || hasWord(t, 'دور و بر') || t.includes('دور و بر') || t.includes('همین دور');

/** Rule parser. `confident` is false when no rule or more than one kind of rule fired; the model is asked then. */
export function parseRules(question: string, stations: readonly string[], _busLines: ReadonlySet<string> = new Set()): Parsed {
  const t = normalize(question);
  if (!t || SMALL_TALK.includes(t) || t.split(' ').every(w => SMALL_TALK.includes(w))) return { intent: 'unknown', params: {}, confident: true };
  const toks = t.split(' ');
  const bus = anyStem(t, BUS), metro = anyStem(t, METRO);
  const trip = tripSpans(t);
  const food = foodParams(t), shop = shopParams(t);
  const kinds: Parsed[] = [];
  if (trip && !(food && !trip.from && amounts(t).length)) kinds.push({ intent: 'trip', params: trip, confident: true });
  if (bus || (!metro && toks.some((x, i) => (x === 'خط' || x === 'khat') && /^\d{1,3}(\.\d)?$/.test(toks[i + 1] ?? '') && !['1', '2', '3'].includes(toks[i + 1]!)))) {
    const line = lineNumber(toks.slice(Math.max(0, toks.findIndex(x => BUS.includes(x) || x === 'خط' || x === 'khat'))));
    const stopAt = toks.findIndex(x => x === 'ایستگاه' || x === 'istgah');
    const stop = stopAt >= 0 ? toks.slice(stopAt + 1).filter(x => !BUS.includes(x) && !['کی', 'میاد', 'میرسه', 'key', 'miad'].includes(x)).join(' ').trim() : '';
    // The person's own line number is passed on even when the OSM guide lacks it; the bus page then says it is not listed.
    kinds.push({ intent: 'bus_eta', params: { ...(line ? { line } : {}), ...(stop ? { stop } : {}) }, confident: true });
  }
  const station = findStation(t, stations);
  if (!bus && (metro || (station && METRO_ASK.some(w => t.includes(w)))) && !(trip && (trip.from || TRIP_VERBS.some(v => hasWord(t, v))))) {
    kinds.push({ intent: 'metro_board', params: station ? { station } : {}, confident: true });
  }
  if (food && !kinds.length) kinds.push({ intent: 'food', params: food, confident: true });
  if (shop && !kinds.some(k => k.intent === 'food')) kinds.push({ intent: 'shop', params: shop, confident: true });
  if (food && shop) return { ...(shop.budget ? { intent: 'shop' as const, params: shop } : { intent: 'food' as const, params: food }), confident: false };
  // A trip with a vehicle word is still a trip («از کوثر تا حرم با مترو»).
  if (kinds.length > 1 && kinds[0]!.intent === 'trip' && (trip?.from || TRIP_VERBS.some(v => hasWord(t, v)))) return kinds[0]!;
  if (kinds.length === 1) return kinds[0]!;
  if (kinds.length > 1) return { ...kinds[0]!, confident: false };
  return { intent: 'unknown', params: {}, confident: false };
}
