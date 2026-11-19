# دفتر انتشار (Release ledger)

هر انتشار یک ردیف دارد: چه چیزی مستقر شد، از کدام کامیت، و نقطهٔ بازگشت کجاست. این دفتر همان کمبود F1 در `docs/product/MASTER-PLAN-REVIEW-2026-11-19.md` را رفع می‌کند.

## U12 — ۱۹ نوامبر ۲۰۲۶
- **ریشهٔ کد مستقر:** شاخهٔ محلی سرور `integrate/live-plus-main-20261119` @ `42aaaf9`. این شاخه برابر است با شاخهٔ Production قبلی (`metro-update-20261110-live` @ `4b2f95e`) به‌اضافهٔ GitHub `main` @ `e231782` (PRهای #14 تا #20).
- **چرا در GitHub نیست:** شاخهٔ Production داده‌های خصوصی را track می‌کند (ایندکس غذا، کاتالوگ خرید، پژوهش‌ها). پس نباید در ریپوی عمومی push شود. GitHub `main` نسخهٔ پاک‌شده است. **قاعده:** هر انتشار بعدی اول `main` را روی همین شاخهٔ محلی merge می‌کند، و هرگز `main` را مستقیم روی Production نمی‌گذارد. وگرنه ۱۴۱ کامیت فقط-Production از بین می‌رود.
- **مستقر شد:** `packages/core/dist` (کامل) و `apps/miniapp` (بدون حذف فایل). **دادهٔ Production دست نخورد.**
- **سرور:**
  - snippet Nginx `deploy/nginx-besrah-u12.conf` برای `/api/profile/describe`، `/api/bus/stops` و `/api/bus/eta`.
  - drop-in `deploy/systemd/besrah-core-bus.conf`.
  - فهرست خصوصی ایستگاه‌ها در `/var/lib/besrah-bus/stops.json`.
- **شبکه (پیش از انتشار):** قانون xray برای خروج مقصدهای IP ایران از vmess ایران. علت خرابی مسیریابی نشان همین بود.
- **نقطهٔ بازگشت:** `/var/backups/besrah/u12-20261119T152653Z/` (`srv-besrah.tgz`، `etc.tgz`، `SHA256SUMS`). بازیابی آزمایشی آن انجام شد.
- **تأیید:**
  - Core روی درخت ادغام‌شده ۸۵۷/۸۵۷، Mini App ۳۵۱/۳۵۱.
  - smoke عمومی: سفر، مترو، غذا، خرید، ETA زنده، جست‌وجوی ایستگاه، کد تیپ.
  - محافظ‌های متد (پاسخ 403) سالم‌اند.
  - هش فایل‌های عمومی با build برابر است.
  - مرورگر واقعی روی دامنه: بدون خطای JS.
  - `NRestarts=0`.
