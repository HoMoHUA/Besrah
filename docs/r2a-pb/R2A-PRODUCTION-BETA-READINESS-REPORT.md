# گزارش آمادگی R2a-PB — برنامه ریز سفر مترو (آزمایشی)

> **Addendum پیش پرواز:** برچسب `READY_FOR_OWNER_GO` در این گزارش بعد از preflight کامل اصلاح شد. نتیجه فعلی در `docs/r2apb/PREDEPLOY-GO-NOGO-REPORT.md` است: `CONDITIONAL_NO_GO` برای فعال سازی؛ پنج یافته (از جمله مسدودکننده ای که قفل بازخورد را بعد از هر restart می بست) رفع شدند و HEAD تغییر کرده است. اعداد benchmark این گزارش مربوط به commit `b986875` بودند؛ اعداد نهایی در `docs/r2a-pb/BENCHMARK-RESULTS.md` و `docs/r2apb/evidence/benchmark-summary.json` آمده اند. همچنین فونت کارت از Vazirmatn به AzarMehr سیستم HM7 اصلاح شد (بند ۶ همین گزارش درباره «فونت محلی Vazirmatn» دیگر صادق نیست).


**نتیجه: `READY_FOR_OWNER_GO`** — با پنج شرط پیش از عمومی کردن که در بخش ۷ آمده اند. این نتیجه مجوز استقرار نیست. بدون GO جداگانه مالک هیچ merge، deploy یا فعال سازی Production انجام نمی شود، و این مرحله هیچ فایل Production، Nginx، سرویس یا بات را تغییر نداد.

## ۱. چه چیزی ساخته شد

- قابلیت: برآورد حرکت و رسیدن **روی یک خط، ایستگاه به ایستگاه، از لحظه آماده بودن روی سکوی مبدأ**، با موتور واقعی R1/R2a و timetable مدل شده. نه مسیریاب درب به درب، نه زمان زنده، نه ضمانت رسیدن، نه اتوبوس، نه کرایه، نه سریع ترین مسیر شهر.
- API فقط خواندنی `GET /app/api/journey` و `GET /app/api/beta`، پیش فرض خاموش (`BESRAH_JOURNEY_BETA`)، با فایل کنترل اختیاری که هر ناسازگاری آن را خاموش می کند (بدون restart).
- مسیر نوشتنی جداگانه `POST /app/api/journey-feedback` با رضایت صریح، schema زمان اجرا، سقف ۴KiB، rate limit، بررسی Origin/Fetch-Metadata، store دائمی JSONL فقط افزایشی با قفل نویسنده تنها و retention تعریف شده.
- UI در صفحه فعلی مترو، با HM7 Commerce و بدون بازطراحی صفحه خانه: کارت ورودی غیراجباری، خروج از بتا، انتخاب خط/مبدأ/مقصد، «همین الان روی سکو هستم» یا روز و ساعت (`Asia/Tehran`)، کارت های حرکت/رسیدن تخمینی، انتظار و مدت داخل قطار به دقیقه (بدون ثانیه)، و فرم بازخورد اختیاری.
- متن ثابت نزدیک نتایج: «این زمان ها برآورد مدل برنامه قطارند، نه موقعیت زنده. زمان رسیدن شما از ورودی ایستگاه به سکو، پیاده روی و جابه جایی بین خطوط محاسبه نشده است.»
- برای غیرجمعه ها `weekday_baseline` فقط با هشدار ثابت و آشکار؛ `strict` و اعلام معتبر تقویم در قرارداد حفظ شده اند و strict بدون تقویم معتبر گزینه نمی سازد. جمعه تضمین عملیاتی نیست.
- گزارش آفلاین تجمیعی `scripts/beta_feedback_report.py` که بدون داده کافی فقط «دقت هنوز اندازه گیری نشده است» می گوید و MAE/P90 را بدون حداقل ۳۰ مشاهده بازبینی شده مستقل محاسبه نمی کند.

