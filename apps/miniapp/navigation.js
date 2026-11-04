// Indexed route history supports nested Back and native browser Forward without persisting user data.
export const NAV_VIEWS = ['home', 'saved', 'services', 'settings', 'profile'];
export const ROUTES = [...NAV_VIEWS, 'about', 'metro', 'bus', 'food', 'trip', 'shop', 'favourites'];
export const activeNav = view => view === 'about' ? 'profile' : ['metro', 'bus', 'food', 'trip', 'shop', 'favourites'].includes(view) ? 'services' : view;
export function createNavigation() {
  let cursor = 0;
  const entries = [{ view: 'home', scroll: 0 }];
  return {
    current: () => entries[cursor].view,
    index: () => cursor,
    go(view, scroll = 0) {
      if (!ROUTES.includes(view)) return false;
      if (view !== entries[cursor].view) {
        entries[cursor].scroll = scroll;
        entries.splice(cursor + 1); entries.push({ view, scroll: 0 }); cursor++;
      }
      return true;
    },
    replace(view) { if (!ROUTES.includes(view)) return false; entries[cursor] = { view, scroll: 0 }; return true; },
    back() { return cursor ? { ...entries[--cursor] } : null; },
    restore(index) { if (!Number.isInteger(index) || !entries[index]) return null; cursor = index; return { ...entries[cursor] }; },
  };
}
