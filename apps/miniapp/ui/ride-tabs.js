// Shared switch between the two Besrah ride products: metro and bus.
import { h } from './dom.js';
export function createRideTabs(active, actions) {
  const tab = (view, label) => h('button', { type: 'button', class: ['ride-tab', view === active && 'is-active'], 'aria-current': view === active ? 'page' : 'false',
    dataset: { ride: view }, onClick: () => { if (view !== active) actions.go(view); } }, label);
  return h('nav', { class: 'ride-tabs', dataset: { active }, 'aria-label': 'بخش های بسراه' }, tab('metro', 'مترو'), tab('bus', 'اتوبوس'));
}
