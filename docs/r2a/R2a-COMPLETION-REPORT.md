# گزارش پایان R2a — Real Transit Adapter & Station-to-Station Journey Planning

**تاریخ:** ۲۰۲۶-۱۱-۰۲

**وضعیت:** Adapter داخلی ساخته و روی timetable مدل موجود اجرا شده است؛ بدون Deployment، route عمومی، UI یا ورود به R2b.

## ۱. نتیجه اجرایی

برای نخستین بار، داده عملیاتی مدل فعلی مترو از طریق یک Adapter واقعی به Intelligence Core تأیید شده R1 داده می شود. ورودی، خط و شناسه فیزیکی مبدأ/مقصد و زمان آماده بودن مسافر روی سکو است. خروجی، سفرهای معتبر همان خط، انتظار و زمان حرکت، رسیدن مدل شده، شواهد و تصمیم زمان محور R1 است.

این یک مسیر یاب کل شهر، مسیریابی درب تا درب، سامانه GPS، تأیید لحظه ای خدمت یا موتور اقتصادی با کرایه معتبر نیست. همه زمان های حاصل از مدل، estimated باقی می مانند.

**نتایج تأیید شده:**

- **۶۰۱ تست ثبت شده موفق، صفر شکست**؛ شامل **۱۴۵ تست R2a** و تمام **۴۵۶ تست مبنای R1**.
- Typecheck، build، بررسی بازتولید داده اتوبوس و کنترل تغییر نکردن فایل های محافظت شده موفق.
- Oracle مستقل روی **۵۱۸۴ درخواست کوچک تولید شده** و edge case های جداگانه با نتیجه Planner منطبق بود. این تعداد داخل تست های Oracle اجرا شده است و به ۶۰۱ اضافه نمی شود.
- هر هشت نمونه CLI روی timetable واقعی مدل موجود اجرا شد؛ هر دو خط، هر دو جهت خط ۲، غدیر/فرودگاه، پنجشنبه/عادی، تقویم نامعلوم و پایان سرویس.
- Benchmark مدل واقعی و ظرفیت مصنوعی، در cgroup جدا با **MemoryMax=192 MiB و MemorySwapMax=0** موفق بودند؛ OOM و OOM kill صفر بود.
- API قبلی فقط در یک فرایند آزمایشی loopback و روی پورت موقت برای سنجش رقابت Event Loop اجرا شد؛ هیچ درخواست benchmark به Production ارسال نشد.

## ۲. حفاظت از پروژه و بازیابی کار موجود

- Worktree: `/root/projects/besrah-r2a`
- شاخه: `feature/r2a-transit-station-planner`
- مبنا: R1 تأیید شده، `50dd9eea95509ae922a278495a9abb687fcb0988`.
- checkpoint اولیه: `/var/backups/besrah/r2a-20261102T115516Z`.
- checkpoint ادامه کار و شواهد اجرا: `/var/backups/besrah/r2a-resume-20261102T140723Z`.

در بررسی زنده، worktree مستقل و بخشی از فایل های ناتمام R2a از قبل موجود بودند. قبل از ادامه، شاخه، مبنا، فایل های untracked و فرایندها بررسی و archive و hash همین فایل ها ثبت شد؛ شروع دوباره یا بازنویسی کورکورانه انجام نشد؛ فایل های ناتمام پس از checkpoint به صورت هدفمند تکمیل و اصلاح شدند. صحت فشرده سازی archive ادامه کار بررسی شد.

وابستگی های لازم در همان worktree موجود و پوشه آن مستقل از R1 بود. هیچ dependency جدید یا تغییر در package/lockfile ایجاد نشد.

مقایسه byte/hash و نام فایل ها با checkpoint اولیه:

