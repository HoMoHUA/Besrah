// Bottom sheet host: .cm-sheet over a .cm-scrim, role=dialog, focus trap, focus return, and Escape / scrim /
// Back (history pop or Telegram BackButton) to close. One sheet at a time; its content can be swapped.
// Pages can be stacked inside the open sheet (push / pop, e.g. bus line -> stop): each page slides in from the reading
// start, has its own history entry so Back (Android, Telegram, browser) returns one page, and close leaves them all.
import { h, focusables, reducedMotion, trapFocus } from './dom.js';
import { springEasing } from './hm7.js';

export function createSheetHost({ root, appEl, onChange = () => {} }) {
  let layer = null, dialog = null, scrim = null, release = null, opener = null, exiting = null, pushed = false, closedCb = null;
  let stage = null, pages = [];   // stacked pages; pages[0] is the content the sheet opened with

  const snapshots = new Map();
  let sequence = 0, currentEntry = null, restoring = null, focusResolver = null;

  const flag = open => {
    document.documentElement.classList.toggle('has-sheet', open);
    if (open) appEl.setAttribute('inert', ''); else appEl.removeAttribute('inert');
    onChange(open);
  };

  function open(content, { labelledBy, onClosed, onRestore, returnFocus, initialFocus = document.activeElement, stacked = false } = {}) {
    if (layer) {
      swap(content, labelledBy); closedCb = onClosed ?? closedCb;
      snapshots.set(currentEntry, { content: onRestore ? null : content, labelledBy, onClosed: closedCb, onRestore });
      return api;
    }
    exiting?.();                       // a sheet still sliding out must not delay the next one
    opener = initialFocus;
    focusResolver = returnFocus ?? null;
    scrim = h('div', { class: 'cm-scrim sheet-scrim', 'data-close': '' });
    dialog = h('section', { class: ['cm-sheet', 'app-sheet', stacked && 'is-stacked'], role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': labelledBy, tabindex: '-1' }, content);
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
    leaveAll();
    dialog.replaceChildren(content);
    if (labelledBy) dialog.setAttribute('aria-labelledby', labelledBy);
    focusInitial();
  }

  function focusInitial(scope = dialog) {
    const target = scope.querySelector('[data-autofocus]') ?? focusables(scope)[0] ?? dialog;
    target.focus({ preventScroll: true });
  }

  // ── stacked pages ──
  function leaveAll() {
    for (const page of pages) page.onLeave?.();
    pages = []; stage = null;
  }
  // Forward: the new page enters from the reading start (the left in RTL) and the old one eases back a little;
  // back is the mirror. Reduced motion: a short crossfade. Without the Web Animations API: no animation.
  function slide(incoming, outgoing, forward, done) {
    if (!incoming.animate) return done();
    if (reducedMotion()) {
      if (forward) incoming.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 }).onfinish = done;
      else outgoing.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }).onfinish = done;
      return;
    }
    const s = document.documentElement.getAttribute('dir') === 'ltr' ? 1 : -1;   // the side a new page comes from
    const spring = springEasing(300, 30);
    const timing = forward ? { duration: spring?.duration ?? 380, easing: spring?.easing ?? 'cubic-bezier(.22,1,.36,1)' } : { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' };
    const away = `translateX(${-s * 28}%)`, offstage = `translateX(${s * 100}%)`;
    if (forward) {
      incoming.animate([{ transform: offstage }, { transform: 'none' }], timing).onfinish = done;
      outgoing.animate([{ transform: 'none', opacity: 1 }, { transform: away, opacity: 0.5 }], timing);
    } else {
      outgoing.animate([{ transform: 'none' }, { transform: offstage }], { ...timing, fill: 'forwards' }).onfinish = done;
      incoming.animate([{ transform: away, opacity: 0.5 }, { transform: 'none', opacity: 1 }], timing);
    }
  }
  function push(content, { labelledBy, onLeave } = {}) {
    if (!layer) return false;
    if (!stage) {
      const first = dialog.firstElementChild;
      stage = h('div', { class: 'sheet-stage' });
      dialog.replaceChildren(stage);
      if (first) stage.append(first);
      pages = [{ el: first, labelledBy: dialog.getAttribute('aria-labelledby') }];
      dialog.classList.add('is-stacked');
    }
    const from = pages[pages.length - 1];
    from.focus = document.activeElement;
    pages.push({ el: content, labelledBy, onLeave });
    stage.append(content);
    from.el?.setAttribute('inert', ''); from.el?.setAttribute('aria-hidden', 'true');
    if (labelledBy) dialog.setAttribute('aria-labelledby', labelledBy);
    slide(content, from.el ?? content, true, () => { if (pages.includes(from)) from.el?.classList.add('is-behind'); });
    if (pushed) { try { history.pushState({ ...history.state, besrahSheet: currentEntry, besrahSheetPage: pages.length - 1 }, ''); } catch { /* history unavailable: Back closes the sheet */ } }
    focusInitial(content);
    return true;
  }
  function popPage() {
    if (pages.length < 2) return;
    const gone = pages.pop(), back = pages[pages.length - 1];
    gone.onLeave?.();
    gone.el.setAttribute('inert', '');
    back.el?.classList.remove('is-behind'); back.el?.removeAttribute('inert'); back.el?.removeAttribute('aria-hidden');
    if (back.labelledBy) dialog.setAttribute('aria-labelledby', back.labelledBy);
    slide(back.el ?? gone.el, gone.el, false, () => gone.el.remove());
    if (back.focus?.isConnected && back.el?.contains(back.focus)) back.focus.focus({ preventScroll: true });
    else if (back.el) focusInitial(back.el);
  }
  // In-sheet back button: through history when the page has its own entry, so Back and this button stay in step.
  function pop() {
    if (!layer || pages.length < 2) return false;
    if (pushed && history.state?.besrahSheet === currentEntry && history.state?.besrahSheetPage === pages.length - 1) history.back();
    else popPage();
    return true;
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
      const depth = Number.isInteger(history.state.besrahSheetPage) ? history.state.besrahSheetPage : 0;
      history.go(-(depth + 1));                      // past every stacked page; popstate -> finish()
      setTimeout(() => { if (layer) finish(); }, 450); // the entry was already gone: never leave the sheet stuck
    } else finish();
  }

  function finish() {
    if (!layer) return;
    const gone = layer, back = opener, cb = closedCb, resolveBack = focusResolver;
    layer = null; pushed = false; closedCb = null; focusResolver = null; currentEntry = null;
    leaveAll();
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
      if (layer && currentEntry === entry) {
        // Back inside a stacked sheet returns one page (or several after history.go); the sheet stays open.
        const depth = Number.isInteger(event.state.besrahSheetPage) ? event.state.besrahSheetPage : 0;
        while (pages.length - 1 > depth) popPage();
        return;
      }
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

  const api = { open, close, push, pop, get depth() { return Math.max(0, pages.length - 1); }, get isOpen() { return Boolean(layer); }, get element() { return dialog; } };
  return api;
}
