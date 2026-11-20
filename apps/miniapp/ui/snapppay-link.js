// «حساب اسنپ‌پی»: the person logs in to their own Snapp Pay inside Besrah (number -> 6-digit SMS code) and sees their own
// credit: what is left for four instalments, for end-of-month payment and for Snapp's own services, the score and the dates
// to settle. The number and the code pass through Besrah's server to Snapp Pay's login only (not stored or logged); the
// session comes back to this device (store.setSnappPaySession) and the device reads the account from Snapp Pay itself.
import { h } from './dom.js';
import { fa } from '../format.js';

const ERRORS = {
  bad_phone: 'شمارهٔ همراه درست نیست؛ مثلاً ۰۹۱۲۱۲۳۴۵۶۷.',
  bad_code: 'کد شش‌رقمی پیامک را کامل بنویسید.',
  wrong_code: 'کد درست نبود؛ دوباره بنویسید.',
  expired: 'کد منقضی شده است؛ «کد تازه» را بزنید.',
  locked: 'به‌دلیل تلاش‌های ناموفق، ورود موقتاً بسته شده است؛ کمی بعد دوباره امتحان کنید.',
  restart: 'مهلت این ورود تمام شد؛ شماره را دوباره بفرستید.',
  rate_limited: 'درخواست‌ها زیاد شد؛ کمی بعد دوباره امتحان کنید.',
  not_configured: 'اتصال اسنپ‌پی هنوز روی سرور بسراه فعال نشده است.',
  unavailable: 'اسنپ‌پی الان پاسخ نداد؛ کمی بعد دوباره امتحان کنید.',
};
const faDigits = s => String(s).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
const toman = v => (Number.isFinite(v) ? `${v.toLocaleString('fa-IR')} تومان` : 'نامشخص');
const day = iso => { const ms = Date.parse(`${iso}T12:00:00+03:30`); return Number.isFinite(ms) ? new Date(ms).toLocaleDateString('fa-IR', { timeZone: 'Asia/Tehran', day: 'numeric', month: 'long', year: 'numeric' }) : null; };

/** Snapp Pay's own Persian wording first (it says how many tries are left or how long to wait), then ours. */
export function snappPayErrorText(e) {
  if (typeof e?.providerMessage === 'string' && e.providerMessage.trim()) return e.providerMessage.trim();
  if (e?.reason === 'rate_limited' && Number.isFinite(e.retryAfterS)) return `درخواست‌ها زیاد شد؛ ${fa(Math.ceil(e.retryAfterS))} ثانیهٔ دیگر دوباره امتحان کنید.`;
  return ERRORS[e?.reason] ?? ERRORS[e?.kind === 'rate_limited' ? 'rate_limited' : 'unavailable'];
}