- main: **۴۸۸۸** فایل/پیوند؛ صفر تغییر، حذف یا افزوده؛ status و index نیز دقیقاً حفظ شدند.
- worktree تأیید شده R1: **۳۶۲۷** فایل/پیوند؛ بدون تغییر.
- Production: **۲۱۷۹** فایل/پیوند؛ بدون تغییر.

main همچنان روی `3b3dbd323f73545dba355b1b285d5b1f1b9912be` باقی ماند. هیچ reset، clean، merge به main، push، تغییر limit سرویس یا restart Production انجام نشد. سرویس موجود با سقف `201326592` بایت مشاهده شد؛ این همان ۱۹۲ MiB است، نه سقفی که برای تکمیل تست بالا برده شده باشد.

## ۳. فایل ها و ماژول ها

```text
packages/core/src/transit-journey/
  contracts.ts
  validation.ts
  calendar.ts
  registry.ts
  normalize.ts
  model-source.ts
  planner.ts
  index.ts

packages/core/tests/transit-journey/
  helpers.ts
  calendar.test.ts
  registry.test.ts
  normalize.test.ts
  model-source.test.ts
  planner.test.ts
  oracle.test.ts
  integration.test.ts
  cli.test.ts

scripts/
  demo-transit-journey.mjs
  benchmark-transit-journey.mjs
  benchmark-transit-capacity.mjs

docs/r2a/
  ARCHITECTURE.md
  real-model-examples.json
  verification-summary.json
  R2a-COMPLETION-REPORT.md

docs/superpowers/plans/2026-11-02-r2a-transit-adapter.md
```

موتورهای موجود `engine.ts`، `network.ts`، `line2.ts` و `time.ts`، سرور/API، R1، UI/HM7، داده خام و workflow های موجود تغییر نکردند. ماژول جدید از سرور اصلی import نشده و route عمومی ندارد. خروجی build فقط در worktree مستقل تولید شده است.

### مسئولیت ها

- `contracts`: قرارداد درخواست، هویت ایستگاه/توقف/trip، snapshot منبع، تقویم، Journey و سقف منابع.
- `validation`: ورودی نسخه دار bounded، تاریخ/offset و constraints معتبر R1؛ رد فیلد پنهان، accessor، symbol و آرایه sparse در درخواست.
- `registry`: جداسازی ID فیزیکی از عضویت خط و sequence؛ کنترل یکتایی و پوشش ایستگاه ها.
- `calendar`: سیاست strict یا weekday baseline صریح؛ تعیین bounded تاریخ های خدمت مورد نیاز.
- `normalize`: اعتبارسنجی کامل trip و توقف ها؛ رد رکورد خراب بدون ترمیم حدسی.
- `model-source`: خواندن موتورهای موجود، fingerprint، source evidence و cache دو snapshot.
- `planner`: استخراج سفر، بررسی امکان سوار شدن، نگه داشتن گزینه های مناسب تا سقف، تبدیل به R1 و مدیریت وضعیت ناقص.
- `index`: export داخلی کتابخانه؛ نه اتصال به HTTP.

## ۴. استفاده صحیح از موتور موجود

خط ۱ از `dayTrains(forDay(network, dayType), dayEpoch, dayType)` و خط ۲ از `line2DayTrains` استفاده می کند. اعمال `forDay` برای پنجشنبه ضروری است؛ فقط تغییر فاز departure، زمان های حرکت و توقف پنجشنبه را پوشش نمی دهد.

داده قطعات خط ۱ پیش از مصرف positional توسط loader، از نظر `from/to` با ترتیب ایستگاه ها کنترل می شود. جابه جا شدن دو segment دیگر نمی تواند بی صدا زمان مسیر اشتباه بسازد. خط ۲ نیز کنترل endpoint موجود خود را حفظ کرده است.

Fingerprint از byte های واقعی network و ماژول های اجرا شده engine/network/line2/time ساخته می شود. اجرای TypeScript و JavaScript کامپایل شده می توانند hash متفاوت داشته باشند؛ این تفاوت واقعی artifact است و با بازنویسی hash پنهان نشده است. hash منبع مدل با شناسه کامل release یا امضای صحت عملیات زنده یکسان نیست.

