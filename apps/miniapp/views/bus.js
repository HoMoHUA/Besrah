// Bus: the static guide (lines, ordered stops, stop-to-line lookup from a reviewed offline OSM projection) plus live arrivals
// at an official stop from the Mashhad municipal geoportal. A number of minutes is shown only when the provider backs it with
// a fresh bus position; everything else is said to be unknown. Stop search text is sent (POST) only to find the stop.
import { buildIndex, loopVariant, searchLines, searchStops } from '../bus-data.js';
import { findBusConnections } from '../bus-paths.js';
import { BUS_ARRIVAL_SOURCES, busHandoffNote, openBusSource } from '../bus-sources.js';
import { createRideTabs } from '../ui/ride-tabs.js';
import { h, icon } from '../ui/dom.js';
import { init } from '../ui/hm7.js';

const SOURCE_NOTE = 'مسیرهای این راهنما از OpenStreetMap هستند و با بهره‌بردار تطبیق داده نشده‌اند. زمان رسیدن زنده فقط در بخش «زمان رسیدن زنده» و از سامانهٔ شهرداری مشهد می‌آید.';
const fa = n => Number(n).toLocaleString('fa-IR');
// Identifiers (line and stop numbers) in Persian digits, without thousands separators.
const faId = v => String(v).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]).replace(/\./g, '٫');
// One line per arrival. Minutes only for a live, provider-backed estimate.
export function arrivalText(a) {
  const to = a.destination ? ` به ${a.destination}` : '', line = faId(a.line);
  if (a.state === 'live' && Number.isInteger(a.etaMin)) return `خط ${line}${to}: ${a.etaMin <= 0 ? 'در حال رسیدن' : `${fa(a.etaMin)} دقیقه`}`;
  if (a.state === 'no_bus') return `خط ${line}${to}: اتوبوسی در راه نیست`;
  if (a.state === 'stale') return `خط ${line}${to}: زمان نامعلوم (موقعیت اتوبوس قدیمی است)`;
  return `خط ${line}${to}: زمان نامعلوم`;
}
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

  /* sheets: a stop opens its lines; a line opens its ordered stops. Content swaps in place when a sheet is already open. */
  function present(content) {
    if (sheet.isOpen) {
      sheet.element.replaceChildren(content);
      sheet.element.setAttribute('aria-labelledby', 'bus-sheet-title');
      content.querySelector('#bus-sheet-title')?.focus({ preventScroll: true });
    } else sheet.open(content, { labelledBy: 'bus-sheet-title' });
    init(content);
  }
  const sheetHead = (title, sub) => h('div', { class: 'station__head' },
    h('div', { class: 'station__titles' }, h('h2', { class: 'station__name', id: 'bus-sheet-title', tabindex: '-1', 'data-autofocus': '', text: title }), sub && h('p', { class: 'station__sub', text: sub })),
    h('button', { class: 'cm-icon-btn cm-frost station__close el', type: 'button', 'aria-label': 'بستن', onClick: () => sheet.close() }, icon('xmark')));

  function showLine(line, startId) {
    let active = line.variants.find(v => v.id === startId) ?? line.variants[0];
    const variants = h('div', { class: 'cm-chips bus-variants', role: 'group', 'aria-label': 'مسیرهای ثبت شده' });
    const list = h('ol', { class: 'bus-stops' });
    const notes = h('div', { class: 'bus-notes' });
    const title = line.title || `خط ${line.ref}`;
    const isExp = line.isExpress || /^EXP-/i.test(line.ref);
    const paintLine = () => {
      variants.replaceChildren(...(line.variants.length > 1 ? line.variants.map(v => h('button', { type: 'button', class: 'cm-chip bus-variant', 'aria-pressed': String(v === active),
        onClick: () => { active = v; paintLine(); } }, `از ${v.from} به ${v.to}`)) : []));
      list.replaceChildren(...active.stops.map(name => h('li', { text: name })));
      // Native replaceChildren renders `false` as text, so conditional notes are filtered explicitly.
      notes.replaceChildren(...[
        h('p', { class: 'bus-note', text: `${active.stops.length} ایستگاه ثبت شده، به ترتیب داده منبع.` }),
        isExp && h('p', { class: 'bus-note bus-note--express', text: 'این خط تندرو (اکسپرس) است و در مسیر خود تنها در ایستگاه‌های منتخب توقف دارد.' }),
        loopVariant(active) && h('p', { class: 'bus-note', text: 'ایستگاه اول و آخر این مسیر یکی است؛ ممکن است مسیر گردشی باشد.' }),
        active.derived && h('p', { class: 'bus-note', text: 'مبدا و مقصد این مسیر در داده منبع ثبت نشده و از نام انگلیسی همان مسیر و نام پایانه ها برداشته شده است.' }),
        h('p', { class: 'bus-note', text: SOURCE_NOTE })].filter(Boolean));
    };
    paintLine();
    present(h('div', { class: 'station bus-sheet' }, sheetHead(title, isExp ? 'ایستگاه های منتخب (خط تندرو)' : 'ایستگاه های ثبت شده'), h('div', { class: 'station__scroll' }, variants, list, notes)));
  }

  function showStop(stop) {
    present(h('div', { class: 'station bus-sheet' }, sheetHead(stop.name, `${stop.refs.length} خط عبوری ثبت شده`),
      h('div', { class: 'station__scroll' },
        h('div', { class: 'cm-chips' },
          h('button', { type: 'button', class: 'cm-chip', onClick: () => { pickStop(stop.name, 'from'); sheet.close(); }, text: 'انتخاب مبدأ' }),
          h('button', { type: 'button', class: 'cm-chip', onClick: () => { pickStop(stop.name, 'to'); sheet.close(); }, text: 'انتخاب مقصد' })),
        ...stop.refs.map(ref => lineButton(index.byRef.get(ref))),
        officialLinks(stop.name),
        h('p', { class: 'bus-note', text: 'این فهرست از داده منبع است و زمان رسیدن اتوبوس را نشان نمی‌دهد.' }))));
  }

  input.addEventListener('input', () => { query = input.value; paint(); });
  clear.addEventListener('click', () => { input.value = ''; query = ''; paint(); input.focus(); });
  root.append(
    h('header', { class: 'metro-head' },
      h('button', { type: 'button', class: 'cm-icon-btn', 'aria-label': 'بازگشت از اتوبوس', onClick: () => actions.back() }, icon('arrow_right')),
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
