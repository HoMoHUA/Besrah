// Hero carousel content, built only from real state. No data -> a call to action or an honest message.
import { asOfLabel, distanceLabel, fa, summarizeBoard } from './format.js';

const ERRORS = {
  denied: ['اجازهٔ موقعیت داده نشد.', 'اگر خواستید، از تنظیمات دستگاه اجازه را فعال کنید یا ایستگاه را جست وجو کنید.'],
  unavailable: ['موقعیت دستگاه در دسترس نیست.', 'ایستگاه را جست وجو کنید یا دوباره تلاش کنید.'],
  too_far: km => [`ایستگاهی تا ${fa(km)} کیلومتری شما پیدا نشد.`, 'ایستگاه را از فهرست انتخاب کنید.'],
  offline: ['فهرست ایستگاه ها دریافت نشد.', 'اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.'],
};

function boardLines(board) {
  const rows = summarizeBoard(board).map(r => `${r.heading}: ${r.text}`);
  return rows.length ? rows : ['در این ساعت قطاری ثبت نشده است.'];
}

function locateSlide({ phase = 'idle', station, km, reason, board, boardPhase, maxKm = 10 }) {
  const base = { id: 'locate', kicker: 'نزدیک ترین ایستگاه', title: '', lines: [], meta: '', action: null, busy: false, state: 'cta' };
  if (phase === 'loading') return { ...base, state: 'loading', busy: true, title: 'در حال پیدا کردن ایستگاه', lines: ['موقعیت فقط روی همین دستگاه بررسی می شود.'] };
  if (phase === 'error') {
    const entry = ERRORS[reason] ?? ERRORS.unavailable;
    const [title, line] = typeof entry === 'function' ? entry(maxKm) : entry;
    return { ...base, state: 'error', title, lines: [line], action: { id: 'locate', label: 'تلاش دوباره' } };
  }
  if (phase === 'ok' && station) {
    const distance = `فاصلهٔ مستقیم حدود ${distanceLabel(km)}`;
    if (!station.lines?.includes(1)) {
      return { ...base, state: 'unsupported', title: station.name, meta: distance,
        lines: ['این ایستگاه روی خط ۲ است و زمان رسیدن خط ۲ هنوز ساخته نشده است.', 'نزدیک ترین ایستگاه خط ۱ را از فهرست انتخاب کنید.'] };
    }
    const kicker = 'قطار بعدی نزدیک شما';
    if (boardPhase === 'loading' || (boardPhase !== 'error' && !board)) {
      return { ...base, kicker, state: 'loading', busy: true, title: station.name, meta: distance, lines: ['در حال دریافت زمان قطارها'] };
    }
    if (boardPhase === 'error' || !board) {
      return { ...base, kicker, state: 'error', title: station.name, meta: distance, lines: ['زمان قطارها دریافت نشد.'],
        action: { id: 'open', label: 'تلاش دوباره', station: station.name } };
    }
    const asOf = asOfLabel(board.as_of);
    return { ...base, kicker, state: 'result', title: station.name, lines: boardLines(board),
      meta: [distance, asOf && `به روز شده ${asOf}`].filter(Boolean).join(' · '),
      action: { id: 'open', label: 'تابلوی کامل', station: station.name } };
  }
  return { ...base, title: 'نزدیک ترین ایستگاه به شما کجاست؟',
    lines: ['موقعیت فقط پس از لمس دکمه و فقط روی همین دستگاه بررسی می شود.'],
    action: { id: 'locate', label: 'یافتن نزدیک ترین ایستگاه' } };
}

function stationSlide(recent) {
  const kicker = recent.source === 'favourite' ? 'ایستگاه مورد علاقه' : 'آخرین ایستگاه دیده شده';
  const base = { id: 'station', kicker, title: recent.station, lines: [], meta: '', action: { id: 'open', label: 'تابلوی کامل', station: recent.station }, busy: false, state: 'result' };
  if (recent.phase === 'loading' || (recent.phase !== 'error' && !recent.board)) return { ...base, state: 'loading', busy: true, lines: ['در حال دریافت زمان قطارها'] };
  if (recent.phase === 'error' || !recent.board) return { ...base, state: 'error', lines: ['زمان قطارها دریافت نشد.'] };
  const asOf = asOfLabel(recent.board.as_of);
  return { ...base, lines: boardLines(recent.board), meta: asOf ? `به روز شده ${asOf}` : '' };
}

function noteSlide(asOf) {
  const label = asOfLabel(asOf);
  return {
    id: 'note', kicker: 'درباره زمان ها', title: 'برآورد بر پایهٔ برنامه',
    lines: ['زمان ها از برنامهٔ حرکت برآورد می شوند و موقعیت زندهٔ قطار نیست.'],
    meta: label ? `آخرین زمان دریافتی: ${label}` : 'هنوز زمانی دریافت نشده است.',
    action: { id: 'about', label: 'توضیح بیشتر' }, busy: false, state: 'info',
  };
}

export function buildSlides({ locate = { phase: 'idle' }, recent = null, asOf = null } = {}) {
  const slides = [locateSlide(locate)];
  if (recent?.station) slides.push(stationSlide(recent));
  slides.push(noteSlide(asOf));
  return slides;
}
