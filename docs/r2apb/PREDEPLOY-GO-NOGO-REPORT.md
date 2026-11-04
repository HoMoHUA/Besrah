# گزارش Go/No-Go پیش از استقرار — R2a-PB

**نتیجه: `CONDITIONAL_NO_GO` برای فعال سازی Beta برای کاربران؛ استقرار «خاموش» (flag off) از نظر فنی آماده است.**

این گزارش جایگزین برچسب `READY_FOR_OWNER_GO` گزارش قبلی نیست، آن را اصلاح می کند: پیش پرواز (preflight) پنج مشکل واقعی پیدا کرد که گزارش قبلی نمی دید، یکی از آن ها مسدودکننده بود و همه در همین شاخه رفع و با آزمون ثابت شدند. هیچ فایل Production، Nginx، سرویس، بات یا داده خام اصلی تغییر نکرد؛ هیچ merge، deploy یا فعال سازی انجام نشد.

- شاخه: `feature/r2a-production-beta`، کد مرحله فریز شده در `597b7742ab979841ab5f64fe0ea113902b955edd`؛ commit های بعد از آن فقط اسناد، اسکریپت های عملیاتی و شواهد هستند.
- مبنای تأییدشده: D2 `8e8e278`؛ هیچ commit قبلی بازنویسی نشد.

## ۱. یافته های پیش پرواز و رفع آن ها

| # | یافته | شدت | شاهد | رفع |
|---|---|---|---|---|
| F1 | هسته هیچ handler برای `SIGTERM` نداشت. `systemctl stop/restart` هسته را بدون اجرای `onClose` می کشت و قفل `.feedback.lock` باقی می ماند. نتیجه: بعد از **هر** restart یا deploy، ثبت بازخورد تا حذف دستی قفل `503` می داد (برنامه ریز و بقیه سرویس سالم می ماند). | **مسدودکننده** | اجرای `R1/R2` در واحد با sandbox معادل Production شکست خورد (۴۳ PASS و ۲ FAIL). خروجی آن اجرا بعداً با اجرای سالم بازنویسی شد؛ همان شکست با کد قبل از رفع دوباره تولید و در `evidence/F1-red-before-fix.txt` ذخیره شد (process با SIGTERM کشته می شود، کد خروج `null`). نسخه نهایی sandbox ۴۵ از ۴۵ | `98a2e48`: `src/shutdown.ts` با سقف ۱۰ ثانیه (کمتر از `TimeoutStopSec=15`)، تست process واقعی SIGTERM/SIGINT/سیگنال دوم + ۴ تست واحد، RED→GREEN |
| F2 | کارت برنامه ریز فونت دومی (Vazirmatn وزن ۴۰۰) را به جای AzarMehr سیستم HM7 بارگذاری می کرد: دو فونت در یک صفحه و bold مصنوعی. | متوسط (انحراف از HM7) | `tokens.css`: `--font-sans: "AzarMehr", "Vazirmatn", …`؛ AzarMehr در Production با ۲۰۰ سرو می شود | `d041ee1`: ارث بری فونت HM7، حذف asset و ورودی allowlist؛ تأیید در مرورگر: `AzarMehr` در ۸ ترکیب |
| F3 | با flag خاموش (وضعیت درست بعد از استقرار) کارت «مترو · Beta … این بخش موقتاً خاموش شده است» برای **همه** بازدیدکنندگان صفحه مترو دیده می شد. | متوسط (UX Production فعلی) | مرورگر روی نمونه خاموش | `61f419a`: کارت برای کسی که دعوت یا opt-in نداشته مخفی است (idle/loading/disabled/config_error)؛ ۲ تست جدید + `[hidden]` در CSS |
| F4 | متن رضایت نمی گفت گزارش ناشناس بعداً قابل انتساب یا حذف فردی نیست. | کم تا متوسط (حریم خصوصی/شفافیت) | UI برای کاربر هیچ شناسه رسیدی نشان نمی دهد | `404cbed`: جمله صریح؛ تست اینکه عدد ۳۰ روز یا وعده حذف در متن نیست (چون پاک سازی خودکار وجود ندارد) |
| F5 | دامنه واقعی استقرار با «۷۰ مسیر فقط در candidate» فرق داشت: `bus-guide.json` و `views/food.js` در candidate با Production اختلاف دارند ولی **مربوط به PB نیستند**؛ ماژول های `transit-journey` و `intelligence` هرگز مستقر نشده اند؛ `dist/server.js` Production از `8e8e278` عقب است (hunk startup غذا از R0). کپی کورکورانه ریشه پروژه تابلو و بسفود را عوض می کرد. | بالا (ریسک استقرار) | `docs/r2apb/evidence/release-overlay-plan.json` | `45c78f4`: ابزار overlay با allowlist و hash قبل/بعد (۳۶ فایل)، رد در هر drift، snapshot، rollback بایت به بایت، ۸ تست + ۴ mutation کشته شده |
| F6 | مسیر `/etc/besrah` برای فایل کنترل مناسب نیست: مجوز `0700` دارد و کاربر DynamicUser نمی تواند بخواند؛ Beta بی صدا خاموش می ماند (fail-closed). | متوسط (خطای عملیاتی) | `evidence/preflight-control-private-dir.txt` | مسیر `/etc/besrah-journey/control.json` در Runbook |

