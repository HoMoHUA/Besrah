// Besfood: real food search over the stored vendor/menu snapshot, with vendor menus and a hand-off to the platform.
// Location is only ever read after an explicit tap, rounded to ~100 m and sent only to this app's own server to sort one search.
import { h } from '../ui/dom.js';
import { resolveUserCoords } from '../logic.js';
import { fa } from '../format.js';

const BUDGETS = [null, 100000, 150000, 250000, 400000];
const SORTS = [['relevance', 'مرتبط ترین'], ['price', 'ارزان ترین قلم'], ['distance', 'نزدیک ترین'], ['rating', 'امتیاز']];
const QUICK = ['چلو کباب', 'پیتزا', 'برگر', 'قیمه', 'قهوه', 'کیک', 'دسته گل', 'صبحانه'];
const VERTICALS = [
  ['all','همهٔ دسته‌ها'],['meals','غذا'],['restaurant','رستوران'],['fast_food','فست‌فود'],
  ['cafe','کافه'],['sweets','شیرینی و دسر'],['bakery','نانوایی'],
  ['flowers','گل و هدیه'],['grocery','سوپرمارکت'],['produce','میوه و سبزی'],
  ['protein','پروتئین'],['nuts','آجیل و خشکبار'],['other','سایر']
];
const PROVIDERS = { snappfood: 'اسنپ فود', tapsifood: 'تپسی فود' };
const DEBOUNCE_MS = 350;

export const toman = value => `${Number(value).toLocaleString('fa-IR')} تومان`;
export const dayLabel = iso => {
  const ms = Date.parse(iso ?? '');
  return Number.isFinite(ms) ? new Date(ms).toLocaleDateString('fa-IR', { timeZone: 'Asia/Tehran', day: 'numeric', month: 'long' }) : 'نامشخص';
};
export const distanceLabel = meters => (meters < 1000 ? `${fa(Math.max(50, Math.round(meters / 50) * 50))} متر` : `${fa((meters / 1000).toFixed(1).replace('.', '٫'))} کیلومتر`);
const round3 = n => Math.round(n * 1000) / 1000;

// Native app first on mobile, web link as the fallback.
function openPlatformVendor(provider, code, webUrl, vertical) {
  if (typeof window === 'undefined') return;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const open = url => (window.Telegram?.WebApp?.openLink ? window.Telegram.WebApp.openLink(url) : window.open(url, '_blank', 'noopener,noreferrer'));
  // Legacy app links explicitly target restaurant screens. Other marketplace types
  // (flowers, pastries, grocery, café) must use the stored real provider URL.
  if (!mobile || !['restaurant', 'fast_food'].includes(vertical)) { open(webUrl); return; }
  if (/Android/i.test(navigator.userAgent) && provider === 'snappfood') {
    window.location.href = `intent://restaurant/${code}#Intent;scheme=snappfood;package=com.zoodfood.android;S.browser_fallback_url=${encodeURIComponent(webUrl)};end`;
    return;
  }
  const started = Date.now();
  window.location.href = provider === 'snappfood' ? `snappfood://restaurant/${code}` : `tapsifood://vendor/${code}`;
  setTimeout(() => { if (Date.now() - started < 1800) open(webUrl); }, 1200);
}

function priceLine(item) {
  if (item.priceState === 'unknown') return h('span', { class: 'fd-price fd-price--unknown', text: 'قیمت نامشخص' });
  return h('span', { class: 'fd-price' },
    item.discounted ? h('s', { class: 'fd-price__old', text: toman(item.priceToman) }) : null,
    h('b', { text: toman(item.finalPriceToman) }));
}

