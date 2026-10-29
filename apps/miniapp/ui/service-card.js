// Service branding and availability have one presentation across discovery and saved products.
import { isLive } from '../services.js';
import { h, icon } from './dom.js';
export const serviceLogo = (service, className = '') => h('img', { class: ['service-logo', className], src: service.logo, alt: '', width: 120, height: 120 });
export function serviceCard(service, { actions, serviceStore }) {
  const live = isLive(service);
  const heart = h('button', { class: 'service-save cm-icon-btn', type: 'button', 'aria-label': `ذخیره ${service.title}`, 'aria-pressed': String(serviceStore.has(service.id)), onClick: () => { serviceStore.toggle(service.id); paint(); } });
  const paint = () => { const saved = serviceStore.has(service.id); heart.setAttribute('aria-pressed', String(saved)); heart.setAttribute('aria-label', `${saved ? 'حذف' : 'ذخیره'} ${service.title}`); heart.replaceChildren(icon(saved ? 'heart_fill' : 'heart')); };
  paint();
  const card = h('article', { class: ['service-card', !live && 'is-planned'], dataset: { product: service.id } },
    serviceLogo(service),
    h('div', { class: 'service-card__copy' }, h('h2', { text: service.title }), h('p', { class: 'service-card__subtitle', text: service.subtitle }), h('p', { class: 'service-card__blurb', text: service.blurb })),
    heart,
    h('div', { class: 'service-card__actions' },
      h('button', { type: 'button', class: live ? 'cm-btn cm-btn--sm' : 'cm-btn cm-btn--ghost cm-btn--sm', 'aria-disabled': live ? null : 'true', onClick: () => actions.serviceAction(service), text: live ? 'باز کردن' : 'به زودی' })));
  card.syncSave = paint;
  return card;
}
