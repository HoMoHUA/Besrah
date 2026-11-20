// «از بسراه بپرس» in the Mini App: when typed text should be offered as a question, what a valid answer looks like,
// and which existing page an answer opens. Pure: no DOM, no network. The answer comes from POST api/ask.
export const ASK_INTENTS = Object.freeze(['trip', 'food', 'shop', 'metro_board', 'bus_eta', 'unknown']);
const ALLOWED = { trip: ['from', 'to'], food: ['q', 'vertical', 'budget', 'near'], shop: ['q', 'budget'], metro_board: ['station'], bus_eta: ['line', 'stop'], unknown: [] };

/** A sentence, a question mark or Finglish: offer «از بسراه بپرس» first. A single Persian word is offered only when no service matches. */
export function looksLikeQuestion(text) {
  const t = String(text ?? '').trim();
  return t.length >= 3 && (t.split(/\s+/).length >= 2 || /[؟?]/.test(t) || /[a-z]{3,}/i.test(t));
}

export function validAskResult(data) {
  if (!data || data.schemaVersion !== 1 || !ASK_INTENTS.includes(data.intent) || typeof data.reply !== 'string' || !data.reply.trim()) return false;
  if (!data.params || typeof data.params !== 'object' || Array.isArray(data.params)) return false;
  return Object.entries(data.params).every(([k, v]) => ALLOWED[data.intent].includes(k)
    && (k === 'budget' ? Number.isInteger(v) && v > 0 : k === 'near' ? v === true : typeof v === 'string' && v.length > 0 && v.length <= 80));
}

/** Where an answer leads: an existing view with presets, a metro station sheet, or nowhere (unknown). */
export function askRoute(result) {
  const p = result?.params ?? {};
  switch (result?.intent) {
    case 'trip': return { kind: 'view', view: 'trip', options: { ...(p.from ? { fromText: p.from } : {}), toText: p.to } };
    case 'food': return { kind: 'view', view: 'food', options: { ...(p.q ? { q: p.q } : {}), ...(p.vertical ? { vertical: p.vertical } : {}), ...(p.budget ? { budget: p.budget } : {}), ...(p.near ? { near: true } : {}) } };
    case 'shop': return { kind: 'view', view: 'shop', options: { ...(p.q ? { q: p.q } : {}), ...(p.budget ? { budget: p.budget } : {}) } };
    case 'metro_board': return p.station ? { kind: 'station', name: p.station } : { kind: 'view', view: 'metro', options: {} };
    case 'bus_eta': return { kind: 'view', view: 'bus', options: { ...(p.line ? { line: p.line } : {}), ...(p.stop ? { q: p.stop } : {}) } };
    default: return { kind: 'none' };
  }
}
