# گزارش استقرار خاموش R2a-PB (Flag-OFF)

**نتیجه: استقرار خاموش با موفقیت انجام شد؛ Beta برای کاربران غیرفعال است.** هیچ مرحله ای از بخش های ۷ و ۸ Runbook اجرا نشد، `enabled` و `feedbackEnabled` هر دو `false` هستند، هیچ بازخوردی ثبت یا نوشته نشد.

زمان اجرا: ۲۰۲۶-۱۱-۰۳، ۱۶:۱۴ تا ۱۶:۲۴ UTC (حدود ۱۹:۴۴ تا ۱۹:۵۴ تهران)، یعنی یک پنجره کم ترافیک: صفر اتصال برقرار به هسته در لحظه شروع.

## ۱. نسخه و commit ها

- شاخه `feature/r2a-production-beta`، HEAD استقرار: **`587accb6d92e4a93c468047745743b856c651804`**؛ working tree تمیز.
- فاصله تا freeze شناخته شده `597b7742ab97…`: فقط مستندات و یک اسکریپت عملیاتی (`scripts/preflight_api_regression.py`). تفاوت در `packages/`، `apps/` و `data/` صفر است (بررسی شده با `git diff --stat`). کد مستقر همان کد freeze است.
- commit های بعد از مبنای D2 (`8e8e278`) تا HEAD: `93a2cd1`، `ed1f21b`، `b986875`، `462c93d`، `98a2e48` (SIGTERM)، `d041ee1` (فونت HM7)، `61f419a` (کارت مخفی)، `404cbed` (متن رضایت)، `45c78f4`، `a1bd6ff`، `597b774`، `6e47f9b`، `32c991b`، و `587accb` (اصلاح ردیف ۹ فرم QA).
- ابتدا همین HEAD دوباره اجرا شد (نتایج گزارش قبلی تعمیم داده نشد): `tsc` موفق؛ `npm run build` موفق؛ Vitest **۴۰ فایل / ۵۰۶ تست** موفق؛ Mini App **۱۵۲**؛ n8n **۲۱**؛ Python data **۱۶۷**؛ release **۲۰**؛ بازتولید داده اتوبوس بدون diff. خروجی ها در `$CK/regression/`.
- dist یک export تمیز Git با dist worktree بایت به بایت برابر بود.

## ۲. اصلاح فرم QA (ردیف ۹)

انتظار ردیف ۹ برای خط ۲ با مدل واقعی همخوان نبود. با اجرای واقعی موتور تأیید شد که کارت های خط ۲ فقط مقصد «شهید فکوری» (به سمت انتهای خط) یا «طبرسی» (جهت برعکس) دارند. ردیف ۹ اصلاح شد و ردیف جدید `۹-الف` برای تفکیک «غدیر / فرودگاه / وکیل آباد» روی خط ۱ اضافه شد. فقط مستندات تغییر کرد (`587accb`)، نه UI یا موتور.

## ۳. دامنه استقرار: ۳۶ فایل دقیق

plan دوباره روی Production واقعی ساخته شد و با plan بازبینی شده preflight مقایسه شد: **همان مجموعه مسیرها، همان hash های candidate و همان وضعیت قبلی Production**، یعنی Production از زمان preflight هیچ drift نداشت. فهرست کامل با hash کامل ۶۴ نویسه ای: `docs/r2apb/evidence/deploy-hashes-before-after.json`.

dist (۳۱ فایل): ۷ فایل جدید `journey-beta/*`؛ جدید `shutdown.js`؛ جایگزین شده `index.js`، `miniapp.js`، `server.js`، `time.js`؛ ۱۹ فایل جدید `transit-journey/*` (۸) و `intelligence/*` (۱۱).
Mini App (۵ فایل): جایگزین `api.js`، `app.css`، `views/metro.js`؛ جدید `journey.js`، `ui/planner.js`.

hash قبل و بعد (۱۰ نویسه اول؛ `-` یعنی فایل وجود نداشت):

| فایل | قبل | بعد |
|---|---|---|
| dist/index.js | 8047a62e8c | d2e936acf9 |
| dist/miniapp.js | e99c356b78 | e2a60f82ec |
| dist/server.js | 68e3e2620b | 81ed51af44 |
| dist/time.js | 7ace7f4fad | f1a0f7fc17 |
| app/api.js | 8b9a662177 | dc5d91a53a |
| app/app.css | d5c3f0a74b | e8eda45e63 |
| app/views/metro.js | a8c459284b | 425fd1b158 |
| ۲۹ فایل جدید (dist و دو فایل Mini App) | - | در JSON |

