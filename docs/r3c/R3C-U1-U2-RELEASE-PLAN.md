# R3-C | برنامهٔ انتشار U1 و U2 (فقط برنامه؛ اجرا نشده)

تاریخ: ۲۰۲۶-۱۱-۰۴. کد کاندید: commit `bb6cf45ce38ff958977953fb4aeab36ec33cf22c` در شاخهٔ `feature/r3c-experimental-beta`.
**این سند مجوز اجرا نیست.** بدون `PRODUCTION_DEPLOY_GO` هیچ دستوری از این بخش اجرا نمی شود. هیچ فایلی در `/srv/besrah` نوشته نشده و `besrah-core`، Nginx و کنترل Beta دست نخورده اند.

## ۰) وضعیت زندهٔ Production در لحظهٔ تهیهٔ سند

- کد: build مبنای `587accb` (تأیید hash: همهٔ ۹ فایل dist جایگزین شونده برابر build تمیز `587accb`)؛ `besrah-core` فعال، `NRestarts=0`.
- کنترل: `/etc/besrah-journey/control.json` = `{"schemaVersion":1,"enabled":false,"feedbackEnabled":false,"rolloutPercent":0}`.
- Mini App زنده: همان نسخهٔ PB (`views/metro.js` با hash `425fd1b158`).
- `enabled:true` در این معماری یعنی **Beta اختیاری عمومی** (هر بازدیدکننده می تواند وارد شود)، حتی اگر فقط مالک استفاده کند. `rolloutPercent:0` کنترل دسترسی نیست. هیچ allowlist یا auth خصوصی ادعا نمی شود.

## ۱) دو واحد مستقل

| واحد | محتوا | راه اندازی مجدد | بازگشت |
|---|---|---|---|
| **U1** | کد سرور NET01 (۹ فایل dist) + دو فایل داده | یک `restart` برای `besrah-core` | ابزار rollback + یک restart |
| **U2** | ۷ فایل Mini App (R3-A/R3-B) | بدون restart | ابزار rollback (بدون restart) |

U2 روی U1 برنامه ریزی شده (`plan-u2.json` روی درختی که U1 را دارد ساخته شد)، پس دو برنامه هیچ فایل مشترکی ندارند و هر کدام جدا برگردانده می شود. U1 بدون U2 هم ایمن است (آزمون sandbox)؛ U2 بدون U1 هم با API فعلی کار می کند (R3-A و R3-B هیچ تغییر core نداشتند)، اما برچسب های تازه فقط وقتی سرور U1 آنها را بفرستد دیده می شود.

### U1 | `evidence/plan-u1.json`

| فایل | گروه | hash فعلی Production | hash کاندید |
|---|---|---|---|
| `data/official/kowsar_airport_poster_2026-11-03.json` | data | جدید | 49ba32c9f7 |
| `data/timetable/normal-day-overlay-v1.json` | data | جدید | ed9c46a919 |
| `dist/engine.js` | dist | 7f0c14cd98 | 29ccd94f30 |
| `dist/journey-beta/index.js` | dist | a2f605d0c8 | 2dbff3a434 |
| `dist/journey-beta/journey.js` | dist | aef716c2fc | 3376d4ed25 |
| `dist/journey-beta/source.js` | dist | db8fb01fcb | 8e852e975e |
| `dist/server.js` | dist | 81ed51af44 | 9ab6c854ae |
| `dist/service.js` | dist | 9b71235fac | 51568086ad |
| `dist/timetable-overlay.js` | dist | جدید | c5eca5bc85 |
| `dist/timetable-registry.js` | dist | جدید | b42e4f0314 |
| `dist/transit-journey/model-source.js` | dist | cf2b549f05 | 7173c32356 |