برای پنجشنبه، `runQuality` به صورت جهت دار، measured override یا scaling با ضریب موجود `1.073` را بیان می کند و provenance مبنا با برچسب baseline باقی می ماند. مقدار baseline دیگر به عنوان کیفیت مستقیم زمان مؤثر پنجشنبه ارائه نمی شود. این اصلاح metadata در Adapter است، نه تغییر داده یا موتور فعلی.

## ۵. اعتبارسنجی سفر و هویت

هر Journey تاریخ خدمت، خط، جهت، الگوی A/B، شناسه خام قطار مدل، trip ID namespace شده، نسخه منبع و توقف های مرتب را حفظ می کند. شناسه خام کوتاه یا اصلاح نمی شود؛ hash tuple جلوی برخورد namespace را می گیرد.

ID فیزیکی ایستگاه با index آن در خط و sequence آن در trip متفاوت است. شریعتی با `METRO-117` یک ایستگاه فیزیکی با عضویت در هر دو خط است؛ این موضوع در R2a مجوز تعویض خط نیست.

Normalizer مواردی مانند نام/ID ناهماهنگ، ترتیب یا جهت اشتباه، توقف تکراری/حذف شده، الگوی مقصد ناقص، زمان منفی/نامتناهی، حرکت صفر بین دو ایستگاه متفاوت و خروج از سقف ها را رد می کند. شناسه خام تکراری، همه رکوردهای برخورد کننده را نامعتبر می کند؛ یکی به دلخواه انتخاب نمی شود. شمارش رکوردهای رد شده و issue های bounded حفظ می شوند.

الگوی A خط ۱ تا غدیر است؛ فرودگاه از آن ساخته نمی شود. الگوی B از غدیر به سمت فرودگاه ادامه دارد. terminal arrival رفت به عنوان departure برگشت استفاده نمی شود؛ برگشت trip مستقل خود را دارد.

## ۶. زمان سوار شدن و رسیدن

شرایط اصلی:

۱. مبدأ و مقصد عضو همان خط و متفاوت باشند.
۲. همان trip از مبدأ بگذرد و مقصد بعد از آن در sequence باشد.
۳. `origin.depart >= readyAt`؛ قطاری که arrival آن گذشته ولی هنوز توقف دارد، قابل انتخاب است.
۴. زمان رسیدن مقصد داخل افق درخواست باشد و ترتیب زمانی معتبر باقی بماند.

برابری با departure در سیاست مدل مجاز است. زمان واقعی بسته شدن درها یا buffer سوار شدن بدون منبع ساخته نشده است؛ این یک فرض اعلام شده مدل است، نه تضمین عملیاتی.

- انتظار: `origin.depart - readyAt`.
- زمان حرکت داخل وسیله، شامل توقف میانی: `destination.arrive - origin.depart`.
- مدت کل از سکو: `destination.arrive - readyAt`.
- زمان رسیدن: `destination.arrive`.

Layover پس از رسیدن به مقصد به سفر اضافه نمی شود. مسافری که در پایانه منتظر حرکت برگشت است، با departure همان trip برگشت ارزیابی می شود. مختصات ردیاب و endpoint نمایشی `/next` هیچ نقشی در این محاسبات ندارند.

## ۷. روز خدمت، نیمه شب و تقویم

`readyAt` زمان آماده بودن مسافر روی سکوی مبدأ با offset صریح است. تاریخ CLI میلادی و ساعت آن تهران است؛ زمان خروج از منزل، walking یا transfer به آن اضافه نشده است.