export function createFoodView(ctx) {
  const { actions, api, store } = ctx;
  const S = { fromProfile: false, fromVerticalProfile: false, vertical: 'all', decision: null, q: '', source: 'all', budget: null, sort: 'relevance', near: null, nearState: 'idle', status: 'idle', vendors: [], total: 0, notes: [], snapshot: null, offset: 0, detail: null };
  let timer = 0, controller = null;
  const statusMemo = new Map();
  const el = h('div', { class: 'view view--food', dataset: { view: 'food' } });
  const body = h('div', { class: 'fd-body' });
  const input = h('input', { class: 'fd-input', type: 'search', inputmode: 'search', enterkeyhint: 'search', autocomplete: 'off', placeholder: 'چه می خواهید؟ مثلاً چلو کباب', 'aria-label': 'جست وجوی غذا', maxlength: '60' });
  input.addEventListener('input', () => { S.q = input.value; schedule(); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') run(true); });

  const params = (offset = 0) => ({
    q: S.q.trim() || undefined, source: S.source === 'all' ? undefined : S.source, vertical: S.vertical === 'all' ? undefined : S.vertical, maxPrice: S.budget ?? undefined,
    sort: S.sort === 'distance' && !S.near ? undefined : S.sort === 'relevance' ? undefined : S.sort,
    lat: S.near ? round3(S.near.lat) : undefined, lon: S.near ? round3(S.near.lon) : undefined, limit: 10, offset: offset || undefined,
  });

  function schedule() { clearTimeout(timer); timer = setTimeout(() => run(true), DEBOUNCE_MS); }

  async function run(reset) {
    clearTimeout(timer);
    controller?.abort(); controller = new AbortController();
    const mine = controller, offset = reset ? 0 : S.offset;
    if (reset) { S.status = 'loading'; S.vendors = []; } else S.status = 'more';
    draw();
    try {
      const data = await api.foodSearch(params(offset), mine.signal);
      if (mine !== controller) return;
      S.vendors = reset ? data.vendors : S.vendors.concat(data.vendors);
      S.decision = reset ? data.decision ?? null : null; // Core scopes price comparisons to one returned page, not all pages.
      S.total = data.total; S.notes = data.notes ?? []; S.snapshot = data.snapshot; S.offset = offset + data.vendors.length; S.status = 'ok';
    } catch (error) {
      if (mine !== controller || error?.name === 'AbortError') return;
      S.status = error?.status === 503 ? 'unavailable' : 'error';
    }
    draw();
  }

  async function locate() {
    if (S.nearState === 'locating') return;
    S.nearState = 'locating'; draw();
    try {
      const c = await resolveUserCoords(globalThis.window?.Telegram?.WebApp);
      S.near = { lat: c.latitude, lon: c.longitude }; S.nearState = 'ok'; S.sort = S.sort === 'relevance' && !S.q.trim() ? 'distance' : S.sort;
    } catch { S.near = null; S.nearState = 'denied'; if (S.sort === 'distance') S.sort = 'relevance'; }
    run(true);
  }

  async function openVendor(id) {
    S.detail = { id, status: 'loading', data: null, filter: '' }; draw();
    try {
      const data = await api.foodVendor(id, S.near ? { lat: round3(S.near.lat), lon: round3(S.near.lon) } : {});
      if (S.detail?.id !== id) return;
      S.detail = { id, status: 'ok', data, filter: '' };
    } catch { if (S.detail?.id === id) S.detail = { id, status: 'error', data: null, filter: '' }; }
    draw();
  }

  function snapshotNote() {
    if (!S.snapshot?.capturedTo) return null;
    return h('p', { class: ['fd-snapshot', S.snapshot.stale && 'is-stale'], text: `آخرین ثبت قیمت و منو: ${dayLabel(S.snapshot.capturedTo)}${S.snapshot.stale ? ' · قدیمی' : ''}. این قیمت ها لحظه ای نیستند.` });
  }

  function chip(label, pressed, onClick, extra = '') {
    return h('button', { type: 'button', class: ['cm-chip', 'fd-chip', extra], 'aria-pressed': String(pressed), onClick }, label);
  }

  function controls() {
    return h('div', { class: 'fd-controls' },
      h('div', { class: 'fd-row fd-verticals', role: 'group', 'aria-label': 'نوع فروشگاه' },
        VERTICALS.map(([id, label]) => chip(label, S.vertical === id, () => {
          S.vertical = id; S.fromVerticalProfile = false; run(true);
        }))),
      S.fromVerticalProfile ? h('p', { class: 'fd-note', text: 'این دسته را خودتان در پروفایل به‌عنوان علاقه انتخاب کرده‌اید. همهٔ دسته‌ها همچنان قابل مشاهده‌اند.' }) : null,
      h('div', { class: 'fd-row', role: 'group', 'aria-label': 'پلتفرم' },
        [['all', 'همه'], ['snappfood', 'اسنپ فود'], ['tapsifood', 'تپسی فود']].map(([k, label]) => chip(label, S.source === k, () => { S.source = k; run(true); }))),
      S.fromProfile && S.budget !== null ? h('p', { class: 'fd-note', text: 'این سقف را خودتان در پروفایل گذاشته اید؛ همین جا می توانید عوضش کنید.' }) : null,
      h('div', { class: 'fd-row', role: 'group', 'aria-label': 'سقف قیمت هر قلم' },
        BUDGETS.map(b => chip(b === null ? 'بدون سقف' : `تا ${fa((b / 1000).toLocaleString('en-US'))} هزار`, S.budget === b, () => { S.budget = b; S.fromProfile = false; run(true); }))),
      h('div', { class: 'fd-row', role: 'group', 'aria-label': 'مرتب سازی' },
        SORTS.filter(([k]) => k !== 'distance' || S.near).map(([k, label]) => chip(label, S.sort === k, () => { S.sort = k; run(true); })),
        h('button', { type: 'button', class: ['cm-btn', 'cm-btn--ghost', 'cm-btn--sm', 'fd-locate'], disabled: S.nearState === 'locating' ? 'true' : null, onClick: locate },
          S.nearState === 'locating' ? 'در حال دریافت موقعیت…' : S.near ? 'به روزرسانی موقعیت من' : 'نزدیک من')),
      S.nearState === 'denied' ? h('p', { class: 'fd-note', role: 'status', text: 'دسترسی به موقعیت داده نشد. جست وجو بدون فاصله ادامه دارد.' }) : null,
      S.nearState === 'ok' ? h('p', { class: 'fd-note', text: 'موقعیت شما فقط برای مرتب سازی همین جست وجو به سرور بسراه فرستاده می شود (با دقت حدود ۱۰۰ متر) و ذخیره نمی شود.' }) : null,
      h('div', { class: 'fd-quick', role: 'group', 'aria-label': 'پیشنهاد جست وجو' }, QUICK.map(q => h('button', { type: 'button', class: 'fd-quick__item', onClick: () => { S.q = q; input.value = q; run(true); } }, q))));
  }

  function vendorCard(v) {
    const open = v.openSnapshot;
    const openText = open.value === 'unknown' ? 'وضعیت باز بودن نامشخص' : `${open.value === 'open' ? 'باز' : 'بسته'} در زمان ثبت (${dayLabel(open.capturedAt)})`;
    return h('article', { class: 'fd-card cm-card', dataset: { id: v.id } },
      h('header', { class: 'fd-card__head' },
        h('div', { class: 'fd-card__title' }, h('h3', { text: v.name + (v.branch ? ` · ${v.branch}` : '') }), h('p', { class: 'fd-card__sub', text: v.verticalLabel ? `${v.verticalLabel} · ${v.category || 'نوع ثبت‌شده نامعلوم'}` : v.category })),
        h('span', { class: 'cm-badge', text: PROVIDERS[v.provider] })),
      h('p', { class: 'fd-card__meta' },
        v.rating ? h('span', { text: `امتیاز ${fa(v.rating)}` }) : null,
        v.distanceM != null ? h('span', { text: distanceLabel(v.distanceM) }) : null,
        h('span', { text: v.minOrderState === 'known' ? `حداقل سفارش ${toman(v.minOrderToman)}` : 'حداقل سفارش نامشخص' })),
      S.decision?.byVendor?.[v.id]?.label ? h('p', { class: 'fd-note', text: S.decision.byVendor[v.id].label + '؛ فقط قیمت قلم، بدون هزینه ارسال.' }) : null,
      h('p', { class: ['fd-card__open', `is-${open.value}`], text: openText }),
      v.matched.length ? h('ul', { class: 'fd-items' }, v.matched.map(it => h('li', { class: 'fd-item' }, h('span', { class: 'fd-item__name', text: it.name + (it.variation && it.variation !== it.name ? ` · ${it.variation}` : '') }), priceLine(it)))) : h('p', { class: 'fd-card__sub', text: 'منو در دادهٔ ثبت شده خالی است.' }),
      v.matchedCount > v.matched.length ? h('p', { class: 'fd-card__sub', text: `و ${fa(v.matchedCount - v.matched.length)} قلم دیگر در منو` }) : null,
      h('div', { class: 'fd-actions' },
        h('button', { type: 'button', class: ['cm-btn', 'cm-btn--ghost'], onClick: () => openVendor(v.id) }, v.vertical && !['restaurant','fast_food','cafe'].includes(v.vertical) ? 'محصولات و جزئیات' : 'منو و جزئیات'),
        store?.toggleSavedChoice ? h('button', { type: 'button', class: ['cm-btn', 'cm-btn--ghost', 'cm-btn--sm'],
          'aria-pressed': String(Boolean(store?.isSavedChoice?.('food',v.id))),
          onClick: () => { store.toggleSavedChoice('food', {id:v.id,title:v.name,vertical:v.vertical}); draw(); } },
          store?.isSavedChoice?.('food',v.id) ? 'حذف از ذخیره‌ها' : 'ذخیره فروشگاه') : null,
        h('button', { type: 'button', class: ['cm-btn'], onClick: () => openPlatformVendor(v.provider, v.orderCode, v.orderUrl, v.vertical) }, `سفارش در ${PROVIDERS[v.provider]}`)));
  }

  function results() {
    if (S.status === 'loading') return h('div', { class: 'fd-skeleton', 'aria-busy': 'true', 'aria-label': 'در حال جست وجو' }, [0, 1, 2].map(() => h('div', { class: 'cm-skel fd-skeleton__card' })));
    if (S.status === 'error') return h('div', { class: 'empty-state', role: 'alert' }, h('p', { text: 'جست وجو انجام نشد؛ اتصال را بررسی کنید.' }), h('button', { type: 'button', class: 'cm-btn', onClick: () => run(true) }, 'تلاش دوباره'));
    if (S.status === 'unavailable') return h('div', { class: 'empty-state', role: 'alert' }, h('p', { text: 'فهرست غذا اکنون در دسترس نیست.' }), h('button', { type: 'button', class: 'cm-btn', onClick: () => run(true) }, 'تلاش دوباره'));
    if (!S.vendors.length) {
      return h('div', { class: 'empty-state' }, h('p', { text: S.q.trim() || S.budget ? 'نتیجه ای پیدا نشد. عبارت دیگری بنویسید یا سقف قیمت را بالاتر ببرید.' : 'فعلاً مورد قابل نمایشی در دادهٔ ثبت شده نیست.' }),
        S.notes.length ? h('p', { class: 'fd-note', text: S.notes.at(-1) }) : null);
    }
    return h('div', { class: 'fd-results' },
      h('p', { class: 'fd-count', role: 'status', text: `${fa(S.total)} فروشگاه${S.q.trim() ? ` برای «${S.q.trim()}»` : ''}` }),
      S.decision ? h('p', { class: 'fd-note', text: 'مقایسه هوشمند، در صورت وجود قیمت تازه و قلم‌های هم‌نام، فقط میان گزینه‌های همین صفحه است. قیمت سفارش نهایی نامعلوم است.' }) : null,
      snapshotNote(),
      ...S.vendors.map(vendorCard),
      S.vendors.length < S.total ? h('button', { type: 'button', class: ['cm-btn', 'cm-btn--ghost', 'fd-more'], disabled: S.status === 'more' ? 'true' : null, onClick: () => run(false) }, S.status === 'more' ? 'در حال دریافت…' : 'نمایش بیشتر') : null,
      h('ul', { class: 'fd-notes' }, S.notes.map(t => h('li', { text: t }))));
  }

  function statusPanel(v) {
    if (v.provider !== 'tapsifood') return h('p', { class: 'fd-note', text: 'بررسی زندهٔ وضعیت برای اسنپ فود در دسترس نیست؛ وضعیت را در برنامهٔ سفارش ببینید.' });
    const panel = h('div', { class: 'food-card__status', 'aria-live': 'polite' });
    const draw1 = () => {
      const item = statusMemo.get(v.orderCode);
      const fresh = item?.observedAt && Date.now() - Date.parse(item.observedAt) < 60_000;
      const labels = { open: 'باز', closed: 'بسته', out_of_coverage: 'خارج از محدودهٔ پوشش', unknown: 'نامشخص' };
      panel.replaceChildren(
        h('p', null, `وضعیت ثبت‌شدهٔ این فروشگاه: ${fresh ? labels[item.status] : 'نامشخص'}`),
        h('p', null, 'این وضعیت برای موقعیت شما یا امکان ارسال به شما نیست.'),
        h('button', { type: 'button', class: 'cm-btn cm-btn--ghost cm-btn--sm', disabled: item?.loading ? 'true' : null, onClick: async () => {
          statusMemo.set(v.orderCode, { loading: true }); draw1();
          let result; try { result = await api.foodStatus(v.orderCode); } catch { result = { status: 'unknown', observedAt: null }; }
          statusMemo.set(v.orderCode, result); draw1();
        } }, item?.loading ? 'در حال بررسی…' : 'بررسی وضعیت'));
    };
    draw1();
    return panel;
  }

  function detailView() {
    const d = S.detail;
    const back = h('button', { type: 'button', class: 'btn-back', 'aria-label': 'بازگشت به نتایج', onClick: () => { S.detail = null; draw(); } }, '←');
    if (d.status === 'loading') return h('div', { class: 'fd-detail' }, back, h('div', { class: 'cm-skel fd-skeleton__card' }));
    if (d.status === 'error') return h('div', { class: 'fd-detail' }, back, h('div', { class: 'empty-state', role: 'alert' }, h('p', { text: 'منوی این فروشگاه دریافت نشد.' }), h('button', { type: 'button', class: 'cm-btn', onClick: () => openVendor(d.id) }, 'تلاش دوباره')));
    const v = d.data, f = d.filter.trim();
    const groups = v.menu.map(g => ({ category: g.category, items: f ? g.items.filter(i => i.name.includes(f)) : g.items })).filter(g => g.items.length);
    const filter = h('input', { class: 'fd-input', type: 'search', placeholder: 'جست وجو در منوی این فروشگاه', 'aria-label': 'جست وجو در منو', value: d.filter });
    filter.addEventListener('input', () => { d.filter = filter.value; const caret = filter.value.length; draw(); const next = body.querySelector('.fd-detail .fd-input'); next?.focus?.(); next?.setSelectionRange?.(caret, caret); });
    return h('div', { class: 'fd-detail' }, back,
      h('header', { class: 'fd-detail__head' }, h('h2', { text: v.name + (v.branch ? ` · ${v.branch}` : '') }), h('p', { class: 'fd-card__sub', text: `${v.verticalLabel || v.category} · ${PROVIDERS[v.provider]}` }), v.address ? h('p', { class: 'fd-card__sub', text: v.address }) : null),
      h('p', { class: 'fd-card__meta' }, v.rating ? h('span', { text: `امتیاز ${fa(v.rating)}` }) : null, v.distanceM != null ? h('span', { text: distanceLabel(v.distanceM) }) : null,
        h('span', { text: v.minOrderState === 'known' ? `حداقل سفارش ${toman(v.minOrderToman)}` : 'حداقل سفارش نامشخص' })),
      h('p', { class: 'fd-snapshot', text: `منو و قیمت ها آخرین ثبت: ${dayLabel(v.capturedAt)}. هزینهٔ ارسال، تخفیف روز و محدودهٔ ارسال را در پلتفرم ببینید.` }),
      statusPanel(v),
      h('button', { type: 'button', class: 'cm-btn fd-order', onClick: () => openPlatformVendor(v.provider, v.orderCode, v.orderUrl) }, `سفارش در ${PROVIDERS[v.provider]}`),
      v.itemCount ? filter : null,
      groups.length ? groups.map(g => h('section', { class: 'fd-menu' }, h('h3', { text: g.category }), h('ul', { class: 'fd-items' }, g.items.map(it => h('li', { class: 'fd-item' }, h('span', { class: 'fd-item__name', text: it.name + (it.variation && it.variation !== it.name ? ` · ${it.variation}` : '') }), priceLine(it))))))
        : h('div', { class: 'empty-state' }, h('p', { text: v.itemCount ? 'موردی با این نام در منو نیست.' : 'منو در دادهٔ ثبت شده خالی است؛ منو را در پلتفرم ببینید.' })),
      v.truncated ? h('p', { class: 'fd-note', text: `فقط ${fa(400)} قلم اول از ${fa(v.itemCount)} قلم نمایش داده شد؛ منوی کامل را در پلتفرم ببینید.` }) : null);
  }

  function draw() {
    if (S.detail) { body.replaceChildren(detailView()); return; }
    body.replaceChildren(controls(), results());
  }

  el.append(
    h('header', { class: 'metro-head' },
      h('button', { type: 'button', class: 'btn-back', onClick: () => actions.go('services'), 'aria-label': 'بازگشت' }, '←'),
      h('div', null, h('h1', null, 'بسفود'), h('p', null, 'کشف غذا، کافه، شیرینی، گل و فروشگاه‌های اسنپ‌فود و تپسی‌فود؛ دسته‌ها و قیمت‌ها براساس آخرین ثبت'))),
    h('div', { class: 'fd-search' }, input), body);

  draw();
  let started = false;
  return {
    el,
    onShow(options) {
      // A home suggestion can open the search with a preset; a location preset still needs the user's tap on that card, so it asks here.
      let changed = false;
      if (options?.q && options.q !== S.q) { S.q = options.q; input.value = options.q; changed = true; }
      if (options?.vertical && VERTICALS.some(([id]) => id === options.vertical) && options.vertical !== S.vertical) {
        S.vertical = options.vertical; S.fromVerticalProfile = false; changed = true;
      }
      if (!started) {
        started = true;
        // A budget or preferred category explicitly set in Profile is not inferred from browsing.
        const stated = store?.prefs?.().foodBudgetToman;
        if (stated && BUDGETS.includes(stated) && S.budget === null) { S.budget = stated; S.fromProfile = true; }
        const preferred = store?.prefs?.().foodPreferredVerticals?.[0];
        if (!options?.vertical && preferred && VERTICALS.some(([id]) => id === preferred)) {
          S.vertical = preferred; S.fromVerticalProfile = true;
        }
        changed = true;
      }
      if (options?.near && S.nearState !== 'locating') { locate(); return; }
      if (changed) run(true);
    },
    onHide() { controller?.abort(); clearTimeout(timer); },
  };
}
