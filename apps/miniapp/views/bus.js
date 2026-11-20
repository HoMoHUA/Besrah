// Bus: the static guide (lines, ordered stops, stop-to-line lookup from a reviewed offline OSM projection) plus live arrivals
// at an official stop from the Mashhad municipal geoportal. A number of minutes is shown only when the provider backs it with
// a fresh bus position; everything else is said to be unknown. Stop search text is sent (POST) only to find the stop.
import { buildIndex, loopVariant, searchLines, searchStops } from '../bus-data.js';
import { findBusConnections } from '../bus-paths.js';
import { BUS_ARRIVAL_SOURCES, busHandoffNote, openBusSource } from '../bus-sources.js';
import { createRideTabs } from '../ui/ride-tabs.js';
import { h, icon, backButton } from '../ui/dom.js';
import { init } from '../ui/hm7.js';

const SOURCE_NOTE = 'مسیرهای این راهنما از OpenStreetMap هستند و با بهره‌بردار تطبیق داده نشده‌اند. زمان رسیدن زنده فقط در بخش «زمان رسیدن زنده» و از سامانهٔ شهرداری مشهد می‌آید.';
const fa = n => Number(n).toLocaleString('fa-IR');
// Identifiers (line and stop numbers) in Persian digits, without thousands separators.
const faId = v => String(v).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]).replace(/\./g, '٫');
// Running text with Persian digits ("خط 38/1" -> "خط ۳۸/۱").
const faText = v => String(v).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
// One line per arrival. Minutes only for a live, provider-backed estimate.
export function arrivalText(a) {
  const to = a.destination ? ` به ${a.destination}` : '', line = faId(a.line);
  if (a.state === 'live' && Number.isInteger(a.etaMin)) return `خط ${line}${to}: ${a.etaMin <= 0 ? 'در حال رسیدن' : `${fa(a.etaMin)} دقیقه`}`;
  if (a.state === 'no_bus') return `خط ${line}${to}: اتوبوسی در راه نیست`;
  if (a.state === 'stale') return `خط ${line}${to}: زمان نامعلوم (موقعیت اتوبوس قدیمی است)`;
  return `خط ${line}${to}: زمان نامعلوم`;
}
// Same line in the guide and in the municipal answer ("38/1" is "38.1" there); express refs only match themselves.
const lineKey = v => String(v ?? '').trim().replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/\//g, '.').toLowerCase();
export const sameLine = (a, b) => lineKey(a) !== '' && lineKey(a) === lineKey(b);
const baseKey = v => String(v ?? '').replace(/[\u200c\s()]/g, '').replace(/^ایستگاه/, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[0-9۰-۹]+$/, '');
const ageText = a => (a.bus && Number.isInteger(a.bus.ageS) ? (a.bus.ageS < 60 ? 'موقعیت چند ثانیه پیش' : `موقعیت ${fa(Math.round(a.bus.ageS / 60))} دقیقه پیش`) : '');

