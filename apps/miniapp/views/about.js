// About tab: what the numbers mean, what is not built, privacy, and the (default-off) sound/haptics switches.
import { h, icon } from '../ui/dom.js';
import { hapticsOn, hm7, init, setHaptics, setSound, soundOn } from '../ui/hm7.js';

function card(id, title, ...body) {
  return h('section', { class: 'cm-card about-card', 'aria-labelledby': id }, h('h2', { class: 'about-card__title', id, text: title }), ...body);
}
const points = items => h('ul', { class: 'about-list', role: 'list' }, items.map(([ico, text]) => h('li', {}, icon(ico), h('span', { text }))));

function switchRow({ title, hint, on, iconOn, iconOff, onChange }) {
  const row = h('div', { class: ['sw-wrap', on && 'on'] },
    h('div', { class: 'sw-track' }, h('div', { class: 'sw-knob' }, h('div', { class: 'sw-ico' }, icon(iconOff, 'off-s'), icon(iconOn, 'on-s')))),
    h('div', { class: 'sw-text' }, h('div', { class: 'sw-label', text: title }), h('div', { class: 'sw-note', text: hint })));
  row.setAttribute('aria-label', title);
  row.addEventListener('change', event => onChange(Boolean(event.detail?.on)));
  return row;
}

export function createAboutView(ctx) {
  const { store, actions } = ctx;
  const root = h('div', { class: 'view view--about' });

  const themeItems = [['auto', 'خودکار'], ['light', 'روشن'], ['dark', 'تیره']].map(([id, label]) =>
    h('button', { class: ['tb-it', store.themePref() === id && 'on'], type: 'button', role: 'tab', 'aria-selected': String(store.themePref() === id), dataset: { pref: id }, onClick: () => actions.setTheme(id) }, h('span', { text: label })));
  const themeTabs = h('div', { class: 'cm-tabs tb-wrap about__theme', role: 'tablist', 'aria-label': 'پوسته' }, h('div', { class: 'tb-ind' }), themeItems);

  const sound = switchRow({ title: 'صدای رابط', hint: 'صدای کوتاه برای لمس ها؛ پیش فرض خاموش است.', on: soundOn(), iconOn: 'speaker_wave_2_fill', iconOff: 'speaker_slash_fill',
    onChange: on => { setSound(on); if (on) hm7()?.cue('toast'); } });
  const haptic = switchRow({ title: 'لرزش', hint: 'بازخورد لرزشی برای لمس ها؛ پیش فرض خاموش و روی همهٔ دستگاه ها پشتیبانی نمی شود.', on: hapticsOn(), iconOn: 'a_4d_vibration', iconOff: 'a_4d_vibration',
    onChange: on => { setHaptics(on); if (on) hm7()?.cue('success'); } });

  root.append(
    h('header', { class: 'view__head' }, h('h1', { class: 'view__title', text: 'درباره' }), h('p', { class: 'view__sub', text: 'بِسراه، راهنمای قطار بعدی مترو مشهد' })),
    card('about-what', 'بسراه چه کاری می کند؟', h('p', { text: 'زمان تقریبی رسیدن قطارهای خط ۱ مترو مشهد را برای هر ایستگاه نشان می دهد و نزدیک ترین ایستگاه را پیدا می کند.' })),
    card('about-times', 'زمان ها از کجا می آیند؟', points([
      ['calendar_badge_clock', 'زمان ها از برنامهٔ حرکت و زمان سفر بین ایستگاه ها برآورد می شوند. این ها موقعیت زندهٔ قطار (GPS) نیستند.'],
      ['subway', 'خط ۱ دو سرویس دارد: A بین وکیل آباد و غدیر، و B بین وکیل آباد و فرودگاه از مسیر غدیر.'],
      ['info_circle', 'برنامه در پنجشنبه و جمعه با روزهای دیگر فرق دارد؛ نام برنامهٔ فعال کنار هر تابلو آمده است.'],
      ['shield_checkered', 'برچسب «بر پایهٔ جدول رسمی» یعنی ساعت شروع از جدول رسمی است. «برآورد از فاصلهٔ حرکت» یعنی فاصلهٔ حرکت از اطلاعات رسمی است ولی ساعت دقیق حرکت تخمینی است.'],
      ['clock', 'کنار هر تابلو ساعت سرور به وقت تهران و دکمهٔ تازه سازی هست. شمارش معکوس روی ساعت دستگاه شما نیست.'],
    ])),
    card('about-limits', 'چه چیزهایی ساخته نشده؟', points([
      ['subway_fill', 'زمان رسیدن خط ۲ (ایستگاه های خط ۲ در فهرست هستند ولی بدون زمان).'],
      ['bus_fill', 'اتوبوس، تاکسی اینترنتی و مسیریابی ترکیبی.'],
      ['lock_fill', 'پرداخت، حساب کاربری، تخفیف یا قیمت؛ بسراه هیچ کدام را ندارد.'],
    ])),
    card('about-privacy', 'حریم خصوصی', points([
      ['location_north_up_right_circle_fill', 'موقعیت فقط وقتی دکمهٔ «یافتن نزدیک ترین ایستگاه» را بزنید خوانده می شود و فقط روی همین دستگاه با فهرست ایستگاه ها مقایسه می شود. مختصات نه ارسال می شود و نه ذخیره.'],
      ['person_shield', 'هویت تلگرام شما خوانده یا برای ورود استفاده نمی شود؛ برنامه حساب کاربری ندارد.'],
      ['doc_text', 'درخواست زمان فقط نام ایستگاه را می فرستد.'],
      ['heart_bookmark', 'فقط نام ایستگاه های اخیر و علاقه مندی ها و تنظیمات پوسته، صدا و لرزش روی همین دستگاه می ماند.'],
    ])),
    card('about-settings', 'تنظیمات', h('p', { class: 'about__label', text: 'پوسته' }), themeTabs, h('div', { class: 'about__switches' }, sound, haptic)));

  return {
    el: root,
    mount() { init(root); },
    syncTheme(pref) { themeItems.forEach(t => { const on = t.dataset.pref === pref; t.classList.toggle('on', on); t.setAttribute('aria-selected', String(on)); }); },
  };
}
