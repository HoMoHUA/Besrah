// Journey planner (beta) — pure logic. No DOM, no network, no timers: everything here is unit-tested.
// Product meaning (owner decision): model-only, same line, platform to platform. Not door-to-door, not live
// train position, not a guarantee, not a bus, not a fare, not the fastest route in the city.
import { fa } from './format.js';

/* ── fixed Persian copy ─────────────────────────────────────────────────────────────────────────────── */
export const FIXED_NOTICE = 'این زمان ها برآورد مدل برنامه قطارند، نه موقعیت زنده. زمان رسیدن شما از ورودی ایستگاه به سکو، پیاده روی و جابه جایی بین خطوط محاسبه نشده است.';
export const WEEKDAY_WARNING = 'برنامهٔ روزهای هفته در این مدل یک برآورد است و تعطیلات رسمی در آن بررسی نشده است. ممکن است قطارها آن روز طبق برنامهٔ دیگری حرکت کنند.';
export const MODEL_ONLY_SUMMARY = 'زمان قطار از یک ایستگاه به ایستگاه دیگر روی همان خط، بر پایهٔ برنامهٔ مدل. برآورد است، نه موقعیت زندهٔ قطار؛ مسیر درب تا درب، تغییر خط و تضمین رسیدن نیست.';

/* ── beta exposure (rollout bucket + explicit opt-in) ───────────────────────────────────────────────── */
export const BETA_KEYS = Object.freeze({ bucket: 'besrah.beta.bucket', optIn: 'besrah.beta.optin', optOut: 'besrah.beta.optout' });

const readKey = (storage, key) => { try { return storage?.getItem(key) ?? null; } catch { return null; } };
const writeKey = (storage, key, value) => { try { storage.setItem(key, value); return true; } catch { return false; } };
const removeKey = (storage, key) => { try { storage.removeItem(key); return true; } catch { return false; } };

// A random 0..99 stored once per device. With blocked storage the value simply is not remembered; nothing throws.
export function rolloutBucket(storage, random = Math.random) {
  const stored = readKey(storage, BETA_KEYS.bucket);
  if (stored !== null && /^\d{1,2}$/.test(stored) && Number(stored) <= 99) return Number(stored);
  let value = Math.floor(Number(random()) * 100);
  if (!Number.isInteger(value) || value < 0 || value > 99) value = 99;   // an unusable random source never exposes the beta
  writeKey(storage, BETA_KEYS.bucket, String(value));
  return value;
}

// `?beta=1` (the invitation link) is the only accepted spelling.
export function optInFromSearch(search) {
  try { return new URLSearchParams(String(search ?? '')).get('beta') === '1'; } catch { return false; }
}
export const readOptIn = storage => readKey(storage, BETA_KEYS.optIn) === '1' && readKey(storage, BETA_KEYS.optOut) !== '1';
export function writeOptIn(storage) { removeKey(storage, BETA_KEYS.optOut); return writeKey(storage, BETA_KEYS.optIn, '1'); }
// Leaving the beta forgets the opt-in and also remembers the choice, so a visitor inside the rollout share is not pulled back in.
export function clearOptIn(storage) { removeKey(storage, BETA_KEYS.optIn); return writeKey(storage, BETA_KEYS.optOut, '1'); }
export const readOptOut = storage => readKey(storage, BETA_KEYS.optOut) === '1';

export function betaVisible(config, { bucket = 100, optIn = false, optOut = false } = {}) {
  if (!config || config.enabled !== true || optOut === true) return false;
  const percent = Number(config.rolloutPercent);
  return optIn === true || (Number.isFinite(percent) && bucket < percent);
}

/* ── Tehran calendar (never the device zone) ────────────────────────────────────────────────────────── */
const TEHRAN_ZONE = 'Asia/Tehran';
const TEHRAN_OFFSET_MINUTES = 210;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
const spaced = text => String(text).replace(/\u200c/g, ' ').replace(/[\u200e\u200f]/g, '').replace(/\s+/g, ' ').trim();