بررسی های دیگر که مشکلی نداشتند: لایه فقط خواندنی نتیجه ثابت (۶۲ مسیر قدیمی در نمونه اول و ۱۲۸ از ۱۳۳ مسیر در مقایسه نهایی بایت به بایت برابر، ۵ تغییر دقیقاً همان فایل های برنامه)، CSP یکسان، هیچ وابستگی npm جدید، dist از export تمیز Git با worktree بایت به بایت برابر.

## ۲. جدول شروط

وضعیت ها: `PASS`، `PASS_EQUIVALENT` (در محیط معادل و ایزوله آزموده شد؛ تأیید نهایی در پنجره استقرار)، `AWAITING_HUMAN`، `NOT_TESTED`، `OWNER_DECISION`.

| شرط | وضعیت | شاهد و توضیح |
|---|---|---|
| ۱. Telegram WebView واقعی روی گوشی | **AWAITING_HUMAN** | `DEVICE-WEBVIEW-QA-FA.md`. Hermes به گوشی دسترسی ندارد؛ Chromium به جای آن PASS نخورد. این آزمون نیاز به نمونه ای دارد که Beta در آن روشن باشد (بخش ۴، تصمیم D2). |
| ۲. UID و sandbox واقعی سرویس | **PASS_EQUIVALENT** | واحد گذرا با همان ویژگی های امنیتی `besrah-core.service` (`DynamicUser`، `ProtectSystem=strict`، `ProtectHome`، `PrivateTmp`، `NoNewPrivileges`، `UMask=0077`، `MemoryMax=192M`، `TasksMax=64`، بدون capability) و `StateDirectory` آزمایشی: ۴۵ از ۴۵ بررسی؛ پوشه ۰۷۰۰، فایل ۰۶۰۰، مالک غیر root، قفل، restart، SIGKILL، فایل ناقص، symlink، مجوز، همزمانی. تفاوت: نام واحد و نام StateDirectory، و `MemorySwapMax` (Production بی نهایت، آزمون ما سخت تر: صفر). واحد واقعی دست نخورد؛ تأیید نهایی در بخش ۵ Runbook. |
| ENOSPC | PASS (با شرط عملیاتی) | tmpfs ۴۸KiB: ۴۶ رکورد `201`، بعد فقط `503`، برنامه ریز `200`، شمار ACK برابر خطوط پایدار. **دم فایل ممکن است ناقص بماند** و store آن را fail-closed می کند (اصلاح دستی طبق Runbook). |
| ۳. Nginx / TLS / Origin | **PASS_EQUIVALENT** | (الف) `nginx -t` روی کپی **کل** پیکربندی واقعی با fragment درج شده: موفق (هشدار «protocol options redefined» در پیکربندی فعلی هم هست). (ب) Nginx خصوصی روی `127.0.0.1:18443` با گواهی واقعی `besrah.arklyn.ir` (اعتبارسنجی TLS موفق)، متن واقعی snippet (فقط پورت مقصد عوض شد)، zone واقعی `besrah_api`، و core نامزد: ۲۰ از ۲۰ (فقط POST دقیق، سایر مسیر/متدها ۴۰۳، query ⇒ ۴۰۰، >۴KiB ⇒ ۴۱۳، Origin بیگانه ⇒ ۴۰۳، جعل X-Real-IP/XFF بی اثر، بدون access log). Nginx فعال نصب و reload نشد؛ این کار پیش نیاز بخش ۶ Runbook است. |
| ۴. snapshot Production | **PASS_PREPARED** | ابزار و فرمان ها آماده؛ تمرین کامل روی کپی `/srv/besrah`: apply ⇒ verify ⇒ rollback و `diff -r` با Production واقعی صفر. snapshot واقعی فقط در پنجره استقرار گرفته می شود. |
| ۵. پایش ۲۴ ساعت | **PASS_PREPARED** | `scripts/beta_probe.py` با آستانه های ثابت (۹ تست)؛ روی نمونه واقعی OK/WARN/قفل مانده را تشخیص داد. اجرای ۲۴ ساعته فقط پس از استقرار ممکن است. |
| A. ممیزی release | PASS | ۶۶ فایل نسبت به D2 (کد، تست، اسناد، اسکریپت؛ فقط ۳۶ فایل به Production می رود)؛ طبقه بندی و allowlist (بخش ۳)؛ بازتولیدپذیری dist؛ kill switch سمت سرور (K1–K6) |
| B. سطح دسترسی | **OWNER_DECISION (D1)** | `ACCESS-AND-FEEDBACK-THREAT-MODEL.md`: کد فعلی یک Beta اختیاری عمومی است؛ allowlist هویت دار وجود ندارد و ادعا نمی شود. |
| C. sandbox شبیه Production | PASS_EQUIVALENT | ردیف ۲ |
| D. Nginx | PASS_EQUIVALENT | ردیف ۳ |
| E. فونت و HM7 | PASS (پس از رفع F2) | AzarMehr در ۸ ترکیب ۳۲۰/۳۶۰/۳۹۰/۷۶۸ × روشن/تیره: بدون overflow، RTL، بدون ثانیه، بدون عنصر بریده |
| F. سیاست بازخورد | PASS + OWNER_DECISION (D3) | خوداظهاری هرگز مستقل نمی شود (`anonymous_unverified`، `independentlyVerified=false`)؛ پاک سازی ۳۰ روزه **دستی** است |
| G. عملکرد | PASS | بخش ۵ |