- پوشهٔ `data/timetable/` در Production **وجود ندارد**؛ ابزار آن را می سازد (root، ۰۷۵۵) و فایل ها ۰۶۴۴ هستند تا DynamicUser بخواند. در بازگشت، پوشه ای که خود ابزار ساخته حذف می شود.
- ترتیب اجباری: **داده، سپس dist، سپس restart**. اگر dist پیش از داده بیاید، سرویس با overlay گم شده بالا می آید و یادداشت «نسخهٔ اصلاح شده بارگذاری نشده» را نشان می دهد (در sandbox آزموده شد).
- فقط یک فایل داده در زمان اجرا الزامی است (`kowsar_airport_poster_2026-11-03.json`، hash در overlay چک می شود). PNG، CSV های میدانی و داده های provenance **ارسال نمی شوند**.

### U2 | `evidence/plan-u2.json`

| فایل | گروه | hash فعلی Production | hash کاندید |
|---|---|---|---|
| `apps/miniapp/app.css` | assets | e8eda45e63 | a21ea4551b |
| `apps/miniapp/app.js` | assets | 65fb0affa2 | a60a29f34b |
| `apps/miniapp/format.js` | assets | 3a289e343b | 691a6779ac |
| `apps/miniapp/ui/planner.js` | assets | 30fe6f58f3 | 264b3fff9e |
| `apps/miniapp/ui/station.js` | assets | a0c5d696d7 | f7203089d9 |
| `apps/miniapp/ui/tracker.js` | assets | 5d237b34ba | 2d03e72803 |
| `apps/miniapp/views/metro.js` | assets | 425fd1b158 | 7485a5d5b5 |

- `views/metro.js` همیشه آخرین فایل نوشته می شود (نقطهٔ ورود import).
- فایل های `test-support/*.mjs` و `*.test.mjs` هرگز ارسال نمی شوند (ابزار آنها را حذف می کند و آزمون دارد).
- **خارج از دامنه (drift مصوب Production، ارسال نمی شود):** `apps/miniapp/views/food.js`, `apps/miniapp/assets/bus-guide.json`، `data/network.json`، `data/bus/*`، `vendor/hm7`، هر تغییر dirty شاخهٔ main.

## ۲) تفاوت های قابل مشاهده، حتی با Beta خاموش

بعد از U1 (کد سرور، بدون U2):
- روز عادی (شنبه تا چهارشنبه)، خط ۱: ساعت حرکت در `/next`، `/trains` و ردیاب عوض می شود (۱۰۱ ← ۱۱۰ حرکت خروجی، صفر برخورد دقیق). برای تابلوی قدیمی این **تغییر مستقیم دادهٔ نمایش داده شده** است و Beta خاموش آن را پنهان نمی کند.
- فیلد افزوده `event_id` و دو مقدار تازهٔ `confidence`. Mini App قدیمی مقدار ناشناخته را بدون برچسب نشان می دهد (نه خطا).
- `/api/beta` فیلد `timetable` را اضافه می کند.
- پنجشنبه، جمعه، خط ۲، خطاها، استاتیک، بسفود و بات: بدون تغییر (parity ۱۸۶۸ درخواست، صفر تخلف).

بعد از U2: رابط R3-B برای هر بازدیدکننده (حتی با Beta خاموش) دیده می شود؛ با خاموش بودن Beta فرم برنامه ریز نمایش داده نمی شود و صفحهٔ مترو همان ساختار فهرست ایستگاه و نمای خط است (`screenshots/after-r3c-390x844-beta-off-visitor.png`). با روشن بودن Beta و انتخاب اختیاری، فرم یکپارچه دیده می شود (`screenshots/after-r3c-360x740-first-screen.png`).

## ۳) ترتیب اجرا در یک پنجرهٔ بعد از GO

۱. snapshot با آزمون بازیابی: `tar` از `/srv/besrah`، `/etc/besrah-journey`، فایل ها و drop-in واحد، manifest هش دار، بازیابی به پوشهٔ موقت و مقایسه (پوشهٔ checkpoint با mode ۰۷۰۰).
۲. بازبینی پیش حالت: `preflight_overlay.py verify --state pre` برای هر دو برنامه (اگر Production عوض شده، **متوقف**، برنامه دوباره ساخته می شود).
۳. U1: `apply --plan plan-u1.json` (داده و dist)، سپس `systemctl restart besrah-core`، سپس smoke (بخش ۵).
۴. U2: `apply --plan plan-u2.json` (assets)، smoke.
۵. فقط با تأیید همین GO: `control.json` را به `{"enabled":true,"feedbackEnabled":false,"rolloutPercent":0}` تغییر بده (نوشتن موقت و `mv`، mode ۰۶۴۴، بدون restart). Beta اختیاری عمومی است؛ مالک روی Android خود `R3C-ANDROID-SMOKE-FA.md` را اجرا می کند.
۶. هر شکست smoke یا گوشی ← kill switch (بخش ۴)، سپس در صورت نیاز rollback.