- strict: برای روز غیرجمعه، اعلان صریح روز خدمت با source/version لازم است؛ بدون آن، نتیجه تقویم نامعلوم است.
- جمعه از weekday میلادی تشخیص داده می شود و به مدل Friday موجود نگاشت می شود؛ این اثبات اجرای زنده، نبود تعطیلی استثنایی یا اعتبار برنامه در سال های آینده نیست.
- weekday_baseline: انتخاب صریح استفاده از مدل روز هفته بدون تأیید تعطیلات است؛ خروجی دارای هشدار `partial` می ماند.
- اعلان تعطیل می تواند به Friday model نگاشت شود؛ روز عادی به پنجشنبه نامعتبر تبدیل نمی شود.

اعلان تقویم caller، یک سیاست با provenance صریح است؛ Adapter تقویم تعطیلات بیرونی را مستقلاً تأیید نمی کند.

روز قبل فقط در پنجره امکان spill با invariant چهار ساعته trip بررسی می شود. روز بعد فقط با عبور افق جست و جو از نیمه شب بررسی می شود. تاریخ خدمت با تاریخ مدنی رسیدن یکی فرض نمی شود. نامعلوم بودن یکی از روزهای لازم باعث partial یا insufficient_data می شود، نه fallback بی صدا به normal.

**محدودیت صریح:** هر trip باید در تاریخ خدمت اعلام شده خود آغاز شود و پایان bounded پس از نیمه شب مجاز است. الگوهای دلخواه خدمت شبانه، از جمله تعریف یک leg تازه پس از نیمه شب با برچسب روز قبل، پشتیبانی عمومی ندارند؛ رکورد ناسازگار رد و نقص منبع آشکار می شود. timetable فعلی در سناریوهای واقعی بررسی شده بدون رد trip معتبر بارگذاری شد.

## ۸. قرارداد اتصال به Intelligence Core

قرارداد R1 تغییر نکرد. Candidate دارای domain برابر transit و task/equivalenceKey برای همین خط، مبدأ/مقصد، ساعت، افق، سیاست تقویم و نسخه منبع است.

- Objective فعلی: کمینه کردن `arrivalEpochSeconds`.
- `durationSeconds` و `arrivalEpochSeconds`: estimated با فرض های مدل و Evidence.
- زمان انتظار و حرکت: `NumericMetric` همان R1 در `journeys[].metrics`؛ نه کلید اضافی و ناسازگار در Candidate نسخه ۱.
- `totalCostToman`: unknown؛ هیچ کرایه صفر یا ادعای اقتصادی ترین مسیر وجود ندارد.
- `walkingSeconds`: not_applicable برای محدوده platform-to-platform.
- `transfers`: فقط برای itinerary کامل همان trip برابر صفر.

Source evidence عیناً حفظ می شود؛ fixture به منبع واقعی مدل منتسب نمی شود. Evidence جداگانه derivation، فرمول های انتظار/حرکت/رسیدن را ثبت می کند و Evidence تقویم نیز مستقل است. حداکثر شش مدرک منبع با دو مدرک Adapter/تقویم، سقف هشت مدرک R1 را حفظ می کنند. همه non-live هستند؛ زمان مشاهده یا retrieval ساختگی درج نشده است.

Constraints سخت پیش از نگه داشتن گزینه ها اعمال می شوند. با کرایه مجهول و قید بودجه، نتیجه نامعلوم است؛ قید حذف نمی شود. گزینه های اثبات شده نامعتبر، نامعلوم و معتبر در نگه داشتن bounded اولویت مستقل دارند، سپس زمان رسیدن ملاک است.

حذف گزینه بالقوه معتبر/نامعلوم به دلیل cap، پوشش را ناقص می کند. حذف گزینه ای که نقض قید آن از قبل اثبات شده، diagnostics محدود شدن را نگه می دارد ولی infeasibility اثبات شده را به کمبود داده تبدیل نمی کند.

