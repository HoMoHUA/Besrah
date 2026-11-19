import { h, icon } from '../ui/dom.js';
import { hapticsOn, hm7, init, setHaptics, setSound, soundOn } from '../ui/hm7.js';
function switchRow({ title, hint, on, iconOn, iconOff, onChange }) {
  const row = h('div', { class: ['sw-wrap', on && 'on'] },
    h('div', { class: 'sw-track' }, h('div', { class: 'sw-knob' }, h('div', { class: 'sw-ico' }, icon(iconOff, 'off-s'), icon(iconOn, 'on-s')))),
    h('div', { class: 'sw-text' }, h('div', { class: 'sw-label', text: title }), h('div', { class: 'sw-note', text: hint })));
  row.setAttribute('aria-label', title);
  row.addEventListener('change', event => onChange(Boolean(event.detail?.on)));
  return row;
}

// Shown only inside the Besrah Android app (window.BesrahNative). Lets the user post one test live notification so the
// phone lists Besrah under its notification / Live view settings, then open those settings to allow it.
export function liveNotificationCard(bridge = globalThis.window?.BesrahNative) {
  if (!bridge || typeof bridge.testLiveNotification !== 'function') return null;
  const status = h('p', { class: 'fd-note', role: 'status' });
  const live = () => { try { return bridge.liveNotifications?.() === true; } catch { return false; } };
  const draw = msg => { status.textContent = msg ?? (live() ? 'اعلان زنده (کپسول) برای بِسراه روشن است.' : 'هنوز معلوم نیست گوشی کپسول را برای بِسراه نشان می‌دهد؛ یک اعلان آزمایشی بفرستید.'); };
  draw();
  return h('section', { class: 'cm-card about-card', 'aria-labelledby': 'live-title' },
    h('h2', { id: 'live-title', class: 'about-card__title', text: 'اعلان زنده (سفر در جریان)' }),
    h('p', { class: 'fd-note', text: 'یک اعلان آزمایشی دودقیقه‌ای با زمان‌شمار می‌فرستد تا بِسراه در تنظیمات اعلان و «Live view» گوشی دیده شود و بتوانید آن را روشن کنید.' }),
    h('div', { class: 'fd-actions' },
      h('button', { type: 'button', class: 'cm-btn', onClick: () => { let ok = false; try { ok = bridge.testLiveNotification() === true; } catch { ok = false; } draw(ok ? 'اعلان آزمایشی فرستاده شد؛ نوار وضعیت و پنل اعلان را نگاه کنید.' : 'اعلان فرستاده نشد؛ اجازهٔ اعلان را بدهید و دوباره امتحان کنید.'); } }, 'ارسال اعلان آزمایشی'),
      h('button', { type: 'button', class: ['cm-btn', 'cm-btn--ghost'], onClick: () => { try { bridge.openNotificationSettings?.(); } catch { /* not available */ } } }, 'تنظیمات اعلان')),
    status);
}

export function createSettingsView({ store, actions }) {
  const root = h('div', { class: 'view view--settings' });
  const themeItems = [['auto', 'خودکار'], ['light', 'روشن'], ['dark', 'تیره']].map(([id, label]) =>
    h('button', { class: ['tb-it', store.themePref() === id && 'on'], type: 'button', role: 'tab', 'aria-selected': String(store.themePref() === id), dataset: { pref: id }, onClick: () => actions.setTheme(id) }, h('span', { text: label })));
  const themeTabs = h('div', { class: 'cm-tabs tb-wrap about__theme', role: 'tablist', 'aria-label': 'پوسته' }, h('div', { class: 'tb-ind' }), themeItems);

  const sound = switchRow({ title: 'صدای رابط', hint: 'صدای کوتاه برای لمس ها؛ پیش فرض خاموش است.', on: soundOn(), iconOn: 'speaker_wave_2_fill', iconOff: 'speaker_slash_fill',
    onChange: on => { setSound(on); if (on) hm7()?.cue('toast'); } });
  const haptic = switchRow({ title: 'لرزش', hint: 'بازخورد لرزشی برای لمس ها؛ پیش فرض خاموش و روی همهٔ دستگاه ها پشتیبانی نمی شود.', on: hapticsOn(), iconOn: 'a_4d_vibration', iconOff: 'a_4d_vibration',
    onChange: on => { setHaptics(on); if (on) hm7()?.cue('success'); } });

  root.append(
    h('header', { class: 'view__head' }, h('h1', { class: 'view__title', text: 'تنظیمات' }), h('p', { class: 'view__sub', text: 'بِسراه، به سلیقه شما.' })),
    h('section', { class: 'cm-card about-card', 'aria-labelledby': 'theme-title' }, h('h2', { id: 'theme-title', class: 'about-card__title', text: 'ظاهر برنامه' }), themeTabs),
    h('section', { class: 'cm-card about-card', 'aria-labelledby': 'feedback-title' }, h('h2', { id: 'feedback-title', class: 'about-card__title', text: 'بازخورد لمس' }), sound, haptic),
    liveNotificationCard() ?? null);
  return { el: root, mount() { init(root); }, syncTheme(pref) { themeItems.forEach(t => { const on = t.dataset.pref === pref; t.classList.toggle('on', on); t.setAttribute('aria-selected', String(on)); }); } };
}
