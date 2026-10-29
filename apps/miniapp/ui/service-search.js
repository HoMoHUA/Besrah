// Global search is intentionally product-only; station search belongs to the metro product.
import { filterServices, isLive } from '../services.js';
import { h } from './dom.js';
import { serviceLogo } from './service-card.js';
export function createServiceSearch({ host, input, clearButton, popup, listbox, live, onPick }) {
  let options = [], active = -1;
  const close = () => { popup.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; };
  function run() {
    const found = filterServices(input.value);
    clearButton.hidden = !input.value;
    options = found.map((s, i) => h('button', { type: 'button', class: 'search-option', role: 'option', tabindex: -1, id: `service-opt-${i}`, 'aria-selected': 'false', dataset: { service: s.id },
      onClick: () => { close(); input.blur(); input.value = ''; clearButton.hidden = true; onPick(s); } },
      serviceLogo(s), h('span', { class: 'search-option__name' }, h('strong', { text: s.title }), h('small', { text: s.subtitle })), !isLive(s) && h('span', { class: 'cm-badge', text: 'به زودی' })));
    listbox.replaceChildren(...(options.length ? options : [h('p', { class: 'search-empty', text: 'سرویسی با این نام پیدا نشد.' })]));
    active = -1; input.removeAttribute('aria-activedescendant');
    popup.hidden = false; input.setAttribute('aria-expanded', 'true'); live.textContent = options.length ? 'سرویس های پیشنهادی' : 'نتیجه ای پیدا نشد';
  }
  input.addEventListener('focus', run);
  input.addEventListener('input', run);
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (popup.hidden) run(); if (!options.length) return;
      active = active < 0 ? (e.key === 'ArrowDown' ? 0 : options.length - 1) : (active + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      options.forEach((o,i) => o.setAttribute('aria-selected', String(i === active)));
      input.setAttribute('aria-activedescendant', options[active].id); options[active].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && !popup.hidden && options.length) { e.preventDefault(); options[Math.max(0,active)].click(); }
  });
  clearButton.addEventListener('click', () => { input.value = ''; input.focus(); run(); });
  popup.addEventListener('pointerdown', e => e.preventDefault());
  document.addEventListener('pointerdown', e => { if (!host.contains(e.target)) close(); });
  host.addEventListener('focusout', e => { if (!host.contains(e.relatedTarget)) close(); });
  return { close };
}
