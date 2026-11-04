// Rahyab: door-to-door trip between two real places. Metro legs come from the timetable model, walk and car legs from a routing
// service, the two station-entry constants are labelled assumptions. A leg nobody measured is shown as unknown, never as a number.
// Location is read only after an explicit tap and goes only to this app's server (which asks the routing service for the route).
import { h } from '../ui/dom.js';
import { resolveUserCoords } from '../logic.js';
import { fa } from '../format.js';

const DEBOUNCE_MS = 400;
const BASIS = { routed: 'اندازه گیری مسیریاب', model: 'مدل برنامهٔ قطار', assumption: 'فرض', unknown: 'نامعلوم' };
const KIND = { metro: 'مترو', car: 'خودرو', walk: 'پیاده' };
const REASONS = {
  router_not_configured: 'سرویس مسیریابی پیاده و خودرو فعال نیست؛ فقط ایستگاه ها و ساعت حرکت قطار نمایش داده می شود و زمان رسیدن به مقصد نامعلوم است.',
  walk_legs_unavailable: 'مدت پیاده روی تا ایستگاه اندازه گیری نشد؛ زمان رسیدن به مقصد نامعلوم است.',
  metro_unavailable_for_this_trip: 'برای این سفر قطار مناسبی در مدل پیدا نشد؛ فقط گزینهٔ بدون مترو نمایش داده می شود.',
  no_supported_option: 'برای این دو نقطه گزینهٔ قابل اتکایی نداریم.', no_candidate: 'برای این دو نقطه گزینهٔ قابل اتکایی نداریم.',
  walk_limit_excluded_metro: 'مسیرهای مترو بیشتر از سقف پیاده روی شما (در پروفایل) پیاده روی داشتند و کنار گذاشته شدند.',
  walk_limit_excluded_all: 'هیچ مسیری با سقف پیاده روی شما پیدا نشد. سقف را در پروفایل بالاتر ببرید.',
  metro_unavailable: 'مدل مترو اکنون در دسترس نیست.', metro_disabled: 'مدل مترو اکنون در دسترس نیست.',
};

export const durationLabel = seconds => {
  if (!Number.isFinite(seconds) || seconds < 0) return 'نامعلوم';
  const m = Math.max(1, Math.round(seconds / 60));
  return m < 60 ? `${fa(m)} دقیقه` : `${fa(Math.floor(m / 60))} ساعت${m % 60 ? ` و ${fa(m % 60)} دقیقه` : ''}`;
};
export const meters = m => (m < 1000 ? `${fa(Math.max(10, Math.round(m / 10) * 10))} متر` : `${fa((m / 1000).toFixed(1).replace('.', '٫'))} کیلومتر`);
const clock = value => fa(value);
// replaceChildren stringifies null; keep only real nodes.
const nodes = (...items) => items.flat(Infinity).filter(Boolean);

function legRow(leg) {
  const row = (title, detail, basis) => h('li', { class: ['tp-leg', `tp-leg--${basis}`] },
    h('span', { class: 'tp-leg__body' }, h('b', { text: title }), detail ? h('span', { text: detail }) : null),
    h('span', { class: 'tp-basis', text: BASIS[basis] }));
  switch (leg.type) {
    case 'walk':
      return leg.durationS == null
        ? row(`پیاده از ${leg.from} تا ${leg.to}`, `مدت اندازه گیری نشده، فاصلهٔ هوایی حدود ${meters(leg.straightLineM)} (زمان نیست)`, 'unknown')
        : row(`پیاده از ${leg.from} تا ${leg.to}`, `${durationLabel(leg.durationS)}، ${meters(leg.distanceM)}`, 'routed');
    case 'station_access': return row('ورود به ایستگاه تا سکو', durationLabel(leg.durationS), 'assumption');
    case 'station_egress': return row('خروج از سکو تا بیرون ایستگاه', durationLabel(leg.durationS), 'assumption');
    case 'metro':
      return row(`مترو خط ${fa(leg.line)}${leg.service ? `، سرویس ${leg.service}` : ''} به سمت ${leg.toward}`, `${leg.from} ${clock(leg.departAt)} ← ${leg.to} ${clock(leg.arriveAt)}، ${durationLabel(leg.durationS)}`, 'model');
    case 'car': return row('با خودرو', `${durationLabel(leg.durationS)}، ${meters(leg.distanceM)}، با داده ترافیک مسیریاب`, 'routed');
    default: return null;
  }
}