## ۳. دامنه استقرار (candidate در برابر deployed)

`scripts/preflight_overlay.py plan` در برابر `/srv/besrah` واقعی: **۳۶ فایل**.

- **dist (۳۱):** فقط PB: `journey-beta/*` (۷ فایل جدید) و `shutdown.js` (جدید)؛ جایگزین شونده: `server.js`، `miniapp.js`، `time.js`، `index.js`؛ و ۱۹ فایل جدید `transit-journey/*` (۸) و `intelligence/*` (۱۱) که از مراحل R1/R2a هستند و تا امروز مستقر نشده اند.
- **Mini App (۵):** `api.js`، `app.css`، `journey.js`، `ui/planner.js`، `views/metro.js` (آخرین فایل).
- **عمداً مستقر نمی شوند (drift بی ربط):** `apps/miniapp/views/food.js`، `apps/miniapp/assets/bus-guide.json`، `data/bus/**` و همه تست ها/اسناد.
- **توجه مالک:** `dist/server.js` نامزد فقط PB نیست؛ Production از `8e8e278` عقب است و فایل جدید hunk راه اندازی R0 را هم دارد (کاتالوگ غذا اختیاری است؛ نبود آن ترانزیت را از راه انداختن باز نمی دارد). این تغییر در R0 بازبینی و تست شده بود (تست های `food-status` در مجموعه سبز). ماژول های جدید `transit-journey/intelligence` هنگام راه اندازی بارگذاری می شوند، ولی منبع مدل و store بازخورد فقط هنگام نیاز ساخته می شوند و با flag خاموش هیچ route جدید فعال نیست (حافظه بیکار نمونه ≈ ۳۴MiB در برابر ≈ ۳۳MiB فعلی). تصمیم D5.
- مانیفست release: `validate` موفق؛ candidate = `committed_source_snapshot`، deployed = `deployed_snapshot` مستقل.

## ۴. تصمیم های لازم از مالک (قبل از GO)

