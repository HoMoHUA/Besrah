// Bespay: compare prices of a small curated set of real products across the sellers listed on the product page.
// Prices are what the page declared at the observation time; never live, never "cheapest on the market". Stock, shipping and
// warranty/colour differences stay unknown, and a seller with several different prices is shown unresolved instead of guessed.
import { h } from '../ui/dom.js';
import { fa } from '../format.js';

const BUDGETS = [null, 500000, 1000000, 2000000, 5000000];
const QUICK = ['هدفون', 'ساعت هوشمند', 'پاوربانک', 'اسپیکر', 'کیبورد'];
const DEBOUNCE_MS = 350;
const toman = v => `${Number(v).toLocaleString('fa-IR')} تومان`;
const dayLabel = iso => { const ms = Date.parse(iso ?? ''); return Number.isFinite(ms) ? new Date(ms).toLocaleDateString('fa-IR', { timeZone: 'Asia/Tehran', day: 'numeric', month: 'long' }) : 'نامشخص'; };
const faDigits = text => String(text).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
const budgetLabel = b => (b === null ? 'بدون سقف' : b >= 1000000 ? `تا ${fa(b / 1000000)} میلیون` : `تا ${fa(b / 1000)} هزار`);

function openLink(url) {
  if (typeof window === 'undefined' || !/^https:\/\/[\w.-]+\//.test(url)) return;
  if (window.Telegram?.WebApp?.openLink) window.Telegram.WebApp.openLink(url); else window.open(url, '_blank', 'noopener,noreferrer');
}

// Where the compared prices come from. Several sellers on one marketplace page are not the whole market.
export function scopeLabel(p) {
  const m = Array.isArray(p.merchants) ? p.merchants.filter(Boolean) : [];
  if (!m.length) return '';
  if (p.comparisonScope === 'multi_marketplace') return `از ${m.join('، ')}؛ همهٔ فروشگاه های بازار بررسی نشده اند.`;
  return `فقط فروشندگان صفحهٔ ${m[0]}؛ مقایسهٔ کل بازار نیست.`;
}

export function priceRange(p) {
  if (p.priceState === 'unresolved') return h('span', { class: 'sh-price sh-price--unknown', text: 'قیمت قابل اتکا ندارد' });
  return h('span', { class: 'sh-price' }, p.minToman === p.maxToman ? h('b', { text: toman(p.minToman) }) : [h('small', { text: 'از ' }), h('b', { text: toman(p.minToman) }), h('small', { text: ' تا ' }), h('b', { text: toman(p.maxToman) })]);
}

export function createShopView(ctx) {
  const { actions, api, store } = ctx;
  const S = { fromProfile: false, q: '', budget: null, sort: 'relevance', status: 'idle', products: [], total: 0, notes: [], snapshot: null, offset: 0, detail: null };
  let timer = 0, controller = null;
  const el = h('div', { class: 'view view--shop', dataset: { view: 'shop' } });
  const body = h('div', { class: 'fd-body' });
  const searchBox = h('div', { class: 'fd-search' });
  const input = h('input', { class: 'fd-input', type: 'search', inputmode: 'search', enterkeyhint: 'search', autocomplete: 'off', placeholder: 'چه کالایی؟ مثلاً هدفون', 'aria-label': 'جست وجوی کالا' });
  searchBox.append(input);
  input.addEventListener('input', () => { S.q = input.value; clearTimeout(timer); timer = setTimeout(() => run(true), DEBOUNCE_MS); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') run(true); });

  async function run(reset) {
    clearTimeout(timer); controller?.abort(); controller = new AbortController();
    const mine = controller, offset = reset ? 0 : S.offset;
    if (reset) { S.status = 'loading'; S.products = []; } else S.status = 'more';
    draw();
    try {
      const data = await api.shopSearch({ q: S.q.trim() || undefined, maxPrice: S.budget ?? undefined, sort: S.sort === 'price' ? 'price' : undefined, limit: 10, offset: offset || undefined }, mine.signal);
      if (mine !== controller) return;
      S.products = reset ? data.products : S.products.concat(data.products); S.total = data.total; S.notes = data.notes ?? []; S.snapshot = data.snapshot; S.offset = offset + data.products.length; S.status = 'ok';
    } catch (error) {
      if (mine !== controller || error?.name === 'AbortError' || error?.kind === 'aborted') return;
      S.status = error?.status === 503 ? 'unavailable' : 'error';
    }
    draw();
  }

  async function openProduct(id) {
    S.detail = { id, status: 'loading', data: null }; draw();
    try { const data = await api.shopProduct(id); if (S.detail?.id !== id) return; S.detail = { id, status: 'ok', data }; }
    catch { if (S.detail?.id === id) S.detail = { id, status: 'error', data: null }; }
    draw();
  }

  const chip = (label, pressed, onClick) => h('button', { type: 'button', class: ['cm-chip', 'fd-chip'], 'aria-pressed': String(pressed), onClick }, label);
  const snapshotNote = () => (S.snapshot?.observedTo ? h('p', { class: ['fd-snapshot', S.snapshot.stale && 'is-stale'], text: `آخرین ثبت قیمت: ${dayLabel(S.snapshot.observedTo)}${S.snapshot.stale ? ' · قدیمی' : ''}. قیمت ها لحظه ای نیستند.` }) : null);

  function controls() {
    return h('div', { class: 'fd-controls' },
      S.fromProfile && S.budget !== null ? h('p', { class: 'fd-note', text: 'این سقف را خودتان در پروفایل گذاشته اید؛ همین جا می توانید عوضش کنید.' }) : null,
      h('div', { class: 'fd-row', role: 'group', 'aria-label': 'سقف قیمت' }, BUDGETS.map(b => chip(budgetLabel(b), S.budget === b, () => { S.budget = b; S.fromProfile = false; run(true); }))),
      h('div', { class: 'fd-row', role: 'group', 'aria-label': 'مرتب سازی' }, [['relevance', 'مرتبط ترین'], ['price', 'کمترین قیمت ثبت شده']].map(([k, label]) => chip(label, S.sort === k, () => { S.sort = k; run(true); }))),
      h('div', { class: 'fd-quick', role: 'group', 'aria-label': 'پیشنهاد جست وجو' }, QUICK.map(q => h('button', { type: 'button', class: 'fd-quick__item', onClick: () => { S.q = q; input.value = q; run(true); } }, q))));
  }

  function productCard(p) {
    return h('article', { class: 'sh-card cm-card', dataset: { id: p.id } },
      h('header', { class: 'fd-card__head' }, h('div', { class: 'fd-card__title' }, h('h3', { text: p.title }), h('p', { class: 'fd-card__sub', text: [p.brand, p.category].filter(Boolean).join(' · ') })),
        h('span', { class: 'cm-badge', text: p.priceState === 'compared' ? `${fa(p.resolvedOffers)} فروشنده` : p.priceState === 'single_offer' ? 'یک فروشنده' : 'قیمت نامعلوم' })),
      h('p', { class: 'fd-card__meta' }, priceRange(p), h('span', { text: `ثبت ${dayLabel(p.observedAt)}` })),
      scopeLabel(p) ? h('p', { class: 'sh-scope', text: scopeLabel(p) }) : null,
      h('div', { class: 'fd-actions' }, h('button', { type: 'button', class: 'cm-btn', onClick: () => openProduct(p.id) }, 'مقایسهٔ فروشندگان'),
        store?.toggleSavedChoice ? h('button', {type:'button',class:['cm-btn','cm-btn--ghost','cm-btn--sm'],
          'aria-pressed':String(Boolean(store?.isSavedChoice?.('shop',p.id))),
          onClick:()=>{store.toggleSavedChoice('shop',{id:p.id,title:p.title});draw();}},
          store?.isSavedChoice?.('shop',p.id) ? 'حذف از ذخیره‌ها' : 'ذخیره کالا') : null));
  }

  function results() {
    if (S.status === 'loading') return h('div', { class: 'fd-skeleton', 'aria-busy': 'true', 'aria-label': 'در حال جست وجو' }, [0, 1, 2].map(() => h('div', { class: 'cm-skel fd-skeleton__card' })));
    if (S.status === 'error' || S.status === 'unavailable') return h('div', { class: 'empty-state', role: 'alert' }, h('p', { text: S.status === 'error' ? 'جست وجو انجام نشد؛ اتصال را بررسی کنید.' : 'فهرست کالا اکنون در دسترس نیست.' }), h('button', { type: 'button', class: 'cm-btn', onClick: () => run(true) }, 'تلاش دوباره'));
    if (!S.products.length) return h('div', { class: 'empty-state' }, h('p', { text: 'کالایی پیدا نشد. این فهرست فعلاً چند کالای منتخب دارد؛ عبارت دیگری بنویسید یا سقف قیمت را بالاتر ببرید.' }));
    return h('div', { class: 'fd-results' }, h('p', { class: 'fd-count', role: 'status', text: `${fa(S.total)} کالا${S.q.trim() ? ` برای «${S.q.trim()}»` : ''}` }), snapshotNote(), ...S.products.map(productCard),
      S.products.length < S.total ? h('button', { type: 'button', class: ['cm-btn', 'cm-btn--ghost', 'fd-more'], disabled: S.status === 'more' ? 'true' : null, onClick: () => run(false) }, S.status === 'more' ? 'در حال دریافت…' : 'نمایش بیشتر') : null,
      h('ul', { class: 'fd-notes' }, S.notes.map(t => h('li', { text: t }))));
  }

  function offerRow(o, decision) {
    const verdict = decision?.bySeller?.[o.seller];
    const price = o.state === 'resolved' ? h('b', { class: 'sh-offer__price', text: toman(o.priceToman) })
      : o.state === 'unresolved' ? h('span', { class: 'sh-offer__price sh-offer__price--unknown', text: `چند قیمت متفاوت (${o.priceCandidatesToman.map(toman).join('، ')})؛ تنوع نامشخص` })
      : h('span', { class: 'sh-offer__price sh-offer__price--unknown', text: 'قیمت غیرعادی؛ کنار گذاشته شد' });
    return h('li', { class: ['sh-offer', `is-${o.state}`] },
      verdict?.labels?.length ? h('p', { class: 'tp-labels' }, verdict.labels.map(l => h('span', { class: 'tp-label', text: l }))) : null,
      h('div', { class: 'sh-offer__main' }, h('b', { text: o.seller }), h('span', { class: 'fd-card__sub', text: `${o.merchant} · موجودی و ارسال نامعلوم` })), price,
      o.spreadWarning ? h('span', { class: 'fd-card__sub', text: 'فاصلهٔ قیمت زیاد است؛ تنوع کالا را بررسی کنید.' }) : null,
      h('button', { type: 'button', class: ['cm-btn', 'cm-btn--ghost', 'cm-btn--sm'], onClick: () => openLink(o.url) }, `مشاهده در ${o.merchant}`));
  }

  // The product page the prices were read from: a real, https-only link, shown only when the catalog carries one.
  function sourceLink(p) {
    const url = p.source?.url, name = p.merchants?.length === 1 ? p.merchants[0] : 'فروشگاه';
    if (typeof url !== 'string' || !/^https:\/\/[\w.-]+\//.test(url)) return null;
    return h('button', { type: 'button', class: ['cm-btn', 'cm-btn--ghost', 'sh-source'], onClick: () => openLink(url) }, `صفحهٔ محصول در ${name}`);
  }

  function detailView() {
    const d = S.detail, back = h('button', { type: 'button', class: 'btn-back', 'aria-label': 'بازگشت به نتایج', onClick: () => { S.detail = null; draw(); } }, '←');
    if (d.status === 'loading') return h('div', { class: 'fd-detail' }, back, h('div', { class: 'cm-skel fd-skeleton__card' }));
    if (d.status === 'error') return h('div', { class: 'fd-detail' }, back, h('div', { class: 'empty-state', role: 'alert' }, h('p', { text: 'جزئیات این کالا دریافت نشد.' }), h('button', { type: 'button', class: 'cm-btn', onClick: () => openProduct(d.id) }, 'تلاش دوباره')));
    const p = d.data;
    return h('div', { class: 'fd-detail' }, back,
      h('header', { class: 'fd-detail__head' }, h('h2', { text: p.title }), h('p', { class: 'fd-card__sub', text: [p.brand, p.category].filter(Boolean).join(' · ') })),
      h('p', { class: ['fd-snapshot', p.snapshot.stale && 'is-stale'], text: `قیمت ها در ${dayLabel(p.snapshot.observedAt)} از صفحهٔ محصول ثبت شده اند${p.snapshot.stale ? ' و قدیمی اند' : ''}؛ لحظه ای نیستند.` }),
      p.spread ? h('p', { class: 'fd-card__meta' }, h('span', { text: `کمترین ثبت شده ${toman(p.spread.minToman)}` }), h('span', { text: `بیشترین ${toman(p.spread.maxToman)}` }), p.spread.ratio >= 1.1 ? h('span', { text: `${faDigits(p.spread.ratio).replace('.', '٫')} برابر` }) : null) : null,
      scopeLabel(p) ? h('p', { class: 'sh-scope', text: scopeLabel(p) }) : null,
      h('ul', { class: 'sh-offers' }, p.offers.map(o => offerRow(o, p.decision))),
      p.decision?.notes?.length ? h('ul', { class: 'fd-notes' }, p.decision.notes.map(t => h('li', { text: t }))) : null,
      sourceLink(p),
      h('p', { class: 'fd-note', text: 'رنگ و گارانتی فروشندگان با هم مقایسه نشده؛ پیش از خرید در صفحهٔ فروشنده تأیید کنید.' }),
      h('ul', { class: 'fd-notes' }, p.notes.map(t => h('li', { text: t }))));
  }

  function draw() { searchBox.hidden = Boolean(S.detail); body.replaceChildren(...(S.detail ? [detailView()] : [controls(), results()])); }

  el.append(h('header', { class: 'metro-head' },
    h('button', { type: 'button', class: 'btn-back', onClick: () => actions.go('services'), 'aria-label': 'بازگشت' }, '←'),
    h('div', null, h('h1', null, 'بسخرید'), h('p', null, 'مقایسهٔ قیمت ثبت شدهٔ چند کالای منتخب، با منشأ و زمان هر قیمت'))),
    h('div', { class: 'pay-soon', role: 'note' }, h('b', { text: 'بسپی · پرداخت و کیف پول' }), h('span', { class: 'cm-badge', text: 'به زودی' }), h('p', { text: 'پرداخت درون برنامه هنوز ساخته نشده و زمانی برایش اعلام نشده است. فعلاً قیمت ها را مقایسه کنید و خرید را در فروشگاه انجام دهید.' })),
    searchBox, body);
  draw();
  let started = false;
  return { el, onShow(options) {
    let changed = false;
    if (options?.q && options.q !== S.q) { S.q = options.q; input.value = options.q; changed = true; }
    if (started) { if (changed) run(true); return; }
    started = true;
    // A budget the user stated in Profile is the starting point of the first search; it is announced and never inferred.
    const stated = store?.prefs?.().shopBudgetToman;
    if (stated && BUDGETS.includes(stated)) { S.budget = stated; S.fromProfile = true; }
    run(true);
  }, onHide() { controller?.abort(); clearTimeout(timer); } };
}