export function createSnappPayLinkCard({ api, store, onLinked = () => {}, compact = false }) {
  const S = { step: 'phone', phone: '', loginId: null, masked: null, resendAt: 0, busy: false, message: '' };
  let tick = 0;
  const el = h('section', { class: ['cm-card', 'about-card', 'spay-link', compact && 'spay-link--compact'], 'aria-labelledby': 'pf-spay' });
  const field = attrs => h('input', { class: 'fd-input', dir: 'ltr', autocomplete: 'off', ...attrs });
  const startTimer = s => { S.resendAt = Date.now() + (Number.isFinite(s) ? s : 60) * 1000; clearInterval(tick); tick = setInterval(() => { if (Date.now() >= S.resendAt) clearInterval(tick); draw(); }, 1000); tick.unref?.(); };

  async function sendCode() {
    S.busy = true; S.message = ''; draw();
    try {
      const r = await api.snappPayLogin(S.phone);
      S.step = 'code'; S.loginId = r.loginId; S.masked = r.masked; startTimer(r.resendAfterS);
      S.message = r.masked ? `کد اسنپ‌پی به ${faDigits(r.masked)} فرستاده شد.` : 'کد اسنپ‌پی برای شما فرستاده شد.';
    } catch (e) { S.message = snappPayErrorText(e); }
    S.busy = false; draw();
  }
  async function resend() {
    S.busy = true; S.message = ''; draw();
    try { const r = await api.snappPayResend(S.loginId); startTimer(r.resendAfterS); S.message = 'کد تازه فرستاده شد.'; }
    catch (e) { S.message = snappPayErrorText(e); if (e?.reason === 'restart') { S.step = 'phone'; S.loginId = null; } }
    S.busy = false; draw();
  }
  async function verify(code) {
    S.busy = true; S.message = ''; draw();
    try {
      const r = await api.snappPayVerify(S.loginId, code);
      store.setSnappPaySession(r.session, r.phoneHint);
      S.step = 'phone'; S.phone = ''; S.loginId = null; clearInterval(tick); S.message = 'حساب اسنپ‌پی شما وصل شد.'; onLinked();
    } catch (e) {
      S.message = snappPayErrorText(e);
      if (e?.reason === 'restart' || e?.reason === 'locked') { S.step = 'phone'; S.loginId = null; clearInterval(tick); }
    }
    S.busy = false; draw();
  }

  function draw() {
    const link = store.snappPayLink?.();
    const kids = [h('h2', { class: 'about-card__title', id: 'pf-spay', text: 'حساب اسنپ‌پی' })];
    if (link) {
      kids.push(h('p', { class: 'pf-state', text: `وصل است (شمارهٔ …${faDigits(link.phoneHint)}).` }),
        h('p', { class: 'fd-note', text: 'اعتبار، مانده‌ها و فروشگاه‌ها را گوشی شما مستقیم از اسنپ‌پی می‌گیرد. بسراه خریدی انجام نمی‌دهد و پرداختی نمی‌کند.' }),
        h('div', { class: 'fd-actions' }, h('button', { type: 'button', class: ['cm-btn', 'cm-btn--ghost'], onClick: () => { store.setSnappPaySession(null); S.message = 'اتصال اسنپ‌پی از این دستگاه برداشته شد.'; draw(); } }, 'قطع اتصال')));
    } else {
      kids.push(h('p', { class: 'fd-note', text: compact ? 'با ورود به اسنپ‌پی خودتان، اعتبار و مانده‌ها و فروشگاه‌های حضوری نزدیک را همین‌جا ببینید.'
        : 'با ورود به اسنپ‌پی خودتان، اعتبار باقی‌مانده (چهار قسط، آخر ماه و خدمات اسنپ)، امتیاز و مهلت تسویه را در بسراه می‌بینید و در بسپی کالا و فروشگاه‌های حضوری نزدیک را جست‌وجو می‌کنید. نشست اسنپ‌پی فقط روی همین دستگاه می‌ماند و در سرور ذخیره نمی‌شود.' }));
      if (S.step === 'phone') {
        const phone = field({ type: 'tel', inputmode: 'tel', placeholder: '۰۹۱۲۱۲۳۴۵۶۷', 'aria-label': 'شمارهٔ همراه اسنپ‌پی', value: S.phone });
        phone.addEventListener('input', () => { S.phone = phone.value; });
        kids.push(phone, h('div', { class: 'fd-actions' }, h('button', { type: 'button', class: 'cm-btn', disabled: S.busy ? 'true' : null, onClick: () => { S.phone = phone.value.trim(); sendCode(); } }, 'دریافت کد اسنپ‌پی')));
      } else {
        const code = field({ type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', 'aria-label': 'کد پیامک اسنپ‌پی' });
        const wait = Math.max(0, Math.ceil((S.resendAt - Date.now()) / 1000));
        kids.push(code, h('div', { class: 'fd-actions' },
          h('button', { type: 'button', class: 'cm-btn', disabled: S.busy ? 'true' : null, onClick: () => verify(code.value.trim()) }, 'ورود به اسنپ‌پی'),
          h('button', { type: 'button', class: ['cm-btn', 'cm-btn--ghost'], disabled: S.busy || wait > 0 ? 'true' : null, onClick: resend }, wait > 0 ? `کد تازه (${fa(wait)})` : 'کد تازه'),
          h('button', { type: 'button', class: ['cm-btn', 'cm-btn--ghost'], onClick: () => { S.step = 'phone'; S.loginId = null; clearInterval(tick); draw(); } }, 'شمارهٔ دیگر')));
      }
    }
    if (S.message) kids.push(h('p', { class: 'tp-status', role: 'status', text: S.message }));
    el.replaceChildren(...kids);
  }
  draw();
  return { el, draw };
}

/** The person's own Snapp Pay credit, as Snapp Pay states it now. */
export function snappPayAccountBlock(a, { onRetry, status = 'ok' } = {}) {
  if (status === 'loading') return h('section', { class: 'cm-card spay-acct', 'aria-busy': 'true', 'aria-label': 'اعتبار اسنپ‌پی' }, h('div', { class: 'cm-skel fd-skeleton__card' }));
  if (status !== 'ok' || !a) return h('section', { class: 'cm-card spay-acct', role: 'status' }, h('p', { class: 'fd-note', text: status === 'unauthenticated' ? 'اتصال اسنپ‌پی منقضی شد؛ دوباره وارد شوید.' : 'اعتبار اسنپ‌پی الان دریافت نشد.' }),
    onRetry && status !== 'unauthenticated' ? h('button', { type: 'button', class: ['cm-btn', 'cm-btn--ghost', 'cm-btn--sm'], onClick: onRetry }, 'تلاش دوباره') : null);
  const row = (label, value, hint) => h('li', null, h('span', { class: 'spay-acct__label', text: label }), h('b', { class: 'spay-acct__value', text: toman(value) }), hint ? h('small', { text: hint }) : null);
  const settle = a.settleDeadline ? day(a.settleDeadline) : null, contract = a.contractEnd ? day(a.contractEnd) : null;
  return h('section', { class: 'cm-card spay-acct', 'aria-label': 'اعتبار اسنپ‌پی' },
    h('header', { class: 'spay-acct__head' }, h('h3', { text: 'اعتبار اسنپ‌پی' }), Number.isFinite(a.score) ? h('span', { class: 'cm-badge', text: `امتیاز ${fa(a.score)}` }) : null),
    h('p', { class: 'spay-acct__total' }, h('span', { text: 'اعتبار قابل استفاده' }), h('b', { text: toman(a.balanceToman) }), Number.isFinite(a.totalCreditToman) ? h('small', { text: `از ${toman(a.totalCreditToman)}` }) : null),
    h('ul', { class: 'spay-acct__list' },
      row('چهار قسط', a.installmentToman, 'قسط اول خرید آنلاین در درگاه همان فروشگاه پرداخت می‌شود؛ خرید حضوری پیش‌پرداخت ندارد.'),
      row('پرداخت آخر ماه (یکجا)', a.postpaidToman),
      Number.isFinite(a.snappOnlyToman) ? row('فقط در خدمات اسنپ', a.snappOnlyToman) : null,
      Number.isFinite(a.debtToman) && a.debtToman > 0 ? row('بدهی فعلی', a.debtToman) : null),
    settle || contract ? h('p', { class: ['fd-note', (a.settlePassed || a.badDebt) && 'spay-acct__warn'], text: [settle ? `مهلت تسویه: ${settle}${a.settlePassed ? ' (گذشته است)' : ''}` : null, contract ? `پایان قرارداد: ${contract}${a.contractPassed ? ' (گذشته است)' : ''}` : null].filter(Boolean).join(' · ') }) : null,
    h('p', { class: 'fd-note', text: 'از اسنپ‌پی، همین لحظه. مبلغ‌ها به تومان‌اند.' }));
}
