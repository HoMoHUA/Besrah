# FEATURE-MATRIX (۲۰۲۶-۱۱-۰۵؛ U10 مستقر است)

| قابلیت | وضعیت | شاهد |
|---|---|---|
| خانهٔ مقصد محور، مبدأ = موقعیت فعلی با fallback | DONE | `views/home.js`، `views/trip.js`، `trip.test.mjs` |
| پیشنهاد خانه از ساعت و موقعیت (۲ کارت) | DONE (ساده؛ بدون Core) | `home/recommendations.ts`، `account.test.ts`، `profile-home.test.mjs` |
| تب پروفایل، Guest، ترجیحات دستگاه | DONE | `views/profile.js` |
| ورود تلگرام (Ed25519)، نشست، خروج | DONE در کد؛ دستگاه واقعی AWAITING_HUMAN | `account/*`، `account.test.ts` |
| رضایت، همگام سازی ترجیحات، export، حذف حساب | DONE | `account.test.ts` |
| سقف پیاده روی در نتیجهٔ مسیر | DONE | `trip/plan.ts`، `trip.test.ts` |
| ورود با موبایل / ایمیل / Google / بله | FUTURE (نیازمند provider) | — |
| اتصال Intelligence Core به مسیر (برچسب، قید، اولویت، پرسش) | DONE در کد (U11 منتظر GO) | `decision/trip.ts`، `decision/trip.test.ts` |
| اتصال Core به خرید (کم هزینه ترین پیشنهاد ثبت شده) | DONE در کد (U11 منتظر GO) | `decision/shop.ts`، `decision/shop.test.ts` |
| اتصال Core به غذا | تصمیم: انجام نمی شود تا bump نسخهٔ Core (D11) | — |
| اولویت سفر، سقف پیاده روی، بودجه غذا اثر بر نتیجه | DONE (U11)؛ فقط «هزینه» بی اثر است | `trip.test.mjs`، `food.test.mjs` |
| History سروری، مکان های ذخیره شده | BLOCKED تا تأیید مالک | — |
| تعویض خط ۱↔۲، اتوبوس ETA، انتخاب روی نقشه، Search نشان | BLOCKED (داده/کلید) | — |
