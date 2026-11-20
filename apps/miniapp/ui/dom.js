// DOM helpers. Everything is built with createElement/textContent: no innerHTML, so station names and API
// strings can never become markup, and no inline style attributes are ever produced (CSP).

export function h(tag, attrs, ...children) {
  const node = document.createElement(tag);
  apply(node, attrs);
  append(node, children);
  return node;
}

export function apply(node, attrs = {}) {
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'style') throw new Error('inline styles are blocked by the CSP; use a class');
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  return node;
}

export function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const icon = (name, className = '') => h('i', { class: ['hms', `hms-${name}`, className], 'aria-hidden': 'true' });
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
export const focusables = root => $$(FOCUSABLE, root).filter(el => !el.closest('[hidden], [inert]') && el.getClientRects().length > 0);

// Keeps Tab inside `container` while it is open (dialogs).
export function trapFocus(container) {
  const onKey = event => {
    if (event.key !== 'Tab') return;
    const items = focusables(container);
    if (!items.length) { event.preventDefault(); container.focus(); return; }
    const first = items[0], last = items[items.length - 1], active = document.activeElement;
    if (event.shiftKey && (active === first || !container.contains(active))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (active === last || !container.contains(active))) { event.preventDefault(); first.focus(); }
  };
  container.addEventListener('keydown', onKey);
  return () => container.removeEventListener('keydown', onKey);
}

export const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// One back control for every page and detail panel: a 44px round button with the RTL back arrow (points right).
export function backButton(label, onClick) {
  return h('button', { type: 'button', class: 'cm-icon-btn view-back', 'aria-label': label, onClick }, icon('arrow_right'));
}
// Inside a page (detail -> results) the way back is a labelled link, so it never looks like a second page-level back button.
export function backLink(label, onClick) {
  return h('button', { type: 'button', class: 'back-link', 'aria-label': label, onClick }, icon('arrow_right'), label);
}
