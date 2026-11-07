// Static bus guide: lines, ordered stops and stop-to-line lookup from a reviewed offline OSM projection.
// It never claims live positions or arrival times, and nothing the user types is stored or sent.
import { buildIndex, loopVariant, searchLines, searchStops } from '../bus-data.js';
import { findBusConnections } from '../bus-paths.js';
import { BUS_ARRIVAL_SOURCES, busHandoffNote, openBusSource } from '../bus-sources.js';
import { createRideTabs } from '../ui/ride-tabs.js';
import { h, icon } from '../ui/dom.js';
import { init } from '../ui/hm7.js';

const SOURCE_NOTE = 'مسیرهای این راهنما از OpenStreetMap هستند و با بهره‌بردار تطبیق داده نشده‌اند. زمان رسیدن اتوبوس از داده این برنامه در دسترس نیست؛ فقط منبع بیرونی می‌تواند آن را تأیید کند.';

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
  const routeSuggestions = h('div', { class: 'bus-notes', 'aria-live': 'polite' });
  const routeResults = h('div', { class: 'bus-notes', 'aria-live': 'polite' });
  const routeIntro = h('p', { class: 'bus-note', text: 'مسیرهای ممکن با توجه به ترتیب ایستگاه‌های ثبت‌شده پیدا می‌شوند. زمان رسیدن، هزینه، تأیید فعالیت خط و امکان تعویض واقعی نامعلوم است.' });

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
  const officialLinks = name => h('div', { class: 'bus-notes' },
    h('p', { class: 'bus-note', text: busHandoffNote(name) }),
    ...BUS_ARRIVAL_SOURCES.map(src => h('button', { type: 'button', class: 'cm-btn cm-btn--sm',
      onClick: () => openBusSource(src.id), text: `بررسی در ${src.title}` })));
  const routePanel = h('section', { class: 'cm-card', 'aria-labelledby': 'bus-route-title' },
    h('h2', { id: 'bus-route-title', class: 'about-card__title', text: 'اتصال بین دو ایستگاه اتوبوس' }),
    routeIntro,
    h('div', { class: 'bus-notes' },
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