// { date: 'YYYY-MM-DD', time: 'HH:MM' } on the Tehran wall clock.
export function tehranParts(nowMs) {
  const ms = Number.isFinite(nowMs) ? nowMs : Date.now();
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TEHRAN_ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms));
    const pick = type => parts.find(part => part.type === type)?.value ?? '';
    const date = `${pick('year')}-${pick('month')}-${pick('day')}`, time = `${pick('hour')}:${pick('minute')}`;
    if (DATE_RE.test(date) && TIME_RE.test(time)) return { date, time };
  } catch { /* fall through to the fixed-offset computation */ }
  const shifted = new Date(ms + TEHRAN_OFFSET_MINUTES * 60_000).toISOString();   // Iran has no DST since 2022
  return { date: shifted.slice(0, 10), time: shifted.slice(11, 16) };
}

export function addDays(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10);
}
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
export const tehranIso = (date, time) => `${date}T${time}:00+03:30`;
export const epochOfTehran = (date, time) => Date.parse(tehranIso(date, time));

let jalaliFormat;
function jalaliLabel(date) {
  if (jalaliFormat === undefined) {
    try {
      const format = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
      jalaliFormat = format.resolvedOptions().calendar === 'persian' ? format : null;
    } catch { jalaliFormat = null; }
  }
  const [y, m, d] = date.split('-').map(Number);
  if (jalaliFormat) {
    try { const text = spaced(jalaliFormat.format(new Date(Date.UTC(y, m - 1, d, 12)))); if (text) return fa(text); } catch { /* use the fallback */ }
  }
  // Safe fallback when the runtime has no Persian calendar: weekday plus the Gregorian date in Persian digits.
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()]} ${fa(date.replace(/-/g, '/'))}`;
}

// `count` consecutive Tehran days starting today: [{ value, label, detail, offset }].
export function dayChoices(nowMs, count = 8) {
  const today = tehranParts(nowMs).date;
  return Array.from({ length: Math.max(1, count) }, (_, offset) => {
    const value = addDays(today, offset), detail = jalaliLabel(value);
    return { value, offset, detail, label: offset === 0 ? 'امروز' : offset === 1 ? 'فردا' : detail };
  });
}
export function dateLabel(date, nowMs) {
  const today = tehranParts(nowMs).date, offset = daysBetween(today, date);
  return offset === 0 ? 'امروز' : offset === 1 ? 'فردا' : offset === -1 ? 'دیروز' : jalaliLabel(date);
}

/* ── form -> query ──────────────────────────────────────────────────────────────────────────────────── */
// form: { mode: 'now'|'custom', line, from, to, date, time }. 'now' never carries a date or time (the server clock decides).
export function buildJourneyQuery(form) {
  const query = { line: form?.line === 2 ? 2 : 1, from: String(form?.from ?? ''), to: String(form?.to ?? '') };
  if (form?.mode === 'custom') {
    if (!DATE_RE.test(String(form.date ?? '')) || !TIME_RE.test(String(form.time ?? ''))) throw new RangeError('custom_time_incomplete');
    query.date = form.date; query.time = form.time;
  }
  return query;
}

export const FORM_ERRORS = Object.freeze({
  missing_station: 'ایستگاه مبدأ و مقصد را انتخاب کنید.',
  same_station: 'مبدأ و مقصد باید دو ایستگاه متفاوت باشند.',
  custom_incomplete: 'روز و ساعت را انتخاب کنید.',
  date_out_of_range: 'روز انتخاب شده در بازهٔ مجاز (امروز تا هفت روز بعد) نیست.',
  past_time: 'این ساعت گذشته است. ساعتی از همین حالا به بعد انتخاب کنید یا گزینهٔ «همین الان» را بزنید.',
});

// Mirrors the server's rules so most mistakes are explained before a request is made. The server stays the real gate.
export function validateForm(form, nowMs, { horizonDays = 7, pastGraceMinutes = 5 } = {}) {
  if (!form?.from || !form?.to) return 'missing_station';
  if (form.from === form.to) return 'same_station';
  if (form.mode !== 'custom') return null;
  if (!DATE_RE.test(String(form.date ?? '')) || !TIME_RE.test(String(form.time ?? ''))) return 'custom_incomplete';
  const offset = daysBetween(tehranParts(nowMs).date, form.date);
  if (!Number.isFinite(offset) || offset < 0 || offset > horizonDays) return 'date_out_of_range';
  if (epochOfTehran(form.date, form.time) < nowMs - pastGraceMinutes * 60_000) return 'past_time';
  return null;
}

/* ── option display (Persian digits, minutes only — never seconds) ──────────────────────────────────── */
const clockOf = value => { const m = /^(\d{1,2}):(\d{2})/.exec(String(value ?? '')); return m ? fa(`${m[1].padStart(2, '0')}:${m[2]}`) : ''; };
export const clockText = clockOf;
export function waitText(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s < 0) return '';
  return s < 60 ? 'کمتر از ۱ دقیقه' : `${fa(Math.round(s / 60))} دقیقه`;
}
export function durationText(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s < 0) return '';
  return s < 60 ? 'کمتر از ۱ دقیقه' : `${fa(Math.round(s / 60))} دقیقه`;
}

export function formatOption(option) {
  const o = option ?? {};
  const depart = clockOf(o.departAt), arrive = clockOf(o.arriveAt);
  const wait = waitText(o.waitSeconds), inVehicle = durationText(o.inVehicleSeconds);
  const toward = o.toward ? `به سمت ${spaced(o.toward)}` : '';
  return {
    depart, arrive, wait, inVehicle, toward,
    earliest: o.earliestArrival === true, derived: o.derivedExtension === true,
    label: `حرکت ${depart}، رسیدن ${arrive}، انتظار ${wait}، ${inVehicle} در قطار، ${toward}`,
  };
}

export const EARLIEST_LABEL = 'زودترین رسیدن در همین مدل';
export const ESTIMATE_LABEL = 'برآورد';
export const DERIVED_NOTE = 'زمان بخشی از این مسیر فقط از روی برآورد مدل به دست آمده و اندازه گیری نشده است.';

// "ready on the platform at ..." line for the result header.
export function requestSummary(response, nowMs) {
  const r = response?.request ?? {};
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(String(r.readyAt ?? ''));
  const clock = m ? fa(m[2]) : '';
  const day = m ? dateLabel(m[1], nowMs ?? Date.now()) : '';
  const ready = r.source === 'user_selected'
    ? `آماده روی سکوی مبدأ: ${day} ساعت ${clock} به وقت تهران`
    : `آماده روی سکوی مبدأ: هم اکنون، ساعت ${clock} به وقت تهران`;
  return { title: `از ${spaced(r.originName ?? '')} به ${spaced(r.destinationName ?? '')}`, line: r.line === 1 || r.line === 2 ? `خط ${fa(r.line)}` : '', ready: clock ? ready : '' };
}

/* ── honest states ──────────────────────────────────────────────────────────────────────────────────── */
// statusView accepts a journey response ({ status }) or a client error ({ kind }). It never invents numbers: the
// only figures are the ones the response itself carries.
export function statusView(input) {
  const key = typeof input === 'string' ? input : (input?.kind ?? input?.status ?? '');
  const message = typeof input === 'object' && typeof input?.message === 'string' && input.message ? input.message : null;
  switch (key) {
    case 'ok': {
      const count = Array.isArray(input?.options) ? input.options.length : 0;
      if (!count) return { tone: 'empty', title: 'گزینه ای نمایش داده نشد', text: message ?? 'مدل برای این درخواست گزینه ای برنگرداند.', retryable: false };
      const windowMinutes = Number(input?.request?.windowMinutes);
      return { tone: 'ok', title: `${fa(count)} گزینه در مدل`, text: Number.isFinite(windowMinutes) && windowMinutes > 0 ? `قطارهای ${fa(windowMinutes)} دقیقهٔ بعد از زمان آماده بودن شما روی سکو، به ترتیب زمان حرکت.` : 'به ترتیب زمان حرکت.', retryable: false };
    }
    case 'partial': return { tone: 'warn', title: 'نتیجهٔ ناقص', text: message ?? 'اطلاعات این بازه کامل نیست و فهرست ممکن است ناقص باشد.', retryable: false };
    case 'insufficient_data': return { tone: 'empty', title: 'برنامهٔ این روز در مدل کافی نیست', text: message ?? 'برای این روز برنامه ای که بتوان به آن اعتماد کرد در مدل نیست؛ زمان بندی نمایش داده نمی شود.', retryable: false };
    case 'no_feasible_option': return { tone: 'empty', title: 'قطاری در مدل پیدا نشد', text: message ?? 'در این بازه قطاری که از مبدأ به مقصد برسد در مدل پیدا نشد. ممکن است سرویس تمام شده یا هنوز شروع نشده باشد.', retryable: false };
    case 'network': return { tone: 'error', title: 'اتصال برقرار نشد', text: 'اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.', retryable: true };
    case 'timeout': return { tone: 'error', title: 'پاسخی نرسید', text: 'سرور دیر پاسخ داد. چند لحظه بعد دوباره تلاش کنید.', retryable: true };
    case 'server': return { tone: 'error', title: 'پاسخ سرویس قابل استفاده نبود', text: 'چند لحظه بعد دوباره تلاش کنید.', retryable: true };
    case 'rate_limited': return { tone: 'error', title: 'درخواست ها زیاد است', text: 'چند لحظه صبر کنید و دوباره تلاش کنید.', retryable: true };
    case 'unavailable': return { tone: 'error', title: 'برنامه ریز موقتاً در دسترس نیست', text: 'محاسبهٔ زمان بندی اکنون ممکن نشد. کمی بعد دوباره تلاش کنید.', retryable: true };
    case 'disabled': return { tone: 'empty', title: 'برنامه ریز آزمایشی اکنون فعال نیست', text: 'این بخش موقتاً خاموش شده است. تابلوی ایستگاه ها همچنان کار می کند.', retryable: false };
    case 'bad_request': {
      const code = typeof input === 'object' ? input?.code : undefined;
      const text = code === 'time_in_past' ? FORM_ERRORS.past_time
        : code === 'date_out_of_range' ? FORM_ERRORS.date_out_of_range
          : code === 'same_station' ? FORM_ERRORS.same_station
            : code === 'bad_station' ? 'یکی از ایستگاه ها روی این خط نیست. ایستگاه ها را دوباره انتخاب کنید.'
              : 'درخواست پذیرفته نشد. ایستگاه ها و زمان را بررسی کنید.';
      return { tone: 'error', title: 'درخواست معتبر نبود', text, retryable: false };
    }
    default: return { tone: 'error', title: 'خطای ناشناخته', text: 'دوباره تلاش کنید.', retryable: true };
  }
}

/* ── feedback ───────────────────────────────────────────────────────────────────────────────────────── */
export const CONSENT_TEXT = 'با ذخیره ناشناس این گزارش، ایستگاه ها، خط، تاریخ و زمان مربوط به آن برای بررسی و بهبود مدل موافقم. نام، GPS یا شناسه حساب ارسال نمی شود. چون گزارش ناشناس است، بعداً نمی توان آن را به شما نسبت داد یا به طور جداگانه حذف کرد.';
export const NOTE_HINT = 'اطلاعات شخصی ننویسید';
export const NOTE_MAX = 200;

// Same patterns as the server so a note is explained before sending. The server stays the real gate.
// eslint-disable-next-line no-control-regex
const BAD_NOTE = /(https?:|www\.|\bt\.me\b|\b[a-z0-9-]+\.(com|ir|org|net|me|io|app)\b|[<>`$\\{}|^~]|[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\u200b\u200d\u200e\u200f\ufeff])/i;
const LONG_DIGITS = /[0-9\u06f0-\u06f9\u0660-\u0669](?:[\s-]*[0-9\u06f0-\u06f9\u0660-\u0669]){6,}/;

