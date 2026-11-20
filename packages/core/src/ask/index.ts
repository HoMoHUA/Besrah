// POST /app/api/ask — «از بسراه بپرس». Hybrid and fail-safe:
// 1. The rule parser (parse.ts) answers clear questions instantly, locally, with no model.
// 2. Only an unclear question goes to the local model bridge (agy, OpenAI-compatible), with a hard time limit and a
//    small in-flight cap; its JSON is validated (intent.ts) and may only copy the person's words.
// 3. If the model is slow, down, busy or wrong-shaped, the rules' best guess (or "unknown") is returned.
// The question is never logged, stored or sent anywhere else; location and account data are never part of it.
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { clientKey, createWindowLimiter } from '../journey-beta/limits.js';
import { NETWORK_PATH } from '../network.js';
import { normalize, parseRules, type AskParams, type Intent } from './parse.js';
import { replyFor, validateModelAnswer, type AskAnswer } from './intent.js';

export interface AskModel { (question: string, stations: readonly string[], signal: AbortSignal): Promise<unknown> }
export interface AskResult { schemaVersion: 1; intent: Intent; params: AskParams; reply: string; source: 'rules' | 'model' | 'rules_fallback' }

const MAX_Q = 200;
const BUS_GUIDE = new URL('../../../../apps/miniapp/assets/bus-guide.json', import.meta.url);

export function systemPrompt(stations: readonly string[]): string {
  return [
    'You map one request from users of Besrah, a city app for Mashhad (Iran), to JSON. The request is Persian, colloquial Persian or Finglish.',
    'Intents: "trip" = getting from one place to another; "food" = food, restaurants, cafes, sweets, bakery, flowers, grocery;',
    '"shop" = buying or pricing goods such as electronics; "metro_board" = next metro train or timetable at a station;',
    '"bus_eta" = a city bus line or bus stop; "unknown" = anything else (greetings, weather, jokes, other cities).',
    'Return ONLY one JSON object, no prose: {"intent":"...","from":null,"to":null,"q":null,"vertical":null,"near":false,"station":null,"stop":null}',
    '- from/to/stop/q: copy the words exactly as the person wrote them (for Finglish, write the Persian word). null when absent.',
    '- vertical (food only): one of meals, restaurant, fast_food, cafe, sweets, bakery, flowers, grocery, produce, protein, nuts.',
    `- station (metro only): one of: ${stations.join('، ')}.`,
    '- near: true only if the person asked for something near them.',
    'Never add numbers, prices, times or places that are not in the request.',
  ].join('\n');
}

/** OpenAI-compatible chat call to the local bridge; returns the parsed JSON object or throws. */
export function createBridgeModel(opts: { url?: string; model?: string; fetch?: typeof fetch } = {}): AskModel {
  const url = opts.url ?? 'http://127.0.0.1:8049/v1/chat/completions', model = opts.model ?? 'gemini-3.8-flash-low', doFetch = opts.fetch ?? fetch;
  return async (question, stations, signal) => {
    const res = await doFetch(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, temperature: 0, max_tokens: 200, messages: [{ role: 'system', content: systemPrompt(stations) }, { role: 'user', content: question }] }) });
    if (!res.ok) throw new Error('model_http_' + res.status);
    const body = await res.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new Error('model_shape');
    const json = /\{[\s\S]*\}/.exec(text)?.[0];
    if (!json) throw new Error('model_no_json');
    return JSON.parse(json);
  };
}

export function createAsk(opts: { model?: AskModel | null; stations?: readonly string[]; busLines?: ReadonlySet<string>; timeoutMs?: number; maxInFlight?: number; now?: () => number } = {}) {
  const stations = opts.stations ?? [], busLines = opts.busLines ?? new Set<string>();
  const timeoutMs = opts.timeoutMs ?? 9000, maxInFlight = opts.maxInFlight ?? 2, now = opts.now ?? Date.now;
  const cache = new Map<string, { at: number; result: AskResult }>();
  let inFlight = 0;
  const done = (a: AskAnswer, source: AskResult['source']): AskResult => ({ schemaVersion: 1, intent: a.intent, params: a.params, reply: replyFor(a), source });

  return async function ask(question: string): Promise<AskResult> {
    const ruled = parseRules(question, stations, busLines);
    if (ruled.confident || !opts.model) return done(ruled, ruled.confident ? 'rules' : 'rules_fallback');
    const key = normalize(question), hit = cache.get(key);
    if (hit && now() - hit.at < 10 * 60_000) return hit.result;
    if (inFlight >= maxInFlight) return done(ruled, 'rules_fallback');
    inFlight++;
    try {
      const raw = await opts.model(question, stations, AbortSignal.timeout(timeoutMs));
      const answer = validateModelAnswer(raw, question, { stations, ruled: ruled.params });
      if (!answer) return done(ruled, 'rules_fallback');
      const result = done(answer, 'model');
      cache.set(key, { at: now(), result });
      if (cache.size > 300) cache.delete(cache.keys().next().value!);
      return result;
    } catch { return done(ruled, 'rules_fallback'); }
    finally { inFlight--; }
  };
}

export function loadAskVocabulary(): { stations: string[]; busLines: Set<string> } {
  const stations = (JSON.parse(readFileSync(NETWORK_PATH, 'utf8')).stations as Array<{ name: string }>).map(s => s.name);
  let busLines = new Set<string>();
  try { busLines = new Set((JSON.parse(readFileSync(BUS_GUIDE, 'utf8')).l as Array<{ r: string }>).map(l => l.r.replace('/', '.'))); } catch { /* no guide: any line number is passed on */ }
  return { stations, busLines };
}

export function registerAsk(app: FastifyInstance, opts: { ask?: (q: string) => Promise<AskResult>; limiterClock?: () => number } = {}) {
  let ask = opts.ask;
  const limiter = createWindowLimiter(20, 60_000, opts.limiterClock ?? Date.now);
  // POST so the question never lands in a URL or an access log.
  app.post('/app/api/ask', { bodyLimit: 1024 }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    if (!limiter.allow(clientKey(req))) return reply.code(429).header('Retry-After', '10').send({ error: 'rate_limited' });
    const b = req.body as { q?: unknown } | null;
    if (!b || typeof b !== 'object' || Object.keys(b).some(k => k !== 'q') || typeof b.q !== 'string' || !b.q.trim() || b.q.length > MAX_Q) return reply.code(400).send({ error: 'bad_request' });
    if (!ask) {
      const vocab = loadAskVocabulary();
      const model = process.env.BESRAH_ASK_MODEL === 'off' ? null : createBridgeModel({ ...(process.env.BESRAH_ASK_MODEL_URL ? { url: process.env.BESRAH_ASK_MODEL_URL } : {}), ...(process.env.BESRAH_ASK_MODEL_NAME ? { model: process.env.BESRAH_ASK_MODEL_NAME } : {}) });
      ask = createAsk({ model, ...vocab });
    }
    return ask(b.q.trim());
  });
}
