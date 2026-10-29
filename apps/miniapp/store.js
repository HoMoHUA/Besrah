// Device-local preferences. Only station NAMES and display preferences are kept — never coordinates.
// The storage object is injected so the module is testable and survives blocked/full storage.
export const KEYS = Object.freeze({
  recents: 'besrah:recents', favs: 'besrah:favs', last: 'besrah:last', theme: 'besrah:theme',
});
const MAX_NAME = 64;
const THEMES = ['auto', 'light', 'dark'];
const isName = v => typeof v === 'string' && v.length > 0 && v.length <= MAX_NAME;

export function createStore(storage, { maxRecents = 6, maxFavourites = 24 } = {}) {
  const listeners = new Set();
  const read = key => { try { return storage?.getItem(key) ?? null; } catch { return null; } };
  const write = (key, value) => { try { storage?.setItem(key, value); } catch { /* keep working in memory */ } };
  const names = key => {
    try {
      const parsed = JSON.parse(read(key));
      return Array.isArray(parsed) ? [...new Set(parsed.filter(isName))] : [];
    } catch { return []; }
  };
  const state = {
    recents: names(KEYS.recents).slice(0, maxRecents),
    favs: names(KEYS.favs).slice(0, maxFavourites),
    last: null,
    theme: 'auto',
  };
  try { const last = JSON.parse(read(KEYS.last)); if (isName(last)) state.last = last; } catch { /* ignore */ }
  { const theme = read(KEYS.theme); if (THEMES.includes(theme)) state.theme = theme; }

  const emit = key => listeners.forEach(fn => { try { fn(key); } catch { /* listener errors never break state */ } });
  const save = key => {
    if (key === 'recents') write(KEYS.recents, JSON.stringify(state.recents));
    else if (key === 'favs') write(KEYS.favs, JSON.stringify(state.favs));
    else if (key === 'last') write(KEYS.last, JSON.stringify(state.last));
    else if (key === 'theme') write(KEYS.theme, state.theme);
    emit(key);
  };

  return {
    recents: () => [...state.recents],
    favourites: () => [...state.favs],
    last: () => state.last,
    themePref: () => state.theme,
    isFavourite: name => state.favs.includes(name),
    addRecent(name) {
      if (!isName(name)) return;
      state.recents = [name, ...state.recents.filter(n => n !== name)].slice(0, maxRecents);
      save('recents');
    },
    clearRecents() { state.recents = []; save('recents'); },
    setLast(name) { if (!isName(name)) return; state.last = name; save('last'); },
    setThemePref(value) { if (!THEMES.includes(value)) return; state.theme = value; save('theme'); },
    toggleFavourite(name) {
      if (!isName(name)) return { on: false, reason: 'invalid' };
      if (state.favs.includes(name)) { state.favs = state.favs.filter(n => n !== name); save('favs'); return { on: false }; }
      if (state.favs.length >= maxFavourites) return { on: false, reason: 'full' };
      state.favs = [...state.favs, name]; save('favs'); return { on: true };
    },
    // Forget names that are not real stations any more (the list can change between releases).
    prune(valid) {
      const keep = new Set(valid);
      const recents = state.recents.filter(n => keep.has(n)), favs = state.favs.filter(n => keep.has(n));
      if (recents.length !== state.recents.length) { state.recents = recents; save('recents'); }
      if (favs.length !== state.favs.length) { state.favs = favs; save('favs'); }
      if (state.last && !keep.has(state.last)) { state.last = null; try { storage?.removeItem(KEYS.last); } catch { /* ignore */ } emit('last'); }
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
