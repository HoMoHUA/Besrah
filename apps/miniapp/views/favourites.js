// Favourites tab: saved station NAMES (device only). Tap = the board; heart = remove, with undo.
import { fa, lineLabel } from '../format.js';
import { h, icon } from '../ui/dom.js';
import { init, toast } from '../ui/hm7.js';
import { positionLabel } from '../route.js';

export function createFavouritesView(ctx) {
  const { state, store, actions } = ctx;
  const root = h('div', { class: 'view view--favourites' });
  const head = h('header', { class: 'view__head' }, h('h1', { class: 'view__title', text: 'علاقه مندی ها' }),
    h('p', { class: 'view__sub', text: 'نام ایستگاه های ذخیره شده فقط روی همین دستگاه می ماند.' }));
  const body = h('div', { class: 'fav-body' });
  root.append(head, body);

  function remove(name) {
    store.toggleFavourite(name);
    toast({ title: 'از علاقه مندی ها حذف شد', text: name, icon: 'heart_slash', life: 5000, action: 'برگرداندن', onAction: () => { store.toggleFavourite(name); } });
  }

  function paint() {
    const s = state.get();
    const byName = new Map(s.stations.map(st => [st.name, st]));
    const names = store.favourites().filter(n => byName.has(n));
    if (s.status === 'loading' && store.favourites().length) {
      body.replaceChildren(h('ul', { class: 'fav-list', 'aria-hidden': 'true' }, store.favourites().map(() => h('li', { class: 'cm-card fav-row fav-row--skeleton' }, h('span', { class: 'cm-skel cm-skel--line fav-skel__line' })))));
      return;
    }
    if (!names.length) {
      body.replaceChildren(h('div', { class: 'cm-card cm-empty' },
        h('div', { class: 'cm-empty__art' }, icon('heart')),
        h('h3', { text: 'هنوز ایستگاهی ذخیره نکرده اید' }),
        h('p', { text: 'در برگهٔ هر ایستگاه قلب را لمس کنید تا اینجا بماند.' }),
        h('button', { class: 'cm-btn cm-btn--sm el', type: 'button', onClick: () => actions.go('stations', { mode: 'line1' }) }, 'دیدن ایستگاه ها')));
      init(body); return;
    }
    body.replaceChildren(h('ul', { class: 'fav-list', role: 'list' }, names.map(name => {
      const station = byName.get(name);
      return h('li', { class: 'cm-card cm-wash fav-row' },
        h('button', { class: 'fav-row__main el', type: 'button', onClick: () => actions.openStation(name), dataset: { name } },
          h('span', { class: 'line-badge line-badge--sm' }, h('span', { class: 'cm-sr', text: 'خط ' }), fa(1)),
          h('span', { class: 'fav-row__text' }, h('b', { text: name }), h('span', { text: [lineLabel(station.lines.filter(l => l === 1)), positionLabel(s.order, name)].filter(Boolean).join(' · ') })),
          h('span', { class: 'fav-row__go' }, 'قطار بعدی', icon('chevron_left'))),
        h('button', { class: 'fav-row__remove cm-icon-btn el', type: 'button', 'aria-label': `حذف ${name} از علاقه مندی ها`, onClick: () => remove(name) }, icon('heart_fill')));
    })));
    init(body);
  }

  store.subscribe(key => { if (key === 'favs') paint(); });
  state.subscribe(['status', 'stations', 'order'], paint);
  paint();
  return { el: root, mount() { init(root); }, onShow() { paint(); } };
}
