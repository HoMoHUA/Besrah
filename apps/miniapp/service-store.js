// Product identifiers only, in an isolated versioned key. Never station names or coordinates.
import { SERVICES } from './services.js';
export const SERVICE_KEY = 'besrah:services:v1';
// Earlier builds saved the transport cards separately; they are now one Besrah service.
const LEGACY = { metro: 'besrah', bus: 'besrah', route: 'besrah' };
export function createServiceStore(storage) {
  const valid = new Set(SERVICES.map(s => s.id)), listeners = new Set();
  let saved = [];
  try { const p = JSON.parse(storage?.getItem(SERVICE_KEY) ?? '[]'); if (Array.isArray(p)) saved = [...new Set(p.map(id => LEGACY[id] ?? id).filter(id => valid.has(id)))]; } catch { /* private browsing or corrupt data */ }
  return {
    all: () => [...saved],
    has: id => saved.includes(id),
    toggle(id) {
      if (!valid.has(id)) return false;
      saved = saved.includes(id) ? saved.filter(s => s !== id) : [...saved, id];
      try { storage?.setItem(SERVICE_KEY, JSON.stringify(saved)); } catch { /* memory fallback */ }
      listeners.forEach(fn => fn());
      return saved.includes(id);
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
