import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildServer } from '../../src/server.js';
import { amounts, normalize, parseRules, snapBudget, FOOD_BUDGETS, SHOP_BUDGETS } from '../../src/ask/parse.js';
import { replyFor, validateModelAnswer } from '../../src/ask/intent.js';
import { createAsk, createBridgeModel, loadAskVocabulary, type AskModel } from '../../src/ask/index.js';

const { stations, busLines } = loadAskVocabulary();
const cases = JSON.parse(readFileSync(new URL('./eval-fa.json', import.meta.url), 'utf8')) as Array<{ q: string; intent: string; params: Record<string, unknown> }>;
const latin = (s: string) => s.replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0)).replace(/٬/g, '');

describe('numbers come only from the person’s words', () => {
  it('reads stated amounts in Persian, colloquial and word form; ambiguous or unrelated numbers are not budgets', () => {
    expect(amounts('زیر ۲ میلیون')).toEqual([2_000_000]);
    expect(amounts('تا ۱۵۰ هزار')).toEqual([150_000]);
    expect(amounts('برگر تا ۲۵۰ تومن')).toEqual([250_000]);
    expect(amounts('اسپیکر تا دو میلیون')).toEqual([2_000_000]);
    expect(amounts('حداکثر صد و پنجاه هزار')).toEqual([150_000]);
    expect(amounts('zire 2 milion')).toEqual([2_000_000]);
    expect(amounts('اتوبوس خط ۳۸')).toEqual([]);
    expect(amounts('۱۵۰۰ تومن')).toEqual([]);
  });
  it('a budget becomes the strictest offered cap that still respects it, never a higher one', () => {
    expect(snapBudget(200_000, FOOD_BUDGETS)).toBe(150_000);
    expect(snapBudget(5_000_000, SHOP_BUDGETS)).toBe(5_000_000);
    expect(snapBudget(50_000, FOOD_BUDGETS)).toBeUndefined();
    expect(snapBudget(40_000_000, SHOP_BUDGETS)).toBeUndefined();   // «لپ تاپ تا ۴۰ میلیون»: no 5-million cap
  });
  it('normalises letters, digits and spacing', () => {
    expect(normalize('ايستگاه  وكيل‌آباد؟')).toBe('ایستگاه وکیل آباد');
    expect(normalize('خط ۳۸/۱')).toBe('خط 38.1');
  });
});

describe('rule parser on the 50-question Persian set', () => {
  const results = cases.map(c => ({ c, r: parseRules(c.q, stations, busLines) }));
  it('gets at least 90% of intents and their key details right without any model', () => {
    const right = results.filter(({ c, r }) => r.intent === c.intent && Object.entries(c.params).every(([k, v]) => (r.params as Record<string, unknown>)[k] === v));
    expect(right.length / cases.length).toBeGreaterThanOrEqual(0.9);
  });
  it('no reply contains a number the person did not write', () => {
    for (const { c, r } of results) {
      const said = new Set([...(latin(c.q).match(/\d+/g) ?? []), ...amounts(c.q).map(String), ...amounts(c.q).map(a => String(a / 1000))]);
      const shown = latin(replyFor(r)).match(/\d+/g) ?? [];
      for (const n of shown) expect(said.has(n) || [...said].some(s => String(Number(s) * 1000) === n || String(Number(s) * 1_000_000) === n), `${c.q} -> ${replyFor(r)}`).toBe(true);
    }
  });
});

describe('a model answer is only accepted when it copies the person', () => {
  const ctx = { stations, ruled: {} };
  it('rejects unknown intents, invented places and invented stations; takes budgets and lines from the rules only', () => {
    expect(validateModelAnswer({ intent: 'weather' }, 'فردا هوا', ctx)).toBeNull();
    expect(validateModelAnswer({ intent: 'trip', to: 'میدان آزادی' }, 'چطوری برسم خونه مادربزرگ', ctx)).toBeNull();
    expect(validateModelAnswer({ intent: 'trip', to: 'خونه مادربزرگ' }, 'چطوری برسم خونه مادربزرگ', ctx)).toEqual({ intent: 'trip', params: { to: 'خونه مادربزرگ' } });
    expect(validateModelAnswer({ intent: 'metro_board', station: 'ایستگاه خیالی' }, 'قطار کی میاد', ctx)).toEqual({ intent: 'metro_board', params: {} });
    expect(validateModelAnswer({ intent: 'food', q: 'پیتزا', budget: 999, vertical: 'fast_food' }, 'یه چیزی مثل پیتزا', ctx)).toEqual({ intent: 'food', params: { q: 'پیتزا', vertical: 'fast_food' } });
    expect(validateModelAnswer({ intent: 'bus_eta', line: '999' }, 'اون اتوبوسه', { stations, ruled: { line: '38' } })).toEqual({ intent: 'bus_eta', params: { line: '38' } });
    expect(validateModelAnswer({ intent: 'trip', to: 'حرم' }, 'beram haram', ctx)).toEqual({ intent: 'trip', params: { to: 'حرم' } });
    // A category typed as text is searched as the category.
    expect(validateModelAnswer({ intent: 'food', q: 'فست فود', vertical: 'fast_food', near: true }, 'nazdikam fast food hast?', ctx)).toEqual({ intent: 'food', params: { vertical: 'fast_food', near: true } });
  });
});

