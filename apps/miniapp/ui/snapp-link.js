// «حساب اسنپ» in Profile: the person logs in to their own Snapp inside Besrah (number -> optional captcha -> SMS code).
// In the Android app the number and the code go straight from the phone to Snapp (snapp-device.js); in a browser or
// Telegram they pass through this app's server to Snapp and are not stored or logged there. The session comes back and
// stays on this device (store.setSnappSession) and is used only to ask Snapp for ride prices. «قطع اتصال» removes it.
import { h } from './dom.js';
import { fa } from '../format.js';

const ERRORS = {
  bad_phone: 'شمارهٔ همراه درست نیست؛ مثلاً ۰۹۱۲۱۲۳۴۵۶۷.',
  bad_code: 'کد پیامک را کامل بنویسید.',
  wrong_code: 'کد درست نبود؛ دوباره بنویسید یا کد تازه بگیرید.',
  rate_limited: 'درخواست‌ها زیاد شد؛ چند دقیقه بعد دوباره امتحان کنید.',
  not_configured: 'اتصال اسنپ هنوز روی سرور بسراه فعال نشده است.',
  unavailable: 'اسنپ الان پاسخ نداد؛ کمی بعد دوباره امتحان کنید.',
};
const faDigits = s => String(s).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);

export function createSnappLinkCard({ api, store, onLinked = () => {} }) {
  // captchaFor: which step the captcha answers. A captcha asked at the code check is sent back with the same code; it must
  // never request a new SMS code (that loops: new code -> captcha -> new code ...).
  const S = { step: 'phone', phone: '', code: '', captcha: null, captchaFor: 'otp', wrongCaptcha: false, busy: false, message: '' };
  const el = h('section', { class: 'cm-card about-card snapp-link', 'aria-labelledby': 'pf-snapp' });
  const field = (attrs) => h('input', { class: 'fd-input', dir: 'ltr', autocomplete: 'off', ...attrs });
  const errorText = e => ERRORS[e?.reason] ?? ERRORS[e?.kind === 'rate_limited' ? 'rate_limited' : 'unavailable'];

  async function sendCode(captcha) {
    S.busy = true; S.message = ''; draw();
    try {
      const r = await api.snappOtp(S.phone, captcha);
      if (r.status === 'captcha') { S.step = 'captcha'; S.captchaFor = 'otp'; S.captcha = r.captcha; S.wrongCaptcha = Boolean(r.wrong); }
      else { S.step = 'code'; S.code = ''; S.captcha = null; S.message = 'کد پیامک اسنپ برای شما فرستاده شد.'; }
    } catch (e) { S.message = errorText(e); }
    S.busy = false; draw();
  }
  async function verify(code, captcha) {
    S.busy = true; S.message = ''; S.code = code; draw();
    try {
      const r = await api.snappVerify(S.phone, code, captcha);
      if (r.status === 'captcha') { S.step = 'captcha'; S.captchaFor = 'verify'; S.captcha = r.captcha; S.wrongCaptcha = Boolean(r.wrong); }
      else { store.setSnappSession(r.session, r.phoneHint); S.step = 'phone'; S.phone = ''; S.code = ''; S.captcha = null; S.message = 'حساب اسنپ شما وصل شد.'; onLinked(); }
    } catch (e) {
      S.message = errorText(e);
      if (S.step === 'captcha') S.step = 'code';               // a wrong code is typed again on the code screen
    }
    S.busy = false; draw();
  }

  function draw() {
    const link = store.snappLink?.();
    const kids = [h('h2', { class: 'about-card__title', id: 'pf-snapp', text: 'حساب اسنپ' })];
    if (link) {
      kids.push(h('p', { class: 'pf-state', text: `وصل است (شمارهٔ …${faDigits(link.phoneHint)}).` }),
        h('p', { class: 'fd-note', text: 'قیمت سفر با حساب خود شما از اسنپ پرسیده می‌شود. بسراه سفر ثبت نمی‌کند و پرداختی انجام نمی‌دهد.' }),
        h('div', { class: 'fd-actions' }, h('button', { type: 'button', class: ['cm-btn', 'cm-btn--ghost'], onClick: () => { store.setSnappSession(null); S.message = 'اتصال اسنپ از این دستگاه برداشته شد.'; draw(); } }, 'قطع اتصال')));
    } else {
      kids.push(h('p', { class: 'fd-note', text: 'با ورود به اسنپ خودتان، قیمت لحظه‌ای سفر با تخفیف‌های حساب شما زیر گزینه‌های سفر نمایش داده می‌شود و می‌توانید کمترین قیمت ممکن را برای همان مبدأ و مقصد پیدا کنید. بسراه فقط قیمت را می‌پرسد؛ سفر ثبت نمی‌کند و پرداختی انجام نمی‌دهد. نشست اسنپ فقط روی همین دستگاه می‌ماند و در سرور ذخیره نمی‌شود.' }));
      if (api.deviceSnapp) kids.push(h('p', { class: 'fd-note', text: 'در برنامهٔ بِسراه، شماره و کد مستقیم از گوشی شما به اسنپ می‌رود و از سرور بسراه نمی‌گذرد.' }));
      if (S.step === 'phone') {
        const phone = field({ type: 'tel', inputmode: 'tel', placeholder: '۰۹۱۲۱۲۳۴۵۶۷', 'aria-label': 'شمارهٔ همراه اسنپ', value: S.phone });
        phone.addEventListener('input', () => { S.phone = phone.value; });
        kids.push(phone, h('div', { class: 'fd-actions' }, h('button', { type: 'button', class: 'cm-btn', disabled: S.busy ? 'true' : null, onClick: () => { S.phone = phone.value.trim(); sendCode(); } }, 'دریافت کد پیامک')));
      } else if (S.step === 'captcha') {
        const answer = field({ type: 'text', inputmode: S.captcha?.type === 'numeric' ? 'numeric' : 'text', maxlength: '8', 'aria-label': 'پاسخ تصویر امنیتی اسنپ' });
        const forCode = S.captchaFor === 'verify';
        kids.push(h('p', { class: 'fd-note', text: S.wrongCaptcha ? 'پاسخ تصویر درست نبود؛ تصویر تازه را بنویسید.' : forCode ? 'اسنپ برای تأیید کد، یک تصویر امنیتی خواسته است:' : 'اسنپ پیش از فرستادن کد، یک تصویر امنیتی خواسته است:' }),
          h('img', { class: 'snapp-link__captcha', src: S.captcha?.image ?? '', alt: 'تصویر امنیتی اسنپ', width: 150, height: 50 }),
          answer, h('div', { class: 'fd-actions' },
            h('button', { type: 'button', class: 'cm-btn', disabled: S.busy ? 'true' : null, onClick: () => {
              const c = { type: S.captcha.type, refId: S.captcha.refId, solution: answer.value.trim() };
              return forCode ? verify(S.code, c) : sendCode(c);
            } }, forCode ? 'ورود به اسنپ' : 'ادامه'),
            h('button', { type: 'button', class: ['cm-btn', 'cm-btn--ghost'], onClick: () => { S.step = forCode ? 'code' : 'phone'; S.captcha = null; draw(); } }, 'انصراف')));
      } else {
        const code = field({ type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', 'aria-label': 'کد پیامک اسنپ' });
        kids.push(code, h('div', { class: 'fd-actions' },
          h('button', { type: 'button', class: 'cm-btn', disabled: S.busy ? 'true' : null, onClick: () => verify(code.value.trim()) }, 'ورود به اسنپ'),
          h('button', { type: 'button', class: ['cm-btn', 'cm-btn--ghost'], disabled: S.busy ? 'true' : null, onClick: () => sendCode() }, 'کد تازه')));
      }
    }
    if (S.message) kids.push(h('p', { class: 'tp-status', role: 'status', text: S.message }));
    el.replaceChildren(...kids);
  }
  draw();
  return { el, draw };
}

/** «قیمت لحظه‌ای اسنپ» block for a trip: at most four bookable services, with where the price came from and when. */
export function snappPriceBlock(data, { faTime, onFind, search } = {}) {
  const items = (data?.services ?? []).filter(s => s.enabled && Number.isInteger(s.priceToman)).slice(0, 4);
  if (!items.length) return null;
  const when = faTime ? faTime(data.retrievedAt) : '';
  return h('section', { class: 'cm-card snapp-price', 'aria-label': 'قیمت لحظه‌ای اسنپ' },
    h('h3', { class: 'snapp-price__title', text: 'قیمت لحظه‌ای اسنپ' }),
    h('ul', { class: 'snapp-price__list' }, items.map(s => h('li', null,
      h('span', { class: 'snapp-price__name', text: s.name }),
      h('b', { class: 'snapp-price__toman', text: `${s.priceToman.toLocaleString('fa-IR')} تومان` }),
      Number.isInteger(s.etaMin) ? h('small', { text: `رسیدن راننده حدود ${fa(s.etaMin)} دقیقه` }) : null))),
    h('p', { class: 'fd-note', text: `${data.viaDevice ? 'با حساب اسنپ شما، مستقیم از گوشی' : data.sessionKind === 'user' ? 'با حساب اسنپ شما' : 'استعلام عمومی (برای قیمت با تخفیف‌های خودتان، در پروفایل وارد اسنپ شوید)'}${when ? `، دریافت ${when}` : ''}. قیمت قطعی هنگام درخواست سفر در اسنپ تعیین می‌شود.` }),
    onFind ? searchPart(search, onFind) : null);
}

const walk = m => `حدود ${fa(Math.max(10, Math.round(m / 10) * 10))} متر`;
/** «کمترین قیمت ممکن»: the button, the progress while points are priced, and what was found. */
function searchPart(search, onFind) {
  if (!search || search.status === 'idle') return h('div', { class: 'fd-actions' }, h('button', { type: 'button', class: ['cm-btn', 'cm-btn--ghost'], onClick: onFind }, 'کمترین قیمت ممکن را پیدا کن'));
  if (search.status === 'running') return h('p', { class: 'tp-status', role: 'status', text: search.total ? `در حال پرسیدن قیمت نقطه‌های نزدیک… ${fa(search.step)} از ${fa(search.total)}` : 'در حال پیدا کردن نقطه‌های نزدیک روی خیابان‌ها…' });
  if (search.status === 'error') return h('p', { class: 'fd-note', role: 'status', text: search.message || 'جست‌وجوی قیمت کمتر الان انجام نشد.' });
  const r = search.result, best = r?.best;
  if (!best || !(best.saving >= 1000) || !(best.pickup || best.dropoff)) return h('p', { class: 'fd-note', role: 'status', text: `از ${fa(r?.tried?.length ?? 0)} قیمت نقطه‌های نزدیک، ارزان‌تر از همین نقطه پیدا نشد.` });
  return h('div', { class: 'snapp-best', role: 'status' },
    h('p', { class: 'snapp-best__price', text: `ارزان‌ترین: ${best.price.toLocaleString('fa-IR')} تومان، ${best.saving.toLocaleString('fa-IR')} تومان کمتر` }),
    best.pickup ? h('p', { text: `سوار شدن: ${best.pickup.street ? `«${best.pickup.street}»` : 'خیابان کناری'}، ${walk(best.pickup.walkM)} پیاده از مبدأ.` }) : null,
    best.dropoff ? h('p', { text: `پیاده شدن: ${best.dropoff.street ? `«${best.dropoff.street}»` : 'خیابان کناری'}، ${walk(best.dropoff.walkM)} تا مقصد.` }) : null,
    h('p', { class: 'fd-note', text: `از ${fa(r.tried.length)} قیمت لحظه‌ای؛ تا چند دقیقه معتبر است. در اسنپ همین نقطه‌ها را انتخاب کنید.` }));
}
