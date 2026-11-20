// Snapp Pay results in بسپی (F6): an online product, a shop, and an in-store branch near the person with how to get there.
import { h } from './dom.js';
import { fa } from '../format.js';

const toman = v => `${Number(v).toLocaleString('fa-IR')} تومان`;
export const distanceText = m => (!Number.isFinite(m) ? '' : m < 1000 ? `${fa(Math.max(10, Math.round(m / 10) * 10))} متر` : `${(Math.round(m / 100) / 10).toLocaleString('fa-IR')} کیلومتر`);
const faDigits = t => String(t).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
const logo = (src, size = 40) => (typeof src === 'string' && /^https:\/\/(web-cdn\.snapp\.ir|image\.searchwise\.ir)\//.test(src)
  ? h('img', { class: 'spay-logo', src, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', width: size, height: size, onError: e => e?.target?.remove?.() }) : null);
const chips = list => (list?.length ? h('p', { class: 'tp-labels' }, list.map(t => h('span', { class: 'tp-label', text: t }))) : null);

export function productCard(p, { openLink }) {
  return h('article', { class: 'cm-card spay-prod' },
    h('div', { class: 'spay-prod__main' },
      p.image ? h('img', { class: 'spay-prod__img', src: p.image, alt: '', loading: 'lazy', width: 64, height: 64, referrerpolicy: 'no-referrer' }) : null,
      h('div', { class: 'spay-prod__text' },
        h('h3', { class: 'spay-prod__name', text: p.name }),
        h('p', { class: 'fd-card__sub', text: [p.merchant, p.sellers > 1 ? `${fa(p.sellers)} فروشنده` : null, p.freeShipping ? 'ارسال رایگان' : null, p.ad ? 'آگهی' : null].filter(Boolean).join(' · ') }))),
    h('p', { class: 'spay-prod__price' },
      Number.isInteger(p.priceToman) ? h('b', { text: toman(p.priceToman) }) : h('span', { text: 'قیمت نامشخص' }),
      p.oldPriceToman ? h('s', { text: toman(p.oldPriceToman) }) : null,
      p.discount ? h('span', { class: 'cm-badge', text: `${fa(p.discount)}٪ تخفیف` }) : null,
      p.cashback ? h('span', { class: 'cm-badge cm-badge--soft', text: `${fa(p.cashback)}٪ بازگشت وجه` }) : null),
    chips(p.payWays),
    p.link ? h('div', { class: 'fd-actions' }, h('button', { type: 'button', class: ['cm-btn', 'cm-btn--sm'], onClick: () => openLink(p.link) }, 'خرید در فروشگاه')) : null);
}

export function storeChip(s, { openLink }) {
  const label = [s.name, s.cashback ? `${fa(s.cashback)}٪ بازگشت وجه` : null, s.inStore ? 'حضوری' : null].filter(Boolean).join(' · ');
  return s.link ? h('button', { type: 'button', class: ['cm-chip', 'fd-chip', 'spay-chip'], onClick: () => openLink(s.link) }, logo(s.logo, 20), label) : h('span', { class: ['cm-chip', 'fd-chip', 'spay-chip'] }, logo(s.logo, 20), label);
}

/** One in-store branch: who, where, how far, when open, which payment ways, and «مسیر» into the trip planner. */
export function branchCard(b, { onRoute, canRoute }) {
  const where = b.nearest ?? b;
  return h('article', { class: 'cm-card spay-branch' },
    h('header', { class: 'fd-card__head' },
      logo(b.logo),
      h('div', { class: 'fd-card__title' }, h('h3', { text: b.name }), h('p', { class: 'fd-card__sub', text: [where.branch, where.city && !where.branch?.includes(where.city) ? where.city : null].filter(Boolean).join(' · ') })),
      Number.isFinite(where.distanceM) ? h('span', { class: 'cm-badge', text: distanceText(where.distanceM) }) : null),
    where.address ? h('p', { class: 'spay-branch__addr', text: faDigits(where.address) }) : null,
    where.hours ? h('p', { class: 'fd-card__sub', text: `ساعت کار: ${faDigits(where.hours)}` }) : null,
    chips([...(b.payWays ?? []), b.category].filter(Boolean)),
    h('div', { class: 'fd-actions' },
      Number.isFinite(where.lat) && canRoute(where) ? h('button', { type: 'button', class: ['cm-btn', 'cm-btn--sm'], onClick: () => onRoute(where, b) }, 'مسیر') : null,
      where.phone ? h('a', { class: ['cm-btn', 'cm-btn--ghost', 'cm-btn--sm'], href: `tel:${where.phone}` }, 'تماس') : null),
    !b.nearest && b.nearest !== undefined ? h('p', { class: 'fd-note', text: 'شعبهٔ نزدیک این فروشگاه پیدا نشد.' }) : null);
}
