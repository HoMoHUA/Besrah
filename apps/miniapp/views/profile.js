// Profile: guest-first. Everything on this page works without an account except the account card itself.
// Device preferences live in this browser; an account (Telegram, verified by the server) can optionally sync them, and only
// after an explicit consent that can be revoked at any time (revoking deletes the synced copy).
import { h, icon } from '../ui/dom.js';
import { fa } from '../format.js';
import { sanitizePrefs } from '../store.js';
import { createReminders } from '../reminders.js';

const WALK = [5, 10, 15, 20, 30];
const PRIORITY = [['time', 'زمان رسیدن'], ['walk', 'پیاده روی کمتر'], ['balanced', 'هر دو'], ['cost', 'هزینه']];
const FOOD = [null, 100000, 150000, 250000, 400000];
const SHOP = [null, 500000, 1000000, 2000000, 5000000];
const FOOD_VERTICALS = [
  ['restaurant','غذای ایرانی'],['fast_food','فست‌فود'],['cafe','کافه'],
  ['sweets','شیرینی و دسر'],['bakery','نانوایی'],['flowers','گل و هدیه'],
  ['grocery','سوپرمارکت'],['produce','میوه و سبزی'],['protein','پروتئین'],['nuts','آجیل'],['other','سایر']
];
const budgetLabel = b => (b === null ? 'بدون سقف' : `تا ${fa((b / 1000).toLocaleString('en-US'))} هزار`);

