// Glue between the app and the vendored HM7 runtime (window.HM7). Every helper degrades to plain DOM
// if the bundle is missing, so the app stays usable.
import { reducedMotion } from './dom.js';

export const hm7 = () => globalThis.HM7 ?? null;

// Re-run after every dynamic render (HM7.init is idempotent per element).
export function init(root = document) { try { hm7()?.init(root); } catch (error) { console.warn('HM7.init failed', error); } }

// Rolls the digits of `el` to `text` (documented digit-roll); plain text when motion is reduced or HM7 is absent.
export function roll(el, text) {
  const shop = hm7()?.shop;
  if (shop?.roll && !reducedMotion()) shop.roll(el, text);
  else { el.textContent = text; el.setAttribute('data-v', text); }
}

let toastHost = null;
export const setToastHost = el => { toastHost = el; };
// Toast with the documented API; `tint` is never passed (it would emit an inline style attribute).
export function toast({ title, text = '', icon = 'checkmark_circle_fill', life = 3600, action, onAction }) {
  const shop = hm7()?.shop;
  if (!toastHost || !shop?.toast) return null;
  try { return shop.toast(toastHost, { title, text, icon, life, action, onAction }); } catch { return null; }
}

export function setSound(on) { try { hm7()?.sound.enable(on); } catch { /* ignore */ } }
export function setHaptics(on) { try { hm7()?.haptics.enable(on); } catch { /* ignore */ } }
export const soundOn = () => Boolean(hm7()?.sound?.enabled);
export const hapticsOn = () => Boolean(hm7()?.haptics?.enabled);

// Route HM7 haptic cues through Telegram's native feedback when running inside Telegram (only when the user
// switched haptics on: HM7 only calls haptics.play when enabled).
export function bridgeHaptics(tg) {
  const haptics = hm7()?.haptics;
  if (!haptics || !tg.inTelegram) return;
  const original = haptics.play.bind(haptics);
  haptics.play = name => { if (!tg.haptic(name)) original(name); };
}

export function morph(button, panel) { try { return hm7()?.morph(button, panel) ?? null; } catch { return null; } }
export function lensTabs(bar, onChange) { try { return hm7()?.lensTabs(bar, { onChange }) ?? null; } catch { return null; } }
export function springEasing(k, c) { try { return hm7()?.springEasing(k, c) ?? null; } catch { return null; } }