export function sanitizeNote(text) {
  const clean = String(text ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  return [...clean].slice(0, NOTE_MAX).join('').trim();
}
export function checkNote(text) {
  const note = sanitizeNote(text);
  if (!note) return null;
  if (BAD_NOTE.test(note) || /^[=+\-@]/.test(note)) return 'disallowed_content';
  if (LONG_DIGITS.test(note)) return 'looks_like_personal_number';
  return null;
}

const UUID_BYTES = 16;
// Idempotency key: crypto.randomUUID(), else built from crypto.getRandomValues, else (no crypto at all) from Math.random.
export function newReportId(cryptoImpl = globalThis.crypto) {
  try { if (typeof cryptoImpl?.randomUUID === 'function') { const id = cryptoImpl.randomUUID(); if (/^[A-Za-z0-9-]{16,64}$/.test(id)) return id; } } catch { /* fall back */ }
  const bytes = new Uint8Array(UUID_BYTES);
  let filled = false;
  try { if (typeof cryptoImpl?.getRandomValues === 'function') { cryptoImpl.getRandomValues(bytes); filled = true; } } catch { /* fall back */ }
  if (!filled) for (let i = 0; i < UUID_BYTES; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const TIMING_CHOICES = Object.freeze([
  ['close', 'نزدیک بود'], ['earlier', 'قطار زودتر از این زمان آمد'], ['later', 'قطار دیرتر از این زمان آمد'], ['unknown', 'نمی دانم'],
]);
// The two observation events stay literally distinct; the person's own arrival at the platform is neither.
export const OBSERVATION_EVENTS = Object.freeze([['train_arrival', 'قطار به ایستگاه رسید'], ['train_departure', 'قطار از ایستگاه حرکت کرد']]);
export const PRECISION_CHOICES = Object.freeze([['minute', 'دقیقهٔ آن را مطمئنم'], ['approximate', 'زمان تقریبی است']]);
export const OUTCOME_CHOICES = Object.freeze([['made_it', 'به قطار رسیدم و سوار شدم'], ['missed', 'قطار را از دست دادم'], ['unknown', 'نمی دانم']]);
export const PROBLEM_CHOICES = Object.freeze([
  ['cancelled', 'قطار لغو شده بود'], ['different_schedule', 'برنامهٔ واقعی با این فهرست فرق داشت'], ['wrong_station', 'ایستگاه درست نیست'],
  ['wrong_direction', 'جهت قطار درست نیست'], ['other', 'مشکل دیگر'], ['unknown', 'نمی دانم'],
]);
export const FEEDBACK_KINDS = Object.freeze({
  timing_quality: { title: 'این زمان بندی با تجربهٔ من نزدیک بود', hint: 'نظر کلی شما است و اندازه گیری دقیق حساب نمی شود.' },
  train_observation: { title: 'رسیدن یا حرکت یک قطار را دیدم', hint: 'فقط اگر خودتان دیده اید که قطاری به ایستگاه رسید یا از آن حرکت کرد. رسیدن خودتان به سکو مشاهدهٔ قطار نیست.' },
  boarding_outcome: { title: 'آیا سوار قطار شدم', hint: 'یادداشتی از تجربهٔ شما است و معیار خطای مدل حساب نمی شود.' },
  problem: { title: 'گزارش مشکل', hint: 'اگر برنامه یا ایستگاه یا جهت درست به نظر نمی رسد.' },
});

const oneOf = (value, list) => list.some(([key]) => key === value);
const STATION_ID = /^METRO-\d{3}$/;
const TRIP_DATE = /^(\d{4}-\d{2}-\d{2}):L[12]:(out|back):/;
export const tripDate = id => TRIP_DATE.exec(String(id ?? ''))?.[1] ?? null;
export function optionDirection(option) { return TRIP_DATE.exec(String(option?.id ?? ''))?.[2] ?? 'unknown'; }

// Direction choices for «train_observation»: out = towards the end of the line order, back = towards its start.
export function directionChoices({ order = [] } = {}) {
  const list = order.filter(Boolean);
  const choices = [];
  if (list.length > 1) {
    choices.push({ value: 'out', label: `در جهت ${spaced(list[list.length - 1])}` });
    choices.push({ value: 'back', label: `در جهت ${spaced(list[0])}` });
  }
  choices.push({ value: 'unknown', label: 'جهت را نمی دانم' });
  return choices;
}

function baseContext(response, option) {
  const request = response?.request ?? {}, calendar = response?.calendar ?? {};
  const context = { line: request.line, originId: request.originId, destinationId: request.destinationId };
  context.serviceDate = (option && tripDate(option.id)) || calendar.serviceDate;
  if (option?.id) context.tripId = option.id;
  if (typeof request.readyAt === 'string') context.readyAt = request.readyAt;
  if (['known', 'estimated', 'unknown'].includes(calendar.state)) context.calendarState = calendar.state;
  return context;
}

function envelope(kind, response, extras, { consent, reportId, note, option } = {}) {
  if (consent !== true) throw new Error('consent_required');
  if (!/^sha256:[0-9a-f]{64}$/.test(String(response?.modelVersion ?? ''))) throw new Error('model_version_missing');
  const payload = { v: 1, reportId: reportId ?? newReportId(), kind, consent: { storeForModelImprovement: true }, modelVersion: response.modelVersion, context: baseContext(response, option), ...extras };
  const text = sanitizeNote(note);
  if (text) payload.note = text;
  return payload;
}

// (a) «did this schedule feel close to my experience» — qualitative, never a measurement.
export function buildTimingPayload(response, { quality, ...rest } = {}) {
  if (!oneOf(quality, TIMING_CHOICES)) throw new RangeError('bad_timing_quality');
  return envelope('timing_quality', response, { timingQuality: quality }, rest);
}
// (b) «I witnessed a train event» — arrival and departure are different events; the person's own arrival is not one.
export function buildObservationPayload(response, { event, stationId, direction = 'unknown', observedAt, precision, ...rest } = {}) {
  if (!oneOf(event, OBSERVATION_EVENTS)) throw new RangeError('bad_event');
  if (!STATION_ID.test(String(stationId ?? ''))) throw new RangeError('bad_station');
  if (!['out', 'back', 'unknown'].includes(direction)) throw new RangeError('bad_direction');
  if (!oneOf(precision, PRECISION_CHOICES)) throw new RangeError('bad_precision');
  const instant = String(observedAt ?? ''), date = instant.slice(0, 10);
  const dateMs = Date.parse(`${date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\+03:30$/.test(instant) ||
      !Number.isFinite(dateMs) || new Date(dateMs).toISOString().slice(0, 10) !== date) throw new RangeError('bad_observed_at');
  // An observation concerns a train seen at a station, not one of the listed options, so it carries no tripId.
  return envelope('train_observation', response, { observation: { event, stationId, direction, observedAt, precision } }, { ...rest, option: undefined });
}
// (c) «did I make it onto the train» — an experience note, never a measure of model error.
export function buildOutcomePayload(response, { result, ...rest } = {}) {
  if (!oneOf(result, OUTCOME_CHOICES)) throw new RangeError('bad_outcome');
  const outcome = { result };
  return envelope('boarding_outcome', response, { outcome }, rest);
}
export function buildProblemPayload(response, { category, ...rest } = {}) {
  if (!oneOf(category, PROBLEM_CHOICES)) throw new RangeError('bad_problem');
  return envelope('problem', response, { problem: { category } }, rest);
}

// Witnesses choose BOTH date and time. A future clock time is an error, never yesterday by inference.
export function observedAtFromTime(time, nowMs, date) {
  if (!TIME_RE.test(String(time ?? '')) || !DATE_RE.test(String(date ?? ''))) return null;
  const noon = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(noon) || new Date(noon).toISOString().slice(0, 10) !== date) return null;
  const iso = tehranIso(date, time), age = nowMs - Date.parse(iso);
  return age < 0 || age > 36 * 3_600_000 ? null : iso;
}
export const observationFitsService = (observedAtIso, serviceDate) => DATE_RE.test(String(serviceDate ?? '')) && Math.abs(daysBetween(String(observedAtIso).slice(0, 10), serviceDate)) <= 1;

// Which feedback kinds make sense right now for this response (the server enforces the same date windows).
export function feedbackAvailability(response, nowMs, { horizonDays = 7 } = {}) {
  const today = tehranParts(nowMs).date;
  const serviceDate = response?.calendar?.serviceDate;
  const hasModel = /^sha256:[0-9a-f]{64}$/.test(String(response?.modelVersion ?? ''));
  const hasOptions = Array.isArray(response?.options) && response.options.length > 0;
  const result = { timing_quality: false, train_observation: false, boarding_outcome: false, problem: false, experienceWait: false };
  if (!hasModel || !DATE_RE.test(String(serviceDate ?? ''))) return result;
  const offset = daysBetween(today, serviceDate);
  result.problem = offset >= -2 && offset <= horizonDays;
  const happened = Date.parse(response?.request?.readyAt) <= nowMs + 60_000;
  const inWindow = offset >= -2 && offset <= 0;
  if (inWindow && happened) {
    result.train_observation = true;
    result.timing_quality = result.boarding_outcome = hasOptions;
  } else if (result.problem) result.experienceWait = true;   // planned for a later moment: the experience questions come after it
  return result;
}

// Server/transport error -> what the feedback form says. `field` marks an input the person can fix.
export function feedbackErrorView(error) {
  const kind = error?.kind;
  const issues = Array.isArray(error?.issues) ? error.issues : [];
  switch (kind) {
    case 'rate_limited': return { tone: 'warn', text: 'تعداد ارسال ها زیاد بوده است. کمی بعد دوباره تلاش کنید.', retryable: true };
    case 'bad_request': {
      if (issues.some(issue => issue.includes('$.note'))) return { tone: 'error', text: 'یادداشت شامل نشانی، نشانهٔ ویژه یا عددی شبیه اطلاعات شخصی است. آن را ویرایش کنید یا خالی بگذارید.', retryable: false, field: 'note' };
      if (issues.some(issue => issue.includes('observedAt'))) return { tone: 'error', text: 'زمانی که نوشتید برای ثبت مجاز نیست (آینده یا بیش از ۳۶ ساعت پیش). زمان را اصلاح کنید.', retryable: false, field: 'time' };
      if (issues.some(issue => issue.includes('serviceDate'))) return { tone: 'error', text: 'این گزارش برای روز این سفر پذیرفته نمی شود.', retryable: false };
      return { tone: 'error', text: 'گزارش پذیرفته نشد. گزینه ها را بررسی کنید.', retryable: false };
    }
    case 'disabled': return { tone: 'error', text: 'دریافت نظر اکنون فعال نیست.', retryable: false };
    case 'forbidden': return { tone: 'error', text: 'ارسال از این صفحه مجاز نیست.', retryable: false };
    case 'unavailable': return { tone: 'error', text: error?.reason === 'feedback_full' ? 'ظرفیت دریافت نظر امروز پر شده است. بعداً دوباره تلاش کنید.' : 'سرویس دریافت نظر موقتاً در دسترس نیست. بعداً دوباره تلاش کنید.', retryable: true };
    case 'timeout': return { tone: 'error', text: 'پاسخی نرسید. دوباره تلاش کنید؛ گزارش دو بار ثبت نمی شود.', retryable: true };
    case 'network': return { tone: 'error', text: 'اتصال برقرار نشد. دوباره تلاش کنید؛ گزارش دو بار ثبت نمی شود.', retryable: true };
    default: return { tone: 'error', text: 'ارسال نشد. دوباره تلاش کنید؛ گزارش دو بار ثبت نمی شود.', retryable: true };
  }
}

// A report is sent once per session: identical content (ignoring reportId) or the same reportId is refused while in flight or after success.
export function createSentTracker() {
  const sent = new Set(), flying = new Set(), ids = new Set();
  const fingerprint = payload => { const { reportId, ...rest } = payload ?? {}; return JSON.stringify(rest); };
  return {
    fingerprint,
    isSent: payload => sent.has(fingerprint(payload)) || ids.has(payload?.reportId),
    begin(payload) {
      const key = fingerprint(payload);
      if (sent.has(key) || flying.has(key) || ids.has(payload?.reportId)) return false;
      flying.add(key); return true;
    },
    succeed(payload) { const key = fingerprint(payload); flying.delete(key); sent.add(key); ids.add(payload?.reportId); },
    fail(payload) { flying.delete(fingerprint(payload)); },
    get size() { return sent.size; },
  };
}
