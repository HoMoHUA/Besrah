// Optional, same-line beta inside Metro. No new route, location request or travel persistence.
import { createReminders } from '../reminders.js';
import { createSequencer } from '../async.js';
import { h, icon } from './dom.js';
import { createSearchBox } from './searchbox.js';
import { fa } from '../format.js';
import {
  FIXED_NOTICE, WEEKDAY_WARNING, MODEL_ONLY_SUMMARY, CONSENT_TEXT, NOTE_HINT, NOTE_MAX,
  FORM_ERRORS, EARLIEST_LABEL, ESTIMATE_LABEL, DERIVED_NOTE, FEEDBACK_KINDS,
  TIMING_CHOICES, OBSERVATION_EVENTS, PRECISION_CHOICES, OUTCOME_CHOICES, PROBLEM_CHOICES,
  rolloutBucket, betaVisible, readOptIn, readOptOut, writeOptIn, clearOptIn, optInFromSearch,
  tehranParts, dayChoices, addDays, dateLabel, clockText, buildJourneyQuery, validateForm,
  formatOption, requestSummary, statusView, feedbackAvailability, feedbackErrorView,
  buildTimingPayload, buildObservationPayload, buildOutcomePayload, buildProblemPayload,
  observedAtFromTime, checkNote, newReportId, createSentTracker, directionChoices,
} from '../journey.js';

const spaced = text => String(text ?? '').replace(/\u200c/g, ' ');
export function lineStations(registry, line) {
  const order = line === 2 ? registry.order2 : registry.order;
  return (order ?? []).map(name => registry.stations?.find(s => s.name === name && s.lines?.includes(line)))
    .filter(s => s && /^METRO-\d{3}$/.test(s.id));
}
const freshFeedback = () => ({ open: false, kind: 'problem', quality: '', event: '', stationId: '', direction: 'unknown', date: '', time: '', precision: '', result: '', category: '', optionId: '', note: '', consent: false, status: 'idle', message: '' });