اثبات دامنه: مقایسه کل درخت `/srv/besrah` با tar قبل از تغییر: **۲۱۷۹ ⇒ ۲۲۰۸ فایل، ۷ تغییر، ۲۹ افزوده، ۰ حذف**؛ مجموع تغییر و افزوده برابر plan است، **هیچ تغییر خارج از plan وجود ندارد**، و هر ۳۶ فایل با hash candidate برابر است. `views/food.js`، `assets/bus-guide.json`، `data/bus/**` و هر فایل تست یا سند منتشر نشدند؛ manifest بعد از استقرار دقیقاً همین دو فایل را (`food.js` و `bus-guide.json`) به عنوان تفاوت candidate با deployed نشان می دهد و `deployed_only=0`.

## ۴. snapshot و بازیابی (پیش از هر نوشتن)

مسیر خصوصی (`0700`، فایل ها `0600`، بدون session یا credential، commit نشده): `/var/backups/besrah/pb-deploy-20261103T161435Z/`

شامل: `srv-besrah-before.tar.gz` (۴.۳MiB، SHA-256 در `srv-besrah-before.sha256`)، واحد systemd قبلی، فایل site و snippet Nginx قبلی، خروجی کامل `nginx -T` قبل، `unit-before.txt`، وضعیت سرویس های دیگر، `manifest-before.json`، `api-before.json` (۱۳۳ مسیر)، plan، و `overlay-snapshot/` (نسخه قبلی هر فایل جایگزین شده).

**راستی آزمایی restore پیش از تغییر:** tar در مسیر جدا باز شد و با `/srv/besrah` زنده `diff -r` گرفته شد: **بایت به بایت برابر**. **بعد از استقرار** rollback روی یک کپی از Production جاری اجرا شد و نتیجه با درخت snapshot برابر بود (`diff -r` صفر؛ پوشه های ساخته شده توسط overlay نیز حذف شدند). rollback روی Production واقعی اجرا نشد.

## ۵. واحد واقعی `besrah-core`

- drop-in نصب شد: `/etc/systemd/system/besrah-core.service.d/journey-beta.conf` (`StateDirectory=besrah-feedback`، `0700`، env های Beta). فایل واحد اصلی تغییر نکرد؛ `systemd-analyze verify` موفق.
- کنترل: `/etc/besrah-journey/control.json` (root، `0644`، جایگزینی اتمیک) با محتوای صریح `{"schemaVersion":1,"enabled":false,"feedbackEnabled":false,"rolloutPercent":0}`.
- `BESRAH_JOURNEY_BETA=on` در محیط process هست، اما چون فایل کنترل `enabled:false` دارد، هیچ route فعال نیست. این وضعیت مشخصاً با فایل خوانا آزموده شد، نه با شکست خواندن: process با uid پویا **61187** (غیر root) اجرا می شود و همان uid محتوای فایل کنترل را خواند (هم از بیرون و هم داخل mount namespace سرویس).
- `StateDirectory`: `/var/lib/private/besrah-feedback`، `0700`، مالک `61187:61187`؛ symlink `/var/lib/besrah-feedback`. داخل sandbox سرویس: نوشتن در state dir ممکن (probe موقت با `0600`، بلافاصله حذف شد)، `/srv/besrah` و `/etc/besrah-journey` فقط خواندنی (`Read-only file system`). **شمار فایل ها در state dir صفر است؛ نه فایل بازخورد، نه `.feedback.lock`.**
- زمان شروع جدید: `ExecMainStartTimestamp=16:18:27`، `MainPID=724194` (قبلی `47379`)، `NRestarts=0`، `Result=success`. حافظه `38.7MiB` (قبل ۳۳ تا ۴۱MiB)، `MemoryMax=192M` دست نخورده، `MemorySwapMax` دست نخورده (infinity، مثل قبل). دو restart انجام شد (بعد از dist و بعد از drop-in) و restart دوم نیز تمیز بود؛ هیچ حالت `start-limit` رخ نداد.
- مجوز فایل `0600` و ساخت قفل در Production **آزمایش نشد** چون نوشتن بازخورد ممنوع بود؛ در preflight روی واحد معادل ثابت شده بود (۴۵/۴۵).

## ۶. Nginx

- فقط `/etc/nginx/snippets/besrah-miniapp-root.conf` تغییر کرد: **۲۴ خط افزوده، ۰ خط حذف شده**، فقط fragment دقیق `docs/r2a-pb/nginx-feedback-route.conf` پیش از `location ^~ /api/`. snippet قبل و فایل site در snapshot هست.
- `nginx -t`: **successful** (هشدار «protocol options redefined» از `panel-8099-https.conf` از قبل وجود داشت). فقط بعد از `nginx -t` موفق، `nginx -s reload` اجرا شد؛ master PID `1111` عوض نشد.
- smoke روی **دامنه واقعی** `https://besrah.arklyn.ir` (۱۵ از ۱۵ PASS، هیچ بدنه یا داده ای ذخیره نشد):

