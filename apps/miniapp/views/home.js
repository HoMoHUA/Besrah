// A product-neutral landing page. Product detail belongs behind its own service card.
import { homeLayout, isLive } from '../services.js';
import { h, icon } from '../ui/dom.js';
import { serviceLogo } from '../ui/service-card.js';

export function createHomeView({ actions }) {
  const root = h('div', { class: 'view view--home' });
  const layout = homeLayout();
  const tile = (service, small = false) => h('button', {
    type: 'button', class: ['product-tile', small && 'product-tile--small', !isLive(service) && 'is-planned'],
    dataset: { service: service.id }, 'aria-disabled': isLive(service) ? null : 'true',
    'aria-label': `${service.title}، ${service.subtitle}${isLive(service) ? '' : '، به زودی'}`,
    onClick: () => actions.serviceAction(service),
  }, h('span', { class: 'product-tile__art' }, serviceLogo(service), !isLive(service) && h('span', { class: 'product-tile__badge', text: 'به زودی' })),
  h('strong', { class: 'product-tile__name', text: service.title }), h('span', { class: 'product-tile__subtitle', text: service.subtitle }));
  const shortcut = (label, ico, target) => h('button', { class: 'product-tile product-tile--small product-shortcut', type: 'button', onClick: () => actions.go(target) },
    h('span', { class: 'product-tile__art' }, icon(ico)), h('strong', { class: 'product-tile__name', text: label }));
  root.append(
    h('div', { class: 'home-greeting' }, h('div', {}, h('p', { class: 'eyebrow', text: 'بِسراه · مشهد' }), h('h1', { text: 'امروز، کجا می روید؟' })), icon('location_north_up_right_circle_fill')),
    h('section', { class: 'brand-banner', 'aria-labelledby': 'brand-title' },
      h('div', { class: 'brand-banner__copy' }, h('p', { class: 'brand-banner__kicker', text: 'یک شهر، راه های تازه' }),
        h('h2', { id: 'brand-title' }, 'همراه مسیر', h('br'), 'شما در مشهد'),
        h('button', { class: 'brand-banner__link', type: 'button', onClick: () => actions.go('services') }, 'سرویس ها را ببینید', icon('arrow_left'))),
      h('img', { class: 'brand-banner__art', src: 'assets/hero-brand.svg', alt: '', width: 480, height: 220 })),
    h('section', { class: 'product-panel', 'aria-labelledby': 'products-title' },
      h('div', { class: 'section-head' }, h('h2', { id: 'products-title', text: 'سرویس های بِسراه' })),
      h('div', { class: 'product-row product-row--primary' }, layout.primary.map(s => tile(s))),
      h('div', { class: 'product-row product-row--secondary' }, layout.secondary.map(s => tile(s, true)), shortcut('ذخیره ها', 'heart', 'saved'), shortcut('همه سرویس ها', 'square_grid_2x2', 'services'))),
    h('button', { type: 'button', class: 'discovery-note', onClick: () => actions.go('about') },
      h('span', { class: 'discovery-note__icon' }, icon('star')),
      h('span', {}, h('strong', { text: 'بِسراه، قدم به قدم' }), h('span', { text: 'سرویس های تازه، وقتی آماده باشند.' })), icon('chevron_left')));
  return { el: root };
}