describe('hybrid flow (fail-safe)', () => {
  const model = (fn: AskModel) => { const calls: string[] = []; return { calls, model: (async (q, s, sig) => { calls.push(q); return fn(q, s, sig); }) as AskModel }; };
  it('greetings and thanks get the help sentence at once, without the model', async () => {
    const m = model(async () => ({ intent: 'unknown' }));
    for (const q of ['سلام', 'مرسی', 'salam', 'سلام خوبی']) expect(await createAsk({ model: m.model, stations })(q)).toMatchObject({ intent: 'unknown', source: 'rules' });
    expect(m.calls).toEqual([]);
  });
  it('a clear question never waits for the model', async () => {
    const m = model(async () => ({ intent: 'unknown' }));
    const r = await createAsk({ model: m.model, stations, busLines })('اتوبوس ۳۸ کی میرسه');
    expect(r).toMatchObject({ intent: 'bus_eta', params: { line: '38' }, source: 'rules' });
    expect(m.calls).toEqual([]);
  });
  it('an unclear question goes to the model; a slow, broken or busy model falls back to the rules', async () => {
    const good = model(async () => ({ intent: 'food', vertical: 'meals' }));
    const ask = createAsk({ model: good.model, stations, busLines });
    expect(await ask('امشب چی درست کنم که زود آماده بشه')).toMatchObject({ intent: 'food', source: 'model' });
    expect(await ask('امشب چی درست کنم که زود آماده بشه')).toMatchObject({ source: 'model' });
    expect(good.calls.length).toBe(1);                                                          // cached
    const slow = createAsk({ model: (_q, _s, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('timeout')))), stations, timeoutMs: 30 });
    expect(await slow('یه چیزی میخوام')).toMatchObject({ intent: 'unknown', source: 'rules_fallback' });
    const broken = createAsk({ model: async () => 'not json', stations });
    expect(await broken('یه چیزی میخوام')).toMatchObject({ source: 'rules_fallback' });
    expect(await createAsk({ model: null, stations })('یه چیزی میخوام')).toMatchObject({ source: 'rules_fallback', reply: expect.stringContaining('متوجه نشدم') });
  });
  it('the bridge client sends the question with a fixed system prompt and pulls JSON out of fenced text', async () => {
    const sent: unknown[] = [];
    const m = createBridgeModel({ fetch: (async (_u: string, init: RequestInit) => { sent.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"intent":"shop","q":"هدفون"}\n```' } }] })); }) as typeof fetch });
    expect(await m('هدفون', ['کوثر'], new AbortController().signal)).toEqual({ intent: 'shop', q: 'هدفون' });
    expect(sent[0]).toMatchObject({ model: 'gemini-3.8-flash-low', temperature: 0, messages: [{ role: 'system' }, { role: 'user', content: 'هدفون' }] });
  });
});

describe('POST /app/api/ask', () => {
  const ask = createAsk({ model: null, stations, busLines });
  it('answers with a fixed schema and no-store; rejects bad bodies', async () => {
    const app = buildServer({ ask });
    const r = await app.inject({ method: 'POST', url: '/app/api/ask', payload: { q: 'از کوثر تا حرم چطوری برم؟' } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.json()).toEqual({ schemaVersion: 1, intent: 'trip', params: { from: 'کوثر', to: 'حرم' }, reply: 'مسیر «کوثر» تا «حرم» را باز می‌کنم؛ مکان دقیق را از فهرست انتخاب کنید.', source: 'rules' });
    for (const payload of [{}, { q: '' }, { q: 3 }, { q: 'x'.repeat(201) }, { q: 'سلام', extra: 1 }]) expect((await app.inject({ method: 'POST', url: '/app/api/ask', payload })).statusCode).toBe(400);
  });
  it('is rate limited per client', async () => {
    const app = buildServer({ ask, limiterClock: () => 0 });
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await app.inject({ method: 'POST', url: '/app/api/ask', payload: { q: 'قهوه' } })).statusCode;
    expect(last).toBe(429);
  });
});