| کد | تصمیم | پیشنهاد |
|---|---|---|
| D1 | مدل دسترسی | **Beta اختیاری عمومی با برچسب Beta.** هر کس بتواند وارد شود؛ فقط «محدود به آزمونگران» نگویید مگر احراز هویت سمت سرور ساخته شود (در threat model هزینه و ریسک آن آمده). توجه: `rolloutPercent=0` کارت ورود را برای دیگران پنهان **نمی کند**؛ فقط «برجسته سازی» را کنترل می کند. روشن کردن flag یعنی ورود اختیاری برای همه بازدیدکنندگان. |
| D2 | محل آزمون گوشی | چون کارت وقتی روشن شود برای همه است، آزمون گوشی نخستین پنجره فعال سازی در Production با **`feedbackEnabled:false`** باشد؛ پس از PASS بازخورد باز شود. گزینه دوم: مالک یک نشانی پیش نمایش خصوصی (vhost جدا) تأمین کند که در این مرحله ساخته نشد. |
| D3 | اجرای retention | بدون cron مجاز: پاک سازی دستی ماهانه با `purge` طبق Runbook. در UI عدد روز وعده داده نشده است. |
| D4 | قفل مانده پس از crash (SIGKILL/OOM) | **fail-closed بماند** و پروب هشدار دهد؛ پاک کردن خودکار بر پایه «PID مرده» ریسک reuse دارد و بدون تصمیم جدا ساخته نشد. |
| D5 | قبول دامنه ۳۶ فایل (شامل hunk R0 در `server.js` و ماژول های بی اثر R1/R2a) | بله، با allowlist و rollback آزموده. |
| D6 | دو مرحله GO | `PRODUCTION_DEPLOY_GO` برای بخش های ۱ تا ۶ Runbook (کد، فایل ها، واحد و Nginx؛ همگی با Beta خاموش)، و تأیید جدا برای فعال سازی (بخش های ۷ و ۸). |

## ۵. آزمون ها و benchmark (روی کد نهایی)

- `tsc`، `npm run build`: موفق. Vitest سری: **۴۰ فایل، ۵۰۶ تست**. Mini App Node: **۱۵۲**. n8n: **۲۱**. Python data: **۱۶۷**. release: **۲۰**. بازتولید داده اتوبوس: بدون diff. (`evidence/regression-summary.txt`، مبنا `597b774`)
- sandbox: **۴۵ از ۴۵**، Nginx replica: **۲۰ از ۲۰**، مقایسه API قدیمی: ۱۲۸ از ۱۳۳ بدون تغییر + ۵ تغییر مورد انتظار + ۰ ناخواسته.
- benchmark (cgroup ۱۹۲MiB، swap صفر، سرور و client جدا، بودجه ها تغییر نکردند): سه اجرای ۱۰۰ نمونه ای و یک اجرای ۳۰۰ نمونه ای، **هر چهار `WITHIN_BUDGETS`**:

| سنجه | سقف | بازه چهار اجرا |
|---|---|---|
| warm p95 | ≤ ۸۰ms | ۶.۹ تا ۸.۰ |
| cold | ≤ ۲۵۰ms | ۸۷ تا ۱۰۰ |
| concurrency دو p95 | ≤ ۱۵۰ms | ۱۱.۶ تا ۱۲.۳ |
| cache churn p95 | ≤ ۲۰۰ms | ۵۰.۵ تا ۵۳.۲ |
| API قدیمی در بار ترکیبی p95 | ≤ ۵۰ms | ۴.۶ تا ۸.۶ (افزایش ۱.۶ تا ۶.۶ از سقف ۳۰) |
| ثبت بازخورد p95 | ≤ ۵۰ms | ۸.۶ تا ۱۱.۶ |
| بازگشایی store نزدیک سقف | ≤ ۵۰۰ms | ۴۱۴ تا ۴۷۲ |
| event loop p95 / max | ≤ ۳۰ / ۱۵۰ms | ۲۵.۰ تا ۲۵.۹ / ۳۹.۶ تا ۴۸.۰ |
| RSS سرور | ≤ ۱۷۰MiB | ۱۳۸.۷ تا ۱۴۶.۶ |
| اوج cgroup | ≤ ۱۸۴MiB | ۱۵۰.۳ تا ۱۸۱.۲ |

حاشیه های کم که باید پایش شوند: **اوج cgroup در اجرای ۳۰۰ نمونه ای ۱۸۱.۲MiB (فقط ۲.۸MiB زیر سقف)** که بخش بزرگ آن page cache نوشتن فایل های benchmark و fixture ۷MiB است نه RSS سرور؛ event loop p95 حدود ۱۷٪ زیر سقف؛ بازگشایی store فقط در راه اندازی مجدد و تا ۱۷٪ زیر سقف. با یک بار اضافی دو پردازه چرخان روی ۴ هسته (در اجرای جدا) هم بودجه ها رد نشدند.