Caller باید `JourneyResult.status` را رعایت کند. `decision.status` داخلی فقط درباره گزینه های واقعاً تحویل شده به R1 است و به تنهایی کامل بودن تقویم یا منبع را اثبات نمی کند. `TimetableSource` نیز یک مرز typed و نرمال شده داخلی است، نه ورودی JSON شخص ثالث.

## ۹. نمونه واقعی اجرای مدل

**این ها اجرای واقعی کد روی مدل فعلی هستند، نه تأیید وقوع تاریخی یا خدمت لحظه ای. همه زمان های سفر تخمینی اند؛ اعشار مدل به معنی دقت واقعی نیست.**

```sh
cd /root/projects/besrah-r2a
npm --prefix packages/core run build
node scripts/demo-transit-journey.mjs --stations
node scripts/demo-transit-journey.mjs --examples
node scripts/demo-transit-journey.mjs --line 1 --from METRO-101 --to METRO-124 --date 2026-10-16 --time 14:00:00 --calendar strict
```

در جمعه **۲۰۲۶-۱۰-۱۶، ساعت ۱۴:۰۰ تهران**:

- وکیل آباد → غدیر: ۶ Candidate، انتخاب `B-out-19`؛ departure ساعت **14:12:00** و رسیدن مدل **14:52:37.800**.
- وکیل آباد → فرودگاه: ۳ Candidate، همان `B-out-19`؛ رسیدن مدل **15:02:35.800**. الگوی A در این گزینه ها وجود ندارد.
- خط ۲ از `METRO-201` به `METRO-213`: ۸ Candidate؛ `L2-out-35` با departure ساعت **14:00:00** و رسیدن **14:29:32.300**.
- جهت برگشت خط ۲: `L2-back-35`، departure ساعت **14:00:00** و رسیدن **14:29:46.300**.

در **پنجشنبه ۲۰۲۶-۱۰-۲۲** با weekday_baseline صریح، وکیل آباد → غدیر با `B-out-16`، departure ساعت **14:05:17** و رسیدن **14:47:12** استخراج شد؛ status برابر partial است چون تعطیلات تأیید نشده اند.

در **دوشنبه ۲۰۲۶-۱۰-۱۹**، خط ۲ با weekday_baseline خروجی دارد ولی partial است؛ همان تاریخ با strict و بدون اعلان تقویم، `insufficient_data` و صفر سفر می دهد.

جمعه ساعت **23:59** با افق ۳۰ ثانیه، `no_feasible_option` داد. افق عمداً داخل همان روز است؛ افق عبوری به شنبه نامعلوم نباید به عنوان قطعیت نبود خدمت روز بعد معرفی شود.

JSON خلاصه هر هشت اجرا همراه با trip ID کامل و زمان ها در `real-model-examples.json` موجود است. خروجی کامل CLI در checkpoint خصوصی ثبت شده و با دستور بالا قابل بازتولید است.

## ۱۰. آزمون ها و Oracle

اجرای نهایی سری، با یک worker و بدون file parallelism:

- Core: **۳۷۴** تست موفق.
- Mini App / data / n8n: **۱۹۸** تست موفق.
- Release Inventory Python: **۱۲** تست موفق.
- Bus Catalogue Python: **۱۷** تست موفق.
- جمع: **۶۰۱**؛ شکست: صفر.

تست های R2a: Calendar ده، Registry یک، Normalization پنجاه، Model Source سی و یک، Planner هجده، Oracle پانزده، Integration شانزده و CLI چهار؛ جمع **۱۴۵**.

پوشش مستقل شامل سفر هر دو خط، زودترین رسیدن به جای اولین departure، dwell و مرز departure، از دست رفتن قطار، جهت مخالف، آخرین حرکت، غدیر/فرودگاه، normal/Thursday/Friday، مرز نیمه شب و تقویم نامعلوم، خط/ایستگاه نامعتبر، شناسه تکراری، داده خراب و نبود مسیر است.