| درخواست | انتظار | نتیجه |
|---|---|---|
| POST `/api/beta`، `/api/journey`، `/api/trains`، `/app.js`، `/` | ۴۰۳ | ۴۰۳ |
| GET و HEAD و PUT روی `/api/journey-feedback` | ۴۰۳ | ۴۰۳ |
| POST `/api/journey-feedback/x` (زیر مسیر) | ۴۰۳ | ۴۰۳ |
| POST با query (`?token=x`) | ۴۰۰ | ۴۰۰ |
| POST بدنه بیش از ۴KiB | ۴۱۳ | ۴۱۳ |
| POST مسیر دقیق، بدون header (Beta خاموش) | ۴۰۴ | ۴۰۴ |
| POST مسیر دقیق، Origin بیگانه (Beta خاموش) | ۴۰۴ | ۴۰۴ |
| GET `/api/journey` (Beta خاموش) | ۴۰۴ | ۴۰۴ |
| GET `/api/beta` | ۲۰۰، `enabled:false` | ۲۰۰ |

لاگ خطای Nginx بعد از reload فقط شش خط «access forbidden by rule» از همین smoke (client `<VPS_HOST>` یعنی همین سرور) دارد؛ خطای دیگری برای vhost بسراه نیست.

## ۷. regression و سلامت (Beta خاموش)

- **۱۳۳ مسیر قدیمی** (`/health`، `/app/api/next` و `trains` برای ۵ زمان ثابت و چند ایستگاه، `food-status`، ۶۵ asset و `/app/`) پیش و پس از استقرار بایت به بایت مقایسه شد: **۱۲۸ برابر، ۵ تغییر مورد انتظار (دقیقاً ۵ فایل Mini App)، ۰ ناخواسته**. در مرحله میانی (پس از dist، پیش از asset ها) دو مسیر جدید `/app/journey.js` و `/app/ui/planner.js` با `404` و بدنه متفاوت دیده شدند؛ چون آن ها تازه به allowlist اضافه شده بودند و فایلشان هنوز نبود. بعد از مرحله Mini App برطرف شد.
- API جدید خاموش: `/app/api/journey` ⇒ ۴۰۴ و POST بازخورد ⇒ ۴۰۴ روی هسته و روی دامنه عمومی.
- سرویس های دیگر: n8n، Nginx، `claude-bot`، `radepa-customer-bot`، `sajjadi-bot`، `sharifian-products-bot`، `sharifian-social-bot`، `instagram-bot` همگی **همان PID و active** (مقایسه قبل/بعد). بسفود (کاتالوگ و `food-status`) در ۱۳۳ مسیر بایت به بایت برابر ماند.
- پروب ۴ دقیقه ای (۴ نمونه): API قدیمی p95 بین ۱.۶ و ۳.۸ms، حافظه ثابت ۳۸.۷MiB، ۵xx صفر، restart صفر، OOM صفر. وضعیت هر نمونه `WARN` است فقط چون پروب نمونه موفق برنامه ریز ندارد (Beta خاموش است)؛ این WARN عمدی و طبیعی است و «سالم» نیست بلکه «بی نتیجه» معنا می دهد.
- دیسک: ۶.۷GiB آزاد.
- journal واحد: هیچ هشدار یا خطا بعد از شروع.

## ۸. صفحه فعلی برای بازدیدکننده عادی: تغییر قابل مشاهده

آزمون در مرورگر روی `https://besrah.arklyn.ir/` (بدون `?beta=1`، بدون opt-in):

- کارت برنامه ریز **مخفی** است (`hidden`، `display:none`، ارتفاع صفر، متن صفر)، هیچ عبارت «Beta» یا «برنامه ریز» دیده نمی شود؛ تابلو، ردیاب و فونت (AzarMehr) سالم هستند. screenshot در checkpoint خصوصی (`browser/production-ordinary-visitor-metro.png`).
- با لینک `?beta=1` فقط پیام «این بخش موقتاً خاموش شده است» دیده می شود، بدون کنترل و بدون فرم.

**دو اختلاف صادقانه با عبارت «بدون هیچ تغییر قابل مشاهده»** (هر دو در diff بازبینی شده بودند، ولی در گزارش های قبلی صریحاً بیرون کشیده نشده بودند):

