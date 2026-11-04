// Two-tab switcher shared by the pairs of views that form one service (Besrah: metro and bus | place to place).
// Tabs replace the current history entry instead of stacking a new one, so Back still leaves the service.
import { h } from './dom.js';

export const TRANSPORT_TABS = [['metro', 'مترو و اتوبوس'], ['trip', 'مسیر مکان به مکان']];

export function segmented({ tabs, active, label, onSelect }) {
  const root = h('div', { class: 'seg', role: 'tablist', 'aria-label': label });
  for (const [id, text] of tabs) {
    const on = id === active;
    root.append(h('button', { type: 'button', role: 'tab', class: ['seg__tab', on && 'is-on'], 'aria-selected': String(on), tabindex: on ? '0' : '-1', dataset: { tab: id },
      onClick: () => { if (!on) onSelect(id); } }, text));
  }
  root.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const index = tabs.findIndex(([id]) => id === active), next = tabs[(index + (event.key === 'ArrowLeft' ? 1 : -1) + tabs.length) % tabs.length];
    if (next) onSelect(next[0]);
  });
  return root;
}