Oracle با حلقه ساده روی همه زوج توقف ها و کمینه گیری arrival نوشته شده؛ از helper استخراج، تقویم، فیلتر یا رتبه بندی Planner استفاده نمی کند. مجموعه generated شامل **۵۱۸۴** ترکیب خط سیر کوچک، زمان آمادگی، افق و cap است. تست های integration جداگانه هر دو خط را در **۲۰۲۶-۱۰-۱۶، ۲۰۲۶-۱۰-۲۲ و ۲۰۲۶-۱۰-۱۹** با timetable موجود و Oracle روی snapshot کامل مقایسه می کنند.

دستورهای اجرایی:

```sh
npm --prefix packages/core run typecheck
npm --prefix packages/core test -- --maxWorkers=1 --no-file-parallelism
node --test --test-concurrency=1 apps/miniapp/*.test.mjs tests/data/*.test.mjs tests/n8n/*.test.mjs
python3 -W error::ResourceWarning -m unittest discover -s tests/release -v
python3 -W error::ResourceWarning -m unittest discover -s tests/data -p 'test_*.py' -v
python3 scripts/build_bus_app_data.py --check
npm --prefix packages/core run build
```

همه exit code صفر داشتند. API و موتور قبلی علاوه بر تست هایشان، با مقایسه byte و Git diff محافظت شدند؛ هیچ assertion معتبر قبلی ضعیف نشد. تست CLI موجود نیز اصلاح شد تا آرایه flag ها را واقعاً به عنوان یک row دریافت کند، نه صرفاً کاراکترهای نخستین flag را رد کند.

## ۱۱. Benchmark مستقل R2a

Benchmark از build فعلی اجرا شد؛ از نتایج R1 برای تضمین کارایی استفاده نشد. ۲۰ تکرار برای نمونه های مدل واقعی، concurrency حداکثر چهار، API client یکی و cache منبع دو snapshot بود. نتایج نمونه محلی اند، نه SLO یا ظرفیت قطعی Production.

```sh
node --expose-gc scripts/benchmark-transit-journey.mjs --iterations 20 --concurrency 4
node scripts/benchmark-transit-capacity.mjs --iterations 10
```

همین workload ها به صورت جداگانه داخل واحدهای transient آزمایشی systemd با `MemoryMax=192M` و `MemorySwapMax=0` اجرا شدند. این واحدها پس از اجرا پایان یافتند؛ سرویس دائمی یا معماری جدید ساخته نشد. supervisor پایتون نیز داخل همین سقف بود.

### مدل واقعی

- اولین ساخت source: **8.98 ms**؛ این عدد شامل reset کردن cache سیستم عامل/JIT نیست.
- p95 برنامه ریزی cold snapshot: **32.26 ms**.
- p95 برنامه ریزی warm: **3.80 ms**.
- p95 برنامه ریزی هم زمان با concurrency چهار: **12.89 ms**.
- MAX RSS کرنل برای فرایند Node، شامل benchmark و سرور آزمایشی: **107.76 MiB**.
- peak حافظه charge شده cgroup، شامل supervisor: **60.50 MiB**؛ OOM و limit-hit صفر.

RSS و accounting cgroup تعریف یکسان ندارند، به ویژه درباره صفحات مشترک؛ نباید یکی را به جای دیگری گزارش کرد. عبور موفق این نمونه فقط همین workload را تأیید می کند، نه رفتار نامحدود یک فرایند Production در طول زمان.

### HTTP و Event Loop در همان فرایند

سرور موجود با `buildServer` روی `127.0.0.1` و پورت موقت اجرا و route موجود مترو درخواست شد؛ هیچ route جدیدی ساخته نشد. خروجی قطار فعال بررسی و socket پس از آزمون بسته شد. تماس ارائه دهنده غذا صفر بود.

p95 پاسخ HTTP در ۲۰ درخواست هر فاز:

