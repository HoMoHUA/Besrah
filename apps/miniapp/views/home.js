// Home: hero carousel (real data only) -> lamp tiles (services) -> honest info card -> line-1 station rail.
import { buildSlides } from '../hero.js';
import { fa } from '../format.js';
import { homeLayout, isLive } from '../services.js';
import { createCarousel } from '../ui/carousel.js';
import { h, icon, reducedMotion } from '../ui/dom.js';
import { init, toast } from '../ui/hm7.js';

const RAMP_FROM = [63, 170, 164], RAMP_TO = [215, 255, 99];
const tintAt = t => RAMP_FROM.map((v, i) => Math.round(v + (RAMP_TO[i] - v) * t)).join(', ');

export function createHomeView(ctx) {
  const { state, actions } = ctx;
  const root = h('div', { class: 'view view--home' });

  /* ── hero ── */
  const track = h('div', { class: 'hero__track', tabindex: '0', role: 'group', 'aria-label': 'اطلاعات اصلی' });
  const dotsHost = h('div', { class: 'hero__dots hm7-glass', role: 'tablist', 'aria-label': 'انتخاب اسلاید' });
  const pause = h('button', { class: 'hero__pause hm7-glass hm7-press', type: 'button' });
  const art = h('img', { class: 'hero__art', src: 'assets/hero-metro.svg', alt: '', width: '240', height: '200', decoding: 'async' });
  const hero = h('section', { class: 'hero hm7-stage', 'aria-roledescription': 'carousel', 'aria-label': 'قطار بعدی و توضیح زمان ها' },
    art, track, h('div', { class: 'hero__controls' }, dotsHost, pause));
  const carousel = createCarousel({ track, dotsHost, pauseButton: pause });

  function slideEl(data, i, total) {
    const actionsRow = h('div', { class: 'hero__actions' });
    if (data.action) {
      actionsRow.append(h('button', {
        class: 'hm7-btn hm7-btn--primary hm7-press hero__cta', type: 'button', dataset: { action: data.action.id },
        onClick: () => actions.heroAction(data.action),
      }, data.action.label));
    }
    return h('article', { class: ['hero__slide', `hero__slide--${data.state}`], role: 'group', 'aria-roledescription': 'slide', 'aria-label': `${fa(i + 1)} از ${fa(total)}`, 'aria-busy': String(data.busy), dataset: { id: data.id } },
      h('div', { class: 'hero__copy' },
        h('p', { class: 'hero__kicker', text: data.kicker }),
        h('h2', { class: 'hero__title', text: data.title }),
        data.lines.map(line => h('p', { class: 'hero__line', text: line })),
        data.meta && data.meta.split(' · ').map(part => h('p', { class: 'hero__meta', text: part })),
        actionsRow));
  }

  function paintHero() {
    const s = state.get();
    const slides = buildSlides({ locate: { ...s.nearest, maxKm: s.maxKm }, recent: s.recent, asOf: s.asOf });
    const focusedAction = document.activeElement?.closest?.('.hero__slide')?.dataset.id;
    const existing = new Map([...track.children].map(el => [el.dataset.id, el]));
    const elements = slides.map((data, i) => slideEl(data, i, slides.length));
    // keep the current slide in place when its siblings change
    const sameShape = existing.size === slides.length && slides.every(d => existing.has(d.id));
    if (sameShape) slides.forEach((data, i) => { existing.get(data.id).replaceWith(elements[i]); });
    const currentId = [...track.children][carousel.index]?.dataset.id;
    if (sameShape) carousel.setSlides([...track.children]); else {
      carousel.setSlides(elements);
      const keep = slides.findIndex(d => d.id === currentId);
      if (keep > 0) carousel.goTo(keep);
    }
    if (focusedAction) track.querySelector(`.hero__slide[data-id="${focusedAction}"] .hero__cta`)?.focus({ preventScroll: true });
    init(hero);
  }

  /* ── services (lamps) ── */
  const layout = homeLayout();
  function lamp(service, { small = false } = {}) {
    const live = isLive(service);
    const tile = h('button', {
      class: ['hm7-glass', live && 'hm7-press', 'hm7-cc-btn', 'lamp__tile', small && 'lamp__tile--small', !live && 'is-soon'],
      type: 'button', 'aria-label': live ? service.title : `${service.title}، به زودی`, 'aria-disabled': live ? null : 'true',
      dataset: { service: service.id }, 'data-hm7-tint': service.tint,
      onClick: () => (live ? actions.serviceAction(service) : toast({ title: service.title, text: 'این بخش هنوز ساخته نشده است.', icon: 'info_circle_fill', life: 3200 })),
    }, icon(service.icon, 'lamp__icon'), !live && h('span', { class: 'cm-badge cm-badge--warn lamp__badge', text: 'به زودی' }));
    return h('div', { class: ['lamp', small && 'lamp--small'] }, tile, h('span', { class: 'lamp__label', 'aria-hidden': 'true', onClick: () => tile.click(), text: service.title }));
  }
  const moreTile = h('button', { class: 'hm7-glass hm7-press hm7-cc-btn lamp__tile lamp__tile--small lamp__more', type: 'button', 'aria-haspopup': 'dialog', 'aria-label': `${fa(layout.moreCount)} سرویس دیگر در برنامه`, onClick: () => actions.openRoadmap() },
    h('bdi', { class: 'lamp__more-num cm-num', dir: 'ltr', text: `+${fa(layout.moreCount)}` }));
  const lamps = h('section', { class: 'lamps hm7-stage', 'aria-labelledby': 'lamps-title' },
    h('h2', { class: 'cm-sr', id: 'lamps-title', text: 'سرویس ها' }),
    h('div', { class: 'lamps__row lamps__row--primary' }, layout.primary.map(s => lamp(s))),
    h('div', { class: 'lamps__row lamps__row--secondary' }, layout.secondary.map(s => lamp(s, { small: true })),
      h('div', { class: 'lamp lamp--small' }, moreTile, h('span', { class: 'lamp__label', 'aria-hidden': 'true', onClick: () => moreTile.click(), text: 'بیشتر' }))));

  /* ── how estimates work (honest card, no promotion) ── */
  const info = h('section', { class: 'cm-card cm-wash info-card', 'aria-labelledby': 'info-title' },
    h('div', { class: 'info-card__art', 'aria-hidden': 'true' }, icon('calendar_badge_clock')),
    h('div', { class: 'info-card__body' },
      h('h2', { id: 'info-title', class: 'info-card__title', text: 'زمان ها چگونه برآورد می شوند؟' }),
      h('p', { text: 'بسراه موقعیت زندهٔ قطارها را ندارد. زمان رسیدن از برنامهٔ حرکت و زمان سفر بین ایستگاه ها محاسبه می شود؛ تأخیر یا اختلال ممکن است در آن دیده نشود.' }),
      h('p', { text: 'کنار هر تابلو ساعت سرور به وقت تهران نوشته شده است.' }),
      h('button', { class: 'cm-btn cm-btn--ghost cm-btn--sm el', type: 'button', onClick: () => actions.go('about') }, 'توضیح کامل')));

  /* ── line-1 rail ── */
  const rail = h('ul', { class: 'rail__row', role: 'list' });
  const railWrap = h('section', { class: 'rail', 'aria-labelledby': 'rail-title' },
    h('div', { class: 'section-head' }, h('span', { class: 'section-head__mark', 'aria-hidden': 'true' }), h('h2', { id: 'rail-title', text: 'ایستگاه های خط ۱' }),
      h('button', { class: 'section-head__more', type: 'button', onClick: () => actions.go('stations', { mode: 'line1' }) }, 'همهٔ ایستگاه ها', icon('chevron_left'))),
    h('div', { class: 'rail__scroller' }, rail));

  function paintRail() {
    const s = state.get();
    if (s.status === 'loading') {
      rail.replaceChildren(...Array.from({ length: 7 }, () => h('li', { class: 'station-chip station-chip--skeleton', 'aria-hidden': 'true' },
        h('span', { class: 'cm-skel station-chip__disc' }), h('span', { class: 'cm-skel cm-skel--line station-chip__skel-line' }))));
      return;
    }
    if (s.status === 'error') {
      rail.replaceChildren(h('li', { class: 'rail__error' }, h('div', { class: 'cm-card cm-empty' },
        h('div', { class: 'cm-empty__art' }, icon('wifi')), h('h3', { text: 'فهرست ایستگاه ها دریافت نشد' }),
        h('p', { text: 'اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.' }),
        h('button', { class: 'cm-btn cm-btn--sm el', type: 'button', onClick: () => actions.reload() }, icon('arrow_clockwise'), 'تلاش دوباره'))));
      return;
    }
    const byName = new Map(s.stations.map(st => [st.name, st]));
    const order = s.order.filter(n => byName.has(n));
    rail.replaceChildren(...order.map((name, i) => {
      const station = byName.get(name);
      const inter = station.lines.some(l => l !== 1);
      const btn = h('button', { class: ['station-chip', inter && 'is-interchange'], type: 'button', dataset: { name }, onClick: () => actions.openStation(name) },
        h('span', { class: 'station-chip__disc', 'aria-hidden': 'true' }, h('span', { class: 'station-chip__num cm-num', text: fa(i + 1) })),
        h('span', { class: 'station-chip__name' }, name, inter && h('span', { class: 'cm-sr', text: '، تقاطع با خط ۲' })));
      btn.style.setProperty('--tint', tintAt(order.length > 1 ? i / (order.length - 1) : 0));
      return h('li', {}, btn);
    }));
    init(rail);
  }

  root.append(hero, lamps, info, railWrap);
  paintHero(); paintRail();
  state.subscribe(['nearest', 'recent', 'asOf', 'maxKm'], paintHero);
  state.subscribe(['status', 'stations', 'order'], paintRail);

  return {
    el: root,
    mount() {
      init(root);
    },
    focusHero() { carousel.goTo(0); hero.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }); },
    onShow() { carousel.arm(); },
  };
}