## ۲. وضعیت Git و candidate/deployed

- شاخه `feature/r2a-production-beta`، مبنا D2 `8e8e278`. working tree تمیز است. هیچ commit قبلی تغییر نکرد.
- commit ها:
  - `93a2cd11843d4e059174901dbe4bb21849a7476c` — هسته: API، control، limits، store بازخورد، اصلاح عملکرد و تست ها
  - `ed1f21bc77e893bf019f5691f9a2dda36325a033` — UI Mini App و تست های آن
  - `b986875f5fc7f9ad02e793db1e0ea8152f42f86e` — benchmark، گزارش آفلاین، preview، اسناد rollout (و بعد از آن commit همین گزارش)
- bundle و بازیابی: `/var/backups/besrah/r2apb-final2-20261103T140321Z/r2a-pb-complete.bundle`؛ درخت Git بازیابی شده با درخت اصلی برابر بود (`f49f333a…`).
- manifest `R2A-PB.manifest.json` در همان checkpoint: candidate `committed_source_snapshot` با HEAD `b986875…` و `dirty:false`؛ deployed `deployed_snapshot` مستقل؛ تفاوت: ۸ فایل تغییر کرده، ۷۰ فایل فقط در candidate، ۰ فقط در deployed، ۸۳ برابر. validate موفق بود. این manifest هویت فایل است، نه اثبات build یا مجوز استقرار.
- شش محدوده محافظت شده قبلی (main، R1، R2a، R2b، D1، D2) و Production `/srv/besrah` با hash فایل/HEAD/status/index برابر ماندند (`protected-after.json`). سرویس `besrah-core` همان PID `47379` و `MemoryMax=192M`.

## ۳. نتایج تست

| مجموعه | نتیجه |
|---|---|
| `tsc --noEmit` و `npm run build` | موفق |
| Vitest (سری، `--maxWorkers=1 --no-file-parallelism`) | ۳۸ فایل، **۴۹۹ تست موفق** (۱۲۵ تست beta، از جمله ۵ تست جدید برای بازاستفاده snapshot و زمان تهران) |
| Node Mini App | **۱۴۹ موفق** (۳۵ تست جدید planner/journey/api) |
| Node n8n | ۲۱ موفق |
| Python data (شامل D1/D2 و ۷۲ تست گزارش بازخورد) | ۱۵۸ موفق |
| Python release inventory | ۱۲ موفق |
| بازتولید داده اتوبوس (`build_bus_app_data.py`) | خروجی بایت به بایت برابر؛ بدون diff |

پوشش رفتار: دو خط و دو جهت، غدیر و فرودگاه، dwell/departure، نیمه شب، جمعه/پنجشنبه/روز عادی/تعطیل نامعلوم، expiry، ورودی نامعتبر، چند گزینه و بدون گزینه، خطای مدل و timeout. پوشش feedback: consent، تمایز arrival/departure/رسیدن شخص، timestamp/timezone نامعتبر، duplicate، spam، سقف اندازه، retention، حمله به endpoint، و اینکه بازخورد timetable را تغییر نمی دهد. آلودگی provider با شیء تغییرپذیر یا proxy رد می شود. ریشه یابی اصلاح عملکرد با mutation تأیید شد (حذف شرط frozen تست را شکست می دهد).

## ۴. Benchmark

جزئیات کامل در `BENCHMARK-RESULTS.md`. خلاصه: اجرای نخست `BUDGET_MISSED` (سه بودجه) بود؛ ریشه یابی نشان داد هم روش اندازه گیری (client و server در یک process) و هم هزینه واقعی سرور (ساخت Intl formatter در هر فراخوانی و اعتبارسنجی مجدد snapshot) مقصر بود. پس از اصلاح، **سه اجرای پیاپی در cgroup ۱۹۲MiB بدون swap `WITHIN_BUDGETS`** بود: warm p95 ≤ ۷.۷ms، cold ≤ ۹۶.۳ms، API قدیمی در بار ترکیبی p95 ≤ ۵.۸ms (افزایش ≤ ۳.۸ms)، event loop p95 ≈ ۲۵ms (سقف ۳۰)، RSS سرور ≤ ۱۴۱.۳MiB، اوج cgroup ≤ ۱۵۴.۵MiB، OOM صفر. بودجه ها تغییر نکردند. حاشیه event loop و بازگشایی store کم است و باید پایش شود.

