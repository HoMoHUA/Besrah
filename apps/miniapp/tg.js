// Thin, defensive wrapper over window.Telegram.WebApp. Outside Telegram (or with an old client) every call is a no-op.
const HEX = /^#[0-9a-fA-F]{6}$/;
const SELECTION = new Set(['tab', 'toggleOn', 'toggleOff', 'count', 'slide', 'snap', 'actions', 'dock']);
const IMPACT = new Set(['tap', 'tileOn', 'tileOff', 'add', 'drop', 'dissolve', 'sweep', 'morphOpen', 'morphClose']);

export function createTelegram(win = globalThis) {
  const app = win.Telegram?.WebApp ?? null;
  const inTelegram = Boolean(app && app.platform && app.platform !== 'unknown');
  const at = version => { try { return Boolean(app?.isVersionAtLeast?.(version)); } catch { return false; } };
  const safe = fn => { try { return fn(); } catch { return undefined; } };
  let backHandler = null;

  return {
    app, inTelegram,
    colorScheme: () => (inTelegram && (app.colorScheme === 'light' || app.colorScheme === 'dark') ? app.colorScheme : null),
    start() {
      if (!inTelegram) return;
      safe(() => app.ready());
      safe(() => app.expand());
      // The page scrolls and has bottom sheets: a downward drag must not minimise the Mini App.
      if (at('7.7')) safe(() => app.disableVerticalSwipes());
    },
    applyColors({ header, background, bottom } = {}) {
      if (!inTelegram) return;
      if (HEX.test(header ?? '') && at('6.1')) safe(() => app.setHeaderColor(header));
      if (HEX.test(background ?? '') && at('6.1')) safe(() => app.setBackgroundColor(background));
      if (HEX.test(bottom ?? '') && at('7.10')) safe(() => app.setBottomBarColor(bottom));
    },
    setBack(handler) {
      if (!inTelegram || !at('6.1')) return;
      const button = app.BackButton;
      if (backHandler) { safe(() => button.offClick(backHandler)); backHandler = null; }
      if (handler) { backHandler = handler; safe(() => button.onClick(handler)); safe(() => button.show()); }
      else safe(() => button.hide());
    },
    // Returns true when Telegram handled the cue (so the caller does not also call navigator.vibrate).
    haptic(cue) {
      if (!inTelegram || !at('6.1') || !app.HapticFeedback) return false;
      const feedback = app.HapticFeedback;
      if (SELECTION.has(cue)) safe(() => feedback.selectionChanged());
      else if (IMPACT.has(cue)) safe(() => feedback.impactOccurred('light'));
      else if (cue === 'success') safe(() => feedback.notificationOccurred('success'));
      else if (cue === 'error') safe(() => feedback.notificationOccurred('error'));
      else if (cue === 'limit') safe(() => feedback.notificationOccurred('warning'));
      else return false;
      return true;
    },
    onThemeChanged(fn) {
      if (!inTelegram) return () => {};
      safe(() => app.onEvent('themeChanged', fn));
      return () => safe(() => app.offEvent('themeChanged', fn));
    },
  };
}