- پایه بدون Planner: **5.10 ms**.
- Planner هم زمان با cache گرم: **14.75 ms**.
- فشار cache، با clear پیش از هر submission: **48.60 ms**؛ درخواست های هم کلید هم زمان هنوز می توانند hit داشته باشند، بنابراین این عدد «تمام درخواست ها cold مستقل» نیست.

بیشینه Event Loop delay در این فازها به ترتیب حدود **7.37 / 13.66 / 41.75 ms** بود. در هر فاز دارای Planner، ۱۰ پاسخ HTTP هنگام فعال بودن کار Planner تکمیل شدند. یک نوبت yield به معنی CPU موازی نیست؛ normalization و R1 هنوز بخش های synchronous دارند.

### ظرفیت مصنوعی

این probe عمداً **۵۱۲ trip مصنوعی** با ۲۴ توقف، افق شش ساعت و cap برابر **۶۴ Candidate** ساخت؛ زمان های آن داده شهر نیستند و وارد محصول نشده اند.

- ۱۰ تکرار؛ بیشینه normalization: **86.36 ms**؛ بیشینه plan: **80.11 ms**.
- ۶۴ Candidate و **۲۰۱۶** جفت در pass اصلی R1؛ status درست به دلیل cap برابر partial.
- MAX RSS: **79.60 MiB**؛ peak charge شده cgroup: **37.14 MiB**؛ بدون OOM.
- probe ترکیبی normalization/Planner، بیشینه تأخیر heartbeat حدود **140.53 ms** نشان داد؛ این بخش را نباید پاسخگویی آنی معرفی کرد.

### نتیجه عملی منابع

نمونه های محدود در سقف حافظه عبور کردند؛ اما تأثیر محسوس بر Event Loop و latency وجود دارد، به ویژه با cache سرد و ظرفیت مصنوعی. قبل از اتصال عمومی باید budget پاسخگویی، admission/concurrency، warmup و سیاست invalidation تعیین و آزمون طولانی تری انجام شود. این مرحله مجوز افزودن worker، microservice، افزایش limit یا بازنویسی موتور نیست و چنین تغییری انجام نشده است.

## ۱۲. بازبینی و اصلاح ریشه ای

بازبینی مستقل چهار ایراد پیدا کرد که با تست بازتولید و اصلاح شدند:

۱. انتساب ثابت منبع در Planner به جای حفظ lineage واقعی؛ اکنون Evidence منبع حفظ و derivation جدا می شود.
۲. نبود کنترل endpoint قطعات خط ۱ پیش از loader positional؛ داده جابه جا شده رد می شود.
۳. ارائه کیفیت baseline برای زمان های مؤثر پنجشنبه؛ provenance جهت دار override/scaling اضافه شد.
۴. تبدیل نبود مسیر اثبات شده به insufficient_data فقط به دلیل حذف گزینه های خلاف قید؛ این دو حالت جدا شدند.

در بازبینی مجدد static، یافته مسدود کننده باقی نماند. بررسی تکمیلی عامل اصلی نیز حرکت صفر بین ایستگاه های متفاوت را با RED بازتولید و رد کرد. تست ها و benchmark های نهایی پس از اصلاح ها دوباره اجرا شدند. بازبینی static به جای شواهد runtime یا cgroup معرفی نشده است.

## ۱۳. عدم قطعیت و محدودیت های باقی مانده

