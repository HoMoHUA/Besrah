// Validation of a model's answer and the reply the person sees. Both are deterministic: the model may only choose an
// intent and copy words that are in the question (or in Besrah's own vocabulary); every number comes from parse.ts;
// the reply is a fixed template, so it can never contain a time, price or place the person did not write.
import { compact, genericFood, normalize, snapBudget, FOOD_BUDGETS, SHOP_BUDGETS, INTENTS, VERTICALS, amounts, type AskParams, type Intent, type Vertical } from './parse.js';

export interface AskAnswer { intent: Intent; params: AskParams }

const fa = (n: number) => n.toLocaleString('fa-IR');
const faDigits = (s: string) => s.replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]!);
const hasLatin = (s: string) => /[a-z]/i.test(s);
const VOCAB = new Set(['پیتزا', 'برگر', 'کباب', 'جوجه کباب', 'چلو کباب', 'قیمه', 'قهوه', 'کیک', 'بستنی', 'صبحانه', 'هدفون', 'ایرپاد', 'پاوربانک', 'اسپیکر', 'کیبورد', 'ماوس', 'گوشی', 'لپ تاپ', 'شارژر', 'ساعت هوشمند', 'دسته گل']);

/** A copied span is accepted only if it is in the question (any spacing), a known term, or a Finglish rendering. */
function span(value: unknown, question: string, max = 60): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = normalize(value).trim();
  if (!v || v.length > max) return undefined;
  if (compact(question).includes(compact(v)) || VOCAB.has(v)) return v;          // copied, so even its digits are the person's
  return hasLatin(question) && !hasLatin(v) && !/\d/.test(v) && v.length <= 40 ? v : undefined;
}

/** Turn whatever a model returned into a safe answer, or null. Budgets and line numbers are taken from `ruled`. */
export function validateModelAnswer(raw: unknown, question: string, ctx: { stations: readonly string[]; ruled: AskParams }): AskAnswer | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const intent = INTENTS.find(i => i === r.intent);
  if (!intent) return null;
  const params: AskParams = {};
  if (intent === 'trip') {
    const to = span(r.to, question), from = span(r.from, question);
    if (!to) return null;
    params.to = to; if (from && compact(from) !== compact(to)) params.from = from;
  } else if (intent === 'food' || intent === 'shop') {
    const q = span(r.q, question, 40), generic = intent === 'food' && q ? genericFood(q) : undefined;
    if (q && !generic) params.q = q;
    if (intent === 'food' && typeof r.vertical === 'string' && (VERTICALS as readonly string[]).includes(r.vertical)) params.vertical = r.vertical as Vertical;
    else if (generic) params.vertical = generic;
    const budget = snapBudget(amounts(question)[0], intent === 'food' ? FOOD_BUDGETS : SHOP_BUDGETS);
    if (budget) params.budget = budget;
    if (intent === 'food' && r.near === true && /نزدیک|اطراف|دور و بر|nazdik/.test(normalize(question))) params.near = true;
    if (intent === 'shop' && !params.q) return null;
  } else if (intent === 'metro_board') {
    if (typeof r.station === 'string') { const s = ctx.stations.find(x => compact(x) === compact(r.station as string)); if (s) params.station = s; }
  } else if (intent === 'bus_eta') {
    if (ctx.ruled.line) params.line = ctx.ruled.line;
    const stop = span(r.stop, question); if (stop) params.stop = stop;
  }
  return { intent, params };
}

const VERTICAL_FA: Record<Vertical, string> = { meals: 'غذا', restaurant: 'رستوران', fast_food: 'فست‌فود', cafe: 'کافه', sweets: 'شیرینی و دسر', bakery: 'نانوایی',
  flowers: 'گل و هدیه', grocery: 'سوپرمارکت', produce: 'میوه و سبزی', protein: 'پروتئین', nuts: 'آجیل و خشکبار' };

/** The one sentence shown to the person: what Besrah understood and where it is taking them. */
export function replyFor(a: AskAnswer): string {
  const p = a.params, budget = p.budget ? ` تا ${fa(p.budget)} تومان` : '';
  switch (a.intent) {
    case 'trip': return p.from ? `مسیر «${p.from}» تا «${p.to}» را باز می‌کنم؛ مکان دقیق را از فهرست انتخاب کنید.` : `مسیر تا «${p.to}» را باز می‌کنم؛ مقصد دقیق را از فهرست انتخاب کنید.`;
    case 'food': return `${p.q ? `«${p.q}»` : VERTICAL_FA[p.vertical ?? 'meals']}${p.near ? ' نزدیک شما' : ''}${budget} را در بسفود جست‌وجو می‌کنم.`;
    case 'shop': return `«${p.q}»${budget} را در بسپی مقایسه می‌کنم.`;
    case 'metro_board': return p.station ? `تابلوی ایستگاه ${p.station} را باز می‌کنم.` : 'بخش مترو را باز می‌کنم.';
    case 'bus_eta': return p.line ? `خط ${faDigits(p.line)} اتوبوس را باز می‌کنم؛ روی ایستگاه بزنید تا زمان رسیدن را ببینید.` : p.stop ? `ایستگاه «${p.stop}» را در راهنمای اتوبوس پیدا می‌کنم.` : 'راهنمای اتوبوس را باز می‌کنم.';
    default: return 'متوجه نشدم دنبال چه هستید. مثلاً بپرسید: «از کوثر تا حرم»، «پیتزا نزدیک من» یا «قطار بعدی شریعتی».';
  }
}