export function createBusView(ctx) {
  const { actions, api, sheet } = ctx;
  let status = 'idle', index = null, query = '';
  let routeFrom = '', routeTo = '';
  const root = h('div', { class: 'view view--bus' });
  const input = h('input', { id: 'bus-q', type: 'text', inputmode: 'search', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'جست وجوی خط یا ایستگاه اتوبوس', placeholder: 'شماره خط، مبدا یا نام ایستگاه' });
  const clear = h('button', { type: 'button', class: 'search-clear cm-icon-btn', hidden: true, 'aria-label': 'پاک کردن جست وجو' }, icon('xmark_circle_fill'));
  const results = h('div', { class: 'bus-results', 'aria-live': 'polite' });
  const dateText = () => (index?.meta?.osm_base ?? '').slice(0, 10);
  const fromInput = h('input', { id: 'bus-route-from', type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: 'نام دقیق ایستگاه مبدأ', 'aria-label': 'ایستگاه مبدأ اتوبوس' });
  const toInput = h('input', { id: 'bus-route-to', type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: 'نام دقیق ایستگاه مقصد', 'aria-label': 'ایستگاه مقصد اتوبوس' });
  const routeSuggestions = h('div', { class: 'bus-route-suggestions', 'aria-live': 'polite' });
  const routeResults = h('div', { class: 'bus-route-results', 'aria-live': 'polite' });
  const routeIntro = h('p', { class: 'bus-note', text: 'مسیرهای ممکن با توجه به ترتیب ایستگاه‌های ثبت‌شده پیدا می‌شوند. زمان رسیدن، هزینه، تأیید فعالیت خط و امکان تعویض واقعی نامعلوم است.' });

  // ── live arrivals at an official stop ──
  const live = { q: '', stops: [], status: 'idle', station: null, data: null, timer: null, ctrl: null };
  const liveInput = h('input', { id: 'bus-live-q', type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: 'نام ایستگاه یا شمارهٔ آن', 'aria-label': 'ایستگاه برای زمان رسیدن زنده' });
  const liveOut = h('div', { class: 'bus-live__out', 'aria-live': 'polite' });
  async function liveSearch() {
    const q = live.q.trim();
    if (q.length < 2 && !/^\d+$/.test(q)) { live.stops = []; live.status = 'idle'; drawLive(); return; }
    live.ctrl?.abort(); live.ctrl = new AbortController(); const mine = live.ctrl;
    live.status = 'searching'; drawLive();
    try { const r = await api.busStops(q, mine.signal); if (mine !== live.ctrl) return; live.stops = r.stops; live.status = r.stops.length ? 'picked' : 'nostop'; }
    catch (e) { if (mine !== live.ctrl || e?.kind === 'aborted') return; live.stops = []; live.status = /^\d{1,6}$/.test(q) ? 'number' : 'searcherror'; }
    drawLive();
  }
  async function liveLoad(station) {
    live.station = station; live.status = 'loading'; live.data = null; drawLive();
    try { live.data = await api.busEta(station.number); live.status = 'eta'; }
    catch (e) { live.status = e?.kind === 'rate_limited' ? 'busy' : 'etaerror'; }
    drawLive();
  }
  function drawLive() {
    const note = text => h('p', { class: 'bus-note', text });
    const stopButton = s => h('button', { type: 'button', class: ['cm-chip', 'bus-live__stop'], onClick: () => liveLoad(s) }, `${s.name} · ${faId(s.number)}`);
    const kids = [];
    if (live.status === 'searching') kids.push(h('div', { class: 'cm-skel fd-skeleton__card', 'aria-busy': 'true' }));
    if (live.status === 'nostop') kids.push(note('ایستگاهی با این نام در فهرست شهرداری پیدا نشد؛ نام کوتاه‌تر یا شمارهٔ ایستگاه را بنویسید.'));
    if (live.status === 'searcherror') kids.push(note('جست‌وجوی ایستگاه الان در دسترس نیست؛ اگر شمارهٔ ایستگاه را می‌دانید، آن را بنویسید.'));
    if (live.status === 'number') kids.push(h('button', { type: 'button', class: ['cm-btn', 'cm-btn--ghost', 'cm-btn--sm'], onClick: () => liveLoad({ number: Number(live.q.trim()), name: `ایستگاه ${faId(live.q.trim())}` }) }, `زمان رسیدن ایستگاه ${faId(live.q.trim())}`));
    if (live.stops.length && ['picked', 'loading', 'eta', 'etaerror', 'busy'].includes(live.status)) kids.push(h('div', { class: 'cm-chips' }, live.stops.map(stopButton)));
    if (live.status === 'loading') kids.push(h('div', { class: 'cm-skel fd-skeleton__card', 'aria-busy': 'true' }));
    if (live.status === 'busy') kids.push(note('درخواست‌ها زیاد است؛ چند ثانیه بعد دوباره امتحان کنید.'));
    if (live.status === 'etaerror') kids.push(note('سامانهٔ شهرداری الان جواب نداد؛ زمان رسیدن نامعلوم است.'), h('button', { type: 'button', class: ['cm-btn', 'cm-btn--ghost', 'cm-btn--sm'], onClick: () => liveLoad(live.station) }, 'تلاش دوباره'));
    if (live.status === 'eta' && live.data) {
      const rows = live.data.arrivals;
      kids.push(h('h3', { class: 'bus-live__title', text: live.station.name }),
        rows.length ? h('ul', { class: 'fd-notes bus-live__list' }, rows.map(a => h('li', { class: a.state === 'live' ? 'is-live' : '' }, h('span', { text: arrivalText(a) }), ageText(a) ? h('small', { text: ` · ${ageText(a)}` }) : null)))
          : note('سامانهٔ شهرداری برای این ایستگاه خطی گزارش نکرد.'),
        note(`منبع: سامانهٔ شهرداری مشهد، دریافت ${new Date(live.data.retrievedAt).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tehran' })}. زمان‌ها برآورد خود سامانه‌اند.`),
        h('button', { type: 'button', class: ['cm-btn', 'cm-btn--ghost', 'cm-btn--sm'], onClick: () => liveLoad(live.station) }, 'به‌روزرسانی'));
    }
    liveOut.replaceChildren(...kids);
  }
  liveInput.addEventListener('input', () => { live.q = liveInput.value; clearTimeout(live.timer); live.timer = setTimeout(liveSearch, 300); });
  const livePanel = h('section', { class: 'cm-card about-card bus-live', 'aria-labelledby': 'bus-live-title' },
    h('h2', { id: 'bus-live-title', class: 'about-card__title', text: 'زمان رسیدن زنده' }),
    h('label', { class: 'cm-search cm-inset', for: 'bus-live-q' }, icon('magnifyingglass'), liveInput),
    liveOut);

  function pickStop(name, target) {
    if (target === 'from') { routeFrom = name; fromInput.value = name; } else { routeTo = name; toInput.value = name; }
    routeSuggestions.replaceChildren();
    renderRoutes();
  }
  function suggest(field) {
    if (!index) return;
    const term = field === 'from' ? fromInput.value : toInput.value;
    const matches = searchStops(index, term, 6);
    routeSuggestions.replaceChildren(...matches.map(stop => h('button', { type: 'button', class: 'cm-chip',
      onClick: () => pickStop(stop.name, field), text: stop.name })));
  }
  function renderRoutes() {
    if (!index) return routeResults.replaceChildren(h('p', { class: 'bus-note', text: 'ابتدا فهرست خطوط را دریافت کنید.' }));
    const found = findBusConnections(index, routeFrom, routeTo);
    if (!routeFrom || !routeTo) return routeResults.replaceChildren(h('p', { class: 'bus-note', text: 'ایستگاه مبدأ و مقصد را انتخاب کنید.' }));
    if (!found.length) return routeResults.replaceChildren(h('p', { class: 'bus-note', text: 'در ترتیب ایستگاه‌های فعلی، اتصال مستقیمی یا با یک تعویض پیدا نشد. این به معنی نبود خط واقعی نیست؛ نام دقیق و مسیر رسمی را بررسی کنید.' }));
    routeResults.replaceChildren(...found.map((route, i) => h('div', { class: 'cm-card' },
      h('strong', { text: `گزینه ${i + 1} • ${route.type === 'direct' ? 'بدون تعویض' : 'یک تعویض احتمالی'}` }),
      ...route.legs.map(l => h('p', { class: 'bus-note', text: `خط ${l.label}، ${l.from} ← ${l.to}، ${l.stopCount} توقف ثبت‌شده` })),
      h('p', { class: 'bus-note', text: route.warning }),
      h('p', { class: 'bus-note', text: 'زمان سفر و زمان انتظار قابل محاسبه نیست؛ این گزینه‌ها بر اساس زمان رتبه‌بندی نشده‌اند.' }))));
  }
  const officialLinks = name => h('div', { class: 'bus-source-links' }, 
    h('p', { class: 'bus-note', text: busHandoffNote(name) }),
    ...BUS_ARRIVAL_SOURCES.map(src => h('button', { type: 'button', class: 'cm-btn cm-btn--sm',
      onClick: () => openBusSource(src.id), text: `بررسی در ${src.title}` })));
  const routePanel = h('section', { class: 'cm-card bus-route-panel', 'aria-labelledby': 'bus-route-title' }, 
    h('h2', { id: 'bus-route-title', class: 'about-card__title', text: 'اتصال بین دو ایستگاه اتوبوس' }),
    routeIntro,
    h('div', { class: 'bus-route-fields' },
      h('label', { for: 'bus-route-from', text: 'مبدأ' }), fromInput,
      h('label', { for: 'bus-route-to', text: 'مقصد' }), toInput),
    routeSuggestions,
    h('button', { type: 'button', class: 'cm-btn cm-btn--sm', onClick: () => { routeFrom = fromInput.value.trim(); routeTo = toInput.value.trim(); routeSuggestions.replaceChildren(); renderRoutes(); }, text: 'یافتن مسیرهای ممکن' }),
    routeResults);
  fromInput.addEventListener('input', () => { routeFrom = fromInput.value.trim(); suggest('from'); });
  toInput.addEventListener('input', () => { routeTo = toInput.value.trim(); suggest('to'); });

  const lineButton = line => {
    const first = line.variants[0];
    const isExp = line.isExpress || /^EXP-/i.test(line.ref);
    const label = line.label || line.ref;
    const title = line.title || `خط ${line.ref}`;
    return h('button', { type: 'button', class: ['bus-line', isExp && 'bus-line--express'].filter(Boolean).join(' '), dataset: { line: line.ref }, 'aria-label': `${title}، از ${first.from} به ${first.to}`, onClick: () => showLine(line) },
      h('bdi', { class: ['bus-line__ref', isExp && 'bus-line__ref--express'].filter(Boolean).join(' '), dir: isExp ? 'rtl' : 'ltr', text: label }),
      h('span', { class: 'bus-line__body' },
        h('strong', { text: `از ${first.from} به ${first.to}` }),
        h('small', { text: isExp ? `${line.variants.length} مسیر ثبت شده • خط تندرو` : `${line.variants.length} مسیر ثبت شده` })),
      icon('chevron_left'));
  };
  const stopButton = stop => h('button', { type: 'button', class: 'bus-line bus-line--stop', dataset: { stop: stop.name }, 'aria-label': `${stop.name}، ${stop.refs.length} خط`, onClick: () => showStop(stop) },
    h('span', { class: 'bus-line__pin' }, icon('location_north_up_right_circle_fill')),
    h('span', { class: 'bus-line__body' }, h('strong', { text: stop.name }), h('small', { text: `${stop.refs.length} خط عبوری ثبت شده` })), icon('chevron_left'));

  function paint() {
    clear.hidden = !query;
    if (status === 'loading' || status === 'idle') return results.replaceChildren(h('div', { class: 'bs-progress', role: 'progressbar', 'aria-label': 'در حال دریافت فهرست خط ها' }, h('i')),
      h('div', { class: 'bus-skeleton', 'aria-hidden': 'true' }, Array.from({ length: 7 }, () => h('div', { class: 'cm-skel bus-skel' }))));
    if (status === 'error') return results.replaceChildren(h('p', { class: 'bus-note', text: 'دریافت فهرست خط ها انجام نشد.' }), h('button', { type: 'button', class: 'cm-btn cm-btn--sm', onClick: load, text: 'تلاش دوباره' }));
    const lines = searchLines(index, query), stops = searchStops(index, query);
    const children = [];
    if (stops.length) children.push(h('h2', { class: 'bus-section-title', text: 'ایستگاه ها' }), ...stops.map(stopButton));
    children.push(h('h2', { class: 'bus-section-title', text: query ? 'خط ها' : `همه خط ها (${lines.length})` }), ...lines.map(lineButton));
    if (!lines.length && !stops.length) children.splice(0, children.length, h('div', { class: 'cm-card cm-empty' }, h('div', { class: 'cm-empty__art' }, icon('magnifyingglass')), h('h3', { text: 'نتیجه ای پیدا نشد' }), h('p', { class: 'bus-note', text: 'شماره خط، مبدا یا نام ایستگاه را دقیق تر بنویسید.' })));
    results.replaceChildren(...children);
  }

  async function load() {
    if (status === 'loading' || status === 'ready') return;
    status = 'loading'; paint();
    try { index = buildIndex(await api.busGuide()); status = 'ready'; } catch { status = 'error'; }
    paint(); if (status === 'ready') renderRoutes();
  }

  /* Sheets. A line opens its ordered stops and every stop opens its live arrivals; a stop found by search opens its lines.
     Inside an open sheet each next page is pushed: it slides in and Back (button, Android, Telegram) returns one page.
     A sheet host without pages (older callers, tests) swaps the content instead. */
  let pageSeq = 0;
  const stackable = () => typeof sheet.push === 'function' && sheet.isOpen;
  function present(content, labelledBy, { onClosed, onLeave } = {}) {
    if (stackable()) sheet.push(content, { labelledBy, onLeave });
    else sheet.open(content, { labelledBy, onClosed, stacked: true });
    init(content);
  }
  const sheetHead = (title, sub, id, back) => h('div', { class: 'station__head' },
    back ? backButton('بازگشت به صفحهٔ قبل', () => sheet.pop?.()) : null,
    h('div', { class: 'station__titles' }, h('h2', { class: 'station__name', id, tabindex: '-1', 'data-autofocus': '', text: title }), sub ? h('p', { class: 'station__sub', text: sub }) : null),
    h('button', { class: 'cm-icon-btn cm-frost station__close el', type: 'button', 'aria-label': 'بستن', onClick: () => sheet.close() }, icon('xmark')));

  // Official station of every stop of a variant, from this app's server (null when the link is not available).
  const variantMatches = new Map();
  function matchesFor(variant) {
    if (typeof api.busVariantStops !== 'function') return Promise.resolve(null);
    if (!variantMatches.has(variant.id)) {
      variantMatches.set(variant.id, api.busVariantStops(variant.id)
        .then(r => (r.stops.length === variant.stops.length ? r.stops : null))
        .catch(() => { variantMatches.delete(variant.id); return null; }));
    }
    return variantMatches.get(variant.id);
  }

  function showLine(line, startId) {
    let active = line.variants.find(v => v.id === startId) ?? line.variants[0];
    const id = `bus-line-${++pageSeq}`, back = stackable();
    const variants = h('div', { class: 'cm-chips bus-variants', role: 'group', 'aria-label': 'مسیرهای ثبت شده' });
    const list = h('ol', { class: 'bus-stops' });
    const notes = h('div', { class: 'bus-notes' });
    const title = faText(line.title || `خط ${line.ref}`);
    const isExp = line.isExpress || /^EXP-/i.test(line.ref);
    const paintLine = () => {
      const variant = active;
      variants.replaceChildren(...(line.variants.length > 1 ? line.variants.map(v => h('button', { type: 'button', class: 'cm-chip bus-variant', 'aria-pressed': String(v === active),
        onClick: () => { active = v; paintLine(); } }, `از ${v.from} به ${v.to}`)) : []));
      const numbers = variant.stops.map(() => h('small', { class: 'bus-stop__no' }));
      const buttons = variant.stops.map((name, seq) => h('button', { type: 'button', class: 'bus-stop', dataset: { seq: String(seq) }, 'aria-label': `${name}، زمان رسیدن`,
        onClick: () => showStopPage(line, variant, seq) }, h('span', { class: 'bus-stop__name', text: name }), numbers[seq], icon('chevron_left')));
      list.replaceChildren(...buttons.map(b => h('li', null, b)));
      matchesFor(variant).then(stops => {
        if (!stops || active !== variant) return;
        stops.forEach((s, i) => { if (s?.match) numbers[i].textContent = faId(s.match.number); });
      });
      // Native replaceChildren renders `false` as text, so conditional notes are filtered explicitly.
      notes.replaceChildren(...[
        h('p', { class: 'bus-note', text: `${active.stops.length} ایستگاه ثبت شده، به ترتیب داده منبع. روی هر ایستگاه بزنید تا زمان رسیدن اتوبوس‌ها را ببینید.` }),
        isExp && h('p', { class: 'bus-note bus-note--express', text: 'این خط تندرو (اکسپرس) است و در مسیر خود تنها در ایستگاه‌های منتخب توقف دارد.' }),
        loopVariant(active) && h('p', { class: 'bus-note', text: 'ایستگاه اول و آخر این مسیر یکی است؛ ممکن است مسیر گردشی باشد.' }),
        active.derived && h('p', { class: 'bus-note', text: 'مبدا و مقصد این مسیر در داده منبع ثبت نشده و از نام انگلیسی همان مسیر و نام پایانه ها برداشته شده است.' })].filter(Boolean));
    };
    paintLine();
    present(h('div', { class: 'station bus-sheet' }, sheetHead(title, isExp ? 'ایستگاه های منتخب (خط تندرو)' : 'ایستگاه های ثبت شده', id, back), h('div', { class: 'station__scroll' }, variants, list, notes)), id);
  }

  // One stop of one line: its official station and the municipal live arrivals there, this line first.
  function showStopPage(line, variant, seq) {
    const name = variant.stops[seq], title = faText(line.title || `خط ${line.ref}`);
    const id = `bus-stop-${++pageSeq}`, back = stackable();
    const st = { station: null, status: 'matching', data: null, candidates: [], searched: false, timer: null, ctrl: null };
    const official = h('p', { class: 'bus-stop-page__official' });
    const out = h('div', { class: 'bus-eta', 'aria-live': 'polite' });
    const refresh = h('button', { type: 'button', class: ['cm-btn', 'cm-btn--ghost', 'cm-btn--sm', 'bus-eta__refresh'], hidden: true, onClick: () => load() }, icon('arrow_clockwise'), 'به‌روزرسانی');
    const note = text => h('p', { class: 'bus-note', text });
    const etaRow = (a, current) => {
      const live = a.state === 'live' && Number.isInteger(a.etaMin);
      const time = live ? (a.etaMin <= 0 ? 'در حال رسیدن' : `${fa(a.etaMin)} دقیقه`) : a.state === 'no_bus' ? 'اتوبوسی در راه نیست' : a.state === 'stale' ? 'نامعلوم (موقعیت قدیمی)' : 'نامعلوم';
      // Minutes get their own column; any other state is a quiet second line, so the destination keeps its width.
      return h('div', { class: ['bus-eta-row', current && 'is-current', live && 'is-live'] },
        h('bdi', { class: 'bus-eta-row__line', dir: 'ltr', text: current ? faText(line.label || line.ref) : faId(a.line) }),
        h('span', { class: 'bus-eta-row__body' }, h('b', { text: a.destination ? `به ${a.destination}` : `خط ${faId(a.line)}` }),
          live ? (ageText(a) ? h('small', { text: ageText(a) }) : null) : h('small', { class: 'bus-eta-row__state', text: time })),
        live ? h('span', { class: ['bus-eta-row__time', a.etaMin <= 0 && 'is-now'], text: time }) : null);
    };
    function draw() {
      const kids = [];
      if (['matching', 'loading', 'searching'].includes(st.status)) kids.push(h('div', { class: 'cm-skel bus-eta__skel', 'aria-busy': 'true', 'aria-label': 'در حال دریافت' }));
      if (st.status === 'choose') kids.push(note(st.searched ? 'ایستگاه خودتان را از فهرست شهرداری انتخاب کنید:' : 'چند ایستگاه رسمی با همین نام کنار هم هست (مثلاً سکوهای یک پایانه)؛ ایستگاه خودتان را انتخاب کنید:'),
        h('div', { class: 'cm-chips' }, st.candidates.map(c => h('button', { type: 'button', class: ['cm-chip', 'bus-live__stop'], onClick: () => choose(c, 'user') }, `${c.name} · ${faId(c.number)}`))));
      if (st.status === 'nomatch' || st.status === 'nomap') kids.push(note(st.status === 'nomap' ? 'پیوند این ایستگاه با سامانهٔ شهرداری الان در دسترس نیست.' : 'شمارهٔ رسمی این ایستگاه با اطمینان پیدا نشد؛ برای همین زمانی حدس زده نمی‌شود.'),
        h('button', { type: 'button', class: ['cm-btn', 'cm-btn--ghost', 'cm-btn--sm'], onClick: search }, 'جست‌وجو در فهرست شهرداری'));
      if (st.status === 'nostop') kids.push(note('ایستگاهی با این نام در فهرست شهرداری پیدا نشد؛ شمارهٔ ایستگاه را در بخش «زمان رسیدن زنده» بنویسید.'));
      if (st.status === 'searcherror') kids.push(note('جست‌وجوی فهرست شهرداری الان در دسترس نیست.'));
      if (st.status === 'busy') kids.push(note('درخواست‌ها زیاد است؛ چند ثانیه بعد دوباره امتحان کنید.'));
      if (st.status === 'etaerror') kids.push(note('سامانهٔ شهرداری الان جواب نداد؛ زمان رسیدن نامعلوم است.'));
      if (st.status === 'eta' && st.data) {
        const rows = st.data.arrivals, mine = rows.filter(a => sameLine(a.line, line.ref)), others = rows.filter(a => !sameLine(a.line, line.ref));
        kids.push(h('div', { class: 'bus-eta__mine' }, mine.length ? mine.map(a => etaRow(a, true)) : note(`سامانهٔ شهرداری برای ${title} در این ایستگاه زمانی گزارش نکرد.`)));
        if (others.length) kids.push(h('div', { class: 'bus-eta__others' }, h('h4', { class: 'bus-eta__h', text: 'خط‌های دیگر در این ایستگاه' }), others.map(a => etaRow(a, false))));
        kids.push(note(`منبع: سامانهٔ شهرداری مشهد، دریافت ${new Date(st.data.retrievedAt).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tehran' })}. زمان‌ها برآورد خود سامانه‌اند و هر ۳۰ ثانیه تازه می‌شوند.`));
      }
      out.replaceChildren(...kids);
      refresh.hidden = !st.station || st.status === 'loading';
    }
    async function load(background = false) {
      if (!st.station) return;
      st.ctrl?.abort?.();
      const ctrl = st.ctrl = typeof AbortController === 'function' ? new AbortController() : {};
      if (!background) { st.status = 'loading'; draw(); }
      try {
        const data = await api.busEta(st.station.number, ctrl.signal);
        if (ctrl !== st.ctrl) return;
        st.data = data; st.status = 'eta';
      } catch (e) {
        if (ctrl !== st.ctrl || e?.kind === 'aborted') return;
        // A missed background refresh keeps the last answer for a short while; older minutes are never left on screen.
        const age = st.data ? Date.now() - Date.parse(st.data.retrievedAt) : Infinity;
        if (!background || !(age < 90_000)) st.status = e?.kind === 'rate_limited' ? 'busy' : 'etaerror';
      }
      draw();
    }
    const stop = () => { clearInterval(st.timer); st.timer = null; st.ctrl?.abort?.(); };
    function choose(station, how) {
      st.station = station;
      const renamed = station.name && baseKey(station.name) !== baseKey(name);
      official.textContent = `ایستگاه رسمی ${faId(station.number)}${renamed ? ` · در سامانهٔ شهرداری: ${station.name}` : ''}${how === 'user' ? ' (انتخاب شما)' : how === 'nearby_name' || how === 'nearby_side' ? ' (تطبیق با نام و فاصله)' : ''}`;
      load();
      clearInterval(st.timer);
      st.timer = setInterval(() => {
        if (page.isConnected === false) return stop();
        if (page.closest?.('[inert]') || globalThis.document?.hidden) return;
        load(true);
      }, 30_000);
      st.timer?.unref?.();
    }
    async function search() {
      st.status = 'searching'; st.searched = true; draw();
      try {
        const r = await api.busStops(name.replace(/^ایستگاه\s*/, '').slice(0, 60));
        st.candidates = r.stops.slice(0, 8); st.status = st.candidates.length ? 'choose' : 'nostop';
      } catch { st.status = 'searcherror'; }
      draw();
    }
    const prev = variant.stops[seq - 1], next = variant.stops[seq + 1];
    const guideStop = index?.stops.find(x => x.name === name);
    const otherLines = (guideStop?.refs ?? []).filter(ref => ref !== line.ref).map(ref => index.byRef.get(ref)).filter(Boolean);
    const page = h('div', { class: 'station bus-sheet bus-stop-page' },
      sheetHead(name, `${title} · به سمت ${variant.to}`, id, back),
      h('div', { class: 'station__scroll' },
        official,
        h('section', { class: 'bus-eta-card', 'aria-labelledby': `${id}-eta` },
          h('div', { class: 'bus-eta-card__head' }, h('h3', { id: `${id}-eta`, text: 'زمان رسیدن' }), refresh), out),
        h('div', { class: 'bus-stop-page__route' },
          h('p', null, h('b', { text: 'ایستگاه قبلی' }), h('span', { text: prev ?? 'ابتدای مسیر' })),
          h('p', null, h('b', { text: 'ایستگاه بعدی' }), h('span', { text: next ?? 'انتهای مسیر' }))),
        otherLines.length ? h('section', { class: 'bus-stop-page__lines' }, h('h3', { class: 'bus-eta__h', text: 'خط‌های دیگری که در راهنما از این ایستگاه می‌گذرند' }),
          h('div', { class: 'cm-chips' }, otherLines.map(l => h('button', { type: 'button', class: 'cm-chip', onClick: () => showLine(l) }, faText(l.title || `خط ${l.ref}`))))) : null,
        officialLinks(name)));
    present(page, id, { onLeave: stop });
    draw();
    matchesFor(variant).then(stops => {
      if (st.station) return;
      const s = stops?.[seq];
      if (s?.match) return choose({ number: s.match.number, name: s.match.name }, s.match.method);
      st.candidates = s?.candidates ?? [];
      st.status = !stops ? 'nomap' : st.candidates.length ? 'choose' : 'nomatch';
      draw();
    });
  }

  function showStop(stop) {
    let chosenInput = null;
    const id = `bus-guide-stop-${++pageSeq}`;
    present(h('div', { class: 'station bus-sheet' }, sheetHead(stop.name, `${stop.refs.length} خط عبوری ثبت شده`, id, stackable()),
      h('div', { class: 'station__scroll' },
        h('div', { class: 'cm-chips' },
          h('button', { type: 'button', class: 'cm-chip', onClick: () => { pickStop(stop.name, 'from'); chosenInput = fromInput; sheet.close(); }, text: 'انتخاب مبدأ' }),
          h('button', { type: 'button', class: 'cm-chip', onClick: () => { pickStop(stop.name, 'to'); chosenInput = toInput; sheet.close(); }, text: 'انتخاب مقصد' })),
        h('p', { class: 'bus-note', text: 'برای زمان رسیدن، خط را باز کنید و روی همین ایستگاه بزنید؛ جهت حرکت خط، ایستگاه درست را مشخص می‌کند.' }),
        ...stop.refs.map(ref => lineButton(index.byRef.get(ref))),
        officialLinks(stop.name))), id,
      { onClosed: () => { if (chosenInput) { chosenInput.focus?.(); chosenInput.scrollIntoView?.({ block: 'center' }); } } });
  }

  input.addEventListener('input', () => { query = input.value; paint(); });
  clear.addEventListener('click', () => { input.value = ''; query = ''; paint(); input.focus(); });
  root.append(
    h('header', { class: 'metro-head' },
      backButton('بازگشت از اتوبوس', () => actions.back()),
      h('img', { src: 'assets/services/caravan.svg', alt: '', width: 60, height: 60 }),
      h('div', {}, h('h1', { text: 'اتوبوس' }), h('p', { text: 'خط ها و ایستگاه های مشهد' }))),
    createRideTabs('bus', actions),
    livePanel,
    routePanel,
    h('label', { class: 'cm-search cm-inset bus-search', for: 'bus-q' }, icon('magnifyingglass'), input, clear),
    results,
    h('section', { class: 'cm-card about-card', 'aria-labelledby': 'bus-method-title' },
      h('h2', { id: 'bus-method-title', class: 'about-card__title', text: 'درباره اطلاعات اتوبوس' }),
      h('p', { text: SOURCE_NOTE }), officialLinks(''),
      h('p', { dir: 'ltr', text: `© OpenStreetMap contributors · ODbL-1.0${dateText() ? ' · ' + dateText() : ''}` })));
  paint();
  return { el: root, mount() { init(root); }, onShow() { load(); }, onHide() {} };
}
