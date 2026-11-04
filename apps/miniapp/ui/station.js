// Station bottom sheet: arrival board, server time, refresh, favourite, API notes and a compact line-1 spine.
import { createSequencer } from '../async.js';
import { SUPPORTED_LINES, asOfLabel, dayTypeLabel, fa, lineLabel } from '../format.js';
import { positionLabel, spine } from '../route.js';
import { createBoard } from './board.js';
import { h, icon } from './dom.js';
import { hm7, toast } from './hm7.js';

const AUTO_REFRESH_MS = 60_000;

const ERROR_COPY = {
  network: ['اتصال برقرار نشد', 'زمان قطارها دریافت نشد. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.'],
  timeout: ['پاسخی نرسید', 'سرور دیر پاسخ داد. چند لحظه بعد دوباره تلاش کنید.'],
  server: ['سرویس پاسخ نمی دهد', 'چند لحظه بعد دوباره تلاش کنید.'],
  unknown_station: ['ایستگاه پیدا نشد', 'این ایستگاه در فهرست خط ۱ یا خط ۲ نیست.'],
};

const SPINE_NOTE = {
  1: 'ترتیب ایستگاه ها از وکیل آباد به فرودگاه؛ نمودار است، نه نقشه جغرافیایی.',
  2: 'ترتیب ایستگاه ها از طبرسی به شهید فکوری؛ نمودار است، نه نقشه جغرافیایی.',
};

