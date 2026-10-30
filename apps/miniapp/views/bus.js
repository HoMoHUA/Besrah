// Static bus guide: lines, ordered stops and stop-to-line lookup from a reviewed offline OSM projection.
// It never claims live positions or arrival times, and nothing the user types is stored or sent.
import { buildIndex, loopVariant, searchLines, searchStops } from '../bus-data.js';
import { createRideTabs } from '../ui/ride-tabs.js';
import { h, icon } from '../ui/dom.js';
import { init } from '../ui/hm7.js';

const SOURCE_NOTE = 'اطلاعات خطوط از نقشه مشارکتی OpenStreetMap آمده و با سازمان اتوبوسرانی تطبیق داده نشده است؛ ممکن است خطی جا افتاده یا مسیری عوض شده باشد. زمان رسیدن اتوبوس هنوز در دسترس نیست.';

export function createBusView(ctx) {
  const { actions, api, sheet } = ctx;
  let status = 'idle', index = null, query = '';
  const root = h('div', { class: 'view view--bus' });
  const input = h('input', { id: 'bus-q', type: 'text', inputmode: 'search', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'جست وجوی خط یا ایستگاه اتوبوس', placeholder: 'شماره خط، مبدا یا نام ایستگاه' });
  const clear = h('button', { type: 'button', class: 'search-clear cm-icon-btn', hidden: true, 'aria-label': 'پاک کردن جست وجو' }, icon('xmark_circle_fill'));
  const results = h('div', { class: 'bus-results', 'aria-live': 'polite' });
  const dateText = () => (index?.meta?.osm_base ?? '').slice(0, 10);

  const lineButton = line => {
    const first = line.variants[0];
    return h('button', { type: 'button', class: 'bus-line', dataset: { line: line.ref }, 'aria-label': `خط ${line.ref}، از ${first.from} به ${first.to}`, onClick: () => showLine(line) },
      h('bdi', { class: 'bus-line__ref', dir: 'ltr', text: line.ref }),
      h('span', { class: 'bus-line__body' }, h('strong', { text: `از ${first.from} به ${first.to}` }), h('small', { text: `${line.variants.length} مسیر ثبت شده` })),
      icon('chevron_left'));
  };
  const stopButton = stop => h('button', { type: 'button', class: 'bus-line bus-line--stop', dataset: { stop: stop.name }, 'aria-label': `${stop.name}، ${stop.refs.length} خط`, onClick: () => showStop(stop) },
    h('span', { class: 'bus-line__pin' }, icon('location_north_up_right_circle_fill')),
    h('span', { class: 'bus-line__body' }, h('strong', { text: stop.name }), h('small', { text: `${stop.refs.length} خط عبوری ثبت شده` })), icon('chevron_left'));

  function paint() {
    clear.hidden = !query;
    if (status === 'loading' || status === 'idle') return results.replaceChildren(h('p', { class: 'bus-note', text: 'در حال دریافت فهرست خط ها…' }));
    if (status === 'error') return results.replaceChildren(h('p', { class: 'bus-note', text: 'دریافت فهرست خط ها انجام نشد.' }), h('button', { type: 'button', class: 'cm-btn cm-btn--sm', onClick: load, text: 'تلاش دوباره' }));
    const lines = searchLines(index, query), stops = searchStops(index, query);
    const children = [];
    if (stops.length) children.push(h('h2', { class: 'bus-section-title', text: 'ایستگاه ها' }), ...stops.map(stopButton));
    children.push(h('h2', { class: 'bus-section-title', text: query ? 'خط ها' : `همه خط ها (${lines.length})` }), ...lines.map(lineButton));
    if (!lines.length && !stops.length) children.splice(0, children.length, h('p', { class: 'bus-note', text: 'خط یا ایستگاهی با این نام پیدا نشد.' }));
    results.replaceChildren(...children);
  }

  async function load() {
    if (status === 'loading' || status === 'ready') return;
    status = 'loading'; paint();
    try { index = buildIndex(await api.busGuide()); status = 'ready'; } catch { status = 'error'; }
    paint();
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
    const variants = h('div', { class: 'bus-variants', role: 'group', 'aria-label': 'مسیرهای ثبت شده' });
    const list = h('ol', { class: 'bus-stops' });
    const notes = h('div', { class: 'bus-notes' });
    const paintLine = () => {
      variants.replaceChildren(...(line.variants.length > 1 ? line.variants.map(v => h('button', { type: 'button', class: 'bus-variant', 'aria-pressed': String(v === active),
        onClick: () => { active = v; paintLine(); } }, `از ${v.from} به ${v.to}`)) : []));
      list.replaceChildren(...active.stops.map(name => h('li', { text: name })));
      // Native replaceChildren renders `false` as text, so conditional notes are filtered explicitly.
      notes.replaceChildren(...[
        h('p', { class: 'bus-note', text: `${active.stops.length} ایستگاه ثبت شده، به ترتیب داده منبع.` }),
        loopVariant(active) && h('p', { class: 'bus-note', text: 'ایستگاه اول و آخر این مسیر یکی است؛ ممکن است مسیر گردشی باشد.' }),
        active.derived && h('p', { class: 'bus-note', text: 'مبدا و مقصد این مسیر در داده منبع ثبت نشده و از نام انگلیسی همان مسیر و نام پایانه ها برداشته شده است.' }),
        h('p', { class: 'bus-note', text: SOURCE_NOTE })].filter(Boolean));
    };
    paintLine();
    present(h('div', { class: 'station bus-sheet' }, sheetHead(`خط ${line.ref}`, 'ایستگاه های ثبت شده'), h('div', { class: 'station__scroll' }, variants, list, notes)));
  }

  function showStop(stop) {
    present(h('div', { class: 'station bus-sheet' }, sheetHead(stop.name, `${stop.refs.length} خط عبوری ثبت شده`),
      h('div', { class: 'station__scroll' }, ...stop.refs.map(ref => lineButton(index.byRef.get(ref))),
        h('p', { class: 'bus-note', text: 'این فهرست از داده منبع است و زمان رسیدن اتوبوس را نشان نمی دهد.' }))));
  }

  input.addEventListener('input', () => { query = input.value; paint(); });
  clear.addEventListener('click', () => { input.value = ''; query = ''; paint(); input.focus(); });
  root.append(
    h('header', { class: 'metro-head' },
      h('button', { type: 'button', class: 'cm-icon-btn', 'aria-label': 'بازگشت از اتوبوس', onClick: () => actions.back() }, icon('arrow_right')),
      h('img', { src: 'assets/services/caravan.svg', alt: '', width: 60, height: 60 }),
      h('div', {}, h('h1', { text: 'اتوبوس' }), h('p', { text: 'خط ها و ایستگاه های مشهد' }))),
    createRideTabs('bus', actions),
    h('label', { class: 'cm-search cm-inset bus-search', for: 'bus-q' }, icon('magnifyingglass'), input, clear),
    results,
    h('section', { class: 'cm-card about-card', 'aria-labelledby': 'bus-method-title' },
      h('h2', { id: 'bus-method-title', class: 'about-card__title', text: 'درباره اطلاعات اتوبوس' }),
      h('p', { text: SOURCE_NOTE }),
      h('p', { dir: 'ltr', text: `© OpenStreetMap contributors · ODbL-1.0${dateText() ? ' · ' + dateText() : ''}` })));
  paint();
  return { el: root, mount() { init(root); }, onShow() { load(); }, onHide() {} };
}
