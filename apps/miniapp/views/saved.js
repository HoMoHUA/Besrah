import { SERVICES } from '../services.js';
import { h, icon } from '../ui/dom.js';
import { serviceCard } from '../ui/service-card.js';
export function createSavedView(ctx) {
  const { serviceStore, actions } = ctx;
  const body = h('div', { class: 'service-catalog' });
  const root = h('div', { class: 'view view--saved' },
    h('header', { class: 'view__head' }, h('h1', { class: 'view__title', text: 'ذخیره ها' }), h('p', { class: 'view__sub', text: 'سرویس های دلخواه شما، روی همین دستگاه.' })), body);
  function paint() {
    const saved = SERVICES.filter(s => serviceStore.has(s.id));
    body.replaceChildren(...(saved.length ? saved.map(s => serviceCard(s, ctx)) : [h('div', { class: 'cm-card cm-empty saved-empty' }, icon('heart'), h('h2', { text: 'جای سرویس های دلخواه شما' }), h('p', { text: 'در صفحه سرویس ها، قلب کنار هر بخش را لمس کنید.' }), h('button', { type: 'button', class: 'cm-btn cm-btn--sm', text: 'دیدن سرویس ها', onClick: () => actions.go('services') }))]));
  }
  serviceStore.subscribe(paint); paint();
  return { el: root };
}