// `getOrders` returns { 1: line-1 order, 2: line-2 order }.
export function createStationSheet({ sheet, api, store, getStations, getOrders, onBoard = () => {}, onRecent = () => {}, canPlanFrom = () => false, onPlanFrom = () => {} }) {
  const seq = createSequencer();
  let timer = 0, current = null, lastOk = 0, view = null, pendingPlan = null;

  function stopTimer() { clearTimeout(timer); timer = 0; }
  function schedule() {
    stopTimer();
    if (!view || document.visibilityState !== 'visible') return;
    const wait = Math.max(1000, AUTO_REFRESH_MS - (performance.now() - lastOk));
    timer = setTimeout(() => load({ auto: true }), wait);
  }
  document.addEventListener('visibilitychange', () => {
    if (!view) return;
    if (document.visibilityState !== 'visible') stopTimer();
    else if (performance.now() - lastOk >= AUTO_REFRESH_MS) load({ auto: true });
    else schedule();
  });

  function errorState(kind) {
    const [title, text] = ERROR_COPY[kind] ?? ERROR_COPY.network;
    return h('div', { class: 'cm-empty station__error', role: 'alert' },
      h('div', { class: 'cm-empty__art' }, icon('wifi')),
      h('h3', { text: title }), h('p', { text }),
      h('button', { class: 'cm-btn cm-btn--sm el', type: 'button', onClick: () => load({}) }, icon('arrow_clockwise'), 'تلاش دوباره'));
  }

  async function load({ auto = false } = {}) {
    if (!view || !current) return;
    const name = current;
    view.refresh.setAttribute('aria-busy', 'true');
    if (!view.hasBoard) view.board.showSkeleton();
    const result = await seq.run(signal => api.next(name, { signal, limit: 10 }));
    if (result.stale || name !== current || !view) return;
    view.refresh.setAttribute('aria-busy', 'false');
    if (!result.ok) {
      if (result.error?.kind === 'aborted') return;
      const kind = result.error?.kind ?? 'network';
      if (!view.hasBoard) { view.board.el.replaceChildren(errorState(kind)); view.board.busy(false); view.asOf.textContent = 'زمان قطارها دریافت نشد'; }
      else {
        view.status.textContent = 'تازه سازی انجام نشد. زمان های نمایش داده شده مربوط به آخرین دریافت موفق است.';
        if (!auto) toast({ title: 'تازه سازی انجام نشد', text: 'اتصال را بررسی کنید و دوباره تلاش کنید.', icon: 'exclamationmark_triangle', life: 4200 });
      }
      schedule();
      return;
    }
    const data = result.value;
    lastOk = performance.now();
    view.hasBoard = true;
    view.board.render(data.passes);
    view.asOf.textContent = `به روز شده ${asOfLabel(data.as_of, { seconds: true })}`;
    view.day.textContent = [dayTypeLabel(data.day_type), 'برآورد بر پایهٔ برنامه، نه موقعیت زندهٔ قطار'].filter(Boolean).join(' · ');
    view.status.textContent = '';
    view.notes.replaceChildren(...(data.notes ?? []).map(note => h('li', {}, icon('info_circle'), h('span', { text: note }))));
    view.notes.hidden = !(data.notes?.length);
    onBoard(name, data);
    schedule();
  }

  function build(name) {
    const station = getStations().find(s => s.name === name);
    const orders = getOrders();
    const lines = (station?.lines ?? []).filter(l => SUPPORTED_LINES.includes(l));
    const board = createBoard();
    const titleId = 'station-title';
    const pressed = store.isFavourite(name);

    const heart = h('button', { class: 'cm-fav station__fav', type: 'button', 'aria-pressed': String(pressed), 'aria-label': 'افزودن به علاقه مندی ها' },
      h('span', { class: 'im', 'aria-hidden': 'true' },
        h('i', { class: ['hms', 'hms-heart', pressed ? 'off' : 'on'] }),
        h('i', { class: ['hms', 'hms-heart_fill', pressed ? 'on' : 'off'] })));
    const labelFav = () => heart.setAttribute('aria-label', heart.getAttribute('aria-pressed') === 'true' ? 'حذف از علاقه مندی ها' : 'افزودن به علاقه مندی ها');
    labelFav();
    hm7()?.shop?.fav(heart, {
      onChange(on) {
        const result = store.toggleFavourite(name);
        if (on && !result.on) {                       // list full: undo the optimistic heart
          hm7().ui.morph(heart.querySelector('.im'), true);
          toast({ title: 'فهرست علاقه مندی ها پر است', text: 'برای افزودن، یکی از ایستگاه های ذخیره شده را حذف کنید.', icon: 'exclamationmark_triangle' });
        } else toast({ title: on ? 'به علاقه مندی ها افزوده شد' : 'از علاقه مندی ها حذف شد', text: name, icon: on ? 'heart_fill' : 'heart_slash' });
        labelFav();
      },
    });

    const refresh = h('button', { class: 'cm-btn cm-btn--ghost cm-btn--sm el', type: 'button', 'aria-busy': 'false', onClick: () => load({}) }, icon('arrow_clockwise'), 'تازه سازی');
    const asOf = h('span', { class: 'station__asof-text', text: 'در حال دریافت زمان از سرور' });
    const asOfRow = h('div', { class: 'station__asof' }, h('p', {}, icon('clock'), asOf), refresh);
    const day = h('p', { class: 'station__day' });
    const status = h('p', { class: 'station__status', role: 'status' });
    const notes = h('ul', { class: 'station__notes', hidden: true });

    const spineFor = line => {
      const where = spine(orders[line] ?? [], name);
      if (!where) return null;
      const titleFor = `spine-title-${line}`;
      return h('section', { class: 'station__spine', 'aria-labelledby': titleFor },
        h('h3', { id: titleFor, text: `جایگاه در خط ${fa(line)}` }),
        h('p', { class: 'station__spine-note', text: SPINE_NOTE[line] }),
        h('ol', { class: 'mini-spine' },
          where.hasBefore && h('li', { class: 'mini-spine__more', 'aria-hidden': 'true' }, h('span', { class: 'mini-spine__dot' })),
          where.items.map(item => h('li', { class: ['mini-spine__item', item.offset === 0 && 'is-current'] },
            h('span', { class: 'mini-spine__dot', 'aria-hidden': 'true' }),
            item.offset === 0
              ? h('span', { class: 'mini-spine__name', 'aria-current': 'location' }, item.name, h('span', { class: 'cm-sr', text: ' (ایستگاه انتخاب شده)' }))
              : h('button', { class: 'mini-spine__name mini-spine__btn el', type: 'button', onClick: () => show(item.name) }, item.name),
            item.terminal && h('span', { class: 'mini-spine__tag', text: item.terminal === 'first' ? 'ابتدای خط' : 'انتهای خط' }))),
          where.hasAfter && h('li', { class: 'mini-spine__more', 'aria-hidden': 'true' }, h('span', { class: 'mini-spine__dot' }))));
    };
    const spineEls = lines.map(spineFor).filter(Boolean);

    const close = h('button', { class: 'cm-icon-btn cm-frost station__close el', type: 'button', 'aria-label': 'بستن', onClick: () => sheet.close() }, icon('xmark'));
    const root = h('div', { class: 'station' },
      h('div', { class: 'station__head' },
        h('span', { class: 'line-badges' }, lines.map(l => h('span', { class: ['line-badge', `line-badge--l${l}`] }, h('span', { class: 'cm-sr', text: 'خط ' }), fa(l)))),
        h('div', { class: 'station__titles' },
          h('h2', { class: 'station__name', id: titleId, tabindex: '-1', 'data-autofocus': '', text: name }),
          h('p', { class: 'station__sub' }, lines.length === 1 && positionLabel(orders[lines[0]] ?? [], name), lines.length > 1 && h('span', { class: 'cm-badge cm-badge--new', text: `تقاطع ${lineLabel(lines)}` }))),
        heart, close),
      h('div', { class: 'station__scroll' },
        canPlanFrom() && h('button', { type: 'button', class: 'cm-btn cm-btn--sm', text: 'از این ایستگاه سفر بساز', onClick: () => { pendingPlan = name; sheet.close(); } }),
        asOfRow, day, board.el, status, notes, ...spineEls));
    view = { board, refresh, asOf, day, status, notes, hasBoard: false };
    return { root, titleId };
  }

  function show(name) {
    const sourceFocus = document.activeElement;
    seq.cancel(); stopTimer();
    current = name; pendingPlan = null;
    store.addRecent(name); store.setLast(name); onRecent(name);
    const { root, titleId } = build(name);
    const openedView = view;
    sheet.open(root, {
      labelledBy: titleId, initialFocus: sourceFocus,
      returnFocus: () => {
        if (sourceFocus?.isConnected) return sourceFocus;
        const key = sourceFocus?.dataset?.focusKey;
        return key ? document.querySelector(`[data-focus-key="${CSS.escape(key)}"]`) : null;
      },
      onRestore: () => show(name),
      onClosed: () => { if (view !== openedView) return; seq.cancel(); stopTimer(); view = null; current = null; const next = pendingPlan; pendingPlan = null; if (next && canPlanFrom()) onPlanFrom(next); },
    });
    load({});
  }

  return { show, get current() { return current; } };
}
