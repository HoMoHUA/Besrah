# HANDOFF-FINAL | سه دامنه، ۲۰۲۶-۱۱-۰۴

**commit کد U7:** `48efb70`؛ HEAD شاخه (شامل U8 و مستندات): نگاه کنید `git rev-parse --short HEAD`. شاخه: `feature/three-domain` در `/root/projects/besrah-3d`. مبنای زنده: `a8cb909`.
**استقرار:** **U10 DEPLOYED** (۱۱-۰۴؛ `U10-DEPLOY-REPORT.md`) بالای **U9 DEPLOYED** (۱۱-۰۴؛ `U9-DEPLOY-REPORT.md`؛ شامل U8) بالای **U7 DEPLOYED** در ۲۰۲۶-۱۱-۰۴ (گزارش: `U7-DEPLOY-REPORT.md`). U8 داخل U9 رفت (`plan-u8-food-ranking.json` منسوخ است).
**آدرس زنده:** `https://besrah.arklyn.ir/`؛ پیش نمایش لوپ بک: `http://127.0.0.1:18941/app/`.

## وضعیت هر قابلیت

| قابلیت | وضعیت | نمونهٔ واقعی |
|---|---|---|
| بسفود: جست وجو، بودجه، منو، لینک سفارش | **DONE** (زنده؛ بهبود رتبه بندی در U8 منتظر GO) | «چلو کباب» ← ۱۱۲ فروشگاه با قیمت ثبت شدهٔ ۲۰۲۶-۱۰-۳۱ و لینک تپسی فود/اسنپ فود (`samples/food-search-sample.json`) |
| رهیاب: مسیر مکان به مکان | **PARTIAL** | دانشگاه فردوسی ← غدیر: خودرو ۱۷:۰۲ تا ۱۷:۲۷ (۲۵ دقیقه)، مترو ۱۷:۰۲ تا ۱۷:۳۳ با پیاده ۱۶ دقیقه + مترو ۱۰ دقیقه، با `ifMissed` (نمونهٔ خام با مختصات دیگر: `samples/trip-sample.json`) |
| بسخرید: مقایسهٔ قیمت | **PARTIAL** | ۱۱ کالا، ۱۰ تای آن ≥۲ فروشندهٔ قیمت دار، مثلاً Mi Band 10: ۹۴۰ تا ۱٬۱۵۰ هزار تومان؛ Flip 7: `unresolved` (هر سه فروشنده چند قیمت دارند) |
| مترو و اتوبوس قبلی | **حفظ شد** | parity HTTP ۸ از ۸ با سرور مبنای `587accb`؛ Mini App ۲۱۹/۲۱۹ |
| انتخاب نقطه روی نقشه | **BLOCKED** | کلید نقشهٔ وب و تصمیم CDN لازم است |
| تعویض خط، اتوبوس، تاکسی | **BLOCKED / نامعلوم** | داده یا مدل قابل دفاع نیست |
| Telegram واقعی مالک | **AWAITING_HUMAN** | iOS `NOT_TESTED` |

## آنچه تغییر کرد

- Core: `food/*`، `shop/search.ts`، `trip/{neshan,plan,routes}.ts`، `journey-beta/index.ts` (برگرداندن `planMetro`)، `server.ts`، `miniapp.ts` (ثبت فایل های تازه).
- Mini App: `views/{food,trip,shop}.js`، `api.js`، `services.js` (دو سرویس زنده: رهیاب و بسخرید)، `navigation.js`، `app.js`، `app.css`، `assets/services/shop.svg`.
- داده/ابزار: `scripts/food/build_food_index.py`، `scripts/shop/import_offers.py`، `data/food/*`، `data/shop/*`.
- استقرار: `deploy/nginx/besrah-trip-post.conf`، `deploy/systemd/besrah-core-neshan.conf`.

## آزمون ها (اجرای واقعی همین جلسه)

- Core: ۶۲۸ از ۶۲۸ (۵۱ فایل). Mini App: ۲۱۹ از ۲۱۹. `tests/shop` ۷، `tests/data` ۱۶۷، `tests/release` ۲۱. n8n ۲۱. parity HTTP ۸/۸. `tsc`، build، `git diff --check` سبز.
- موبایل: ۳۲۰/۳۶۰/۳۹۰ بدون سرریز افقی برای غذا، خرید و رهیاب. اسکرین شات ها در `docs/sprint/screenshots/`.
- حافظه: بیکار ۳۹ MiB، اوج ۱۰۳ MiB زیر سقف ۱۹۲ MiB.
- نشان واقعی: ژئوکد «دانشگاه فردوسی»، مسیر پیاده و خودرو، مشاهدهٔ تفاوت ترافیک دار و بی ترافیک (۱۰۹۹ ثانیه در برابر ۶۳۹) از روی پاسخ واقعی. `v1/search` برای این کلید فعال نیست (۴۸۵).

## ریسک ها و بدهی

- **ROTATION REQUIRED:** کلید نشان باید در پنل نشان عوض شود (چرخش به عهدهٔ مالک).

- **کلید نشان در گفت وگو فرستاده شده است.** در مخزن نیست. پیشنهاد: پس از آزمون جایگزین شود.
- داده غذا ۴ روز قدیمی است و به همین صورت در UI برچسب می خورد.
- ثابت های ۳ و ۲ دقیقه ای ورود/خروج ایستگاه فرض اند و در UI «فرض» نامیده می شوند.
- Nginx برای POST دو location دقیق می خواهد (در runbook).