بازخورد در تمام این پنجره **خاموش** می ماند. روشن کردن آن (UID واقعی، رضایت، جداسازی SYNTH، مسئول و تاریخ پاک سازی) مرحلهٔ جدا و GO جدا است.

## ۴) kill switch و rollback

- **kill switch (بدون restart، چند ثانیه):** `control.json` با `enabled:false`. UI به legacy برمی گردد؛ مدل NET01 همچنان در `/next` است.
- **بازگشت U2 (بدون restart):** `preflight_overlay.py rollback --plan plan-u2.json --target /srv/besrah --snapshot <snapshot-u2>`.
- **بازگشت U1:** همان ابزار با `plan-u1.json`، سپس `systemctl restart besrah-core`. اگر U2 هنوز اعمال است، ابتدا U2 برگردد.
- ابزار اگر فایلی در هیچ یک از دو حالت ثبت شده نباشد **متوقف می شود** و چیزی را بازنویسی نمی کند (`--force` فقط با تصمیم آگاهانه).
- آزموده شد (sandbox زیر سخت سازی Production): بازگشت U2 ← U1 باعث می شود درخت **hash به hash برابر Production زندهٔ امروز** شود.
- بازگشت نادرست: حذف دستی فایل overlay. این حالت `baseline_missing` است و روی خط ۱ روز عادی یادداشت هشدار می دهد.

## ۵) smoke پس از هر مرحله

بعد از U1 (عمومی، بدون ورود): `GET /api/beta` ← `journey.enabled:false` و `timetable.state:"applied"`؛ `GET /api/next?station=هفت‌تیر&limit=3&line=1` ← ۲۰۰ با `event_id`؛ `systemctl show besrah-core -p NRestarts -p MemoryCurrent` ← `NRestarts=0`؛ `journalctl -u besrah-core` بدون `BESRAH_TIMETABLE_OVERLAY`؛ پنجشنبه/جمعه همان خروجی پیش از انتشار؛ n8n و بات فعال.
بعد از U2: hash فایل های `views/metro.js` و `format.js` روی `https://besrah.arklyn.ir/` برابر `plan-u2.json`؛ باز شدن صفحهٔ مترو در مرورگر معمولی بدون خطای کنسول؛ بدون overflow افقی.
بعد از روشن کردن Beta: `journey.enabled:true`, `feedbackEnabled:false`؛ یک `GET /api/journey` معتبر ← ۲۰۰ و `eventId`.

## ۶) سنجه های پایش (۲۴ ساعت اول)

- `NRestarts`, `MemoryCurrent` (سقف ۱۹۲ MiB؛ benchmark: اوج cgroup ۱۴۵٫۵ تا ۱۴۷٫۳ MiB)، OOM در `journalctl`.
- ۵xx در لاگ Nginx برای `/api/`، `/api/journey`، تابلو و بسفود.
- `event loop p95` در سه اجرای benchmark بین ۲۶٫۶ و ۲۹٫۵ms بود (مبنا ۲۴٫۶ms، بودجه ۳۰ms)، یعنی **حاشیهٔ کم**. اگر در Production ۵xx یا کندی دیده شد، اول kill switch، بعد بررسی.
- پیش از استفاده: دیسک `/` ۸۹ درصد پر است (۴٫۴ GiB آزاد). snapshot حدود ۲۵ MiB است و مشکلی ندارد، اما رشد لاگ و `/var/lib/besrah-preflight` (۴۸ MiB، منتظر تأیید مالک) را زیر نظر داشته باشید.
