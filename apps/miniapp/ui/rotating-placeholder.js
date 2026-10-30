// Animated phrases for the header search. The real placeholder stays for assistive tech; this overlay is decoration.
import { h } from './dom.js';
import { reducedMotion } from './dom.js';

export function rotatePlaceholder({ input, phrases, interval = 3400 }) {
  const field = input.closest('label') ?? input.parentElement;
  const layer = h('span', { class: 'search-ph', 'aria-hidden': 'true' });
  let index = 0, current = h('span', { text: phrases[0] });
  layer.append(current);
  field.append(layer);
  const place = () => {
    const f = field.getBoundingClientRect(), i = input.getBoundingClientRect(), rtl = getComputedStyle(field).direction === 'rtl';
    layer.style.insetInlineStart = (rtl ? f.right - i.right : i.left - f.left) + parseFloat(getComputedStyle(input).paddingInlineStart || '0') + 'px';
  };
  place();
  if ('ResizeObserver' in window) new ResizeObserver(place).observe(field);
  const sync = () => { layer.hidden = Boolean(input.value); };
  input.addEventListener('input', sync); sync();
  function swap() {
    if (document.hidden || layer.hidden || document.activeElement === input || phrases.length < 2) return;
    index = (index + 1) % phrases.length;
    const next = h('span', { text: phrases[index] }), old = current;
    layer.append(next); current = next;
    const move = reducedMotion() ? 0 : 9;
    next.animate([{ opacity: 0, transform: `translateY(${move}px)` }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' });
    old.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateY(${-move}px)` }], { duration: 320, easing: 'ease-in', fill: 'forwards' }).onfinish = () => old.remove();
  }
  return { timer: setInterval(swap, interval), swap };
}