export function createProfileView(ctx) {
  const { api, store, actions } = ctx;
  let reminders = null;
  try { reminders = createReminders(); } catch { /* storage unavailable */ }
  const S = { phase: 'loading', session: null, busy: false, message: '', exportText: '', confirmDelete: false, prefsVersion: 0 };
  const el = h('div', { class: 'view view--profile', dataset: { view: 'profile' } });
  const body = h('div', { class: 'pf-body' });
  const tgInitData = () => { try { return globalThis.window?.Telegram?.WebApp?.initData || ''; } catch { return ''; } };
  const synced = () => S.session?.authenticated && S.session.consents?.sync_preferences?.status === 'granted';

  async function refresh() {
    try {
      S.session = await api.accountSession();
      S.phase = S.session.available === false ? 'unavailable' : S.session.authenticated ? 'user' : 'guest';
      if (synced()) await pullPrefs();
    } catch { S.phase = 'unavailable'; S.session = null; }
    draw();
  }

  async function pullPrefs() {
    try {
      const remote = await api.accountPreferences();
      S.prefsVersion = remote.version;
      if (remote.version > 0) store.setPrefs(sanitizePrefs(remote.values));
      else if (Object.keys(store.prefs()).length) await pushPrefs();
    } catch { /* offline: the device copy keeps working */ }
  }
  async function pushPrefs() {
    if (!synced()) return;
    try { const r = await api.accountSavePreferences(S.prefsVersion, store.prefs()); S.prefsVersion = r.version; }
    catch (error) { if (error?.kind === 'conflict') { S.prefsVersion = error.version ?? 0; await pullPrefs(); } else S.message = 'همگام سازی انجام نشد؛ تنظیمات روی این دستگاه ذخیره شد.'; }
  }
  const setPref = async (key, value) => {
    const next = { ...store.prefs() }; if (value === null || value === undefined) delete next[key]; else next[key] = value;
    store.setPrefs(next); draw(); await pushPrefs(); draw();
  };

  async function login() {
    const initData = tgInitData(); if (!initData || S.busy) return;
    S.busy = true; S.message = ''; draw();
    try {
      await api.accountTelegram(initData);
      // Some in-app browsers silently drop cookies: confirm the session really stuck before saying "logged in".
      S.session = await api.accountSession();
      if (!S.session.authenticated) { S.message = 'ورود انجام شد ولی مرورگر داخلی کوکی را نگه نمی دارد؛ حساب در این دستگاه کار نمی کند.'; S.phase = 'guest'; }
      else { S.phase = 'user'; if (synced()) await pullPrefs(); }
    }
    catch (error) { S.message = error?.kind === 'rate_limited' ? 'تلاش های زیاد؛ چند لحظه بعد دوباره امتحان کنید.' : 'ورود انجام نشد. برنامه را از داخل تلگرام دوباره باز کنید.'; }
    S.busy = false; draw();
  }
  async function logout() { S.busy = true; draw(); try { await api.accountLogout(); } catch { /* cookie expires anyway */ } S.session = null; S.phase = 'guest'; S.busy = false; S.exportText = ''; draw(); refresh(); }
  async function toggleSync() {
    if (!S.session?.authenticated || S.busy) return;
    const grant = !synced(); S.busy = true; draw();
    try {
      await api.accountConsent('sync_preferences', grant);
      S.session = await api.accountSession();
      if (grant) await pullPrefs(); else S.prefsVersion = 0;
    } catch { S.message = 'تغییر همگام سازی انجام نشد.'; }
    S.busy = false; draw();
  }
  async function exportData() {
    S.busy = true; draw();
    try { S.exportText = JSON.stringify(await api.accountExport(), null, 1); } catch { S.message = 'دریافت داده انجام نشد.'; }
    S.busy = false; draw();
  }
  async function deleteAccount() {
    if (!S.confirmDelete) { S.confirmDelete = true; draw(); return; }
    S.busy = true; draw();
    try { await api.accountDelete(); S.session = null; S.phase = 'guest'; S.confirmDelete = false; S.exportText = ''; S.message = 'حساب و داده های همگام شده حذف شد.'; }
    catch { S.message = 'حذف حساب انجام نشد.'; }
    S.busy = false; draw(); refresh();
  }

  const chip = (label, pressed, onClick) => h('button', { type: 'button', class: ['cm-chip', 'fd-chip'], 'aria-pressed': String(pressed), onClick }, label);
  const card = (id, title, ...kids) => h('section', { class: 'cm-card about-card', 'aria-labelledby': id }, h('h2', { class: 'about-card__title', id, text: title }), ...kids);
  const note = text => h('p', { class: 'fd-note', text });

  function accountCard() {
    if (S.phase === 'loading') return card('pf-acc', 'حساب', h('div', { class: 'cm-skel fd-skeleton__card' }));
    if (S.phase === 'user') return card('pf-acc', 'حساب بسراه',
      h('p', { class: 'pf-state', text: 'وارد شده اید (تلگرام).' }),
      note('شناسه تلگرام فقط برای پیدا کردن حساب شما در سرور نگه داشته می شود؛ نام، شماره و موقعیت ذخیره نمی شود.'),
      h('div', { class: 'fd-actions' }, h('button', { type: 'button', class: ['cm-btn', 'cm-btn--ghost'], disabled: S.busy ? 'true' : null, onClick: logout }, 'خروج')));
    if (S.phase === 'unavailable') return card('pf-acc', 'حساب', h('p', { class: 'pf-state', text: 'ورود فعلاً در دسترس نیست.' }), note('همهٔ سرویس ها بدون حساب کار می کنند و تنظیمات شما روی همین دستگاه می ماند.'));
    const inTelegram = Boolean(tgInitData());
    return card('pf-acc', 'حساب', h('p', { class: 'pf-state', text: 'مهمان هستید؛ همهٔ سرویس ها بدون حساب کار می کنند.' }),
      inTelegram ? h('div', { class: 'fd-actions' }, h('button', { type: 'button', class: 'cm-btn', disabled: S.busy ? 'true' : null, onClick: login }, S.busy ? 'در حال ورود…' : 'ورود با تلگرام'))
        : note('ورود با تلگرام فقط داخل برنامهٔ تلگرام ممکن است. برای باز کردن آن از ربات @Besrahbot استفاده کنید.'),
      note('با ورود می توانید ترجیحات را بین دستگاه ها همگام کنید. روش های دیگر ورود (شماره موبایل، ایمیل، بله) هنوز ساخته نشده اند و زمانی برایشان اعلام نشده است.'));
  }

  function prefsCard() {
    const p = store.prefs();
    return card('pf-pref', 'ترجیحات من',
      note(synced() ? 'همگام سازی روشن است؛ تغییرها به حساب شما هم ارسال می شود.' : 'این ترجیحات فقط روی همین دستگاه می ماند.'),
      h('div', { role: 'group', 'aria-label': 'بیشترین پیاده روی' }, h('p', { class: 'pf-label', text: 'بیشترین پیاده روی تا ایستگاه' }),
        h('div', { class: 'fd-row' }, [null, ...WALK].map(m => chip(m === null ? 'نامشخص' : `${fa(m)} دقیقه`, (p.transitMaxWalkMin ?? null) === m, () => setPref('transitMaxWalkMin', m))))),
      h('div', { role: 'group', 'aria-label': 'اولویت سفر' }, h('p', { class: 'pf-label', text: 'در سفر کدام مهم تر است؟' }),
        h('div', { class: 'fd-row' }, PRIORITY.map(([id, label]) => chip(label, p.transitPriority === id, () => setPref('transitPriority', p.transitPriority === id ? null : id))))),
      h('div', { role: 'group', 'aria-label': 'سقف قیمت غذا' }, h('p', { class: 'pf-label', text: 'سقف قیمت هر قلم غذا' }),
        h('div', { class: 'fd-row' }, FOOD.map(b => chip(budgetLabel(b), (p.foodBudgetToman ?? null) === b, () => setPref('foodBudgetToman', b))))),
      h('div', { role: 'group', 'aria-label': 'سقف قیمت کالا' }, h('p', { class: 'pf-label', text: 'سقف قیمت کالا در بسپی' }),
        h('div', { class: 'fd-row' }, SHOP.map(b => chip(b === null ? 'بدون سقف' : b >= 1000000 ? `تا ${fa(b / 1000000)} میلیون` : `تا ${fa(b / 1000)} هزار`, (p.shopBudgetToman ?? null) === b, () => setPref('shopBudgetToman', b))))),
      h('div', { role: 'group', 'aria-label': 'دسته‌های مورد علاقه' },
        h('p', { class: 'pf-label', text: 'دسته‌های مورد علاقهٔ من (حداکثر ۴ مورد)' }),
        h('div', { class: 'fd-row' }, FOOD_VERTICALS.map(([id, label]) => chip(label, (p.foodPreferredVerticals ?? []).includes(id), () => {
          const selected = p.foodPreferredVerticals ?? [];
          if (!selected.includes(id) && selected.length >= 4) { S.message = 'حداکثر چهار دسته را انتخاب کنید؛ ابتدا یک دسته را بردارید.'; draw(); return; }
          return setPref('foodPreferredVerticals', selected.includes(id) ? selected.filter(v => v !== id) : [...selected, id]);
        }))),
        note('فقط انتخاب صریح شما ذخیره می‌شود. این موارد در نمایش دسته‌ها و پیشنهادهای مناسب همان ساعت اثر دارند؛ سابقهٔ مرور یا سفارش جمع‌آوری نمی‌شود.')),
      note('سقف پیاده روی و اولویت سفر همین حالا در مسیر مکان به مکان اعمال می شوند (هسته تصمیم گیری گزینه ها را با آن می سنجد). «هزینه» فعلاً اثری ندارد چون نرخ مسیرها را نداریم. سقف قیمت غذا و کالا نقطهٔ شروع جست وجوی بسفود و بسپی است.'));
  }

  function savedCard() {
    const items = store?.savedChoices?.() ?? [];
    return card('pf-saved', 'ذخیره‌های من',
      note('فقط مواردی که خودتان با دکمهٔ ذخیره انتخاب کرده‌اید، روی همین دستگاه نگه داشته می‌شوند. ذخیرهٔ خودکار تاریخچه وجود ندارد.'),
      items.length ? h('div', { class: 'fd-results' }, items.map(item => h('div', { class: 'cm-card about-card' },
        h('p', { class: 'pf-label', text: item.title }),
        h('p', { class: 'fd-note', text: item.kind === 'food' ? 'فروشگاه در بسفود' : 'کالا در بسپی' }),
        h('div', { class: 'fd-actions' },
          h('button', { type:'button', class:['cm-btn','cm-btn--ghost','cm-btn--sm'],
            onClick:()=>actions.go(item.kind === 'food' ? 'food' : 'shop', { q:item.title, ...(item.vertical ? {vertical:item.vertical} : {}) }) }, 'پیدا کردن'),
          h('button', { type:'button', class:['cm-btn','cm-btn--ghost','cm-btn--sm'],
            onClick:()=>{store.removeSavedChoice?.(item.kind,item.id);draw();} }, 'حذف'))))) :
        note('هنوز فروشگاه یا کالایی ذخیره نکرده‌اید. در بسفود و بسپی می‌توانید یک مورد را ذخیره کنید.'),
      items.length ? h('button', {type:'button',class:['cm-btn','cm-btn--ghost','cm-btn--sm'],
        onClick:()=>{store.clearSavedChoices?.();draw();}}, 'پاک کردن تمام ذخیره‌ها') : null);
  }

  function privacyCard() {
    const on = store.suggestLocation();
    return card('pf-priv', 'حریم خصوصی و داده',
      h('div', { role: 'group', 'aria-label': 'پیشنهاد بر اساس موقعیت' }, h('p', { class: 'pf-label', text: 'پیشنهاد صفحهٔ اول بر اساس موقعیت من' }),
        h('div', { class: 'fd-row' }, chip('روشن', on, () => { store.setSuggestLocation(true); draw(); }), chip('خاموش', !on, () => { store.setSuggestLocation(false); draw(); })),
        note('خاموش است مگر خودتان روشن کنید. وقتی روشن باشد موقعیت فقط برای ساختن پیشنهاد همان لحظه به سرور می رود و ذخیره نمی شود.')),
      S.phase === 'user' ? h('div', { role: 'group', 'aria-label': 'همگام سازی' }, h('p', { class: 'pf-label', text: 'همگام سازی ترجیحات با حساب' }),
        h('div', { class: 'fd-row' }, chip('روشن', synced(), () => { if (!synced()) toggleSync(); }), chip('خاموش', !synced(), () => { if (synced()) toggleSync(); })),
        note('با خاموش کردن، نسخهٔ همگام شده از سرور پاک می شود و نسخهٔ این دستگاه می ماند.')) : null,
      h('div', { class: 'fd-actions' },
        h('button', { type: 'button', class: ['cm-btn', 'cm-btn--ghost'], onClick: () => { store.clearRecents(); store.setPrefs({}); store.clearSavedChoices?.(); S.message = 'ایستگاه های اخیر و ترجیحات این دستگاه پاک شد.'; draw(); } }, 'پاک کردن داده های این دستگاه'),
        S.phase === 'user' ? h('button', { type: 'button', class: ['cm-btn', 'cm-btn--ghost'], disabled: S.busy ? 'true' : null, onClick: exportData }, 'دریافت داده های حساب') : null,
        S.phase === 'user' ? h('button', { type: 'button', class: ['cm-btn', S.confirmDelete ? 'pf-danger' : 'cm-btn--ghost'], disabled: S.busy ? 'true' : null, onClick: deleteAccount }, S.confirmDelete ? 'برای حذف دوباره لمس کنید' : 'حذف حساب') : null),
      S.exportText ? h('pre', { class: 'pf-export', tabindex: '0', 'aria-label': 'داده های حساب' }, S.exportText) : null,
      h('button', { type: 'button', class: 'discovery-note', onClick: () => actions.go('about') },
        h('span', { class: 'discovery-note__icon' }, icon('checkmark_shield')),
        h('span', {}, h('strong', { text: 'درباره، منبع داده و حریم خصوصی' }), h('span', { text: 'هر عدد با منشأش؛ چه چیزی کجا می رود.' })), icon('chevron_left')));
  }

  function reminderCard() {
    if (!reminders?.hasReminder()) return null;
    const status = reminders.status();
    return card('pf-reminder', 'یادآوری مترو', note(status === 'pending' ? 'ثبت یادآوری هنوز تأیید نشده است؛ می‌توانید آن را لغو کنید.' : status === 'cancelling' ? 'لغو هنوز تأیید نشده است؛ دوباره تلاش کنید.' : 'لغو یادآوری این دستگاه.'),
      h('button', {type:'button', class:'cm-btn', disabled:S.busy ? 'true' : null, onClick: async () => {
        if (S.busy) return; S.busy = true; draw();
        try { await reminders.remove(); S.message = 'یادآوری لغو شد.'; }
        catch { S.message = 'لغو انجام نشد؛ اتصال را بررسی و دوباره تلاش کنید.'; }
        S.busy = false; draw();
      }}, 'لغو یادآوری'));
  }

  function draw() {
    body.replaceChildren(...[S.message ? h('p', { class: 'tp-status', role: 'status', text: S.message }) : null, accountCard(), reminderCard(), prefsCard(), savedCard(), privacyCard()].filter(Boolean));
  }
  el.append(h('header', { class: 'view__head' }, h('p', { class: 'eyebrow', text: 'PROFILE' }), h('h1', { class: 'view__title', text: 'پروفایل' }), h('p', { class: 'view__sub', text: 'ترجیحات و حساب شما؛ همه چیز اختیاری است.' })), body);
  draw();
  return { el, onShow() { S.message = ''; S.confirmDelete = false; draw(); refresh(); } };
}
