/* Besrah theme boot. Loaded synchronously in <head> (after the Telegram SDK) so data-theme is set before
   first paint. External file because the CSP forbids inline scripts. Also exposes BesrahTheme for the app. */
(function (global) {
  'use strict';
  var KEY = 'besrah:theme';
  // Must equal --bg in skin.css (pinned by theme.test.mjs).
  var COLORS = { dark: '#061C1D', light: '#F3F5EF' };

  function pick(value) { return value === 'light' || value === 'dark' ? value : null; }

  // Preference (user) > Telegram colour scheme (only inside Telegram) > operating system > dark.
  function resolveTheme(input) {
    input = input || {};
    return pick(input.pref) || pick(input.tgScheme) || (input.prefersLight ? 'light' : 'dark');
  }
  function readPref() {
    try { return pick(global.localStorage.getItem(KEY)) || 'auto'; } catch (e) { return 'auto'; }
  }
  function telegramScheme() {
    var app = global.Telegram && global.Telegram.WebApp;
    // The SDK reports a default scheme even in a normal browser; only trust it inside Telegram.
    return app && app.platform && app.platform !== 'unknown' ? pick(app.colorScheme) : null;
  }
  function prefersLight() {
    try { return !!global.matchMedia('(prefers-color-scheme: light)').matches; } catch (e) { return false; }
  }
  function apply(pref) {
    var theme = resolveTheme({ pref: pref === undefined ? readPref() : pref, tgScheme: telegramScheme(), prefersLight: prefersLight() });
    var root = global.document.documentElement;
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
    var meta = global.document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', COLORS[theme]);
    return theme;
  }

  global.BesrahTheme = { resolveTheme: resolveTheme, apply: apply, colors: COLORS, readPref: readPref };
  apply();
})(window);
