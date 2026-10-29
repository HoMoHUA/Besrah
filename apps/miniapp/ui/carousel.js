// Scroll-snap carousel with dots and an optional, polite auto-advance (>= 6 s). It never advances while the
// pointer or focus is inside, after a touch, when the tab is hidden, when it is off screen, when the user
// paused it, or when the user asks for reduced motion.
import { h, icon, reducedMotion } from './dom.js';

const AUTO_MS = 7000;

export function createCarousel({ track, dotsHost, pauseButton, label = 'اسلاید', onChange = () => {} }) {
  let slides = [], dots = [], index = 0, timer = 0, userPaused = false, hover = false, focus = false, touching = false, visible = true, holdUntil = 0;
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      const i = slides.indexOf(entry.target);
      if (i >= 0 && entry.isIntersecting && entry.intersectionRatio >= 0.6) setIndex(i, false);
    }
  }, { root: track, threshold: [0.6] }) : null;
  const viewObserver = 'IntersectionObserver' in window ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; arm(); }, { threshold: 0.3 }) : null;
  viewObserver?.observe(track);

  function setIndex(i, scroll = true) {
    if (i === index && !scroll) return;
    index = i;
    dots.forEach((dot, k) => { dot.setAttribute('aria-selected', String(k === i)); dot.tabIndex = k === i ? 0 : -1; });
    if (scroll) scrollToSlide(i);
    onChange(i);
  }

  function scrollToSlide(i, smooth = !reducedMotion()) {
    const slide = slides[i];
    if (!slide) return;
    const left = slide.getBoundingClientRect().left - track.getBoundingClientRect().left + track.scrollLeft;
    track.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
  }

  const canRun = () => !userPaused && !hover && !focus && !touching && visible && slides.length > 1 && !reducedMotion()
    && document.visibilityState === 'visible' && performance.now() >= holdUntil;
  function arm() {
    clearInterval(timer); timer = 0;
    if (canRun()) timer = setInterval(() => { if (canRun()) setIndex((index + 1) % slides.length); }, AUTO_MS);
  }

  track.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') { hover = true; arm(); } });
  track.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { hover = false; arm(); } });
  track.addEventListener('focusin', () => { focus = true; arm(); });
  track.addEventListener('focusout', () => { focus = false; arm(); });
  track.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') { touching = true; holdUntil = performance.now() + 12000; arm(); } });
  const release = () => { touching = false; arm(); };
  track.addEventListener('pointerup', release); track.addEventListener('pointercancel', release);
  document.addEventListener('visibilitychange', arm);
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', arm);

  function paintPause() {
    if (!pauseButton) return;
    pauseButton.setAttribute('aria-pressed', String(userPaused));
    pauseButton.setAttribute('aria-label', userPaused ? 'ادامهٔ پخش خودکار اسلایدها' : 'توقف پخش خودکار اسلایدها');
    pauseButton.replaceChildren(icon(userPaused ? 'play_fill' : 'pause'));
    pauseButton.hidden = slides.length < 2 || reducedMotion();
  }
  pauseButton?.addEventListener('click', () => { userPaused = !userPaused; paintPause(); arm(); });

  function setSlides(elements) {
    slides.forEach(s => io?.unobserve(s));
    slides = elements;
    track.replaceChildren(...slides);
    index = Math.min(index, Math.max(0, slides.length - 1));
    dots = slides.map((_, k) => h('button', { class: 'hero__dot', type: 'button', role: 'tab', 'aria-label': `${label} ${k + 1} از ${slides.length}`, 'aria-selected': String(k === index), tabindex: k === index ? '0' : '-1', onClick: () => { holdUntil = performance.now() + 12000; setIndex(k); arm(); } },
      h('span', { class: 'hero__dot-mark', 'aria-hidden': 'true' })));
    dotsHost.replaceChildren(...dots);
    dotsHost.hidden = slides.length < 2;
    slides.forEach(s => io?.observe(s));
    paintPause(); arm();
    scrollToSlide(index, false);
  }

  dotsHost.addEventListener('keydown', event => {
    const next = event.key === 'ArrowLeft' ? 1 : event.key === 'ArrowRight' ? -1 : 0;   // RTL: left = forward
    if (!next) return;
    event.preventDefault();
    const target = (index + next + slides.length) % slides.length;
    setIndex(target); dots[target]?.focus();
  });

  return { setSlides, goTo: i => setIndex(i), get index() { return index; }, get count() { return slides.length; }, arm };
}