حافظه سرویس: Production اکنون ≈ ۳۳MiB؛ نمونه candidate در حالت بیکار ≈ ۳۴MiB و بعد از ۲۰ درخواست ≈ ۴۰MiB. بار قابل پذیرش واقعی با rate limit حداکثر ۶۰ درخواست برنامه ریز و ۳۰ تلاش ثبت در دقیقه است؛ benchmark عمداً از این بالاتر است.

## ۶. ریسک های باقی مانده

1. **قفل مانده پس از crash/OOM** (D4): ثبت بازخورد fail-closed می شود، برنامه ریز و بقیه سرویس سالم می مانند، پروب `WARN` می دهد؛ اصلاح طبق Runbook. در restart عادی دیگر رخ نمی دهد (F1 رفع شد).
2. **دیسک ۸۳٪ پر** (`/` با ۶.۸GB آزاد): سقف store فقط ۸MiB است ولی دیسک پر شدن دیگر سرویس ها ENOSPC و دم ناقص ایجاد می کند. پروب هشدار می دهد.
3. **retention دستی** (D3) و **عدم امکان حذف فردی** بازخورد ناشناس.
4. **پایش event loop در Production** ممکن نیست (logger خاموش و بدون instrumentation)؛ پروکسی آن latency API قدیمی است.
5. rate limit بر پایه IP با X-Real-IP فقط در لبه Nginx قابل اعتماد است؛ هر کاربر روی همان میزبان loopback می تواند آن را جعل کند (برای تهدید خارجی بی اثر، چون Nginx overwrite می کند و core فقط به loopback اعتماد می کند).
6. نمونه های ۱۰۰ تا ۳۰۰ تایی روی میزبان مشترک SLO نیستند.
7. محدودیت داده محصول بدون تغییر: مدل زمان بندی، نه موقعیت زنده؛ تعطیلات رسمی تأیید نشده؛ R2b بسته است.

## ۷. چه چیزی نتیجه را به `READY_FOR_FINAL_OWNER_GO` تبدیل می کند

۱. نتیجه `PASS` از فرم `DEVICE-WEBVIEW-QA-FA.md` روی حداقل یک گوشی Android با Telegram واقعی (و iOS اگر ممکن بود)؛
۲. تصمیم مالک برای D1 تا D6؛
۳. در پنجره استقرار: گذراندن بخش ۵ Runbook (واحد واقعی با drop-in بالا بیاید و `StateDirectory` واقعی ساخته شود) و بخش ۶ (نصب fragment، `nginx -t`، smoke دقیق)، و rollback در صورت هر شکست.

بدون این ها، پاسخ `PRODUCTION_DEPLOY_GO` برای بخش های ۱ تا ۶ (همه با Beta خاموش) از نظر فنی ممکن است ولی **فعال سازی** برای کاربران مجاز نیست.

## ۸. اجرا نشده ها (صادقانه)

Telegram WebView واقعی و iOS؛ اجرای واقعی unit/Nginx Production؛ پایش ۲۴ ساعته؛ بار واقعی چند کاربر؛ پاک سازی/purge روی داده واقعی (داده واقعی وجود ندارد)؛ خواندن بازخورد واقعی (هیچ مشاهده میدانی یا گزارش واقعی تاکنون ثبت نشده است). مجموعه `tests/browser/*.js` به مرورگر و محیط دیگر نیاز دارد و در این مرحله اجرا نشد؛ جایگزین آن ماتریس مرورگر و مقایسه ۱۳۳ مسیر بود.

## ۹. شواهد

مسیر خصوصی: `/var/backups/besrah/r2apb-final2-20261103T140321Z/`. نسخه فشرده کم حجم در `docs/r2apb/evidence/`:

- `preflight-sandbox-e2e.json` (۴۵ بررسی)، `preflight-nginx-edge.json` (۲۰ بررسی)، `preflight-enospc.txt`، `preflight-control-private-dir.txt`
- `api-regression-candidate-vs-production.txt`، `release-overlay-plan.json`
- `benchmark-summary.json`، `regression-summary.txt`، `regression-head.txt`

نکته: نتیجه شکست خورده sandbox پیش از رفع F1 (بررسی های R1/R2) و دو اجرای benchmark ناموفق قدیمی در checkpoint خصوصی نگه داشته شده اند و حذف نشده اند.
