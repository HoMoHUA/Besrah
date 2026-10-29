import { SERVICES, isLive } from '../services.js';
import { h } from '../ui/dom.js';
import { serviceCard, serviceLogo } from '../ui/service-card.js';
export function roadmapList() {
  return h('ul', { class: 'road-list', role: 'list' }, SERVICES.filter(s => !isLive(s)).map(s =>
    h('li', { class: 'road-item' }, serviceLogo(s), h('span', { class: 'road-item__body' }, h('b', { text: s.title }), h('span', { text: s.blurb })), h('span', { class: 'cm-badge', text: 'به زودی' }))));
}
export function createServicesView(ctx) {
  const root = h('div', { class: 'view view--services' });
  root.append(h('header', { class: 'view__head' }, h('p', { class: 'eyebrow', text: 'راه های جابه جایی' }), h('h1', { class: 'view__title', text: 'همه سرویس ها' }), h('p', { class: 'view__sub', text: 'یک انتخاب برای هر بخش از مسیر شما.' })),
    h('div', { class: 'service-catalog' }, SERVICES.map(s => serviceCard(s, ctx))));
  ctx.serviceStore.subscribe(() => root.querySelectorAll('.service-card').forEach(card => card.syncSave()));
  return { el: root };
}