- داده منبع، مدل فعلی است؛ نه GPS، تأخیر لحظه ای، تضمین حرکت یا تأیید در دسترس بودن واقعی.
- normal phase و خط ۲ فرض های برنامه حرکت دارند؛ measured phase نیز کل سفر را known نمی کند.
- بخش غدیر/فرودگاه و بخشی از زمان ها مشتق/فرضی مدل اند؛ confidence، runQuality و نسخه حفظ شده اند.
- `derivedExtension` از الگوی کامل trip می آید؛ توقف های slice شده Journey و lineIndex مشخص می کنند کدام قطعه واقعاً در سفر انتخابی است.
- تقویم تعطیلات مرجع جامع و صحت عملیات استثنایی هنوز موجود نیست؛ baseline صریح، partial است.
- محدودیت چهار ساعت span و آغاز trip در روز خدمت، جای پشتیبانی عمومی سرویس شبانه نیست.
- حافظه/candidate/cache bounded به معنی امکان پذیرش تعداد نامحدود درخواست یا تضمین peak آینده نیست؛ آزمون طولانی Production انجام نشده است.
- انتظار و حرکت در sidecar Metric هستند؛ اولویت های متعدد جدید یا schema جدید R1 در این فاز اضافه نشده اند.
- هزینه، walking بیرون ایستگاه، entrance، transfer، accessibility و ظرفیت واقعی قطار تأمین نشده اند؛ مقدار مطلوب حدس زده نمی شود.
- `TimetableSource` قابل اعتماد داخلی است؛ Provider JSON خارجی به اعتبارسنجی و منبع داده جدا نیاز دارد.

## ۱۴. تفاوت با تابلو فعلی و باقی مانده R2b

تابلو موجود عبور بعدی یک ایستگاه را نمایش می دهد و ممکن است قطار با arrival گذشته را کنار بگذارد. Adapter، مبدأ/مقصد و امکان سوار شدن تا departure و رسیدن مقصد را در یک trip کامل بررسی می کند؛ به همین دلیل می تواند هنگام dwell گزینه قابل استفاده پیدا کند که در `/next` نمایش داده نمی شود. تغییر رفتار تابلو یا endpoint برای این موضوع انجام نشده است.

برای R2b باید جداگانه درباره این موارد تصمیم گرفته شود: ورودی/خروجی خیابانی و walking معتبر، تعویض خط و حداقل زمان انتقال دارای منبع، کرایه و مقایسه اقتصادی واقعی، تقویم مرجع و اعتبار خدمت، سیاست محصول برای cache/concurrency/latency، اتصال API/UI و محدودیت مجوزها. هیچ کدام در R2a اجرا نشده اند.

## ۱۵. Commit ها و شواهد تحویل

چهار Commit کد/تست، مستقل از مبنای R1:

- `7338f96` — قراردادهای bounded سفر، ایستگاه و تقویم صریح.
- `c41ff22` — نرمال سازی موتورهای بدون تغییر، lineage و cache محدود.
- `b238f4b` — Planner متصل به R1، Oracle مستقل و integration واقعی.
- `26ef374` — CLI و benchmark های مستقل latency/ظرفیت.

Commit مستندات تحویل پس از این واحدها ثبت می شود و SHA نهایی در پیام تحویل خواهد بود. تاریخچه قبلی بازنویسی نشده است.

`verification-summary.json` دستورها، exit code و شمارش تست، hash فایل های کد/تست/script، benchmark ها، cgroup، حفاظت از وضعیت و نتیجه بازبینی را ثبت می کند. این خروجی، امضای release یا attestation زنجیره build تا Production نیست.

Digest ورودی های ثبت شده:

```text
73fcce8e636dc95051fc9f28d4a25360ee7999eba3274cc9ba60ac30cab24086
```

لاگ های کامل، خروجی کامل CLI و شواهد خصوصی checkpoint در Git یا فایل ارسالی عمومی قرار نگرفته اند. هیچ credential یا حافظه واقعی کاربر در خروجی های جدید نیست.

## ۱۶. پایان مرحله

R2a مسئله واقعی سفر همان خط از سکو به سکو را با داده مدل موجود حل می کند و نتیجه قابل ردیابی را به R1 می دهد. محدودیت ها و ریسک منابع به صراحت ثبت شده اند.

**R2a در همین محدوده پایان یافته است. R2b، اتصال عمومی API/UI، تغییر Production و Deployment انجام نشده اند و به تأیید جداگانه نیاز دارند.**