export function createPlannerController({ api, state, storage, now = Date.now, timers = globalThis, search = '' }) {
  const sequence = createSequencer(), configSequence = createSequencer(), listeners = new Set(), sent = createSentTracker();
  const bucket = rolloutBucket(storage);
  let timer = null, pending = null, opted = readOptIn(storage), left = readOptOut(storage);
  const wall = tehranParts(now());
  let data = { phase: 'idle', active: false, config: null, promoted: false, invited: optInFromSearch(search), busy: null,
    form: { line: 1, from: '', to: '', mode: 'now', date: wall.date, time: wall.time }, response: null, expired: false, error: null, feedback: freshFeedback() };
  const emit = () => { for (const fn of listeners) fn(data); };
  const stopTimer = () => { if (timer !== null) timers.clearTimeout(timer); timer = null; };
  function invalidate() {
    sequence.cancel(); stopTimer(); pending = null;
    data = { ...data, busy: null, response: null, expired: false, error: null, feedback: freshFeedback() };
  }
  function disabled() { invalidate(); data = { ...data, active: false, phase: 'disabled', config: { ...data.config, enabled: false } }; emit(); }
  function configFrom(config) {
    data = { ...data, config, promoted: betaVisible(config, { bucket, optIn: opted, optOut: left }) };
    return config.enabled === true;
  }
  function availableFeedback() {
    if (!data.active || !data.config?.feedbackEnabled || !data.response) return {};
    const availability = feedbackAvailability(data.response, now());
    if (data.expired || Date.parse(data.response.validUntil) <= now()) availability.timing_quality = availability.boarding_outcome = false;
    // Display expiry cannot turn an uncertain write into a different report. Only its exact retry stays eligible.
    if (pending && ['sending', 'error'].includes(data.feedback.status)) availability[pending.kind] = true;
    return availability;
  }
  function expire() {
    if (!data.response) return;
    stopTimer();
    data = { ...data, expired: true };
    if (['timing_quality', 'boarding_outcome'].includes(data.feedback.kind) && !pending && data.feedback.status !== 'sent' && data.busy !== 'feedback') {
      pending = null; data.feedback = { ...freshFeedback(), open: data.feedback.open, message: 'اعتبار گزینه ها منقضی شده است؛ برای نظر درباره این گزینه ها دوباره محاسبه کنید.', kind: 'problem' };
    }
    emit();
  }
  const controller = {
    get: () => data,
    /** True when this visitor followed the invitation link or has an opt-in on this device (and has not left). */
    interested: () => data.invited === true || (opted && !left),
    now,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    availableFeedback,
    expire,
    async load() {
      invalidate(); data.phase = 'loading'; emit();
      const result = await configSequence.run(signal => api.beta(signal));
      if (result.stale) return;
      if (!result.ok) {
        if (result.error?.kind === 'disabled') return disabled();
        data = { ...data, phase: 'config_error', active: false, error: result.error }; emit(); return;
      }
      if (!configFrom(result.value)) return disabled();
      data = { ...data, phase: 'ready', active: opted && !left }; emit();
    },
    optIn() {
      if (!data.config?.enabled || data.phase !== 'ready') return;
      opted = true; left = false; writeOptIn(storage);
      data = { ...data, active: true }; emit();
    },
    leave() {
      invalidate(); opted = false; left = true; clearOptIn(storage);
      data = { ...data, active: false }; emit();
    },
    hide() { configSequence.cancel(); invalidate(); emit(); },
    setForm(patch, notify = true) {
      if (Object.keys(patch).every(key => data.form[key] === patch[key])) return;
      const form = { ...data.form, ...patch };
      if (patch.line !== undefined) {
        const ids = new Set(lineStations(state.get(), form.line).map(s => s.id));
        if (!ids.has(form.from)) form.from = '';
        if (!ids.has(form.to)) form.to = '';
      }
      invalidate(); data.form = form; if (notify) emit();
    },
    async plan() {
      if (!data.active || !data.config?.enabled || data.busy) return;
      const form = { ...data.form }, issue = validateForm(form, now());
      const ids = new Set(lineStations(state.get(), form.line).map(s => s.id));
      if (issue || !ids.has(form.from) || !ids.has(form.to)) {
        data = { ...data, error: { kind: 'form', message: FORM_ERRORS[issue] ?? 'ایستگاه ها را از همین خط انتخاب کنید.' } }; emit(); return;
      }
      invalidate(); data.busy = 'plan'; emit();
      const result = await sequence.run(async signal => {
        const config = await api.beta(signal);
        if (!config.enabled) throw { kind: 'disabled' };
        const response = await api.journey(buildJourneyQuery(form), signal);
        return { response, config };
      });
      if (result.stale) return;
      data.busy = null;
      if (!result.ok) {
        if (result.error?.kind === 'disabled') return disabled();
        data.error = result.error; emit(); return;
      }
      configFrom(result.value.config); data.response = result.value.response;
      const delay = Date.parse(data.response.validUntil) - now();
      if (!Number.isFinite(delay) || delay <= 0) { expire(); return; }
      timer = timers.setTimeout(expire, Math.min(delay, 2_147_483_647));
      emit();
    },
    openFeedback() {
      if (!data.response || !data.config?.feedbackEnabled || data.busy) return;
      data.feedback = { ...freshFeedback(), open: true }; emit();
    },
    closeFeedback() {
      if (data.busy === 'feedback') return;
      pending = null; data.feedback = freshFeedback(); emit();
    },
    updateFeedback(patch, notify = true) {
      if (data.busy) return;
      pending = null;
      data.feedback = { ...data.feedback, ...patch, status: 'idle', message: '' };
      if (patch.kind !== undefined && patch.consent === undefined) data.feedback.consent = false;
      if (notify) emit();
    },
    async sendFeedback() {
      if (data.busy || !data.response || !data.feedback.open || !data.config?.feedbackEnabled || data.feedback.status === 'sent') return;
      const f = data.feedback, response = data.response;
      const fail = message => { data.feedback = { ...data.feedback, status: 'error', message }; emit(); };
      if (!f.consent) return fail('برای ارسال، رضایت ذخیره گزارش را خودتان انتخاب کنید. ارسال نظر اجباری نیست.');
      if (!availableFeedback()[f.kind]) return fail('این نوع گزارش اکنون برای این نتیجه مجاز نیست. در صورت نیاز دوباره محاسبه کنید.');
      if (checkNote(f.note)) return fail('نشانی، شماره تماس یا اطلاعات شخصی ننویسید؛ یادداشت را اصلاح کنید یا خالی بگذارید.');
      let payload;
      try {
        const option = !data.expired && response.options?.find(o => o.id === f.optionId);
        const rest = { consent: true, reportId: pending?.reportId ?? newReportId(), note: f.note, option };
        if (f.kind === 'timing_quality') payload = buildTimingPayload(response, { ...rest, quality: f.quality });
        else if (f.kind === 'boarding_outcome') payload = buildOutcomePayload(response, { ...rest, result: f.result });
        else if (f.kind === 'problem') payload = buildProblemPayload(response, { ...rest, category: f.category });
        else if (f.kind === 'train_observation') {
          const observedAt = observedAtFromTime(f.time, now(), f.date);
          if (!observedAt) return fail('تاریخ و ساعت رخداد را به وقت تهران وارد کنید؛ زمان آینده یا بیش از ۳۶ ساعت پیش پذیرفته نیست.');
          if (!lineStations(state.get(), response.request.line).some(s => s.id === f.stationId)) return fail('ایستگاه مشاهده را از همین خط انتخاب کنید.');
          payload = buildObservationPayload(response, { ...rest, event: f.event, stationId: f.stationId, direction: f.direction, observedAt, precision: f.precision });
        } else return fail('نوع گزارش را انتخاب کنید.');
      } catch { return fail('گزینه های گزارش را کامل کنید.'); }
      // After uncertain delivery, retry the exact original bytes and key, even if display validity elapsed.
      if (pending) payload = pending;
      if (!sent.begin(payload)) return fail('این گزارش قبلاً ارسال شده یا در حال ارسال است.');
      pending = payload; data.busy = 'feedback'; data.feedback = { ...f, status: 'sending', message: 'در حال ارسال نظر…' }; emit();
      const result = await sequence.run(async signal => {
        const config = await api.beta(signal);
        if (!config.enabled) throw { kind: 'disabled', globalOff: true };
        if (!config.feedbackEnabled) throw { kind: 'disabled' };
        return api.journeyFeedback(payload, signal);
      });
      if (result.stale) { sent.fail(payload); return; }
      data.busy = null;
      if (result.ok) {
        sent.succeed(payload);
        data.feedback = { ...data.feedback, status: 'sent', consent: false, message: result.value.status === 'duplicate' ? 'این گزارش قبلاً ثبت شده بود؛ دوباره ذخیره نشد.' : 'گزارش ناشناس ثبت شد. این نظر هنوز بررسی نشده و به تنهایی برنامه قطار را تغییر نمی دهد.' };
      } else {
        sent.fail(payload);
        if (result.error?.globalOff) return disabled();
        if (result.error?.kind === 'disabled') data.config = { ...data.config, feedbackEnabled: false };
        data.feedback = { ...data.feedback, status: 'error', message: feedbackErrorView(result.error).text };
      }
      emit();
    },
  };
  return controller;
}