## ۵. امنیت و حریم خصوصی

- نوشتن فقط یک route دقیق؛ Nginx فعلی دست نخورده است. fragment نامزد در یک Nginx مستقل loopback آزموده شد: GET بتا ۲۰۰، POST به `/api/beta` و `/api/stations` و `/app.js` ۴۰۳، GET روی مسیر feedback ۴۰۳، query روی مسیر feedback ۴۰۰، مسیر اضافه ۴۰۳، بدنه نامعتبر ۴۰۰، بدنه بزرگ ۴۱۳ (`nginx-route-verification.json`).
- بدون IP/hash، user agent، حساب، initData، GPS یا آدرس؛ کلید rate فقط pseudonym موقت در حافظه. هویت همیشه `anonymous_unverified`، `independentlyVerified=false`، `modelTimetableUpdated=false`.
- یادداشت کوتاه ۲۰۰ نویسه ای، با رد URL/markup/دستور/ایمیل/شماره/مختصات؛ این فیلتر کاهش دهنده است و اثبات عدم وجود اطلاعات شخصی نیست.
- store خراب، symlink، مالکیت ناایمن، خط ناقص و قفل مانده fail-closed هستند و هرگز خودکار ترمیم نمی شوند. مسیر store زیر `/tmp` عمداً رد می شود.

## ۶. UX و مرورگر

- Chromium روی ۳۲۰، ۳۶۰، ۳۹۰ و ۷۶۸ پیکسل، روشن/تیره، با و بدون reduced motion: بدون overflow، RTL، فونت محلی Vazirmatn، ۵ گزینه، متن مدل و هشدار تقویم دیده شد، صفر کنترل بریده (`browser/matrix.json` و ۸ screenshot در checkpoint قبلی `r2apb-finalize-…`). UI از آن زمان تغییر نکرد (mtime فایل ها قبل از matrix است). پس از آخرین build یک smoke زنده روی preview loopback هم انجام شد: ورود به بتا، هفت تیر به دانش آموز، نتیجه ناقص با هشدار baseline، گزینه های غدیر/فرودگاه با ساعت HH:MM و فرم بازخورد.
- هیچ popup اجباری برای نظر وجود ندارد؛ استفاده بدون بازخورد کامل ممکن است.
- **تست Telegram WebView واقعی روی گوشی انجام نشده است**؛ Chromium جای آن را نمی گیرد. وضعیت: `NOT_TESTED`.

## ۷. Release Readiness Checklist

| مورد | وضعیت | شاهد |
|---|---|---|
| نمایش درست عدم قطعیت (تخمینی، مدل، آزمایشی، هشدار baseline) | PASS | تست های UI/API، matrix مرورگر، smoke زنده |
| بدون آسیب به API قبلی | PASS | regression کامل، delta بار ترکیبی ≤ ۳.۸ms، beta خاموش ۴۰۴ و APIهای قدیمی ۲۰۰ در تست |
| امنیت endpoint بازخورد (schema، اندازه، Origin، rate، duplicate، کنترل ناسازگار) | PASS | ۱۲۵ تست beta، Nginx مستقل، fail-closed |
| بودجه latency و event loop | PASS | سه اجرای v3 (پس از رفع ریشه ای شکست v2) |
| سقف ۱۹۲MiB، swap صفر، OOM صفر | PASS | cgroup peak ≤ ۱۵۴.۵MiB |
| concurrency محدود و burst | PASS | فقط ۲۰۰ یا ۴۲۹؛ نه ۵۰۰ و نه صف نامحدود |
| بازیابی خطای مدل/ذخیره ساز | PASS | benchmark و تست ها |
| backup و rollback آزموده | PASS (rehearsal مستقل) | bundle و بازیابی درخت برابر، kill switch در تست، rollback مستند |
| تأیید مرورگر و RTL | PASS (Chromium) | matrix و screenshot |
| Telegram WebView واقعی | **NOT_TESTED** | شرط ۱ |
| اجرا با UID و sandbox واقعی سرویس | **NOT_TESTED** | شرط ۲ |
| TLS/Origin نهایی و نصب fragment روی Nginx واقعی | **NOT_TESTED** (عمداً نصب نشده) | شرط ۳ |
| snapshot/backup Production پیش از استقرار | پس از GO | شرط ۴ |
| دسترسی داوطلبانه واقعی کاربران (opt-in، برچسب Beta، share کنترل شده) | طراحی و تست شده؛ اجرا پس از GO | `ROLLOUT-AND-ROLLBACK.md` |

