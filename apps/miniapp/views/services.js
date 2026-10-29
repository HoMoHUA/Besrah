// Services tab: what works today, and the honest roadmap (not built, no dates).
import { SERVICES, isLive } from '../services.js';
import { h, icon } from '../ui/dom.js';
import { init, toast } from '../ui/hm7.js';

export function roadmapList() {
  return h('ul', { class: 'road-list', role: 'list' }, SERVICES.filter(s => !isLive(s)).map(s =>
    h('li', { class: 'road-item' }, h('span', { class: 'road-item__ico', 'aria-hidden': 'true' }, icon(s.icon)),
      h('span', { class: 'road-item__body' }, h('b', { text: s.title }), h('span', { text: s.blurb })),
      h('span', { class: 'cm-badge cm-badge--warn', text: 'به زودی' }))));
}

export function createServicesView(ctx) {
  const { actions } = ctx;
  const root = h('div', { class: 'view view--services' });
  const live = SERVICES.filter(isLive);
  root.append(
    h('header', { class: 'view__head' }, h('h1', { class: 'view__title', text: 'سرویس ها' }), h('p', { class: 'view__sub', text: 'آنچه امروز کار می کند و آنچه هنوز ساخته نشده است.' })),
    h('section', { 'aria-labelledby': 'svc-live' }, h('h2', { class: 'section-title', id: 'svc-live', text: 'در دسترس' }),
      h('div', { class: 'svc-grid' }, live.map(s => h('article', { class: 'cm-card cm-wash svc-card rv' },
        h('span', { class: 'svc-card__ico', 'aria-hidden': 'true' }, icon(s.icon)),
        h('div', { class: 'svc-card__body' }, h('h3', { text: s.title }), h('p', { text: s.blurb })),
        h('button', { class: 'cm-btn cm-btn--ghost cm-btn--sm el', type: 'button', onClick: () => actions.serviceAction(s) }, 'باز کردن'))))),
    h('section', { 'aria-labelledby': 'svc-soon' }, h('h2', { class: 'section-title', id: 'svc-soon', text: 'هنوز ساخته نشده' }),
      h('div', { class: 'cm-card road-card' }, roadmapList(),
        h('p', { class: 'road-note', text: 'برای هیچ یک از این ها زمان یا وعده ای اعلام نشده است و در این برنامه چیزی ساختگی نشان داده نمی شود.' }))));
  return { el: root, mount() { init(root); }, toastSoon: s => toast({ title: s.title, text: 'این بخش هنوز ساخته نشده است.', icon: 'info_circle_fill' }) };
}
