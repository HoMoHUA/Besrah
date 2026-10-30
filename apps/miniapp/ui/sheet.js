// Bottom sheet host: .cm-sheet over a .cm-scrim, role=dialog, focus trap, focus return, and Escape / scrim /
// Back (history pop or Telegram BackButton) to close. One sheet at a time; its content can be swapped.
import { h, focusables, reducedMotion, trapFocus } from './dom.js';
import { springEasing } from './hm7.js';

export function createSheetHost({ root, appEl, onChange = () => {} }) {
  let layer = null, dialog = null, scrim = null, release = null, opener = null, exiting = null, pushed = false, closedCb = null;

  const snapshots = new Map();
  let sequence = 0, currentEntry = null, restoring = null, focusResolver = null;

  const flag = open => {
    document.documentElement.classList.toggle('has-sheet', open);
    if (open) appEl.setAttribute('inert', ''); else appEl.removeAttribute('inert');
    onChange(open);
  };

  function open(content, { labelledBy, onClosed, onRestore, returnFocus, initialFocus = document.activeElement } = {}) {
    if (layer) {
      swap(content, labelledBy); closedCb = onClosed ?? closedCb;
      snapshots.set(currentEntry, { content: onRestore ? null : content, labelledBy, onClosed: closedCb, onRestore });
      return api;
    }
    exiting?.();                       // a sheet still sliding out must not delay the next one
    opener = initialFocus;
    focusResolver = returnFocus ?? null;
    scrim = h('div', { class: 'cm-scrim sheet-scrim', 'data-close': '' });
    dialog = h('section', { class: 'cm-sheet app-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': labelledBy, tabindex: '-1' }, content);
    layer = h('div', { class: 'sheet-layer' }, scrim, dialog);
    closedCb = onClosed ?? null;
    root.append(layer);
    flag(true);
    currentEntry = restoring ?? ++sequence;
    snapshots.set(currentEntry, { content: onRestore ? null : content, labelledBy, onClosed, onRestore });
    if (restoring !== null) pushed = true;
    else {
      try { history.pushState({ ...history.state, besrahSheet: currentEntry }, ''); pushed = true; } catch { pushed = false; }
    }
    release = trapFocus(dialog);
    layer.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } });
    scrim.addEventListener('click', () => close());
    animateIn();
    focusInitial();
    return api;
  }

  function swap(content, labelledBy) {
    dialog.replaceChildren(content);
    if (labelledBy) dialog.setAttribute('aria-labelledby', labelledBy);
    focusInitial();
  }

  function focusInitial() {
    const target = dialog.querySelector('[data-autofocus]') ?? focusables(dialog)[0] ?? dialog;
    target.focus({ preventScroll: true });
  }

  function animateIn() {
    if (!dialog.animate) return;
    if (reducedMotion()) { dialog.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180 }); scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180 }); return; }
    const spring = springEasing(260, 26);
    dialog.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: spring?.duration ?? 420, easing: spring?.easing ?? 'cubic-bezier(.22,1,.36,1)' });
    scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
  }

  function close() {
    if (!layer) return;
    if (pushed && history.state?.besrahSheet) {
      history.back();                                // popstate -> finish()
      setTimeout(() => { if (layer) finish(); }, 450); // the entry was already gone: never leave the sheet stuck
    } else finish();
  }

  function finish() {
    if (!layer) return;
    const gone = layer, back = opener, cb = closedCb, resolveBack = focusResolver;
    layer = null; pushed = false; closedCb = null; focusResolver = null; currentEntry = null;
    release?.(); release = null;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true; exiting = null;
      gone.remove();
      flag(false);
      const target = resolveBack?.() ?? back;
      if (target?.isConnected) target.focus({ preventScroll: true });
      cb?.();
    };
    const sheetEl = gone.querySelector('.app-sheet');
    if (!sheetEl.animate) return done();
    exiting = done;
    if (reducedMotion()) { sheetEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: 'forwards' }).onfinish = done; gone.querySelector('.sheet-scrim').animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: 'forwards' }); return; }
    sheetEl.animate([{ transform: 'none' }, { transform: 'translateY(100%)' }], { duration: 220, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }).onfinish = done;
    gone.querySelector('.sheet-scrim').animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' });
  }

  // Any history move while a sheet is open (Back, Android back, Telegram BackButton) leaves its entry.
  window.addEventListener('popstate', event => {
    const entry = event.state?.besrahSheet;
    if (entry) {
      if (layer && currentEntry === entry) return;
      const snapshot = snapshots.get(entry);
      if (!snapshot) return;
      if (layer) finish();
      exiting?.();
      restoring = entry;
      try {
        if (snapshot.onRestore) snapshot.onRestore();
        else open(snapshot.content, snapshot);
      } finally { restoring = null; }
    } else if (layer) finish();
  });

  const api = { open, close, get isOpen() { return Boolean(layer); }, get element() { return dialog; } };
  return api;
}