شرط های لازم پیش از عمومی کردن:

1. آزمون Telegram WebView روی حداقل یک گوشی واقعی: RTL، صفحه کلید، ورودی ساعت، consent و ارسال با اینترنت ضعیف.
2. آزمون store بازخورد با UID و StateDirectory واقعی سرویس و sandbox (قفل، مجوز ۰۷۰۰/۰۶۰۰).
3. نصب و آزمون fragment دقیق POST روی Nginx واقعی در پنجره مجاز، با `nginx -t` و rollback آماده.
4. snapshot کامل release، dist، Mini App، فایل های واحد سرویس و fragment فعلی Nginx پیش از هر تغییر.
5. پایش ۲۴ ساعت نخست (latency، 429/5xx، event loop، RSS، OOM)؛ هر عبور از بودجه یا رگرسیون تابلو یعنی خاموشی بتا.

## ۸. ریسک ها و محدودیت های داده

- timetable مدل شده است، نه موقعیت زنده؛ تقویم تعطیلات رسمی تأیید نشده؛ فازهای برخی قطارها اندازه گیری نشده اند. «سریع تر» فقط درون همین مدل است.
- زمان ورود از خیابان به سکو، پیاده روی و تعویض خط محاسبه نمی شود. R2b به دلیل نبود شواهد داخلی ورودی/سکو/زمان پیاده **باز نشد** و هیچ مشاهده میدانی واقعی تاکنون ثبت نشده است.
- بازخورد ناشناس شاهد مستقل نیست؛ برای هر برآورد دقت باید حداقل ۳۰ مشاهده زمان دار بازبینی شده مستقل، با خط/ایستگاه/جهت/رخداد/زمان تهران، تطبیق معتبر و مجموعه held-out جدا وجود داشته باشد. تا آن زمان پیام رسمی: «بازخورد جمع آوری شده، دقت هنوز اندازه گیری نشده».
- ریسک spam و آلودگی با rate limit، سقف روزانه (۲۰۰۰) و سقف ۸MiB کنترل می شود؛ مهاجم هماهنگ می تواند سقف روزانه را پر کند. اثر آن قطع ثبت بازخورد است، نه خرابی مترو/بسفود.
- هر تغییر در ماژول های مسیر مدل `modelVersion` را عوض می کند؛ بازخوردهای نسخه قبل `model_version_mismatch` می شوند.
- چرخه بهبود: ingest → QC → مشاهده مستقل → تحلیل خطا به تفکیک خط/جهت/روز/ساعت → کالیبراسیون در شاخه آزمایشی → ارزیابی held-out → تصویب مالک → نسخه جدید. هیچ گزارش تکی timetable را عوض نمی کند.

## ۹. توقف

کار این مرحله همین جا متوقف شد. در انتظار تصمیم مالک: `GO` برای شروع مراحل ۰ تا ۲ در `ROLLOUT-AND-ROLLBACK.md` (پس از شرط های ۱ تا ۴)، یا درخواست تغییر.
