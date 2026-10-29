import { h, icon } from '../ui/dom.js';
export function createAboutView({ actions }) {
  const card = (id, title, ...body) => h('section', { class: 'cm-card about-card', 'aria-labelledby': id }, h('h2', { class: 'about-card__title', id, text: title }), ...body);
  return { el: h('div', { class: 'view view--about' },
    h('header', { class: 'view__head' }, h('p', { class: 'eyebrow', text: 'BESRAH' }), h('h1', { class: 'view__title', text: 'همراه مسیر شما' }), h('p', { class: 'view__sub', text: 'بِسراه، برای جابه جایی در مشهد.' })),
    card('about-what', 'یک جا برای راه های مختلف', h('p', { text: 'هر سرویس در بِسراه نام و فضای خودش را دارد. سرویس های آماده قابل استفاده اند و بخش های در حال توسعه با نشان «به زودی» مشخص شده اند.' }), h('button', { type: 'button', class: 'cm-btn cm-btn--ghost cm-btn--sm', text: 'دیدن سرویس ها', onClick: () => actions.go('services') })),
    card('about-privacy', 'حریم خصوصی',
      h('p', { text: 'برنامه حساب کاربری ندارد و هویت تلگرام شما برای ورود خوانده نمی شود.' }),
      h('p', { text: 'در سرویس ریل، موقعیت فقط با اجازه شما و روی همین دستگاه بررسی می شود؛ مختصات نه ارسال می شود و نه ذخیره. فقط نام ایستگاه برای دریافت زمان به سرور می رود.' }),
      h('p', { text: 'نام ایستگاه های اخیر و علاقه مندی ها، شناسه سرویس های ذخیره شده و تنظیمات پوسته، صدا و لرزش روی همین دستگاه می ماند. با پاک کردن داده سایت در مرورگر می توانید آن ها را حذف کنید.' })),
    card('about-access', 'بدون وعده اضافه', h('p', { text: 'سرویس های در حال توسعه هنوز قابل استفاده نیستند و زمان عرضه ای برای آن ها اعلام نشده است. توضیح دقت و منبع داده هر سرویس داخل همان بخش آمده است.' }))) };
}
