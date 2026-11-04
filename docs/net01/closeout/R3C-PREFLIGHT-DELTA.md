# NET01-QG | R3-C Preflight Delta (پیشنهاد؛ هیچ انتشاری انجام نشد)

تاریخ: ۲۰۲۶-۱۱-۰۴. این سند **فقط پیشنهاد** است و مجوز استقرار نیست. نیازمند `PRODUCTION_DEPLOY_GO` جدا. هش های زیر از dist این worktree اند و **اطلاعاتی** اند؛ پیش از استقرار باید از export تمیز commit نهایی دوباره ساخته و با `preflight_overlay.py plan` ثبت شوند (همان روشی که برای ۳۶ فایل R2a-PB رفت).

## ۱) دو واحد مستقل (هر کدام جدا قابل استقرار و بازگشت)

| واحد | محتوا | وابستگی |
|---|---|---|
| **U1 – NET01 (سرور + داده)** | ۷ فایل dist تغییریافته، ۲ فایل dist افزوده، ۲ فایل داده | با Mini App **فعلی Production** (R2a-PB) سازگار است: فیلدهای افزوده، بدون حذف (آزمون ۱۸۶۸ درخواست) |
| **U2 – R3-A/R3-B (Mini App)** | ۶ فایل Mini App | مستقل از U1؛ با API فعلی کار می کند. نسبت به Production تفاوت دیگری هم هست (`views/food.js`، `assets/bus-guide.json`) که **drift مصوب Production** است و نباید منتشر شود |

پیشنهاد ترتیب: U1 ← مشاهدهٔ ۲۴ ساعته ← U2 (یا برعکس؛ هر دو مستقل اند). ادغام در یک انتشار ریسک بازگشت را بالا می برد.

## ۲) U1: فایل ها (نسبت به `/srv/besrah` زنده در ۲۰۲۶-۱۱-۰۴)

تغییر (M) در `packages/core/dist/`: `engine.js`، `service.js`، `server.js`، `journey-beta/index.js`، `journey-beta/journey.js`، `journey-beta/source.js`، `transit-journey/model-source.js`.
افزوده (A): `timetable-overlay.js`، `timetable-registry.js`.
داده (A، **پوشهٔ `data/timetable/` وجود ندارد و باید ساخته شود**، root:root 0755، فایل 0644 تا DynamicUser بخواند):
- `data/timetable/normal-day-overlay-v1.json`: sha256 `94f87098…` 
- `data/official/kowsar_airport_poster_2026-11-03.json`: sha256 `49ba32c9…`

**ارسال نشود:** PNG پوستر (۲ MB)، CSV های میدانی، `corrections-2026-11-03.json`. این ها `provenance` اند و در مخزن با hash بررسی می شوند؛ نبودشان در Production مدل را از کار نمی اندازد (آزمون).
**دست نخورد:** `data/network.json`، Mini App، Nginx، systemd، کنترل، `data/field/corrections.json`.
`/srv/besrah/data` و `/srv/besrah/data/official` موجودند (root 0755).

اثر عملیاتی: **یک** restart برای `besrah-core` (dist فقط هنگام شروع بارگذاری می شود). مدل پس از شروع ایستاست؛ hot-reload وجود ندارد.

## ۳) اثر بر منابع (benchmark واقعی، cgroup ۱۹۲ MiB، بدون swap، ۱۰۰ نمونه)

| معیار | مبنا (R2a-PB، dist برابر Production) | NET01-QG | بودجه |
|---|---|---|---|
| نتیجه کلی | WITHIN_BUDGETS | WITHIN_BUDGETS | |
| اوج cgroup | ۱۴۷٫۲ MiB | ۱۵۰٫۴ MiB | ۱۸۴ |
| RSS اوج | ۱۴۰٫۷ MiB | ۱۴۲٫۹ MiB | ۱۷۰ |
| journey گرم p95 | ۸٫۰۳ ms | ۷٫۳۸ ms | ۸۰ |
| journey هم زمان p95 | ۱۱٫۶ ms | ۱۲٫۶۳ ms | ۱۵۰ |
| cache churn p95 | ۴۸٫۱ ms | ۵۳٫۱۹ ms | ۲۰۰ |
| `/next` در رقابت p95 | ۴٫۷۱ ms | ۵٫۳۴ ms | ۵۰ |
| event loop p95 / max | ۲۴٫۶ / ۵۵٫۹ ms | ۲۶٫۹ / ۴۲٫۲ ms | ۳۰ / ۱۵۰ |
| ثبت بازخورد p95 | ۷٫۴۹ ms | ۸٫۹۶ ms | ۵۰ |