export function createTripView(ctx) {
  const { actions, api, store } = ctx;
  const S = { gps: true, from: null, to: null, time: '', result: null, status: 'idle', locating: 'idle', pick: { from: { q: '', status: 'idle', places: [] }, to: { q: '', status: 'idle', places: [] } } };
  let timers = { from: 0, to: 0 }, controllers = { from: null, to: null }, tripController = null;
  const el = h('div', { class: 'view view--trip', dataset: { view: 'trip' } });
  const form = h('div', { class: 'tp-form' }), out = h('div', { class: 'tp-out', 'aria-live': 'polite' });

  async function search(key) {
    clearTimeout(timers[key]); controllers[key]?.abort(); controllers[key] = new AbortController();
    const mine = controllers[key], pick = S.pick[key], q = pick.q.trim();
    if (q.length < 2) { pick.status = 'idle'; pick.places = []; drawPick(key); return; }
    pick.status = 'loading'; drawPick(key);
    try { const data = await api.places(q, mine.signal); if (mine !== controllers[key]) return; pick.places = data.places; pick.status = data.places.length ? 'ok' : 'empty'; pick.geocoder = data.geocoder; }
    catch (error) { if (mine !== controllers[key] || error?.kind === 'aborted') return; pick.places = []; pick.status = 'error'; }
    drawPick(key);
  }

  const inputs = {};
  const lists = { from: h('div', { class: 'tp-list', role: 'listbox' }), to: h('div', { class: 'tp-list', role: 'listbox' }) };
  const chosen = { from: h('p', { class: 'tp-chosen' }), to: h('p', { class: 'tp-chosen' }) };
  function drawPick(key) {
    const pick = S.pick[key];
    lists[key].replaceChildren(...nodes(pick.status === 'loading' ? [h('p', { class: 'fd-note', text: 'در حال جست وجو…' })]
      : pick.status === 'error' ? [h('p', { class: 'fd-note', role: 'alert', text: 'جست وجوی مکان انجام نشد.' })]
      : pick.status === 'empty' ? [h('p', { class: 'fd-note', text: pick.geocoder === 'unavailable' ? 'مکانی پیدا نشد؛ جست وجوی نشانی اکنون در دسترس نیست و فقط نام ایستگاه ها جست وجو می شود.' : 'مکانی پیدا نشد؛ نام دقیق تری بنویسید.' })]
      : pick.places.map(place => h('button', { type: 'button', role: 'option', class: 'tp-place', onClick: () => choose(key, place) },
        h('b', { text: place.name }), h('span', { text: place.precision === 'geocoded' ? 'نشانی (نقطهٔ تقریبی)' : 'ایستگاه مترو' })))));
  }
  function choose(key, place) {
    S[key] = { lat: place.lat, lon: place.lon, name: place.name, precision: place.precision };
    if (key === 'from') S.gps = false;
    S.pick[key] = { q: '', status: 'idle', places: [] }; inputs[key].value = '';
    drawPick(key); drawChosen(); S.result = null; S.status = 'idle'; drawOut(); drawSubmit();
  }
  function drawChosen() {
    for (const key of ['from', 'to']) {
      const v = S[key];
      if (key === 'from' && !v && S.gps) {
        // Default origin: where the user is. It is only read when they press the search button (an explicit tap).
        chosen[key].replaceChildren(h('span', { text: 'موقعیت فعلی من' }), h('i', { class: 'tp-chosen__tag', text: 'هنگام جست وجو دریافت می شود' }),
          h('button', { type: 'button', class: 'tp-link', onClick: () => { S.gps = false; drawChosen(); drawSubmit(); drawOrigin(); inputs.from?.focus?.(); } }, 'مبدأ دیگر'));
        continue;
      }
      chosen[key].replaceChildren(...nodes(v ? [h('span', { text: v.name }), v.precision === 'gps' ? h('i', { class: 'tp-chosen__tag', text: 'موقعیت دقیق شما' }) : v.precision === 'geocoded' ? h('i', { class: 'tp-chosen__tag', text: 'نقطه تقریبی' }) : null,
        h('button', { type: 'button', class: 'tp-clear', 'aria-label': 'پاک کردن', onClick: () => { S[key] = null; if (key === 'from') S.gps = true; S.result = null; S.status = 'idle'; drawChosen(); drawOut(); drawSubmit(); drawOrigin(); } }, '×')] : [h('span', { class: 'tp-chosen__empty', text: 'انتخاب نشده' })]));
    }
  }

  async function locate() {
    if (S.locating === 'locating') return false;
    S.locating = 'locating'; drawLocate();
    let ok = false;
    try {
      const c = await resolveUserCoords(globalThis.window?.Telegram?.WebApp);
      S.from = { lat: Math.round(c.latitude * 1e5) / 1e5, lon: Math.round(c.longitude * 1e5) / 1e5, name: 'موقعیت من', precision: 'gps' }; S.locating = 'ok'; ok = true;
    } catch { S.locating = 'denied'; }
    S.result = null; S.status = 'idle'; drawChosen(); drawLocate(); drawOut(); drawSubmit(); drawOrigin();
    return ok;
  }
  const locateNote = h('p', { class: 'fd-note', role: 'status' });
  const locateBtn = h('button', { type: 'button', class: ['cm-btn', 'cm-btn--ghost', 'cm-btn--sm'], onClick: locate }, 'موقعیت من');
  function drawLocate() {
    locateBtn.textContent = S.locating === 'locating' ? 'در حال دریافت موقعیت…' : 'موقعیت من';
    locateBtn.disabled = S.locating === 'locating';
    locateNote.textContent = S.locating === 'denied' ? 'دسترسی به موقعیت داده نشد؛ مبدأ را جست وجو کنید.'
      : S.locating === 'ok' ? 'موقعیت دقیق شما فقط برای محاسبهٔ همین مسیر به سرور بسراه و سرویس مسیریابی نشان فرستاده می شود و ذخیره نمی شود.' : '';
  }

  const timeInput = h('input', { class: 'fd-input tp-time', type: 'time', 'aria-label': 'ساعت حرکت (خالی یعنی اکنون)' });
  timeInput.addEventListener('input', () => { S.time = timeInput.value; });
  const submit = h('button', { type: 'button', class: 'cm-btn tp-submit', onClick: () => plan() }, 'مسیر را پیدا کن');
  function drawSubmit() { submit.disabled = !(S.to && (S.from || S.gps)) || S.status === 'loading'; submit.textContent = S.status === 'loading' ? 'در حال محاسبه…' : 'مسیر را پیدا کن'; }

  async function plan() {
    if (!(S.to && (S.from || S.gps))) return;
    if (!S.from) {
      // One tap on the search button is the explicit request for the current position.
      S.status = 'loading'; drawOut(); drawSubmit();
      const ok = await locate();
      if (!ok) { S.gps = false; S.status = 'needorigin'; drawChosen(); drawOrigin(); drawOut(); drawSubmit(); inputs.from?.focus?.(); return; }
    }
    tripController?.abort(); tripController = new AbortController(); const mine = tripController;
    S.status = 'loading'; S.result = null; drawOut(); drawSubmit();
    try {
      const payload = { from: { lat: S.from.lat, lon: S.from.lon }, to: { lat: S.to.lat, lon: S.to.lon }, ...(S.time ? { time: S.time } : {}), ...(store?.prefs?.().transitMaxWalkMin ? { maxWalkMin: store.prefs().transitMaxWalkMin } : {}), ...(store?.prefs?.().transitPriority ? { priority: store.prefs().transitPriority } : {}) };
      const result = await api.trip(payload, mine.signal);
      if (mine !== tripController) return;
      S.result = result; S.status = 'ok';
    } catch (error) {
      if (mine !== tripController || error?.kind === 'aborted') return;
      S.status = error?.kind === 'outside_coverage' ? 'outside' : error?.kind === 'rate_limited' ? 'busy' : 'error';
    }
    drawOut(); drawSubmit();
  }

  function optionCard(o, decision) {
    const known = o.arriveAt !== null;
    const verdict = decision?.byOption?.[o.id];
    return h('article', { class: ['tp-card', 'cm-card', `tp-card--${o.kind}`], dataset: { kind: o.kind } },
      h('header', { class: 'tp-card__head' }, h('h3', { text: o.title }), h('span', { class: 'cm-badge', text: KIND[o.kind] })),
      verdict?.labels?.length ? h('p', { class: 'tp-labels' }, verdict.labels.map(l => h('span', { class: 'tp-label', text: l }))) : null,
      known ? h('p', { class: 'tp-times' },
        h('span', null, h('small', { text: 'خروج تا' }), h('b', { text: clock(o.leaveAt) })), h('i', { 'aria-hidden': 'true', text: '←' }),
        h('span', null, h('small', { text: 'رسیدن' }), h('b', { text: clock(o.arriveAt) })),
        h('span', { class: 'tp-total', text: durationLabel(o.totalS) }))
        : h('p', { class: 'tp-unknown', text: 'زمان رسیدن به مقصد نامعلوم است' }),
      o.platformDepartures ? h('p', { class: 'fd-note', text: `قطارهای بعدی روی سکوی مبدأ: ${o.platformDepartures.map(d => clock(d.departAt)).join('، ')}` }) : null,
      h('ul', { class: 'tp-legs' }, o.legs.map(legRow)),
      o.ifMissed ? h('p', { class: 'fd-note', text: `اگر این قطار را از دست بدهید: قطار بعدی ${clock(o.ifMissed.departAt)}${o.ifMissed.arriveAt ? `، رسیدن ${clock(o.ifMissed.arriveAt)}` : ''}.` }) : null,
      verdict?.claims?.length ? h('ul', { class: 'fd-notes tp-why' }, verdict.claims.map(t => h('li', { text: t }))) : null,
      o.notes.length ? h('ul', { class: 'fd-notes' }, o.notes.map(t => h('li', { text: t }))) : null);
  }

  // The Core asks at most one question, only when two options are a real trade-off. The answer is a stated preference the user can change in Profile.
  function questionBlock(decision) {
    const q = decision?.question;
    if (!q?.answers?.length || !store?.setPrefs) return null;
    return h('section', { class: 'tp-question', 'aria-label': 'یک پرسش کوتاه' },
      h('b', { text: q.prompt }),
      h('div', { class: 'fd-row' }, q.answers.map(a => h('button', { type: 'button', class: 'cm-btn cm-btn--ghost cm-btn--sm', onClick: () => { store.setPrefs({ ...store.prefs(), transitPriority: a.priority }); plan(); } }, a.label))),
      h('p', { class: 'fd-note', text: 'پاسخ شما فقط روی همین دستگاه ذخیره می شود و در پروفایل قابل تغییر است.' }));
  }
  function drawOut() {
    if (S.status === 'loading') { out.replaceChildren(h('div', { class: 'fd-skeleton', 'aria-busy': 'true', 'aria-label': 'در حال محاسبه' }, [0, 1].map(() => h('div', { class: 'cm-skel fd-skeleton__card' })))); return; }
    if (S.status === 'needorigin') { out.replaceChildren(h('div', { class: 'empty-state', role: 'alert' }, h('p', { text: 'موقعیت شما در دسترس نبود. مبدأ را از بالا جست وجو کنید یا نام یک ایستگاه بنویسید.' }))); return; }
    if (S.status === 'outside') { out.replaceChildren(h('div', { class: 'empty-state', role: 'alert' }, h('p', { text: 'مسیریابی فقط برای محدودهٔ مشهد است.' }))); return; }
    if (S.status === 'busy') { out.replaceChildren(h('div', { class: 'empty-state', role: 'alert' }, h('p', { text: 'درخواست ها زیاد است؛ چند ثانیه بعد دوباره تلاش کنید.' }), h('button', { type: 'button', class: 'cm-btn', onClick: () => plan() }, 'تلاش دوباره'))); return; }
    if (S.status === 'error') { out.replaceChildren(h('div', { class: 'empty-state', role: 'alert' }, h('p', { text: 'مسیر محاسبه نشد؛ اتصال را بررسی کنید.' }), h('button', { type: 'button', class: 'cm-btn', onClick: () => plan() }, 'تلاش دوباره'))); return; }
    const r = S.result;
    if (!r) { out.replaceChildren(); return; }
    out.replaceChildren(...nodes(
      r.status !== 'ok' ? h('p', { class: 'tp-status', role: 'status', text: REASONS[r.reason] ?? 'نتیجه ناقص است.' }) : null,
      r.options.length ? r.options.map(o => optionCard(o, r.decision)) : h('div', { class: 'empty-state' }, h('p', { text: REASONS[r.reason] ?? 'گزینه ای پیدا نشد.' })),
      questionBlock(r.decision),
      r.decision?.notes?.length ? h('ul', { class: 'fd-notes' }, r.decision.notes.map(t => h('li', { text: t }))) : null,
      h('ul', { class: 'fd-notes' }, [...(r.disclaimers ?? []), r.routing?.trafficLabel].filter(Boolean).map(t => h('li', { text: t })))));
  }

  let originControls = null;
  function drawOrigin() { if (originControls) originControls.hidden = Boolean(S.gps && !S.from); }
  const pickerBlock = (key, label, extra) => {
    const input = h('input', { class: 'fd-input', type: 'search', enterkeyhint: 'search', autocomplete: 'off', placeholder: `${label}: نام ایستگاه یا نشانی`, 'aria-label': label });
    input.addEventListener('input', () => { S.pick[key].q = input.value; clearTimeout(timers[key]); timers[key] = setTimeout(() => search(key), DEBOUNCE_MS); });
    inputs[key] = input;
    const controls = h('div', { class: 'tp-controls' }, input, extra ?? null, lists[key]);
    if (key === 'from') originControls = controls;
    return h('section', { class: 'tp-pick', 'aria-label': label }, h('h2', { text: label }), chosen[key], controls);
  };

  form.append(
    pickerBlock('from', 'مبدأ', h('div', { class: 'fd-row' }, locateBtn)), locateNote,
    h('button', { type: 'button', class: ['cm-btn', 'cm-btn--ghost', 'cm-btn--sm', 'tp-swap'], 'aria-label': 'جابه جایی مبدأ و مقصد', onClick: () => { [S.from, S.to] = [S.to, S.from]; S.result = null; S.status = 'idle'; drawChosen(); drawOut(); drawSubmit(); drawOrigin(); } }, '⇅ جابه جایی'),
    pickerBlock('to', 'مقصد'),
    h('label', { class: 'tp-when' }, h('span', { text: 'ساعت حرکت (خالی یعنی اکنون)' }), timeInput),
    submit,
    h('p', { class: 'fd-note', text: 'انتخاب نقطه روی نقشه هنوز در دسترس نیست؛ مبدأ و مقصد را با نام ایستگاه، نشانی یا موقعیت خودتان بدهید.' }));

  el.append(
    h('header', { class: 'metro-head' },
      h('button', { type: 'button', class: 'btn-back', onClick: () => actions.go('services'), 'aria-label': 'بازگشت' }, '←'),
      h('div', null, h('h1', null, 'مسیر مکان به مکان'), h('p', null, 'با مترو، خودرو یا پیاده؛ هر زمان با منشأ و میزان قطعیتش'))),
    form, out);
  drawChosen(); drawLocate(); drawSubmit(); drawOut(); ['from', 'to'].forEach(drawPick); drawOrigin();
  return { el, onShow(options) { if (options?.focus === 'to') inputs.to?.focus?.(); }, onHide() { tripController?.abort(); for (const k of ['from', 'to']) { controllers[k]?.abort(); clearTimeout(timers[k]); } } };
}