const para = (text, className = '') => h('p', { class: className, text });
const action = (text, onClick, attrs = {}, ...children) => h('button', { type: 'button', class: 'cm-btn cm-btn--sm', ...(text ? { text } : {}), onClick, ...attrs }, ...children);
function selectControl(id, label, choices, value, change, attrs = {}) {
  const input = h('select', { id, ...attrs, onChange: e => change(e.target.value) },
    ...choices.map(([key, text]) => h('option', { value: key, text: spaced(text) })));
  input.value = String(value ?? '');
  return h('div', { class: 'journey-field' }, h('label', { for: id, text: label }), input);
}
function inputControl(id, label, type, value, change, attrs = {}) {
  const input = h('input', { id, type, ...attrs, onInput: e => change(e.target.value) });
  input.value = value ?? '';
  return h('div', { class: 'journey-field' }, h('label', { for: id, text: label }), input);
}

export function createPlanner({ api, state, controller: supplied, storage, search, now, timers, embedded = false, onRetry = () => {}, stationStore = null, shortcuts = null }) {
  const controller = supplied ?? createPlannerController({ api, state, storage, search, now, timers });
  const reminders = storage ? createReminders({ storage, now: () => controller.now() }) : null;
  let remindersReady = false, remindersStarted = false, reminderMessage = '', reminderBusy = false;
  const root = h('section', { class: embedded ? 'journey journey--embedded' : 'journey cm-card', ...(embedded ? { 'aria-label': 'سفر با مترو' } : { 'aria-labelledby': 'journey-title' }) });
  const resultHost = h('div', { class: 'journey-result-host' });
  // A single persistent combobox serves both endpoints. No query or trip history is written.
  let pickerTarget = 'from', picker = null, pickerHost, pickerLabel, pickerInput, shortcutsHost, pickerLine = controller.get().form.line;
  const isMetroStation = s => /^METRO-\d{3}$/.test(s?.id ?? '');
  // The picker must never sit under the fixed bottom nav or the virtual keyboard: centre it (CSS scroll-margin reserves nav + safe area).
  const reveal = () => pickerHost?.scrollIntoView?.({ block: 'center', behavior: 'auto' });
  function choose(name, field) {
    const station = state.get().stations?.find(s => s.name === name && isMetroStation(s));
    if (!station) return false;
    const form = controller.get().form;
    let patch;
    if (station.lines?.includes(form.line)) patch = { [field]: station.id };
    else if (field === 'from') { const line = station.lines?.find(l => [1, 2].includes(l)); if (!line) return false; patch = { line, from: station.id }; }
    else return false;
    setPicker(false); picker.close();
    controller.setForm(patch);
    root.querySelector(`#journey-${field}`)?.focus({ preventScroll: true });
    return true;
  }
  const setPicker = open => { pickerHost.hidden = !open; shortcutsHost.hidden = !open; };
  function paintShortcuts() {
    if (!embedded) return;
    const info = shortcuts?.get?.() ?? {}, line = controller.get().form.line, onLine = new Set(lineStations(state.get(), line).map(st => st.name));
    const chip = (text, onClick, attrs = {}) => h('button', { type: 'button', class: 'cm-chip journey-shortcut', text, onClick, ...attrs });
    const items = [];
    if (pickerTarget === 'from') {
      const near = info.nearest;
      if (near?.phase === 'loading') items.push(chip('در حال پیدا کردن ایستگاه…', () => {}, { disabled: true }));
      else if (near?.station) items.push(chip(`نزدیک ترین: ${near.station.name}`, () => choose(near.station.name, 'from')));
      else items.push(chip('نزدیک ترین ایستگاه', () => shortcuts?.locate?.()));
    }
    if (info.recent?.station) items.push(chip(`آخرین: ${info.recent.station}`, () => choose(info.recent.station, pickerTarget)));
    for (const name of (info.favourites ?? []).filter(n => onLine.has(n)).slice(0, 4)) items.push(chip(name, () => choose(name, pickerTarget), { 'aria-label': `علاقه مندی: ${name}` }));
    items.push(chip('ایستگاه های من', () => shortcuts?.openFavourites?.()));
    shortcutsHost.replaceChildren(...items, ...(pickerTarget === 'from' && info.nearest?.phase === 'error' ? [h('p', { role: 'status', class: 'journey-muted', text: 'موقعیت پیدا نشد؛ ایستگاه را دستی انتخاب کنید یا دوباره تلاش کنید.' })] : []));
  }
  function openPicker(field, label) {
    pickerTarget = field; pickerLabel.textContent = `جست وجوی ${label}`;
    setPicker(true); pickerInput.value = ''; paintShortcuts(); picker.close(); picker.focus(); reveal();
  }
  if (embedded) {
    pickerInput = h('input', { id: 'journey-station-query', type: 'text', inputmode: 'search', autocomplete: 'off', spellcheck: 'false', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'journey-station-options', 'aria-autocomplete': 'list', placeholder: 'نام ایستگاه را بنویسید' });
    const clear = h('button', { type: 'button', class: 'search-clear cm-icon-btn', hidden: true, 'aria-label': 'پاک کردن جست وجو', text: '×' });
    const listbox = h('div', { id: 'journey-station-options', role: 'listbox', 'aria-label': 'ایستگاه های خط انتخاب شده' });
    const popup = h('div', { class: 'cm-menu app-suggest metro-suggest', hidden: true }, listbox);
    const live = h('p', { class: 'cm-sr', role: 'status', 'aria-live': 'polite' });
    pickerLabel = h('label', { for: 'journey-station-query', text: 'جست وجوی ایستگاه مبدأ' });
    shortcutsHost = h('div', { class: 'journey-shortcuts cm-chips', role: 'group', 'aria-label': 'میان بر ایستگاه' });
    shortcutsHost.hidden = true;
    pickerHost = h('div', { class: 'journey-picker metro-search' }, pickerLabel, h('div', { class: 'cm-search cm-inset' }, pickerInput, clear), shortcutsHost, popup, live);
    pickerHost.hidden = true;
    // Re-centre when the keyboard changes the visual viewport or the input regains focus.
    pickerInput.addEventListener('focus', reveal);
    globalThis.visualViewport?.addEventListener?.('resize', () => { if (!pickerHost.hidden) reveal(); });
    // Suggestions render asynchronously (debounced): once the popup is open keep all of it above the fixed nav.
    // scrollIntoView does not cross the app column's `overflow-x: clip`, so measure against the real nav/keyboard edge instead.
    const fit = () => {
      if (popup.hidden || !globalThis.document) return;
      const vv = globalThis.visualViewport, nav = globalThis.document.getElementById?.('nav'), gap = 12;
      const limit = Math.min(vv ? vv.offsetTop + vv.height : Infinity, globalThis.innerHeight ?? Infinity, nav?.getBoundingClientRect?.().top ?? Infinity) - gap;
      if (!Number.isFinite(limit)) return;
      const top = popup.getBoundingClientRect().top, field = pickerInput.getBoundingClientRect().top;
      // Scroll just enough to show a useful list, never pushing the input under the sticky header (~84px)...
      const want = top + 160 - limit;
      if (want > 0) globalThis.scrollBy?.({ top: Math.min(want, Math.max(0, field - 84)), behavior: 'instant' });
      // ...then bound the list to the space that is really left; it scrolls inside.
      popup.style.setProperty('--journey-pop-max', `${Math.max(120, Math.min(280, limit - popup.getBoundingClientRect().top))}px`);
    };
    if (typeof MutationObserver === 'function') new MutationObserver(fit).observe(listbox, { childList: true });
    picker = createSearchBox({ host: pickerHost, input: pickerInput, clearButton: clear, popup, listbox, live,
      getStations: () => lineStations(state.get(), controller.get().form.line),
      getOrder: () => lineStations(state.get(), controller.get().form.line).map(s => s.name),
      getStatus: () => state.get().status, onRetry,
      // Recent station searches are shared with the legacy search (read, and clear on request); picking an endpoint never writes one.
      store: stationStore ?? { recents: () => [], clearRecents() {} },
      onPick(name) { choose(name, pickerTarget); } });
  }
  function endpoint(field, label, short, form, stops) {
    const name = stops.find(s => s.id === form[field])?.name;
    return action('', () => openPicker(field, label), { id: `journey-${field}`, class: 'journey-endpoint', 'aria-label': `${label}: ${name ?? 'انتخاب نشده'}`, 'aria-controls': 'journey-station-query' },
      h('span', { class: 'journey-endpoint__label', text: short }), h('span', { class: ['journey-endpoint__name', !name && 'is-empty'], text: name ?? 'انتخاب ایستگاه' }));
  }
  function chipGroup(id, label, items, value, change) {
    return h('div', { id, class: 'journey-seg cm-chips', role: 'group', 'aria-label': label },
      ...items.map(([key, text]) => h('button', { type: 'button', id: `${id}-${key}`, class: 'cm-chip journey-chip', 'aria-pressed': String(String(value) === String(key)), text, onClick: () => change(key) })));
  }
  function feedbackForm(s) {
    if (!s.config.feedbackEnabled) return para('دریافت نظر اکنون خاموش است؛ استفاده از برنامه ریز به ارسال نظر نیاز ندارد.', 'journey-muted');
    if (!s.feedback.open) return action('ثبت نظر اختیاری', () => controller.openFeedback(), { class: 'cm-btn cm-btn--sm journey-feedback-open', disabled: !!s.busy });
    const f = s.feedback, available = controller.availableFeedback();
    const kinds = Object.entries(FEEDBACK_KINDS).map(([key, value]) => [key, value.title]);
    const kindSelect = selectControl('journey-feedback-kind', 'چه چیزی را گزارش می کنید؟', kinds.filter(([key]) => available[key] || key === f.kind), f.kind, kind => controller.updateFeedback({ kind }), { disabled: !!s.busy });
    const fields = [];
    const choose = (id, label, choices, key) => selectControl('journey-feedback-' + id, label, [['', 'انتخاب کنید'], ...choices], f[key], value => controller.updateFeedback({ [key]: value }), { disabled: !!s.busy });
    if (f.kind === 'timing_quality') fields.push(choose('quality', 'نظر کلی درباره زمان بندی مدل', TIMING_CHOICES, 'quality'));
    if (f.kind === 'boarding_outcome') fields.push(choose('outcome', 'تجربه شخصی سوار شدن', OUTCOME_CHOICES, 'result'));
    if (f.kind === 'problem') fields.push(choose('problem', 'نوع مشکل', PROBLEM_CHOICES, 'category'));
    if (['timing_quality', 'boarding_outcome', 'problem'].includes(f.kind) && !s.expired && s.response.options?.length) {
      fields.push(selectControl('journey-feedback-option', 'گزینه مرتبط (اختیاری)', [['', 'هیچ گزینه مشخصی'], ...s.response.options.map(o => [o.id, `${clockText(o.departAt)} · به سمت ${spaced(o.toward)}`])], f.optionId, optionId => controller.updateFeedback({ optionId }), { disabled: !!s.busy }));
    }
    if (f.kind === 'train_observation') {
      const stops = lineStations(state.get(), s.response.request.line);
      fields.push(choose('event', 'رخداد قطار، نه رسیدن شخص به سکو', OBSERVATION_EVENTS, 'event'),
        choose('station', `ایستگاه مشاهده · خط ${fa(s.response.request.line)}`, stops.map(st => [st.id, st.name]), 'stationId'),
        choose('direction', 'جهت مشاهده', directionChoices({ order: stops.map(st => st.name) }).map(d => [d.value, d.label]), 'direction'),
        inputControl('journey-observed-date', 'تاریخ رخداد قطار (میلادی، به وقت تهران)', 'date', f.date, date => controller.updateFeedback({ date }, false), { min: addDays(tehranParts(controller.now()).date, -2), max: tehranParts(controller.now()).date, disabled: !!s.busy, dir: 'ltr' }),
        inputControl('journey-observed-time', 'ساعت رخداد قطار · Asia/Tehran', 'time', f.time, time => controller.updateFeedback({ time }, false), { step: '60', disabled: !!s.busy, dir: 'ltr' }),
        choose('precision', 'دقت زمان مشاهده', PRECISION_CHOICES, 'precision'));
      fields.push(para('تاریخ و ساعت را خودتان مشخص کنید. ساعت آینده به دیروز تبدیل نمی شود. زمان ثبت گزارش هنگام دریافت، توسط سرور ثبت می شود.', 'journey-muted'));
    }
    const note = h('textarea', { id: 'journey-feedback-note', maxlength: NOTE_MAX, rows: 2, placeholder: NOTE_HINT, disabled: !!s.busy,
      onInput: e => controller.updateFeedback({ note: e.target.value }, false) });
    note.value = f.note;
    const consent = h('input', { id: 'journey-feedback-consent', type: 'checkbox', disabled: !!s.busy, onChange: e => controller.updateFeedback({ consent: e.target.checked }) });
    consent.checked = f.consent === true;
    const form = h('form', { class: 'journey-feedback', onSubmit: e => { e.preventDefault(); controller.sendFeedback(); } },
      h('h3', { text: 'گزارش اختیاری، ناشناس و بررسی نشده' }), kindSelect,
      para(FEEDBACK_KINDS[f.kind]?.hint ?? '', 'journey-muted'), ...fields,
      h('div', { class: 'journey-field' }, h('label', { for: 'journey-feedback-note', text: 'توضیح کوتاه (اختیاری، حداکثر ۲۰۰ نویسه)' }), note),
      h('div', { class: 'journey-consent' }, consent, h('label', { for: 'journey-feedback-consent', text: CONSENT_TEXT })),
      para('می توانید بدون ارسال نظر ادامه دهید. گزارش، مشاهده مستقل یا تایید شده محسوب نمی شود؛ زمان رسیدن شخص معیار خطای قطار نیست.', 'journey-muted'),
      h('div', { class: 'journey-actions' },
        h('button', { type: 'submit', class: 'cm-btn cm-btn--primary', text: s.busy === 'feedback' ? 'در حال ارسال…' : f.status === 'error' ? 'تلاش دوباره برای ارسال' : 'ارسال نظر', disabled: !!s.busy || !f.consent || f.status === 'sent' || !available[f.kind] }),
        action('بدون ارسال، بستن فرم', () => controller.closeFeedback(), { disabled: s.busy === 'feedback' })),
      h('p', { class: 'journey-feedback-status', role: 'status', 'aria-live': 'polite', text: f.message }));
    return form;
  }
  function results(s) {
    const box = h('div', { class: 'journey-results', 'aria-busy': String(s.busy === 'plan') });
    // The model notice sits beside a result, a pending request or an error — not as standing text above an empty form.
    // Embedded order: answer summary, then the fixed model-only notice (it must be visible with the first card), then the
    // cards; the calendar warning and refresh controls follow the cards. The notice is shown exactly once.
    const notice = !embedded || s.response || s.error || s.busy === 'plan' ? para(FIXED_NOTICE, 'journey-notice') : null;
    const calendarWarning = [];
    // Calendar mode is server configuration, never a device weekday inference. Friday remains model-only too.
    if (s.response && (s.response.calendar?.warning || s.response.calendar?.state === 'estimated' ||
        (s.config.calendarMode === 'weekday_baseline' && s.response.calendar?.dayType !== 'friday'))) calendarWarning.push(para(WEEKDAY_WARNING, 'journey-warning'));
    if (!embedded) box.append(...[notice, ...calendarWarning].filter(Boolean));
    if (s.busy === 'plan') box.append(para('در حال محاسبه برنامه مدل…', 'journey-status'));
    if (s.error) {
      const view = s.error.kind === 'form' ? { title: 'انتخاب را بررسی کنید', text: s.error.message } : statusView(s.error);
      box.append(h('div', { role: 'status', class: 'journey-status' }, h('h3', { text: view.title }), para(view.text)));
    }
    if (!s.response) { if (embedded) box.append(...[notice, ...calendarWarning].filter(Boolean)); return box; }
    const response = s.response, summary = requestSummary(response, controller.now()), status = statusView(response);
    box.append(h('div', { class: 'journey-summary', role: 'status', 'aria-live': 'polite' }, h('h3', { text: summary.title }), para(`${summary.line} · ${summary.ready}`), h('h4', { text: status.title }), para(status.text)));
    if (response.message && response.message !== status.text) box.append(para(response.message, 'journey-warning'));
    if (embedded && notice) box.append(notice);
    const noOptions = !(response.options?.length > 0);
    const fresh = para(embedded
      ? (noOptions ? 'نتیجه ای برای نمایش نیست؛ روز یا ساعت دیگری را امتحان کنید یا دوباره محاسبه کنید. کرایه نامعلوم است.' : s.expired ? 'اعتبار نتیجه تمام شد؛ برای حرکت بعدی دوباره محاسبه کنید. کارت ها فقط سابقهٔ همین درخواست هستند.' : 'نتیجه کوتاه مدت معتبر است و خودکار تازه نمی شود؛ پس از تغییر ورودی یا گذشت اعتبار دوباره محاسبه کنید. کرایه نامعلوم است.')
      : s.expired ? 'اعتبار این نتیجه منقضی شده است. برای تصمیم درباره حرکت بعدی، محاسبه دوباره را بزنید؛ کارت ها فقط سابقه همین درخواست در این صفحه هستند.' : 'این نتیجه کوتاه مدت معتبر است؛ با تغییر انتخاب یا گذشت اعتبار، دوباره محاسبه کنید. به روز رسانی خودکار انجام نمی شود.', 'journey-freshness');
    const again = action('محاسبه دوباره', () => controller.plan(), { disabled: !!s.busy });
    if (!embedded) box.append(fresh, again);
    const cards = h('div', { class: ['journey-cards', s.expired && 'is-expired'] });
    for (const option of response.options ?? []) {
      const view = formatOption(option);
      const dates = option.departDate && option.arriveDate && option.departDate !== option.arriveDate;
      cards.append(h('article', { class: 'journey-option cm-card' },
        h('div', { class: 'journey-option-head' }, h('h4', { text: view.toward || 'جهت قطار مشخص نیست' }), h('span', { class: 'journey-tag', text: s.expired ? 'برآورد منقضی' : ESTIMATE_LABEL })),
        view.earliest && para(embedded ? 'زودترین رسیدن در گزینه های مدل شده این فهرست' : EARLIEST_LABEL, 'journey-earliest'),
        h('dl', { class: 'journey-times' }, h('div', {}, h('dt', { text: 'حرکت تخمینی' }), h('dd', { text: view.depart }), dates && para(dateLabel(option.departDate, controller.now()))),
          h('div', {}, h('dt', { text: 'رسیدن تخمینی' }), h('dd', { text: view.arrive }), dates && para(dateLabel(option.arriveDate, controller.now())))),
        para(`انتظار مدل: ${view.wait} · داخل قطار: ${view.inVehicle}`, 'journey-muted'),
        view.derived && para(DERIVED_NOTE, 'journey-warning'),
        remindersReady && !s.expired && option.eventId && option.departEpoch * 1000 >= controller.now() + 360000 && action('یادآوری این قطار، ۵ دقیقه پیش از حرکت', () => {
          if (reminderBusy) return;
          const task = reminders.schedule(response.request, option);
          reminderBusy = true; reminderMessage = 'در حال ثبت یادآوری…'; render();
          task.then(() => { reminderMessage = 'یادآوری ثبت شد؛ زمان حرکت برآورد مدل است و ارسال اعلان تضمین نمی شود.'; }, () => { reminderMessage = reminders.hasReminder() ? 'وضعیت ثبت مشخص نیست؛ هنگام بازگشت دوباره بررسی می‌شود. می‌توانید یادآوری را لغو کنید.' : 'ثبت یادآوری ممکن نشد؛ اجازه اعلان و اتصال را بررسی کنید.'; }).finally(() => { reminderBusy = false; render(); });
        }, { disabled: reminderBusy || reminders.hasReminder() })));
    }
    if (remindersReady && response.options?.some(o => o.eventId && o.departEpoch * 1000 >= controller.now() + 360000)) box.append(para('یادآوری اختیاری است. با انتخاب یک قطار، نشانی اشتراک اعلان تا زمان یادآوری روی سرور نگهداری می شود؛ متن اعلان جزئیات سفر ندارد. تا تأیید ثبت، اطلاعات اشتراک و سفر برای تلاش دوباره در همین دستگاه ذخیره می‌شود؛ پس از تأیید فقط کد لغو و زمان انقضا می‌ماند. پاک‌سازی محلی هنگام استفاده بعدی انجام می‌شود. امکان لغو در همین دستگاه وجود دارد.', 'journey-muted'));
    box.append(cards, ...(embedded ? [fresh, again, ...calendarWarning] : []), feedbackForm(s));
    return box;
  }
  // Default OFF must be invisible: a visitor who never opted in or followed the invitation sees no card while the beta is
  // loading, disabled or unreachable. People who asked for it still get an honest reason.
  const quiet = s => !controller.interested() && ['idle', 'loading', 'disabled', 'config_error'].includes(s.phase);
  let wasPlanning = false;
  function render() {
    const s = controller.get(), focused = globalThis.document?.activeElement;
    if (embedded && pickerLine !== s.form.line) {
      pickerLine = s.form.line; picker.close(); pickerInput.value = ''; setPicker(false);
    }
    root.hidden = embedded ? !s.active || s.phase !== 'ready' : quiet(s);
    if (root.hidden) { root.replaceChildren(); return; }
    const focusId = focused?.id, start = focused?.selectionStart, end = focused?.selectionEnd;
    root.replaceChildren(...(embedded ? [] : [h('header', { class: 'journey-heading' }, h('div', {}, h('p', { class: 'eyebrow', text: 'مترو · Beta' }), h('h2', { id: 'journey-title', text: 'برنامه ریز سفر مترو — آزمایشی' })), s.active && action('خروج از بتا', () => controller.leave())), para(MODEL_ONLY_SUMMARY, 'journey-intro')]));
    if (s.phase === 'idle' || s.phase === 'loading') { root.append(para(s.phase === 'loading' ? 'در حال بررسی دسترسی بتا…' : 'بخش آزمایشی اختیاری است.', 'journey-muted')); return; }
    if (s.phase === 'disabled') { root.append(para(statusView('disabled').text, 'journey-muted')); return; }
    if (s.phase === 'config_error') {
      root.append(para('دسترسی بتا بررسی نشد. تابلوی ایستگاه و دیگر بخش ها مستقل هستند.', 'journey-muted'), action('بررسی دوباره دسترسی', () => controller.load())); return;
    }
    if (!s.active) {
      root.append(para('ورود اختیاری است. فقط انتخاب ورود به بتا در همین دستگاه به خاطر سپرده می شود، نه تاریخچه سفر.', 'journey-muted'), action(s.invited || s.promoted ? 'ورود به برنامه ریز Beta' : 'فعال کردن اختیاری بتا', () => controller.optIn(), { class: 'cm-btn cm-btn--primary' })); return;
    }
    const form = s.form, registry = state.get(), stops = lineStations(registry, form.line);
    const lines = [1, 2].filter(line => lineStations(registry, line).length > 1).map(line => [String(line), `خط ${fa(line)}`]);
    const stationChoices = [['', 'انتخاب ایستگاه'], ...stops.map(st => [st.id, st.name])];
    const swapForm = () => controller.setForm({ from: form.to, to: form.from });
    let submitButton;
    const timeInput = () => inputControl('journey-time', embedded ? 'ساعت · تهران' : 'ساعت آماده بودن · تهران', 'time', form.time, time => {
      // Keep the native segmented time editor alive while invalidating results on every edit.
      controller.setForm({ time }, false);
      submitButton.disabled = stops.length < 2;
      submitButton.textContent = 'دیدن برآورد سفر';
      resultHost.replaceChildren(results(controller.get()));
    }, { step: '60', dir: 'ltr', required: true });
    const dateFields = () => h('div', { class: 'journey-date-fields' },
      selectControl('journey-date', embedded ? 'روز' : 'روز آماده بودن', dayChoices(controller.now()).map(day => [day.value, day.label === day.detail ? day.label : `${day.label} · ${day.detail}`]), form.date, date => controller.setForm({ date })), timeInput());
    const controls = embedded
      ? h('form', { class: 'journey-form', onSubmit: e => { e.preventDefault(); controller.plan(); } },
        chipGroup('journey-line', 'خط مترو', lines, form.line, line => controller.setForm({ line: Number(line) })),
        h('div', { class: 'journey-endpoints' }, endpoint('from', 'ایستگاه مبدأ', 'مبدأ', form, stops),
          action('', swapForm, { class: 'journey-swap', 'aria-label': 'جابه جا کردن مبدأ و مقصد' }, icon('arrow_left_arrow_right')),
          endpoint('to', 'ایستگاه مقصد', 'مقصد', form, stops)),
        pickerHost,
        h('div', { class: 'journey-ready' }, h('span', { id: 'journey-mode-label', class: 'journey-ready__label', text: 'چه زمانی روی سکوی مبدأ آماده اید؟' }),
          chipGroup('journey-mode', 'زمان آماده بودن روی سکو', [['now', 'همین الان روی سکو'], ['custom', 'انتخاب زمان']], form.mode, mode => controller.setForm({ mode })),
          ...(form.mode === 'custom' ? [dateFields()] : []),
          para('به وقت تهران · زمان آماده بودن روی سکو، نه خروج از خانه', 'journey-muted journey-ready__hint')))
      : h('form', { class: 'journey-form', onSubmit: e => { e.preventDefault(); controller.plan(); } },
        selectControl('journey-line', 'خط مترو', lines.map(([k, text]) => [k, text]), form.line, line => controller.setForm({ line: Number(line) })),
        h('div', { class: 'journey-station-fields' }, selectControl('journey-from', 'ایستگاه مبدأ', stationChoices, form.from, from => controller.setForm({ from })), selectControl('journey-to', 'ایستگاه مقصد', stationChoices, form.to, to => controller.setForm({ to }))),
        action('جابه جا کردن مبدأ و مقصد', swapForm, { class: 'cm-btn cm-btn--sm journey-swap' }),
        selectControl('journey-mode', 'چه زمانی روی سکوی مبدأ آماده هستید؟', [['now', 'همین الان روی سکو هستم'], ['custom', 'انتخاب روز و ساعت آماده بودن روی سکو']], form.mode, mode => controller.setForm({ mode })),
        para('زمان ها به وقت تهران · Asia/Tehran است. «همین الان» یعنی آماده روی سکو، نه زمان خروج از خانه.', 'journey-muted'),
        ...(form.mode === 'custom' ? [dateFields()] : []));
    submitButton = h('button', { type: 'submit', class: 'cm-btn cm-btn--primary journey-cta', text: s.busy === 'plan' ? 'در حال محاسبه…' : 'دیدن برآورد سفر', disabled: !!s.busy || stops.length < 2 });
    controls.append(submitButton);
    resultHost.replaceChildren(results(s));
    root.append(controls, resultHost);
    if (reminders?.hasReminder()) {
      const status = reminders.status();
      root.append(para(status === 'pending' ? 'ثبت یادآوری هنوز تأیید نشده است. برای انتخاب قطار دیگر، ابتدا یادآوری قبلی را لغو کنید.' : status === 'cancelling' ? 'لغو یادآوری هنوز تأیید نشده است؛ دوباره تلاش کنید.' : 'برای انتخاب قطار دیگر، ابتدا یادآوری قبلی را لغو کنید.', 'journey-muted'));
      root.append(action('لغو یادآوری و لغو اشتراک اعلان', () => {
        reminderBusy = true; render();
        reminders.remove().then(() => { reminderMessage = 'درخواست لغو یادآوری انجام شد.'; }, () => { reminderMessage = 'لغو تأیید نشد؛ دوباره تلاش کنید.'; }).finally(() => { reminderBusy = false; render(); });
      }, { disabled: reminderBusy }));
    }
    if (reminderMessage) root.append(h('p', { role: 'status', class: 'journey-muted', text: reminderMessage }));
    // The answer arrives below the CTA: bring it into view above the fixed nav once, when a request just finished.
    if (embedded && wasPlanning && s.busy !== 'plan' && (s.response || s.error)) {
      const target = resultHost.querySelector('.journey-summary, .journey-status'), vh = globalThis.visualViewport?.height ?? globalThis.innerHeight;
      const top = target?.getBoundingClientRect?.().top;
      if (Number.isFinite(top) && top > vh * 0.5) globalThis.scrollBy?.({ top: top - 96, behavior: 'instant' });
    }
    wasPlanning = s.busy === 'plan';
    if (focusId && root.querySelector) {
      const replacement = root.querySelector('#' + focusId);
      replacement?.focus({ preventScroll: true });
      try { if (typeof start === 'number') replacement?.setSelectionRange(start, end); } catch { /* native dates/times have no selection range */ }
    }
  }
  controller.subscribe(render);
  state.subscribe(['stations', 'order', 'order2', 'status'], () => {
    const form = controller.get().form, ids = new Set(lineStations(state.get(), form.line).map(s => s.id));
    // Loading keeps the last registry. Only authoritative ready data can invalidate endpoints.
    if (state.get().status === 'ready') controller.setForm({ from: ids.has(form.from) ? form.from : '', to: ids.has(form.to) ? form.to : '' });
    picker?.refresh(); render();
  });
  render();
  return { el: root, controller, onShow: () => {
    if (reminders && !remindersStarted) { remindersStarted = true; void reminders.prepare().then(ready => { remindersReady = ready; render(); }); }
    return controller.load();
  }, onHide: () => { picker?.close(); if (pickerHost) setPicker(false); controller.hide(); },
    refreshShortcuts() { if (embedded && !pickerHost.hidden) paintShortcuts(); }, choose };
}
