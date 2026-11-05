// Device-local preferences. Only station NAMES and display preferences are kept — never coordinates.
// The storage object is injected so the module is testable and survives blocked/full storage.
export const KEYS = Object.freeze({
  recents: 'besrah:recents', favs: 'besrah:favs', last: 'besrah:last', theme: 'besrah:theme', prefs: 'besrah:prefs', suggest: 'besrah:suggest-location', choices: 'besrah:explicit-saves:v1',
});
const MAX_NAME = 64;
const THEMES = ['auto', 'light', 'dark'];
// Same whitelist and ranges as the server (packages/core/src/account/store.ts): a value that would be rejected there is dropped here.
export const PREF_RANGES = Object.freeze({ transitMaxWalkMin: [3, 40], foodBudgetToman: [20000, 5000000], shopBudgetToman: [50000, 1000000000] });
export function sanitizePrefs(input) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [key, [lo, hi]] of Object.entries(PREF_RANGES)) { const v = input[key]; if (Number.isInteger(v) && v >= lo && v <= hi) out[key] = v; }
  if (['time', 'walk', 'cost', 'balanced'].includes(input.transitPriority)) out.transitPriority = input.transitPriority;
  // Keep in sync with the backend's explicit category whitelist; never infer from browsing.
  const FOOD_VERTICALS = ['restaurant','fast_food','cafe','sweets','bakery','flowers','grocery','produce','protein','nuts','other'];
  const favorites = input.foodPreferredVerticals;
  if (Array.isArray(favorites) && favorites.length <= 4 &&
      new Set(favorites).size === favorites.length && favorites.every(x => FOOD_VERTICALS.includes(x)))
    out.foodPreferredVerticals = [...favorites];
  return out;
}
const isName = v => typeof v === 'string' && v.length > 0 && v.length <= MAX_NAME;
const MAX_SAVED = 24;
// Only explicitly tapped food vendors / product references. No GPS, history, phone or order details.
export function sanitizeSavedChoice(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (!['food','shop'].includes(input.kind)) return null;
  if (typeof input.id !== 'string' || !/^[a-z]{1,12}:[A-Za-z0-9._-]{1,80}$/.test(input.id)) return null;
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 100) return null;
  if (input.vertical !== undefined && (!['restaurant','fast_food','cafe','sweets','bakery','flowers','grocery','produce','protein','nuts','other'].includes(input.vertical))) return null;
  return {kind:input.kind,id:input.id,title:input.title.trim(),...(input.vertical?{vertical:input.vertical}:{})};
}

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
    prefs: {},
    suggestLocation: false,
    savedChoices: [],
  };
  try { state.prefs = sanitizePrefs(JSON.parse(read(KEYS.prefs))); } catch { state.prefs = {}; }
  state.suggestLocation = read(KEYS.suggest) === '1';
  try {
    const raw = JSON.parse(read(KEYS.choices));
    if (Array.isArray(raw)) {
      const dedup = new Set();
      state.savedChoices = raw.slice(0, MAX_SAVED).map(sanitizeSavedChoice).filter(v => {
        if (!v) return false;
        const key = v.kind + ':' + v.id;
        if (dedup.has(key)) return false;
        dedup.add(key); return true;
      });
    }
  } catch { /* corrupt storage is ignored */ }
  try { const last = JSON.parse(read(KEYS.last)); if (isName(last)) state.last = last; } catch { /* ignore */ }
  { const theme = read(KEYS.theme); if (THEMES.includes(theme)) state.theme = theme; }

  const emit = key => listeners.forEach(fn => { try { fn(key); } catch { /* listener errors never break state */ } });
  const save = key => {
    if (key === 'recents') write(KEYS.recents, JSON.stringify(state.recents));
    else if (key === 'favs') write(KEYS.favs, JSON.stringify(state.favs));
    else if (key === 'last') write(KEYS.last, JSON.stringify(state.last));
    else if (key === 'theme') write(KEYS.theme, state.theme);
    else if (key === 'choices') write(KEYS.choices, JSON.stringify(state.savedChoices));
    else if (key === 'prefs') write(KEYS.prefs, JSON.stringify(state.prefs));
    else if (key === 'suggest') write(KEYS.suggest, state.suggestLocation ? '1' : '0');
    emit(key);
  };

  return {
    recents: () => [...state.recents],
    favourites: () => [...state.favs],
    last: () => state.last,
    themePref: () => state.theme,
    savedChoices: () => state.savedChoices.map(x => ({...x})),
    isSavedChoice(kind,id) { return state.savedChoices.some(x => x.kind === kind && x.id === id); },
    toggleSavedChoice(kind, item) {
      const safe = sanitizeSavedChoice({...item,kind});
      if (!safe) return {on:false,reason:'invalid'};
      const i=state.savedChoices.findIndex(x=>x.kind===kind&&x.id===safe.id);
      if (i>=0) {
        state.savedChoices.splice(i,1); save('choices'); return {on:false};
      }
      if (state.savedChoices.length>=MAX_SAVED) return {on:false,reason:'full'};
      state.savedChoices.unshift(safe); save('choices'); return {on:true};
    },
    removeSavedChoice(kind,id) {
      const next=state.savedChoices.filter(x=>x.kind!==kind||x.id!==id);
      if(next.length!==state.savedChoices.length){state.savedChoices=next;save('choices');}
    },
    clearSavedChoices() { state.savedChoices=[]; save('choices'); },
    prefs: () => ({ ...state.prefs }),
    setPrefs(values) { state.prefs = sanitizePrefs(values); save('prefs'); },
    suggestLocation: () => state.suggestLocation,
    setSuggestLocation(on) { state.suggestLocation = Boolean(on); save('suggest'); },
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