1. در کارت «درباره زمان های مترو» پایین صفحه مترو، یک جمله عوض شد. قبل: «خط ۱ دو سرویس دارد: A بین وکیل آباد و غدیر و B بین وکیل آباد و فرودگاه…». بعد: «خط ۱ قطارهای جداگانه به سمت غدیر و فرودگاه دارد؛ قطار برگشت به سمت وکیل آباد می رود. مقصد قطار را بررسی کنید…». دلیل: حذف نشان A/B مطابق دستور قبلی شما (نمایش مقصد واقعی به جای حرف سرویس).
2. هر بار باز شدن صفحه مترو، یک `GET /api/beta` اضافه از طرف مرورگر هر بازدیدکننده ارسال می شود (برای فهمیدن روشن بودن Beta). پاسخ ثابت و سبک است (`enabled:false`)، تحت محدودیت ۵ درخواست بر ثانیه Nginx، و در ۱۳۳ مسیر آزمون و در پروب هیچ اثر منفی دیده نشد.

اگر هر کدام از این دو برای شما نامطلوب است، می توان تغییر را در همین مرحله با rollback یا نسخه اصلاح شده برگرداند؛ استقرار فعلی را بدون تصمیم شما عوض نکردم.

## ۹. رخدادها

هیچ مورد از آستانه های توقف رخ نداد: mismatch فایل یا manifest، شکست Nginx یا واحد، پاسخ نادرست API قبلی، ظاهر شدن Beta، ۵xx جدید، قفل یا مجوز نادرست، OOM یا restart غیرعادی، افت سلامت مترو و بسفود. rollback اجرا نشد. `--force`، `reset --hard`، `clean` و تغییر سقف حافظه استفاده نشد.

نکته پاکسازی: پس از استقرار، فقط وضعیت آزمایشی خودم را حذف کردم: `/var/lib/private/besrah-pb-preflight` (بازخورد ساختگی sandbox مربوط به preflight) که هیچ ارتباطی با store واقعی `besrah-feedback` ندارد. پوشه `/var/lib/besrah-preflight` (کپی های staging ۴۸MiB، بدون راز) باقی ماند و فقط روی دیسک است؛ در صورت تأیید شما پاک می شود.

## ۱۰. آمادگی rollback (کامل، آزموده شده روی کپی)

ترتیب (جزئیات و فرمان ها در `RELEASE-RUNBOOK.md` بخش ۱۰، مسیر checkpoint: `/var/backups/besrah/pb-deploy-20261103T161435Z`):

1. kill switch سطح ۱ (در وضعیت فعلی لازم نیست؛ Beta از ابتدا خاموش است).
2. Nginx: `cp $CK/snippet-before.conf /etc/nginx/snippets/besrah-miniapp-root.conf && nginx -t && nginx -s reload`.
3. `rm /etc/systemd/system/besrah-core.service.d/journey-beta.conf && systemctl daemon-reload`.
4. `python3 scripts/preflight_overlay.py rollback --plan $CK/plan.json --target /srv/besrah --snapshot $CK/overlay-snapshot && systemctl restart besrah-core`.
5. `release_inventory validate` با `manifest-before.json` و `preflight_api_regression compare` با `api-before.json` ⇒ باید ۱۳۳ از ۱۳۳ برابر باشد.

پوشه `/var/lib/private/besrah-feedback` (فعلاً خالی) هرگز با rollback حذف نمی شود. گزینه نهایی: بازیابی کامل از `srv-besrah-before.tar.gz` (hash ثبت شده).

## ۱۱. وضعیت در لحظه پایان

| مورد | وضعیت |
|---|---|
| `enabled` / `feedbackEnabled` | `false` / `false` (فایل کنترل) |
| `/app/api/beta` (عمومی) | `{"journey":{"enabled":false,"rolloutPercent":0,"feedbackEnabled":false,…}}` |
| `/api/journey`، POST بازخورد | ۴۰۴ |
| فایل بازخورد و قفل | وجود ندارد (state dir خالی) |
| `besrah-core` | active، PID `724194`، `NRestarts=0`، ۳۸.۷MiB از ۱۹۲MiB |
| rollback | آماده و روی کپی آزموده |

## ۱۲. اجرا نشده و باقی مانده

- Telegram WebView واقعی روی گوشی (نیازمند پنجره فعال سازی جداگانه، `AWAITING_HUMAN`) و iOS.
- جمع آوری بازخورد: بر اساس D3، تا تعیین مسئول اجرا و تاریخ نخستین بررسی/حذف فعال نمی شود؛ این هنوز تعیین نشده است.
- پایش ۲۴ ساعته با Beta روشن (فقط پس از فعال سازی معنا دارد). پروب اکنون آماده است.
- مجوز نوشتن/قفل/۰۶۰۰ روی store واقعی Production به دلیل ممنوعیت smoke بازخورد آزموده نشده؛ شاهد معادل preflight است.

**کار همین جا متوقف است.** منتظر پیام مستقل شما برای: (الف) تصمیم درباره دو اختلاف بخش ۸، (ب) پنجره کوتاه QA گوشی با `enabled:true` و `feedbackEnabled:false`، (ج) سپس بازخورد. هیچ کدام بدون پیام تأیید شما اجرا نمی شود.