اختلاف ها در حد نوسان یک میزبان مشترک است؛ افزایش حافظه حدود ۳ MiB. **event loop p95 به بودجه (۳۰ms) نزدیک است** (۲۶٫۹)، پس پس از استقرار پایش شود. چرخهٔ بازخورد خاموش بوده و این benchmark دادهٔ ساختگی در پوشهٔ موقت خصوصی نوشته است.
نکتهٔ اجرا: benchmark باید با `TMPDIR` خصوصی اجرا شود. در `/tmp` ذخیره ساز بازخورد، به دلیل ایمنی (والد قابل نوشتن برای همه)، `feedback_unavailable` می دهد؛ این رفتار ایمنی است، نه باگ. (`systemd-run -p MemoryMax=192M -p MemorySwapMax=0 -p TasksMax=64 -E TMPDIR=<private> node scripts/benchmark-journey-beta.mjs 100`)

## ۴) سیاست release inventory

`scripts/release_inventory.py` یک فهرست **مثبت** (`DATA_FILES`) دارد. `data/timetable/*`، برگهٔ کوثر و CSV های جدید در آن نیستند. اگر استقرار از مسیر inventory انجام شود، باید **نسخهٔ سیاست bump** و فایل ها اضافه شوند. اگر از `preflight_overlay.py` با plan صریح انجام شود، این نیاز نیست؛ اما plan باید دایرکتوری جدید را بسازد و در هش before/after بیاید.

## ۵) طرح بازگشت

- پیش از تغییر: snapshot کامل `packages/core/dist` و `data/` و unit/Nginx (مثل استقرار R2a-PB)، با بازیابی آزمایش شده روی کپی.
- بازگشت **درست:** `preflight_overlay.py rollback` که ۹ فایل dist را برمی گرداند و فایل های داده افزوده را حذف می کند، سپس یک restart.
- **بازگشت نادرست:** فقط حذف فایل overlay. این حالت عمداً `baseline_missing` گزارش می شود و روی خط ۱ روز عادی یادداشت «نسخهٔ اصلاح شده بارگذاری نشده» نشان می دهد.
- بازگشت U1 هیچ اثری روی Mini App و flag ها ندارد.

## ۶) آزمون پس از استقرار (پیشنهادی)

۱. `GET /app/api/beta` ← `timetable.state == "applied"` و `overlayId == "net01-normal-day-v1"`.
۲. برای ۵ ایستگاه در یک روز عادی: `GET /app/api/next` ← `event_id` موجود و یادداشت degraded **نباشد**.
۳. بازهٔ `diff` ۱۲۸ از ۱۳۳ مسیر قدیمی مثل R2a-PB؛ تغییرات فقط همان مسیرهای `/next` و `/trains` روز عادی خط ۱ و فیلد `event_id`.
۴. `NRestarts=0` پس از restart، حافظه، و `journalctl -u besrah-core` بدون هشدار process با کد `BESRAH_TIMETABLE_OVERLAY` (آن کد فقط هنگام رد شدن overlay ثبت می شود).
۵. `enabled:false` و `feedbackEnabled:false` دست نخورده.

## ۷) شروط ورود به R3-C (از `ISSUE-LEDGER.md`)

- تصمیم مالک دربارهٔ QG-010 (ریتم برون یابی شدهٔ ۱۱:۵۵ تا ۱۹:۱۵).
- QA انسانی Telegram WebView برای R3-A/R3-B (جدا از NET01).
- نامگذاری مسئول پاک سازی و تاریخ نخست برای هر فعال سازی بازخورد (D3).
